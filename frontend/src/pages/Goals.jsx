import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Avatar, CountUp, Cover, ErrorBox, Hint, PageHead, Stat, Progress, Skeleton, fmtDate, today, useAsync } from '../ui.jsx';
import ChangePassword from '../ChangePassword.jsx';
import PushSettings from '../PushSettings.jsx';
import { DeleteAccount } from '../Profile.jsx';
import EntryDetail from '../EntryDetail.jsx';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const fmt = (n) => (n ?? 0).toLocaleString('tr-TR');

export default function Goals() {
  return (
    <>
      <PageHead title="Hedefler" sub="Aylık ve yıllık hedeflerin, yıl özetin ve okumak istediklerin." />
      <GoalsCard />
      <YearSummary />
      <WantToRead />
    </>
  );
}

// Avatar menusu > Hesap ayarlari
export function Settings() {
  return (
    <>
      <PageHead title="Hesap ayarları" sub="Profil, şifre, bildirimler ve verilerin." />
      <Account />
      <Export />
    </>
  );
}

function GoalsCard() {
  const g = useAsync(() => api.goals(), []);
  const [mp, setMp] = useState(null);
  const [yb, setYb] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);
  const d = g.data?.goals;
  const monthly = mp ?? d?.monthly_pages ?? '';
  const yearly = yb ?? d?.yearly_books ?? '';
  const pct = (v, t) => (t > 0 ? Math.min(100, (v / t) * 100) : 0);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await api.saveGoals({ monthly_pages: Number(monthly) || 0, yearly_books: Number(yearly) || 0 });
      setMp(null);
      setYb(null);
      setOk(true);
      g.reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>🎯 İlerleme</h2>
      {g.loading && !d && <Skeleton h={70} />}
      {g.error?.status === 404 ? <Hint>Hedefler henüz hazır değil.</Hint> : <ErrorBox error={g.error} onRetry={g.reload} />}
      {d && (
        <>
          <div className="goal">
            <div className="row"><b className="grow">Bu ay</b><span className="small">{fmt(d.month_pages)}{d.monthly_pages > 0 ? ` / ${fmt(d.monthly_pages)} sayfa` : ' sayfa'}</span></div>
            {d.monthly_pages > 0 ? <Progress value={pct(d.month_pages, d.monthly_pages)} /> : <p className="small muted" style={{ margin: '2px 0 0' }}>Aylık sayfa hedefi koymadın.</p>}
          </div>
          <div className="goal" style={{ marginTop: 12 }}>
            <div className="row"><b className="grow">Bu yıl</b><span className="small">{fmt(d.year_books)}{d.yearly_books > 0 ? ` / ${fmt(d.yearly_books)} kitap` : ' kitap'}</span></div>
            {d.yearly_books > 0 ? <Progress value={pct(d.year_books, d.yearly_books)} /> : <p className="small muted" style={{ margin: '2px 0 0' }}>Yıllık kitap hedefi koymadın.</p>}
          </div>
          <form onSubmit={save} className="goal-form">
            <label className="field">
              <span>Aylık sayfa</span>
              <input type="number" min="0" max="20000" inputMode="numeric" value={monthly} onChange={(e) => setMp(e.target.value)} />
            </label>
            <label className="field">
              <span>Yıllık kitap</span>
              <input type="number" min="0" max="500" inputMode="numeric" value={yearly} onChange={(e) => setYb(e.target.value)} />
            </label>
            <button className="btn small" disabled={busy || (mp === null && yb === null)}>Kaydet</button>
            {ok && <span className="ok-note small" role="status">✅ Kaydedildi</span>}
          </form>
          <p className="small muted" style={{ marginBottom: 0 }}>0 yazarsan hedef kapanır.</p>
          <ErrorBox error={err} />
        </>
      )}
    </section>
  );
}

