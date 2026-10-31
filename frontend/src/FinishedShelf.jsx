import { api } from './api.js';
import { coverColor, useAsync } from './ui.jsx';

// Sayfa sayisina gore sirt olcusu: [ust sinir, yukseklik px, genislik px]
const TIERS = [
  [50, 22, 6],
  [150, 28, 8],
  [300, 35, 10],
  [500, 42, 12],
  [800, 48, 14],
  [Infinity, 54, 16],
];
const MID = 2; // sayfa sayisi bilinmiyorsa orta kademe (<=300)
export const spineSize = (pages) => {
  const i = pages > 0 ? TIERS.findIndex(([max]) => pages <= max) : MID;
  return { h: TIERS[i][1], w: TIERS[i][2] };
};

// Hesabim ustu: bitirilen her kitap icin rafta bir sirt (olcu = sayfa sayisi, renk = kitap, sira = bitis tarihi)
export default function FinishedShelf({ uid, gid, version }) {
  const res = useAsync(() => api.entries({ user_id: uid, type: 'book', limit: 200, group: gid }), [uid, gid, version]);
  const done = (res.data?.entries || [])
    .filter((e) => e.status === 'bitti')
    .sort((a, b) => (a.end_date || '').localeCompare(b.end_date || '') || a.id - b.id);
  const cap = window.innerWidth <= 640 ? 34 : 110;
  const shown = done.slice(-cap);
  const more = done.length - shown.length;
  return (
    <div className="fs" role="img" aria-label={done.length ? `${done.length} kitap bitirdin` : 'Henüz bitirilen kitap yok'}>
      {shown.map((e, i) => {
        const pg = e.total_pages || e.catalog?.pages || 0;
        const { h, w } = spineSize(pg);
        const title = e.catalog?.title || 'Kitap';
        return (
          <span key={e.id} className="fs-slot" tabIndex={0} data-tip={`${title}${pg ? ` · ${pg} sayfa` : ''}`} style={{ width: w }}>
            <i style={{ height: h, background: coverColor(title), '--i': Math.min(i, 30) }} />
          </span>
        );
      })}
      {more > 0 && <span className="fs-more">+{more}</span>}
    </div>
  );
}
