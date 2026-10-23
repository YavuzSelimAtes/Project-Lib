import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Cover, Empty, ErrorBox, Progress, Skeleton, TYPE_LABEL, fmtDate, useAsync } from '../ui.jsx';
import EntryDetail, { QA } from '../EntryDetail.jsx';
import AddFlow from '../AddFlow.jsx';

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
  const uid = params.id ? Number(params.id) : me.id;
  const own = uid === me.id;
  const [filter, setFilter] = useState('all');
  const [period, setPeriod] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  const stats = useAsync(() => api.stats(uid, period), [uid, period]);
  const heat = useAsync(() => api.heatmap(uid, 91), [uid]);
  const entries = useAsync(() => api.entries({ user_id: uid, type: filter === 'all' ? '' : filter, limit: 200 }), [uid, filter]);
  const pending = useAsync(() => (own ? api.pending() : Promise.resolve(null)), [own]);
  const requests = useAsync(() => (own ? api.myRequests() : Promise.resolve(null)), [own]);

  const s = stats.data;
  const owner = s?.user;
  const reloadAll = () => {
    entries.reload();
    stats.reload();
    heat.reload();
    pending.reload();
  };

  if (Number.isNaN(uid) || stats.error?.status === 404) {
    return (
      <Empty icon="🔍" title="Bu üye bulunamadı">
        <div style={{ marginTop: 12 }}>
          <Link className="btn" to="/">Ana sayfaya dön</Link>
        </div>
      </Empty>
    );
  }

  return (
    <>
      <div className="row">
        <div className="grow">
          <h1>{own ? 'Benim rafım' : owner ? `${owner.avatar} ${owner.display_name} – rafı` : 'Raf'}</h1>
          <p className="sub" style={{ marginBottom: 8 }}>
            {own ? 'Okuduklarım, izlediklerim ve rakamlarım.' : 'Okuduğu, izlediği her şey; bir kayda dokunup soru sorabilirsin.'}
          </p>
        </div>
        {own && (
          <button className="btn" onClick={() => setAdding(true)}>
            + Yeni ekle
          </button>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="Dönem">
        {PERIODS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={period === k} className="tab" onClick={() => setPeriod(k)}>
            {l}
          </button>
        ))}
      </div>
      <ErrorBox error={stats.error} onRetry={stats.reload} />
      {stats.loading && !s ? (
        <Skeleton h={80} />
      ) : (
        s && (
          <div className="stats">
            <div className="card stat"><b>{fmt(s.total_pages)}</b>sayfa okundu</div>
            <div className="card stat"><b>{s.books_finished}</b>kitap bitti</div>
            <div className="card stat"><b>{s.movies_watched}</b>film izlendi</div>
            <div className="card stat"><b>{fmt(s.avg_pages_per_day, 1)}</b>sayfa / gün</div>
            <div className="card stat"><b>🔥 {s.current_streak}</b>gün seri (en uzun {s.longest_streak})</div>
            <div className="card stat">
              <b>{s.record ? s.record.pages : '–'}</b>rekor
              {s.record && <div className="small muted">{fmtDate(s.record.date)}</div>}
            </div>
          </div>
        )
      )}

      <Heatmap data={heat.data?.days} />

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

      <div className="tabs" role="tablist" aria-label="Tür">
        {FILTERS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} className="tab" onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
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
            <Cover src={e.catalog.cover_url} title={e.catalog.title} />
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

// son 13 hafta, GitHub tarzi
function Heatmap({ data }) {
  if (!data) return null;
  const map = new Map(data.map((d) => [d.date, d.pages]));
  const est = new Set(data.filter((d) => d.estimated).map((d) => d.date));
  const max = Math.max(1, ...data.map((d) => d.pages));
  const days = [];
  const end = new Date();
  for (let i = 90; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(d);
    days.push({ key, pages: map.get(key) || 0, est: est.has(key), dow: (d.getDay() + 6) % 7 });
  }
  const pad = days[0].dow;
  const cells = [...Array(pad).fill(null), ...days];
  return (
    <div className="card" style={{ marginBottom: 16, overflowX: 'auto' }}>
      <b>Son 3 ay</b>
      <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 14px)', gap: 3, marginTop: 8, width: 'max-content' }} role="img" aria-label="Günlük okuma ısı haritası">
        {cells.map((c, i) =>
          c ? (
            <span
              key={i}
              title={`${fmtDate(c.key)}: ${c.pages} sayfa${c.est ? ' (tahmini)' : ''}`}
              style={{ width: 14, height: 14, borderRadius: 4, opacity: c.est ? 0.55 : 1, background: c.pages ? `color-mix(in srgb, var(--accent) ${25 + (c.pages / max) * 75}%, var(--surface-2))` : 'var(--surface-2)' }}
            />
          ) : (
            <span key={i} />
          ),
        )}
      </div>
    </div>
  );
}