function YearSummary() {
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const s = useAsync(() => api.yearSummary(year), [year]);
  const d = s.data;
  const none = d && d.finished.total === 0 && !d.total_pages;
  const item = (it) =>
    it && (
      <div className="item" style={{ cursor: 'default' }} key={it.entry_id}>
        <Cover src={it.cover_url} title={it.title} />
        <div className="meta">
          <div className="t">{it.title}</div>
          <div className="line">{[it.author_or_creator, it.end_date && fmtDate(it.end_date), it.rating && '⭐'.repeat(it.rating)].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
    );
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>🗓 {year} özeti</h2>
        <button className="btn small ghost" aria-label="Önceki yıl" onClick={() => setYear(year - 1)}>‹</button>
        <button className="btn small ghost" aria-label="Sonraki yıl" disabled={year >= thisYear} onClick={() => setYear(year + 1)}>›</button>
      </div>
      {s.loading && !d && <Skeleton h={80} />}
      {s.error?.status === 404 ? <Hint>Yıl özeti henüz hazır değil.</Hint> : <ErrorBox error={s.error} onRetry={s.reload} />}
      {d && none && <Hint>Bu yıl için kayıt yok.</Hint>}
      {d && !none && (
        <>
          <div className="stats">
            <Stat value={<CountUp value={d.finished.books} />} label="kitap bitti" />
            <Stat value={<CountUp value={d.total_pages} />} label="sayfa okundu" />
            <Stat value={<CountUp value={d.finished.series} />} label="dizi bitti" />
            <Stat value={<CountUp value={d.finished.movies} />} label="film izlendi" />
            <Stat value={`🔥 ${fmt(d.longest_streak)}`} label="gün en uzun seri" />
            {d.avg_rating != null && <Stat value={`⭐ ${d.avg_rating.toLocaleString('tr-TR')}`} label="ortalama puan" />}
          </div>
          {d.best_month && (
            <p className="small">En çok okuduğun ay: <b>{MONTHS[Number(d.best_month.month.slice(5, 7)) - 1]}</b> ({fmt(d.best_month.pages)} sayfa)</p>
          )}
          {d.top_rated?.length > 0 && (
            <>
              <b className="small">En yüksek puanlıların</b>
              {d.top_rated.map(item)}
            </>
          )}
          {d.first_finished && (
            <>
              <b className="small">Yılın ilk bitirdiği</b>
              {item(d.first_finished)}
            </>
          )}
          {d.last_finished && d.last_finished.entry_id !== d.first_finished?.entry_id && (
            <>
              <b className="small">Son bitirdiği</b>
              {item(d.last_finished)}
            </>
          )}
        </>
      )}
    </section>
  );
}

// status 'planlandi' kayitlari
function WantToRead() {
  const list = useAsync(() => api.entries({ status: 'planlandi', limit: 100 }), []);
  const [openId, setOpenId] = useState(null);
  const items = list.data?.entries || [];
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>📌 Okumak istediklerim</h2>
      {list.loading && !list.data && <Skeleton h={60} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.data && items.length === 0 && <p className="muted small" style={{ margin: 0 }}>Listen boş. Kitaplık’tan “Listeme ekle” ile istediklerini buraya toplayabilirsin.</p>}
      {items.map((e) => (
        <button key={e.id} className="item" style={{ width: '100%' }} onClick={() => setOpenId(e.id)}>
          <Cover src={e.catalog.cover_url} fallback={e.catalog.cover_fallback} title={e.catalog.title} />
          <div className="meta">
            <div className="t">{e.catalog.title}</div>
            <div className="line">{e.catalog.author_or_creator}</div>
          </div>
        </button>
      ))}
      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </section>
  );
}

function Export() {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const go = async (format) => {
    setBusy(format);
    setErr(null);
    try {
      const blob = await api.exportMe(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kutuphane-${today()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>⬇️ Verilerimi indir</h2>
      <p className="small muted">Kayıtların, okuma günlüğün, puanların, yorumların ve notların. JSON hepsini içerir; CSV sadece kayıt listesidir.</p>
      <div className="row">
        <button className="btn small" disabled={!!busy} onClick={() => go('json')}>{busy === 'json' ? 'Hazırlanıyor…' : 'JSON indir'}</button>
        <button className="btn small ghost" disabled={!!busy} onClick={() => go('csv')}>{busy === 'csv' ? 'Hazırlanıyor…' : 'CSV indir'}</button>
      </div>
      <ErrorBox error={err} />
    </section>
  );
}

function Account() {
  const { user, editProfile } = useAuth();
  const [pw, setPw] = useState(false);
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>👤 Hesap</h2>
      <div className="row" style={{ marginBottom: 8 }}>
        <Avatar user={user} />
        <div className="grow">
          <b>{user.display_name}</b> <span className="muted small">@{user.username}</span>
          <div className="small muted">
            E-posta: {user.email ? user.email : 'eklenmemiş (şifre sıfırlama için eklemen gerekir)'} · Saat dilimi: {user.tz || 'Europe/Istanbul'}
          </div>
        </div>
      </div>
      <div className="row">
        <button className="btn small" onClick={editProfile}>✏️ Profil, e-posta ve saat dilimi</button>
        <button className="btn small ghost" onClick={() => setPw(true)}>Şifreyi değiştir</button>
      </div>
      {pw && <ChangePassword onDone={() => setPw(false)} onClose={() => setPw(false)} />}
      <PushSettings uid={user.id} />
      <DeleteAccount />
    </section>
  );
}
