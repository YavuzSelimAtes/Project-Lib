import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { ErrorBox, fmtDayLong, today, useAsync } from './ui.jsx';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DOW_HEAD = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const pad = (n) => String(n).padStart(2, '0');
const mix = (pct) => `color-mix(in srgb, var(--cal-c) ${pct}%, var(--surface-2))`;

// Her tur: birim, deger alani, kademeler (min: bu sayidan itibaren). pct = tur tonunun yogunlugu, warn = uyari tonu degiskeni.
const TYPES = {
  book: {
    title: '📖 Kitap', unit: 'sayfa', zero: 'Okunmadı', field: 'pages', cssVar: '--cal-book',
    tiers: [
      { min: 1, label: 'Az', color: mix(30) },
      { min: 10, label: 'İyi', color: mix(50) },
      { min: 20, label: 'Güzel', color: mix(70) },
      { min: 40, label: 'Çok iyi', color: mix(88) },
      { min: 60, label: 'Aferin!', color: mix(100), gold: true },
    ],
  },
  series: {
    title: '📺 Dizi', unit: 'bölüm', zero: 'İzlenmedi', field: 'episodes', cssVar: '--cal-series',
    tiers: [
      { min: 1, label: 'Aferin 👏', color: mix(100) },
      { min: 3, label: 'Güzel', color: mix(65) },
      { min: 4, label: 'Fazla', color: 'var(--cal-warn1)' },
      { min: 5, label: 'Yapma 🙅', color: 'var(--cal-warn2)' },
      { min: 6, label: 'Sıkılırsın 🥱', color: 'var(--cal-warn3)' },
    ],
  },
  movie: {
    title: '🎬 Film', unit: 'film', zero: 'İzlenmedi', field: 'movies', cssVar: '--cal-movie',
    tiers: [
      { min: 1, label: 'Vaav, iyi seyirler 🍿', color: mix(100) },
      { min: 2, label: 'Ne yapıyon be! 😱', color: 'var(--cal-warn2)' },
      { min: 3, label: 'Sen sinemada mı yaşıyorsun? 🎬', color: 'var(--cal-warn3)' },
    ],
  },
};

const tierOf = (cfg, n) => {
  let t = -1;
  cfg.tiers.forEach((x, i) => {
    if (n >= x.min) t = i;
  });
  return t;
};
const rangeText = (cfg, i) => {
  const a = cfg.tiers[i].min;
  const b = cfg.tiers[i + 1] ? cfg.tiers[i + 1].min - 1 : null;
  return b === null ? `${a}+` : a === b ? `${a}` : `${a}-${b}`;
};

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const keyOf = (d) => d.toISOString().slice(0, 10);

// Gorunume gore gun listesi + veri araligi
function buildRange(view, todayKey) {
  const [ty, tm, td] = todayKey.split('-').map(Number);
  let a;
  let b;
  if (view.mode === 'month') {
    a = utc(view.year, view.month, 1);
    b = utc(view.year, view.month + 1, 0);
  } else if (view.mode === 'year') {
    a = utc(view.year, 0, 1);
    b = utc(view.year, 11, 31);
  } else {
    a = utc(ty, tm - 1, td - 90);
    b = utc(ty, tm - 1, td);
  }
  const keys = [];
  for (let t = a.getTime(); t <= b.getTime(); t += 86400000) keys.push(keyOf(new Date(t)));
  return { keys, from: keys[0], to: keys[keys.length - 1] };
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Gorunum secici + (secili turler icin) takvimler. Tek istekle aralik verisi gelir.
export default function Calendars({ uid, filter, rev = 0 }) {
  const todayKey = today();
  const [ty, tm] = todayKey.split('-').map(Number);
  const [view, setView] = useState({ mode: '3m', year: ty, month: tm - 1 });
  const { keys, from, to } = useMemo(() => buildRange(view, todayKey), [view, todayKey]);
  const cal = useAsync(() => api.calendar(uid, from, to), [uid, from, to, rev]);

  const atMax = view.mode === 'month' ? view.year * 12 + view.month >= ty * 12 + tm - 1 : view.year >= ty;
  const step = (dir) =>
    setView((v) => {
      if (v.mode === 'year') return { ...v, year: v.year + dir };
      const n = v.year * 12 + v.month + dir;
      return { ...v, year: Math.floor(n / 12), month: ((n % 12) + 12) % 12 };
    });
  const types = filter === 'all' ? ['book', 'series', 'movie'] : [filter];
  const MODES = [['month', 'Aylık'], ['3m', '3 Ay'], ['year', 'Tüm yıl']];

  return (
    <div className="cal-section">
      <div className="cal-bar">
        <div className="tabs cal-modes" role="tablist" aria-label="Takvim görünümü">
          {MODES.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view.mode === k} className="tab" onClick={() => setView((v) => ({ ...v, mode: k }))}>
              {l}
            </button>
          ))}
        </div>
        {view.mode !== '3m' && (
          <div className="cal-nav">
            <button type="button" className="btn small ghost" aria-label={view.mode === 'year' ? 'Önceki yıl' : 'Önceki ay'} onClick={() => step(-1)}>
              ‹
            </button>
            <b aria-live="polite">{view.mode === 'year' ? view.year : `${MONTHS[view.month]} ${view.year}`}</b>
            <button type="button" className="btn small ghost" aria-label={view.mode === 'year' ? 'Sonraki yıl' : 'Sonraki ay'} disabled={atMax} onClick={() => step(1)}>
              ›
            </button>
          </div>
        )}
      </div>
      {types.map((t) => (
        <Calendar key={t} type={t} mode={view.mode} keys={keys} todayKey={todayKey} data={cal.data} loading={cal.loading} error={cal.error} onRetry={cal.reload} />
      ))}
    </div>
  );
}

