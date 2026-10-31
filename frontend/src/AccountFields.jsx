import { useState } from 'react';
import { AvatarPicker, ColorPicker, COLORS } from './Profile.jsx';

export const newAccount = () => ({ username: '', password: '', display_name: '', avatar: '🦊', color: COLORS[0] });

// Hesap acma alanlari (kayit ve davet sayfalari ortak kullanir)
export function accountError(f) {
  if (!f.username.trim() || !f.password || !f.display_name.trim()) return 'Kullanıcı adı, şifre ve hesap adını doldur.';
  return '';
}
export const accountBody = (f) => ({ ...f, username: f.username.trim().toLowerCase(), display_name: f.display_name.trim() });

export function useAccountForm() {
  const [f, setF] = useState(newAccount);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return [f, set];
}

export function AccountInputs({ f, set, autoFocus }) {
  return (
    <>
      <label className="field">
        <span>Kullanıcı adı</span>
        <input type="text" autoComplete="username" autoCapitalize="none" value={f.username} onChange={(e) => set('username')(e.target.value)} autoFocus={autoFocus} />
      </label>
      <label className="field">
        <span>Şifre (en az 6 karakter)</span>
        <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password')(e.target.value)} />
      </label>
      <label className="field">
        <span>Hesap adı (herkese görünen)</span>
        <input type="text" maxLength={40} value={f.display_name} onChange={(e) => set('display_name')(e.target.value)} />
      </label>
      <div className="field" role="group" aria-label="Avatar seç"><span>Avatar</span><AvatarPicker value={f.avatar} onChange={set('avatar')} /></div>
      <div className="field" role="group" aria-label="Renk seç"><span>Renk</span><ColorPicker value={f.color} onChange={set('color')} /></div>
    </>
  );
}
