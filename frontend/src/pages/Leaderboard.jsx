import { useState } from 'react';
import { api } from '../api.js';
import { Avatar, CountUp, Empty, ErrorBox, Skeleton, fmtDate, useAsync } from '../ui.jsx';

const BOARDS = [
  { key: 'record', label: '🏆 Rekor', unit: 'sayfa', note: 'Bir günde en çok okunan sayfa', dec: 0 },
  { key: 'average', label: '📈 Günlük ortalama', unit: 'sayfa/gün', note: 'Günde ortalama okunan sayfa', dec: 1 },
  { key: 'finished', label: '📕 En çok bitiren', unit: 'kitap', note: 'Bitirilen kitap sayısı', dec: 0 },
];
const PERIODS = [
  ['all', 'Tüm zamanlar'],
  ['year', 'Bu yıl'],
  ['month', 'Bu ay'],
];
const MEDAL = ['🥇', '🥈', '🥉'];

const titles = (b = []) => (b.length > 2 ? `${b.slice(0, 2).join(', ')} +${b.length - 2}` : b.join(', '));
const cut = (s) => (s.length > 70 ? s.slice(0, 67) + '…' : s);

function detailText(kind, d) {
  if (!d) return '';
  if (kind === 'record') return cut([fmtDate(d.date), titles(d.books)].filter(Boolean).join(' · '));
  if (kind === 'average') return d.total_pages ? `${d.total_pages} sayfa / ${d.days} gün` : '';
  if (kind === 'finished') return cut(titles(d.books));
  return '';
}

export default function Leaderboard() {
  const [kind, setKind] = useState('record');
  const [period, setPeriod] = useState('all');
  const board = BOARDS.find((b) => b.key === kind);
  const { data, error, loading, reload } = useAsync(() => api.leaderboard(kind, period), [kind, period]);
  const list = data?.entries || [];
  const top = list.filter((e) => e.rank <= 3).slice(0, 3);
  const rest = list.filter((e) => !top.includes(e));
  // podyum sirasi: 2 - 1 - 3
  const podium = top.length === 3 ? [top[1], top[0], top[2]] : top;

  return (
    <>
      <h1>Liderlik</h1>
      <p className="sub">{board.note}</p>
      <div className="tabs" role="tablist" aria-label="Tablo">
        {BOARDS.map((b) => (
          <button key={b.key} role="tab" aria-selected={kind === b.key} className="tab" onClick={() => setKind(b.key)}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="tabs" role="tablist" aria-label="Dönem">
        {PERIODS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={period === k} className="tab" onClick={() => setPeriod(k)}>
            {l}
          </button>
        ))}
      </div>

      {loading && <Skeleton h={90} n={3} />}
      <ErrorBox error={error} onRetry={reload} />
      {!loading && !error && list.length === 0 && (
        <Empty icon="🏁" title="Henüz kimse listede değil">
          Sayfa ilerlemeni kaydettikçe burası dolacak.
        </Empty>
      )}
      {!loading && list.length > 0 && (
        <>
          <div className="podium" style={top.length < 3 ? { gridTemplateColumns: `repeat(${top.length}, 1fr)` } : undefined}>
            {podium.map((e) => (
              <div key={e.user.id} className={`pod ${e.rank === 1 ? 'p1' : ''}`}>
                <div className="medal">{MEDAL[e.rank - 1] || e.rank}</div>
                <Avatar user={e.user} size="lg" />
                <div className="name">{e.user.display_name}</div>
                <div className="val">
                  <CountUp value={e.value} decimals={board.dec} />
                  <span className="small muted"> {board.unit}</span>
                </div>
                <div className="small muted" style={{ wordBreak: 'break-word' }}>{detailText(kind, e.detail)}</div>
              </div>
            ))}
          </div>
          {rest.length > 0 && (
            <div className="card">
              {rest.map((e) => (
                <div className="lrow" key={e.user.id}>
                  <span className="rank">{e.rank}</span>
                  <Avatar user={e.user} size="sm" />
                  <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                    <b>{e.user.display_name}</b>
                    <div className="small muted">{detailText(kind, e.detail)}</div>
                  </div>
                  <span className="val">
                    <CountUp value={e.value} decimals={board.dec} /> <span className="small muted">{board.unit}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
