import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { autoEnablePush } from '../pushClient.js';
import { AvatarPicker, ColorPicker, COLORS } from '../Profile.jsx';

export default function Join({ token, onLogin }) {
  const [owner, setOwner] = useState(null);
  const [invalid, setInvalid] = useState('');
  const [f, setF] = useState({ username: '', password: '', display_name: '', avatar: '🦊', color: COLORS[0] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    api.joinInfo(token).then((r) => setOwner(r.owner_name), (e) => setInvalid(e.message));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.username.trim() || !f.password || !f.display_name.trim()) return setError('Kullanıcı adı, şifre ve hesap adını doldur.');
    setBusy(true);
    setError('');
    try {
      const r = await api.join(token, { ...f, username: f.username.trim(), display_name: f.display_name.trim() });
      window.history.replaceState(null, '', '/');
      onLogin(r.user);
      autoEnablePush(r.user.id, { prompt: true });
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <div className="login-wrap">
        <div className="card login">
          <h1>Davet geçersiz</h1>
          <p className="sub" style={{ textAlign: 'center' }}>{invalid}</p>
          <a className="btn" style={{ width: '100%', textAlign: 'center' }} href="/">Girişe git</a>
        </div>
      </div>
    );
  }
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit} noValidate>
        <h1><img src="/brand.png" alt="" width="40" height="40" style={{ verticalAlign: 'middle', marginRight: 8 }} />Kütüphaneye katıl</h1>
        <p className="sub" style={{ textAlign: 'center' }}>{owner ? `${owner} seni grubuna davet etti.` : 'Davet kontrol ediliyor…'}</p>
        <label className="field">
          <span>Kullanıcı adı</span>
          <input type="text" autoComplete="username" autoCapitalize="none" value={f.username} onChange={(e) => set('username')(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Şifre (en az 6 karakter)</span>
          <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password')(e.target.value)} />
        </label>
        <label className="field">
          <span>Hesap adı (herkese görünen)</span>
          <input type="text" value={f.display_name} onChange={(e) => set('display_name')(e.target.value)} />
        </label>
        <div className="field"><span>Avatar</span><AvatarPicker value={f.avatar} onChange={set('avatar')} /></div>
        <div className="field"><span>Renk</span><ColorPicker value={f.color} onChange={set('color')} /></div>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn" style={{ width: '100%' }} disabled={busy || !owner}>{busy ? 'Katılınıyor…' : 'Katıl'}</button>
      </form>
    </div>
  );
}
