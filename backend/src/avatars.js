// Profil avatar listesi (GET /api/avatars). Avatar degeri bu listede olmak zorundadir.
// Emoji varyasyon isareti (U+FE0F) farki yok sayilir; listedeki hali saklanir.
export const AVATAR_GROUPS = [
  {
    id: 'animals', label: 'Hayvanlar',
    items: ['🦊', '🐼', '🦉', '🐙', '🦁', '🐸', '🐧', '🐶', '🐱', '🐭', '🐹', '🐰', '🐻', '🐨', '🐯', '🐮', '🐷', '🐵', '🐔', '🐦',
      '🐤', '🦆', '🦅', '🦇', '🐺', '🐗', '🐴', '🐝', '🦋', '🐌', '🐞', '🐢', '🐍', '🦎', '🦑', '🦀', '🐠', '🐟', '🐬', '🐳',
      '🦈', '🐘', '🦒', '🦓', '🦘', '🦔', '🦥', '🦦', '🦩', '🦜', '🦚', '🦢', '🐑', '🐐', '🐫', '🦙', '🐊', '🦭'],
  },
  {
    id: 'nature', label: 'Doğa / Şirin',
    items: ['🌸', '🌻', '🌼', '🌷', '🌹', '🌵', '🌴', '🌲', '🍀', '🍄', '🌈', '⭐', '🌙', '🔥', '💧', '🍎', '🍓', '🍒', '🍑', '🍋',
      '🍉', '🍕', '🍩', '🍪', '🧁', '🍭', '🌟', '✨', '⚡', '🌊', '🪐', '🍃', '🌺', '🧸', '🎈', '🎀', '🎨', '🎵', '🍦', '🥑'],
  },
  {
    id: 'fantasy', label: 'Fantastik',
    items: ['🦄', '🐉', '🐲', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '👻', '👽', '👾', '🤖', '🎃', '💀', '🔮', '🪄', '🧿', '🦸',
      '🦹', '🏰', '🥷', '🤴', '👸', '🎅', '🤶', '🧌'],
  },
  {
    id: 'people', label: 'Meslekler / İnsanlar',
    items: ['👩', '👨', '👧', '🧒', '👵', '👴', '👑', '🙂', '👶', '👦', '👱', '🧑', '🧔', '👮', '💂', '👷', '🧑‍🚀', '🧑‍🍳', '🧑‍🎨', '🧑‍🏫',
      '🧑‍🌾', '🧑‍🔬', '🧑‍🎤', '🧑‍🚒', '🧑‍⚕', '🧑‍💻', '🧑‍🔧', '🧑‍🎓', '😎', '🤓', '😺', '🥳'],
  },
];

const strip = (s) => String(s).replace(/️/g, '');
const CANON = new Map();
for (const g of AVATAR_GROUPS) for (const it of g.items) if (!CANON.has(strip(it))) CANON.set(strip(it), it);

// Listedeki kanonik hali ya da null
export const canonAvatar = (v) => (typeof v === 'string' ? CANON.get(strip(v.trim())) || null : null);
// Resim avatar: dice:<stil>:<seed>:<arka plan>:<ten>:<sac>; paletler indeks ('-' = stilin kendi rengi).
// Frontend diceAvatar.js ile ayni stil adlari ve palet boyutlari kullanilir.
const DICE_STYLES = ['lorelei', 'openPeeps', 'notionists', 'pixelArt'];
const DICE_SIZES = [8, 5, 6]; // arka plan, ten, sac
export function diceAvatar(v) {
  const m = typeof v === 'string' ? /^dice:([A-Za-z]+):([A-Za-z0-9]{1,16}):([0-9]|-):([0-9]|-):([0-9]|-)$/.exec(v.trim()) : null;
  if (!m || !DICE_STYLES.includes(m[1])) return null;
  for (let i = 0; i < 3; i++) if (m[3 + i] !== '-' && Number(m[3 + i]) >= DICE_SIZES[i]) return null;
  return m[0];
}

export const ALL_AVATARS = [...CANON.values()];
