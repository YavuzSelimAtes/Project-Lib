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
export const ALL_AVATARS = [...CANON.values()];
