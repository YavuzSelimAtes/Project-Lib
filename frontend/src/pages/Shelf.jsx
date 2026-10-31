import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useGroup } from '../auth.js';
import { CountUp, Cover, PageHead, Stat, avatarText, Empty, ErrorBox, Progress, Skeleton, TYPE_LABEL, fmtDate, fmtMinutes, useAsync, useCountUp } from '../ui.jsx';
import Calendars from '../Calendar.jsx';
import EntryDetail, { QA } from '../EntryDetail.jsx';
import AddFlow from '../AddFlow.jsx';
import FinishedShelf from '../FinishedShelf.jsx';

const FILTERS = [
  ['all', 'Hepsi'],
  ['book', '📖 Kitaplar'],
  ['series', '📺 Diziler'],
  ['movie', '🎬 Filmler'],
];
const STATUS = { devam: 'Devam ediyor', bitti: 'Bitti', birakildi: 'Bırakıldı', planlandi: 'Planlandı' };
const PERIODS = [
  ['all', 'Tüm zamanlar'],
  ['year', 'Bu yıl'],
  ['month', 'Bu ay'],
];
const fmt = (n, d = 0) => (n ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: d });

export default function Shelf() {
  const { user: me } = useAuth();
  const params = useParams();
  const gid = useGroup();
  const uid = params.userId ? Number(params.userId) : me.id;
  const own = uid === me.id;
  const [filter, setFilter] = useState('all');
  const [period, setPeriod] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  const stats = useAsync(() => api.stats(uid, period, undefined, gid), [uid, period, gid]);
  const [calRev, setCalRev] = useState(0);
  const entries = useAsync(() => api.entries({ user_id: uid, type: filter === 'all' ? '' : filter, limit: 200, group: gid }), [uid, filter, gid]);
  const pending = useAsync(() => (own ? api.pending() : Promise.resolve(null)), [own]);
  const requests = useAsync(() => (own ? api.myRequests() : Promise.resolve(null)), [own]);

  // tum alanlar her zaman geldigi icin istatistik donem basina BIR kez cekilir; filtre kart setini secer
  const animated = useRef(false);
  useEffect(() => {
    if (stats.data) animated.current = true;
  }, [stats.data]);
  const s = stats.data;
  const owner = s?.user;
  const reloadAll = () => {
    entries.reload();
    stats.reload();
    setCalRev((n) => n + 1);
    pending.reload();
  };

  if (Number.isNaN(uid) || stats.error?.status === 404) {
    return (
      <Empty icon="🔍" title="Bu üye bulunamadı">
        <div style={{ marginTop: 12 }}>
          <Link className="btn" to={gid ? `/g/${gid}` : '/ben'}>Geri dön</Link>
        </div>
      </Empty>
    );
  }

  return (
    <>
      <FinishedShelf uid={uid} gid={gid} version={entries.data} />
      <PageHead
        title={own ? (gid ? 'Rafım' : 'Hesabım') : owner ? `${avatarText(owner.avatar)} ${owner.display_name} – rafı` : 'Raf'}
        sub={own ? (gid ? 'Bu grupta görünen kayıtlarım.' : undefined) : 'Okuduğu, izlediği her şey; bir kayda dokunup soru sorabilirsin.'}
      >
        {own && !gid && (
          <button className="btn" onClick={() => setAdding(true)}>
            + Yeni ekle
          </button>
        )}
      </PageHead>

      <div className="toolbar shelf-bar">
      <div className="tabs seg" role="tablist" aria-label="Tür">
        {FILTERS.map(([k, l]) => {
          const [ic, ...t] = k === 'all' ? [null, l] : l.split(' ');
          return (
            <button key={k} role="tab" aria-selected={filter === k} aria-label={k === 'all' ? undefined : t.join(' ')} title={k === 'all' ? undefined : t.join(' ')} className="tab" onClick={() => setFilter(k)}>
              {k === 'all' ? l : <><span aria-hidden="true">{ic}</span><span className="seg-t"> {t.join(' ')}</span></>}
            </button>
          );
        })}
      </div>
      <select className="period-sel" aria-label="Dönem" value={period} onChange={(e) => setPeriod(e.target.value)}>
        {PERIODS.map(([k, l]) => (
          <option key={k} value={k}>{l}</option>
        ))}
      </select>
      </div>
      <ErrorBox error={stats.error} onRetry={stats.reload} />
      {stats.loading && !s ? (
        <Skeleton h={80} />
      ) : (
        s && (
          <div style={{ opacity: stats.loading ? 0.85 : 1, transition: 'opacity .2s' }}>
            <StatCards key={filter} s={s} type={filter} animate={!animated.current} />
          </div>
        )
      )}

      <Calendars uid={uid} filter={filter} rev={calRev} group={gid} />

      {own && pending.data?.questions?.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <b>❓ Cevap bekleyen sorular</b>
          {pending.data.questions.map((q) => (
            <div key={q.id}>
              <div className="small muted" style={{ marginTop: 8 }}>“{q.entry?.catalog?.title}” hakkında:</div>
              <QA q={q} mine reload={pending.reload} />
            </div>
          ))}
        </div>
      )}

      {entries.loading && !entries.data && <Skeleton h={90} n={3} />}
      <ErrorBox error={entries.error} onRetry={entries.reload} />
      {entries.data && entries.data.entries.length === 0 && (
        <Empty icon="🪴" title={own ? 'Rafın henüz boş' : 'Bu raf henüz boş'}>
          {own ? 'İlk kitabını, filmini ya da dizini ekleyerek başla.' : 'Henüz bir şey eklememiş.'}
          {own && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setAdding(true)}>+ Yeni ekle</button>
            </div>
          )}
        </Empty>
      )}
      <div className="shelf-list">
        {entries.data?.entries.map((e) => (
          <button key={e.id} className="item card" style={{ padding: 12 }} onClick={() => setOpenId(e.id)}>
            <Cover src={e.catalog.cover_url} fallback={e.catalog.cover_fallback} title={e.catalog.title} />
            <div className="meta">
              <div className="t">{e.catalog.title}</div>
              <div className="line">
                {TYPE_LABEL[e.type]} · {STATUS[e.status]}
                {e.type === 'book' && e.total_pages ? ` · ${e.current_page}/${e.total_pages}` : ''}
                {e.type === 'series' && e.season ? ` · S${e.season} B${e.episode}` : ''}
                {e.rating ? ` · ${'⭐'.repeat(e.rating)}` : ''}
                {e.end_date ? ` · ${fmtDate(e.end_date)}` : ''}
              </div>
              {e.type === 'book' && e.total_pages ? <Progress value={e.percent} color={owner?.color ?? me.color} /> : null}
            </div>
          </button>
        ))}
      </div>

      {own && !gid && me.groups?.length > 0 && entries.data?.entries.length > 0 && <BulkVisibility entries={entries.data.entries} onDone={entries.reload} />}

      {own && requests.data?.requests?.length > 0 && (
        <>
          <h2>Taleplerim</h2>
          <div className="card">
            {requests.data.requests.map((r) => (
              <div className="lrow" key={r.id}>
                <div className="grow" style={{ flex: 1 }}>
                  <b>{r.title}</b> <span className="small muted">({TYPE_LABEL[r.type]})</span>
                  {r.admin_note && <div className="small muted">Yönetici: {r.admin_note}</div>}
                </div>
                <span className="chip">{{ acik: 'Bekliyor', inceleniyor: 'İnceleniyor', tamamlandi: 'Eklendi ✅', reddedildi: 'Reddedildi' }[r.status]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {adding && <AddFlow onClose={() => setAdding(false)} onAdded={reloadAll} />}
      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />}
    </>
  );
}

// Tur filtresine gore istatistik kartlari. Alan yoksa (eski backend) kart gizlenir.
function Mins({ v, plus, animate }) {
  const x = useCountUp(v, 700, animate);
  return (
    <>
      {fmtMinutes(x)}
      {plus ? '+' : ''}
    </>
  );
}
function StatCards({ s, type, animate }) {
  const num = (v, dec = 0) => <CountUp value={v} decimals={dec} animate={animate} />;
  const has = (k) => s[k] != null;
  const card = (key, big, label, extra) => (
    <Stat key={key} value={big} label={label} extra={extra} />
  );
  const movieUnk = s.movie_runtime_unknown || 0;
  const epUnk = !!s.episodes_unknown;
  let cards = [];
  if (type === 'book') {
    cards = [
      card('pg', num(s.total_pages), 'sayfa okundu'),
      card('bf', num(s.books_finished), 'kitap bitti'),
      card('avg', num(s.avg_pages_per_day, 1), 'sayfa / gün'),
      card('rec', s.record ? s.record.pages : '–', 'rekor', s.record && <div className="small muted">{fmtDate(s.record.date)}</div>),
      card('st', <>🔥 {s.current_streak ?? 0}</>, 'gün seri', s.longest_streak != null && <div className="small muted">en uzun {s.longest_streak}</div>),
    ];
  } else if (type === 'series') {
    cards = [
      has('series_minutes') &&
        card(
          'sm',
          s.series_minutes === 0 && epUnk ? '–' : <Mins v={s.series_minutes} plus={epUnk} animate={animate} />,
          epUnk ? 'en az izlenen süre' : 'izlenen süre',
          epUnk && <div className="small muted">bazı dizilerin süresi bilinmiyor</div>,
        ),
      card('sf', num(s.series_finished), 'dizi bitti'),
      has('episodes_watched') &&
        card(
          'ep',
          <>
            {num(s.episodes_watched)}
            {epUnk ? '+' : ''}
          </>,
          epUnk ? 'en az bölüm izlendi' : 'bölüm izlendi',
        ),
    ];
  } else if (type === 'movie') {
    cards = [
      has('movie_minutes') &&
        card(
          'mm',
          s.movie_minutes === 0 && movieUnk > 0 ? '–' : <Mins v={s.movie_minutes} plus={movieUnk > 0} animate={animate} />,
          movieUnk > 0 ? 'en az izlenen süre' : 'izlenen süre',
          movieUnk > 0 && <div className="small muted">{movieUnk} filmin süresi bilinmiyor</div>,
        ),
      card('mv', num(s.movies_watched), 'film izlendi'),
    ];
  } else {
    cards = [
      card('bf', num(s.books_finished), 'kitap bitti'),
      card('pg', num(s.total_pages), 'sayfa okundu'),
      card('sf', num(s.series_finished), 'dizi bitti'),
      has('episodes_watched') &&
        card(
          'ep',
          <>
            {num(s.episodes_watched)}
            {epUnk ? '+' : ''}
          </>,
          epUnk ? 'en az bölüm izlendi' : 'bölüm izlendi',
        ),
      card('mv', num(s.movies_watched), 'film izlendi'),
    ];
  }
  return (
    <>
      <div className="stats fade-in">{cards.filter(Boolean)}</div>
      {epUnk && (type === 'series' || type === 'all') && <p className="small muted" style={{ marginTop: -8 }}>Sezon bilgisi olmayan dizilerde bölümler sayılamadı; gerçek sayı daha yüksek olabilir.</p>}
    </>
  );
}

// Gorunen tum kayitlarin gruplarini tek seferde ac/kapat
function BulkVisibility({ entries, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (all) => {
    const text = all ? 'Listedeki ' + entries.length + ' kaydın hepsi tüm gruplarına açılsın mı?' : 'Listedeki ' + entries.length + ' kaydın hepsi gruplardan gizlensin mi? (Sadece sen görürsün; serin ve istatistiklerin etkilenmez.)';
    if (!window.confirm(text)) return;
    setBusy(true);
    setMsg('');
    try {
      for (const e of entries) await api.setEntryGroups(e.id, all ? { all: true } : { none: true });
      setMsg(all ? 'Hepsi gruplarına açıldı.' : 'Hepsi gizlendi.');
      onDone();
    } catch (x) {
      setMsg(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="small row" style={{ margin: '10px 0' }}>
      <span className="muted">Toplu görünürlük:</span>
      <button className="btn small ghost" disabled={busy} onClick={() => run(true)}>Hepsi gruplarıma açık</button>
      <button className="btn small ghost" disabled={busy} onClick={() => run(false)}>Hiçbiri (sadece ben)</button>
      <span role="status">{msg}</span>
    </div>
  );
}
