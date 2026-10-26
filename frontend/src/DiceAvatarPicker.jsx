import { useMemo, useState } from 'react';
import { DICE_PALETTES, DICE_STYLES, encodeDice, isDice, parseDice, randomSeed, useDiceSrc } from './diceAvatar.js';

function Thumb({ value }) {
  const src = useDiceSrc(value);
  return src ? <img src={src} alt="" /> : null;
}

const CANDIDATES = 8;
const seeds = () => Array.from({ length: CANDIDATES }, randomSeed);

// Resim avatar secici: stil -> aday avatarlar (Yenile) -> palet satirlari (arka plan / ten / sac)
export default function DiceAvatarPicker({ value, onChange }) {
  const cur = parseDice(isDice(value) ? value : '');
  const [style, setStyle] = useState(cur?.style || DICE_STYLES[0].id);
  const [pal, setPal] = useState({ bg: cur?.bg || '-', skin: cur?.skin || '-', hair: cur?.hair || '-' });
  const [cands, setCands] = useState(() => (cur ? [cur.seed, ...seeds().slice(1)] : seeds()));
  const def = DICE_STYLES.find((s) => s.id === style);
  const build = (seed, p = pal, st = style) => encodeDice({ style: st, seed, bg: p.bg, skin: p.skin, hair: p.hair });
  const pickPal = (key, v) => {
    const next = { ...pal, [key]: v };
    setPal(next);
    onChange(build(cur?.seed || cands[0], next));
  };
  const rows = useMemo(() => [['bg', true], ['skin', !!def.skin], ['hair', !!def.hair]].filter(([, on]) => on).map(([k]) => k), [def]);
  return (
    <div className="dicepick">
      <div className="tabs" role="tablist" aria-label="Avatar stili">
        {DICE_STYLES.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={style === s.id} className="tab sm" onClick={() => { setStyle(s.id); if (cur) onChange(build(cur.seed, pal, s.id)); }}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="dice-grid">
        {cands.map((seed) => {
          const v = build(seed);
          return (
            <button type="button" key={seed} className="dice-opt" aria-pressed={cur?.seed === seed && cur.style === style} aria-label="Avatar seç" onClick={() => onChange(v)}>
              <Thumb value={v} />
            </button>
          );
        })}
      </div>
      <button type="button" className="btn small ghost" onClick={() => setCands(seeds())}>🎲 Yenile</button>
      {rows.map((k) => (
        <div key={k} className="dice-pal">
          <span className="small muted">{DICE_PALETTES[k].label}</span>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="swatch none" aria-pressed={pal[k] === '-'} aria-label={`${DICE_PALETTES[k].label}: varsayılan`} onClick={() => pickPal(k, '-')}>∅</button>
            {DICE_PALETTES[k].colors.map((c, i) => (
              <button type="button" key={c} className="swatch" style={{ background: '#' + c }} aria-pressed={pal[k] === String(i)} aria-label={`${DICE_PALETTES[k].label} ${i + 1}`} onClick={() => pickPal(k, String(i))} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
