import { useState } from 'react';
import { api } from '../api.js';
import { useGroup } from '../auth.js';
import { Avatar, CountUp, Empty, PageHead, ErrorBox, Skeleton, fmtDate, useAsync } from '../ui.jsx';

const BOARDS = [
  { key: 'record', label: '🏆 Rekor', short: 'Rekor', unit: 'sayfa', note: 'Bir günde en çok okunan sayfa', dec: 0 },
  { key: 'average', label: '📈 Günlük ortalama', short: 'Günlük', unit: 'sayfa/gün', note: 'Günde ortalama okunan sayfa', dec: 1 },
  { key: 'finished', label: '📕 En çok bitiren', short: 'Bitiren', unit: 'kitap', note: 'Bitirilen kitap sayısı', dec: 0 },
  { key: 'streak', label: '🔥 Seri', short: 'Seri', unit: 'gün', note: 'Üst üste her gün kitap okuyanlar: güncel ve tüm zamanların en uzun serisi', dec: 0, noPeriod: true },
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
  if (kind === 'streak') return [d.longest != null ? `en uzun ${d.longest} gün` : null, d.last_date ? `son okuma ${fmtDate(d.last_date)}` : null].filter(Boolean).join(' · ');
  if (kind === 'best_streak') return [d.current > 0 ? `şu an ${d.current} gündür sürüyor` : 'şu an seri yok', d.last_date ? `son okuma ${fmtDate(d.last_date)}` : null].filter(Boolean).join(' · ');
  return '';
}

// Seri sekmesi: buton eklemeden iki sıralama alt alta (güncel seri + en uzun seri)
function StreakBoard({ kind, title, note }) {
  const gid = useGroup();
  const { data, error, loading, reload } = useAsync(() => api.leaderboard(kind, undefined, gid), [kind, gid]);
  const list = data?.entries || [];
  return (
    <>
      <h2 className="sec-h">{title}</h2>
      <p className="small muted" style={{ marginTop: -4 }}>{note}</p>
      {loading && <Skeleton h={56} n={2} />}
      <ErrorBox error={error} onRetry={reload} />
      {!loading && !error && list.length === 0 && (
        <Empty icon="🏁" title="Henüz kimse listede değil">
          {kind === 'streak' ? 'Ardışık günlerde kitap okudukça burası dolacak.' : 'Seri yapmaya başlayınca en uzun seriler burada görünecek.'}
        </Empty>
      )}
      {!loading && list.length > 0 && (
        <div className="card">
          {list.map((e) => (
            <div className="lrow" key={e.user.id}>
              <span className="rank">{MEDAL[e.rank - 1] || e.rank}</span>
              <Avatar user={e.user} size="sm" />
              <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                <b>{e.user.display_name}</b>
                <div className="small muted">{detailText(kind, e.detail)}</div>
              </div>
              <span className="val">
                <CountUp value={e.value} decimals={0} /> <span className="small muted">gün</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function Leaderboard() {
  const gid = useGroup();
  const [kind, setKind] = useState('record');
  const [period, setPeriod] = useState('all');
  const board = BOARDS.find((b) => b.key === kind);
  const isStreak = kind === 'streak';
  const { data, error, loading, reload } = useAsync(() => (isStreak ? Promise.resolve(null) : api.leaderboard(kind, period, gid)), [kind, period, gid]);
  const list = data?.entries || [];
  const top = list.filter((e) => e.rank <= 3).slice(0, 3);
  const rest = list.filter((e) => !top.includes(e));
  // podyum sirasi: 2 - 1 - 3
  const podium = top.length >= 2 ? [top[1], top[0], top[2]].filter(Boolean) : top;

  return (
    <>
      <PageHead title="Liderlik" sub={board.note} />
      <div className="toolbar shelf-bar lb-bar">
        <div className="tabs seg" role="tablist" aria-label="Tablo">
          {BOARDS.map((b) => {
            const [ic, ...t] = b.label.split(' ');
            return (
              <button key={b.key} role="tab" aria-selected={kind === b.key} aria-label={t.join(' ')} title={t.join(' ')} className="tab" onClick={() => setKind(b.key)}>
                <span aria-hidden="true">{ic}</span>
                <span className="lb-full"> {t.join(' ')}</span>
                <span className="lb-short"> {b.short}</span>
              </button>
            );
          })}
        </div>
        {!board.noPeriod && (
          <select className="period-sel" aria-label="Dönem" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        )}
      </div>

      {isStreak && (
        <>
          <StreakBoard kind="streak" title="🔥 Güncel seri" note="Şu an kesintisiz sürenler" />
          <StreakBoard kind="best_streak" title="🏅 En uzun seri" note="Bugüne kadarki en uzun kesintisiz seri" />
        </>
      )}
      {!isStreak && loading && <Skeleton h={90} n={3} />}
      {!isStreak && <ErrorBox error={error} onRetry={reload} />}
      {!isStreak && !loading && !error && list.length === 0 && (
        <Empty icon="🏁" title="Henüz kimse listede değil">
          {kind === 'streak' ? 'Ardışık günlerde kitap okudukça burası dolacak.' : 'Sayfa ilerlemeni kaydettikçe burası dolacak.'}
        </Empty>
      )}
      {!isStreak && !loading && list.length > 0 && (
        <>
          <div className={`podium n${podium.length}`}>
            {podium.map((e) => (
              <div key={e.user.id} className={`pod p${top.indexOf(e) + 1}`}>
                <div className="medal">{MEDAL[e.rank - 1] || e.rank}</div>
                <Avatar user={e.user} size="lg" />
                <div className="name" title={e.user.display_name}>{e.user.display_name}</div>
                <div className="val">
                  <CountUp value={e.value} decimals={board.dec} />
                </div>
                <div className="pod-unit small muted">{board.unit}</div>
                <div className="pod-detail small muted" title={detailText(kind, e.detail)}>{detailText(kind, e.detail)}</div>
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
