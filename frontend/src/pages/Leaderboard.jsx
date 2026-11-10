import { useState } from 'react';
import { api } from '../api.js';
import { useGroup } from '../auth.js';
import { Avatar, CountUp, Empty, PageHead, ErrorBox, Skeleton, fmtDate, useAsync } from '../ui.jsx';

const BOARDS = [
  { key: 'today', label: '📅 Bugün', short: 'Bugün', unit: 'sayfa', note: 'Bugün kim ne yaptı? Oklarla önceki günlere bakabilirsin', dec: 0, noPeriod: true },
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

// Bugun: her satir 5 sutun (sira, kisi, sayfa, dizi/film, ne yaptigi). Sira: sayfa, esitlikte dizi izleyen once.
const shiftDay = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayLabel = (d, today) => (d === today ? 'Bugün' : d === shiftDay(today, -1) ? 'Dün' : new Date(d + 'T12:00:00Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' }));

// Gun secici: oklarla gun gun geri/ileri, ortadaki tarihe dokununca takvim acilir
function DayNav({ date, today, onPick }) {
  const isToday = date === today;
  return (
    <div className="td-nav">
      <button className="btn ghost small" aria-label="Önceki gün" onClick={() => onPick(shiftDay(date, -1))}>‹</button>
      <label className="td-date">
        <span>{dayLabel(date, today)}</span>
        <input type="date" aria-label="Tarih seç" value={date} max={today} onChange={(e) => e.target.value && onPick(e.target.value > today ? today : e.target.value)} />
      </label>
      <button className="btn ghost small" aria-label="Sonraki gün" disabled={isToday} onClick={() => onPick(shiftDay(date, 1))}>›</button>
      {!isToday && <button className="btn small" onClick={() => onPick(today)}>Bugün</button>}
    </div>
  );
}

function TodayBoard() {
  const gid = useGroup();
  const [date, setDate] = useState(null); // null = bugun (herkes kendi saat diliminde)
  const { data, error, loading, reload } = useAsync(() => api.today(gid, date), [gid, date]);
  const rows = data?.rows || [];
  const past = !!data && data.date !== data.today;
  return (
    <>
      {data && <DayNav date={data.date} today={data.today} onPick={(d) => setDate(d === data.today ? null : d)} />}
      {loading && !data && <Skeleton h={56} n={3} />}
      <ErrorBox error={error} onRetry={reload} />
      {data && rows.length === 0 && <Empty icon="🌙" title={past ? 'Bu gün kimse bir şey yapmadı' : 'Bugün henüz kimse bir şey yapmadı'}>{past ? 'Bu tarihe kayıtlı okuma ya da izleme yok.' : 'Sayfa okuyunca ya da dizi/film izleyince burada görünür.'}</Empty>}
      {rows.length > 0 && (
        <div className="card td">
          <div className="td-row td-h">
            <span>#</span><span>Kim</span><span>📖 Sayfa</span><span>📺 Dizi/Film</span><span>Ne yaptı</span>
          </div>
          {rows.map((r) => (
            <div className="td-row" key={r.user.id}>
              <span className="rank">{MEDAL[r.rank - 1] || r.rank}</span>
              <span className="td-who"><Avatar user={r.user} size="sm" /><b>{r.user.display_name}</b></span>
              <span className="td-n">{r.pages || '–'}</span>
              <span className="td-n">{[r.episodes ? `${r.episodes} böl.` : null, r.series_done ? `${r.series_done} dizi bitti` : null, r.movies ? `${r.movies} film` : null].filter(Boolean).join(' · ') || '–'}</span>
              <span className="td-did small" title={[...r.did, ...r.finished.map((t) => t + ' ✔')].join(', ')}>
                {r.finished.length > 0 && <b>🎉 {r.finished.join(', ')} · </b>}{r.did.join(', ')}
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
  const [kind, setKind] = useState('today');
  const [period, setPeriod] = useState('all');
  const board = BOARDS.find((b) => b.key === kind);
  const isStreak = kind === 'streak';
  const isToday = kind === 'today';
  const { data, error, loading, reload } = useAsync(() => (isStreak || isToday ? Promise.resolve(null) : api.leaderboard(kind, period, gid)), [kind, period, gid]);
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

      {isToday && <TodayBoard />}
      {isStreak && (
        <>
          <StreakBoard kind="streak" title="🔥 Güncel seri" note="Şu an kesintisiz sürenler" />
          <StreakBoard kind="best_streak" title="🏅 En uzun seri" note="Bugüne kadarki en uzun kesintisiz seri" />
        </>
      )}
      {!isStreak && !isToday && loading && <Skeleton h={90} n={3} />}
      {!isStreak && !isToday && <ErrorBox error={error} onRetry={reload} />}
      {!isStreak && !isToday && !loading && !error && list.length === 0 && (
        <Empty icon="🏁" title="Henüz kimse listede değil">
          {kind === 'streak' ? 'Ardışık günlerde kitap okudukça burası dolacak.' : 'Sayfa ilerlemeni kaydettikçe burası dolacak.'}
        </Empty>
      )}
      {!isStreak && !isToday && !loading && list.length > 0 && (
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