function dayText(cfg, c) {
  const when = fmtDayLong(c.key);
  if (c.future) return `${when} - Henüz gelmedi`;
  if (!c.n) return `${when} - ${cfg.zero}`;
  return `${when} - ${c.est ? '~' : ''}${c.n} ${cfg.unit}`;
}
function commentOf(cfg, c) {
  if (c.future || !c.n || c.tier < 0) return '';
  const t = cfg.tiers[c.tier];
  return t.gold ? `${t.label} 👏 ${c.n} ${cfg.unit}` : t.label;
}

const BURST = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  const r = 34 + (i % 3) * 12;
  return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), ch: ['⭐', '✨', '🎉', '•'][i % 4], id: i };
});

// Uzerine gel / odaklan / dokun -> "12 Mart Sal - 37 sayfa" balonu. Klavye: tek tab duragi; oklar gezer; Esc kapatir.
function Calendar({ type, mode, keys, todayKey, data, loading, error, onRetry }) {
  const cfg = TYPES[type];
  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const cellRefs = useRef([]);
  const [tip, setTip] = useState(null); // {i, pinned}
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(null);
  const [burst, setBurst] = useState(null); // {x, y, id}
  const rowFlow = mode === 'month'; // ay izgarasi satir satir; digerleri sutun (hafta) akisi
  const monthMode = mode === 'month';

  const cells = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.days.map((d) => [d.date, d]));
    const first = data.first?.[type] || null;
    const list = keys.map((key) => {
      const d = map.get(key);
      const n = d ? d[cfg.field] || 0 : 0;
      const future = key > todayKey;
      const [y, m, dd] = key.split('-').map(Number);
      return {
        key, n, future, day: dd,
        est: type === 'book' && !!d?.estimated && n > 0,
        tier: n > 0 ? tierOf(cfg, n) : -1,
        // kirmizi: gecmis, kayitsiz ve ilk kayit tarihinden sonra (bugun kirmizi olmaz)
        miss: !future && key < todayKey && n === 0 && !!first && key > first,
        dow: (utc(y, m - 1, dd).getUTCDay() + 6) % 7,
      };
    });
    return [...Array(list[0].dow).fill(null), ...list];
  }, [data, keys, todayKey, type, cfg]);

  const lastIdx = cells.length - 1;
  const todayIdx = cells.findIndex((c) => c && c.key === todayKey);
  const tabIdx = active ?? (todayIdx >= 0 ? todayIdx : lastIdx);

  useEffect(() => {
    setActive(null);
    setTip(null);
  }, [keys]);

  // yil gorunumunde mevcut haftaya (sagdan) kaydir
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc && data && mode !== 'month') sc.scrollLeft = todayIdx >= 0 || mode === '3m' ? sc.scrollWidth : 0;
  }, [data, mode, keys, todayIdx]);

  useEffect(() => {
    const measure = () => {
      if (!tip || !wrapRef.current || !cellRefs.current[tip.i]) return setPos(null);
      const w = wrapRef.current.getBoundingClientRect();
      const c = cellRefs.current[tip.i].getBoundingClientRect();
      setPos({ cx: c.left - w.left + c.width / 2, top: c.top - w.top, w: w.width });
    };
    measure();
    if (!tip) return;
    const sc = scrollRef.current;
    sc?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      sc?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [tip]);

  useEffect(() => {
    if (!tip?.pinned) return;
    const off = (e) => {
      if (!e.target.closest?.('.hm-cell')) setTip(null);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [tip]);

  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), 1000);
    return () => clearTimeout(t);
  }, [burst]);

  const head = (
    <div className="cal-title">
      <b>{cfg.title}</b>
    </div>
  );
  if (error && !data) {
    return (
      <div className="card cal-card" style={{ '--cal-c': `var(${cfg.cssVar})` }}>
        {head}
        <ErrorBox error={error} onRetry={onRetry} />
      </div>
    );
  }
  if (!data) {
    return loading ? (
      <div className="card cal-card">
        {head}
        <div className="skel" style={{ height: 7 * 22, marginTop: 8 }} />
      </div>
    ) : null;
  }

  const focusCell = (i) => {
    if (i < 0 || i > lastIdx || !cells[i]) return;
    setActive(i);
    setTip((t) => ({ i, pinned: !!t?.pinned }));
    cellRefs.current[i]?.focus();
  };
  const onKey = (e, i) => {
    const v = rowFlow ? 7 : 1;
    const h = rowFlow ? 1 : 7;
    const stepBy = { ArrowDown: v, ArrowUp: -v, ArrowRight: h, ArrowLeft: -h }[e.key];
    if (stepBy) {
      e.preventDefault();
      focusCell(i + stepBy);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusCell(cells.findIndex(Boolean));
    } else if (e.key === 'End') {
      e.preventDefault();
      focusCell(lastIdx);
    } else if (e.key === 'Escape' && tip) {
      e.stopPropagation();
      setTip(null);
    }
  };
  const onClick = (e, i, c) => {
    const opening = !(tip?.i === i && tip.pinned);
    setTip(opening ? { i, pinned: true } : null);
    const gold = c.tier >= 0 && cfg.tiers[c.tier].gold;
    if (opening && gold && !c.future && !prefersReducedMotion() && wrapRef.current) {
      const w = wrapRef.current.getBoundingClientRect();
      const r = e.currentTarget.getBoundingClientRect();
      setBurst({ x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2, id: Date.now() });
    }
  };

  const shown = tip ? cells[tip.i] : null;
  const half = 100;
  const left = pos ? Math.min(Math.max(pos.cx, half), Math.max(half, pos.w - half)) : 0;
  const bg = (c) => {
    if (c.future) return 'var(--surface-2)';
    if (c.n > 0 && c.tier >= 0) return cfg.tiers[c.tier].color;
    if (c.miss) return 'var(--cal-red)';
    return 'var(--surface-2)';
  };

  return (
    <div className="card cal-card" style={{ '--cal-c': `var(${cfg.cssVar})`, opacity: loading ? 0.7 : 1, transition: 'opacity .2s' }}>
      {head}
      <div className="hm-wrap" ref={wrapRef}>
        {monthMode && (
          <div className="cal-dow" aria-hidden="true">
            {DOW_HEAD.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        )}
        <div className="hm-scroll" ref={scrollRef}>
          <div className={'hm-grid' + (monthMode ? ' is-month' : mode === 'year' ? ' is-year' : '')} role="group" aria-label={`${cfg.title} takvimi. Oklarla gezin.`}>
            {cells.map((c, i) => {
              if (!c) return <span key={'p' + i} />;
              const gold = c.tier >= 0 && cfg.tiers[c.tier].gold;
              return (
                <button
                  type="button"
                  key={c.key}
                  ref={(el) => (cellRefs.current[i] = el)}
                  className={'hm-cell' + (gold ? ' gold' : '') + (c.key === todayKey ? ' today' : '')}
                  tabIndex={i === tabIdx ? 0 : -1}
                  aria-label={dayText(cfg, c) + (commentOf(cfg, c) ? '. ' + commentOf(cfg, c) : '')}
                  data-sel={tip?.i === i ? 'true' : undefined}
                  onMouseEnter={() => setTip((t) => (t?.pinned ? t : { i, pinned: false }))}
                  onMouseLeave={() => setTip((t) => (t?.pinned ? t : null))}
                  onFocus={() => {
                    setActive(i);
                    setTip((t) => (t?.pinned ? t : { i, pinned: false }));
                  }}
                  onBlur={() => setTip((t) => (t?.pinned ? t : null))}
                  onClick={(e) => onClick(e, i, c)}
                  onKeyDown={(e) => onKey(e, i)}
                  style={{ opacity: c.future ? 0.35 : c.est ? 0.55 : 1, background: bg(c) }}
                >
                  {gold ? <span aria-hidden="true" className="cal-trophy">🏆</span> : monthMode ? <span aria-hidden="true" className="cal-num">{c.day}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
        {shown && pos && (
          <div className="hm-tip" role="status" style={{ left, top: pos.top }}>
            <div>{dayText(cfg, shown)}</div>
            {commentOf(cfg, shown) && <div className="cal-tip-sub">{commentOf(cfg, shown)}</div>}
          </div>
        )}
        {burst && (
          <div className="cal-burst" aria-hidden="true" key={burst.id} style={{ left: burst.x, top: burst.y }}>
            {BURST.map((p) => (
              <i key={p.id} style={{ '--dx': p.dx + 'px', '--dy': p.dy + 'px' }}>
                {p.ch}
              </i>
            ))}
          </div>
        )}
      </div>
      <div className="cal-legend small muted">
        <span className="cal-leg">
          <i style={{ background: 'var(--cal-red)' }} />
          0 {cfg.unit}
        </span>
        {cfg.tiers.map((t, i) => (
          <span className="cal-leg" key={t.label}>
            <i style={{ background: t.color, boxShadow: t.gold ? 'inset 0 0 0 2px var(--cal-gold)' : undefined }} />
            {rangeText(cfg, i)} {t.label}
          </span>
        ))}
      </div>
      {type === 'book' && <p className="small muted hm-hint">Bir güne dokun ya da üzerine gel. “~” tahmini gündür.</p>}
    </div>
  );
}
