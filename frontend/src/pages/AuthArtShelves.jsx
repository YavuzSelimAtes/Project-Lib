import { useMemo } from 'react';

// Kutuphane raflari: seed'li, sabit duzen. Her kitap raf boslugundan (136) kucuk; dagınıklık kasitli:
// birkac egik kitap, yatay istif, bosluk + kitap tutucu.
const SPINES = ['#7a2e2e', '#2f4b6e', '#3d5a3a', '#8a6a2f', '#5a3a63', '#a14f2c', '#2c5a5e', '#6b4a32', '#8f3b4f', '#3b3f66'];
const GOLD = '#e9d6a8';
const PITCH = 150;
const CLEAR = 136;

function Spine({ x, base, w, h, c, v }) {
  const y = base - h;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={c} />
      {v === 0 && (
        <>
          <rect x={x} y={y + 12} width={w} height="3" fill={GOLD} opacity=".7" />
          <rect x={x} y={y + 18} width={w} height="1.5" fill={GOLD} opacity=".5" />
          <rect x={x} y={base - 16} width={w} height="3" fill={GOLD} opacity=".6" />
        </>
      )}
      {v === 1 && (
        <>
          <rect x={x + 3} y={y + h * 0.28} width={w - 6} height={h * 0.3} rx="1.5" fill="#f1e4c6" opacity=".88" />
          <rect x={x + 6} y={y + h * 0.4} width={w - 12} height="2" fill="#3a2a20" opacity=".7" />
        </>
      )}
      {v === 2 && (
        <>
          <rect x={x} y={y} width={w} height="9" fill={GOLD} opacity=".55" />
          <circle cx={x + w / 2} cy={y + h * 0.45} r={Math.min(4, w / 4)} fill={GOLD} opacity=".75" />
          <rect x={x} y={base - 9} width={w} height="9" fill={GOLD} opacity=".4" />
        </>
      )}
      {v === 3 && [0, 6, 12].map((d) => <rect key={d} x={x} y={y + h * 0.4 + d} width={w} height="2.5" fill={GOLD} opacity=".65" />)}
      {v === 4 && (
        <>
          <rect x={x} y={base - h * 0.32} width={w} height={h * 0.32} fill="#000" opacity=".28" />
          <rect x={x} y={base - h * 0.32} width={w} height="2" fill={GOLD} opacity=".6" />
        </>
      )}
      <rect x={x} y={y} width={w} height={h} fill="url(#spineShade)" />
      <rect x={x} y={y} width={w} height="2" fill="#fff" opacity=".14" />
    </g>
  );
}

export function Shelves() {
  const rows = useMemo(() => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pick = () => SPINES[Math.floor(rnd() * SPINES.length)];
    const style = () => Math.floor(rnd() * 5);
    return Array.from({ length: 6 }, (_, r) => {
      const items = [];
      let x = 10;
      while (x < 1170) {
        const roll = rnd();
        if (roll < 0.07) { // yatay istif
          const n = 2 + Math.floor(rnd() * 2);
          const w = 70 + rnd() * 26;
          let top = 0;
          for (let i = 0; i < n; i++) {
            const hh = 14 + rnd() * 8;
            top += hh;
            items.push({ t: 'flat', x: x + (rnd() - 0.5) * 6, w: w - i * 4, hh, up: top, c: pick() });
          }
          x += w + 8;
        } else if (roll < 0.15) { // egik kitap, yanindaki uzun kitaba yaslanir
          const w = 20 + rnd() * 12;
          const h = 96 + rnd() * 24;
          const a = 8 + rnd() * 7;
          const rad = (a * Math.PI) / 180;
          items.push({ t: 'lean', x, w, h, a, c: pick(), v: style() });
          x += w * Math.cos(rad) + h * Math.sin(rad);
          const w2 = 22 + rnd() * 10;
          items.push({ t: 'book', x, w: w2, h: Math.min(124, h + 6), c: pick(), v: style() });
          x += w2 + 1;
        } else if (roll < 0.19 && x < 1000) { // bosluk + kitap tutucu
          items.push({ t: 'end', x: x + 6 });
          x += 46 + rnd() * 40;
          items.push({ t: 'end', x: x - 6, flip: true });
        } else {
          const w = 14 + rnd() * 20;
          const h = 84 + rnd() * 40;
          items.push({ t: 'book', x, w, h, c: pick(), v: style() });
          x += w + 1;
        }
      }
      return { base: 70 + r * PITCH + CLEAR - 8, items };
    });
  }, []);

  return (
    <svg className="reg-shelves" viewBox="0 0 1200 960" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="spineShade" x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".35" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#000" stopOpacity=".3" />
        </linearGradient>
      </defs>
      <rect width="1200" height="960" fill="#1d130c" />
      {rows.map((row, i) => (
        <g key={i}>
          {row.items.map((it, k) => {
            if (it.t === 'book') return <Spine key={k} x={it.x} base={row.base} w={it.w} h={it.h} c={it.c} v={it.v} />;
            if (it.t === 'lean') {
              return (
                <g key={k} transform={`rotate(${it.a} ${it.x} ${row.base})`}>
                  <Spine x={it.x} base={row.base} w={it.w} h={it.h} c={it.c} v={it.v} />
                </g>
              );
            }
            if (it.t === 'flat') {
              return (
                <g key={k}>
                  <rect x={it.x} y={row.base - it.up} width={it.w} height={it.hh} rx="1.5" fill={it.c} />
                  <rect x={it.x + 2} y={row.base - it.up + 3} width={it.w - 3} height={it.hh - 6} fill="#efe3c8" opacity=".85" />
                  <rect x={it.x} y={row.base - it.up} width={it.w} height={it.hh} rx="1.5" fill="url(#spineShade)" opacity=".6" />
                </g>
              );
            }
            return <path key={k} d={it.flip ? `M${it.x} ${row.base} v-34 h-5 v28 h-14 v6Z` : `M${it.x} ${row.base} v-34 h5 v28 h14 v6Z`} fill="#3a2a1c" />;
          })}
          <rect x="0" y={row.base} width="1200" height="14" fill="#2b1d14" />
          <rect x="0" y={row.base} width="1200" height="3" fill="#4a3322" />
        </g>
      ))}
    </svg>
  );
}
