import { useEffect, useState } from 'react';

// Resim avatar degeri: dice:<stil>:<seed>:<arka plan>:<ten>:<sac>  (paletler indeks, '-' = stilin kendi rengi)
// Backend (avatars.js) ayni stil adlarini ve palet boyutlarini dogrular; ikisi birlikte degisir.
// Stil paketleri buyuk: yalnizca gerektiginde, stil basina ayri parca olarak yuklenir.
export const DICE_STYLES = [
  { id: 'lorelei', label: 'Lorelei', load: () => import('@dicebear/lorelei'), skin: 'skinColor', hair: 'hairColor' },
  { id: 'openPeeps', label: 'Peeps', load: () => import('@dicebear/open-peeps'), skin: 'skinColor' },
  { id: 'notionists', label: 'Notion', load: () => import('@dicebear/notionists') },
  { id: 'pixelArt', label: 'Piksel', load: () => import('@dicebear/pixel-art'), skin: 'skinColor', hair: 'hairColor' },
];
export const DICE_PALETTES = {
  bg: { label: 'Arka plan', colors: ['ffd5dc', 'ffdfbf', 'fff3b0', 'd4f0c4', 'c0e8f9', 'd9d0ff', 'e9e4dc', 'b6e3db'] },
  skin: { label: 'Ten', colors: ['ffdbb4', 'edb98a', 'd08b5b', 'ae5d29', '694d3d'] },
  hair: { label: 'Saç', colors: ['2c1b18', '6a4e42', 'b55239', 'e6b34f', '8a8d91', '5b7fd0'] },
};
const RE = /^dice:([A-Za-z]+):([A-Za-z0-9]{1,16}):([0-9]|-):([0-9]|-):([0-9]|-)$/;
const pick = (key, v) => (v === '-' ? null : DICE_PALETTES[key].colors[Number(v)] || null);

export const isDice = (v) => typeof v === 'string' && v.startsWith('dice:');
export function parseDice(v) {
  const m = RE.exec(v || '');
  if (!m || !DICE_STYLES.some((s) => s.id === m[1])) return null;
  return { style: m[1], seed: m[2], bg: m[3], skin: m[4], hair: m[5] };
}
export const encodeDice = (d) => `dice:${d.style}:${d.seed}:${d.bg}:${d.skin}:${d.hair}`;
export const randomSeed = () => Math.random().toString(36).slice(2, 10);

const cache = new Map(); // deger -> SVG data URI (bozuksa null)
const pending = new Map();
export const cachedDiceSrc = (v) => cache.get(v);

export function loadDiceSrc(v) {
  if (cache.has(v)) return Promise.resolve(cache.get(v));
  if (pending.has(v)) return pending.get(v);
  const d = parseDice(v);
  if (!d) return Promise.resolve(null);
  const def = DICE_STYLES.find((s) => s.id === d.style);
  const p = Promise.all([import('@dicebear/core'), def.load()])
    .then(([core, style]) => {
      const opts = { seed: d.seed };
      const bg = pick('bg', d.bg);
      if (bg) opts.backgroundColor = [bg];
      const skin = def.skin && pick('skin', d.skin);
      if (skin) opts[def.skin] = [skin];
      const hair = def.hair && pick('hair', d.hair);
      if (hair) opts[def.hair] = [hair];
      const src = 'data:image/svg+xml;utf8,' + encodeURIComponent(core.createAvatar(style, opts).toString());
      cache.set(v, src);
      return src;
    })
    .catch(() => null)
    .finally(() => pending.delete(v));
  pending.set(v, p);
  return p;
}

// Resim avatar kaynagi; yuklenene kadar null (cagiran emoji/yer tutucu gosterir)
export function useDiceSrc(v) {
  const [src, setSrc] = useState(() => (isDice(v) ? cache.get(v) ?? null : null));
  useEffect(() => {
    if (!isDice(v)) return setSrc(null);
    let alive = true;
    setSrc(cache.get(v) ?? null);
    loadDiceSrc(v).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [v]);
  return src;
}
