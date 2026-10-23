import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBox, fmtDayLong, today } from './ui.jsx';


function dayText(c) {
  const when = fmtDayLong(c.key);
  if (!c.pages) return `${when} - Okunmadı`;
  return `${when} - ${c.est ? '~' : ''}${c.pages} sayfa`;
}

// Son 13 hafta. Uzerine gel / odaklan / dokun -> "12 Mart Sal - 37 sayfa" balonu.
// Klavye: tek tab duragi; oklar gun/hafta arasinda gezer; Esc kapatir.
export default function Heatmap({ data, loading, error, onRetry }) {
  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const cellRefs = useRef([]);
  const [tip, setTip] = useState(null); // {i, pinned}
  const [pos, setPos] = useState(null); // {left, top}
  const [active, setActive] = useState(null);

  const cells = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.map((d) => [d.date, d.pages]));
    const est = new Set(data.filter((d) => d.estimated).map((d) => d.date));
    const max = Math.max(1, ...data.map((d) => d.pages));
    const days = [];
    const [ty, tm, td] = today().split('-').map(Number); // Istanbul takvimi, tarayici saat diliminden bagimsiz
    for (let i = 90; i >= 0; i--) {
      const d = new Date(Date.UTC(ty, tm - 1, td - i));
      const key = d.toISOString().slice(0, 10);
      days.push({ key, pages: map.get(key) || 0, est: est.has(key), dow: (d.getUTCDay() + 6) % 7, max });
    }
    return [...Array(days[0].dow).fill(null), ...days];
  }, [data]);

  const lastIdx = cells.length - 1;
  const tabIdx = active ?? lastIdx;

  // balonun konumu: hucrenin ustu, sarmalayicinin icinde kalacak sekilde
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

  // disariya dokununca kapat
  useEffect(() => {
    if (!tip?.pinned) return;
    const off = (e) => {
      if (!e.target.closest?.('.hm-cell')) setTip(null);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [tip]);

  if (error && !data) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <b>Son 3 ay</b>
        <ErrorBox error={error} onRetry={onRetry} />
      </div>
    );
  }
  if (!data) {
    return loading ? (
      <div className="card" style={{ marginBottom: 16 }}>
        <b>Son 3 ay</b>
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
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7 }[e.key];
    if (step) {
      e.preventDefault();
      focusCell(i + step);
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

  const shown = tip ? cells[tip.i] : null;
  // balonu yatayda sinirla
  const half = 92;
  const left = pos ? Math.min(Math.max(pos.cx, half), Math.max(half, pos.w - half)) : 0;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <b>Son 3 ay</b>
      <div className="hm-wrap" ref={wrapRef}>
        <div className="hm-scroll" ref={scrollRef}>
          <div className="hm-grid" role="group" aria-label="Günlük okuma ısı haritası. Oklarla gezin.">
            {cells.map((c, i) =>
              c ? (
                <button
                  type="button"
                  key={c.key}
                  ref={(el) => (cellRefs.current[i] = el)}
                  className="hm-cell"
                  tabIndex={i === tabIdx ? 0 : -1}
                  aria-label={dayText(c)}
                  data-sel={tip?.i === i ? 'true' : undefined}
                  onMouseEnter={() => setTip((t) => (t?.pinned ? t : { i, pinned: false }))}
                  onMouseLeave={() => setTip((t) => (t?.pinned ? t : null))}
                  onFocus={() => {
                    setActive(i);
                    setTip((t) => (t?.pinned ? t : { i, pinned: false }));
                  }}
                  onBlur={() => setTip((t) => (t?.pinned ? t : null))}
                  onClick={() => setTip((t) => (t?.i === i && t.pinned ? null : { i, pinned: true }))}
                  onKeyDown={(e) => onKey(e, i)}
                  style={{
                    opacity: c.est ? 0.55 : 1,
                    background: c.pages ? `color-mix(in srgb, var(--accent) ${25 + (c.pages / c.max) * 75}%, var(--surface-2))` : 'var(--surface-2)',
                  }}
                />
              ) : (
                <span key={'p' + i} />
              ),
            )}
          </div>
        </div>
        {shown && pos && (
          <div className="hm-tip" role="status" style={{ left, top: pos.top }}>
            {dayText(shown)}
          </div>
        )}
      </div>
      <div className="hm-legend small muted" aria-hidden="true">
        az
        {[0, 25, 50, 75, 100].map((p) => (
          <i key={p} style={{ background: p ? `color-mix(in srgb, var(--accent) ${p}%, var(--surface-2))` : 'var(--surface-2)' }} />
        ))}
        çok
      </div>
      <p className="small muted hm-hint">Bir güne dokun ya da üzerine gel. “~” tahmini gündür.</p>
    </div>
  );
}
