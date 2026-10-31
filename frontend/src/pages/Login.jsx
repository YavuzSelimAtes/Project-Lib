import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { autoEnablePush } from '../pushClient.js';
import { BookArt } from './AuthArt.jsx';
import { Shelves } from './AuthArtShelves.jsx';

// Hesap ac sayfasiyla ayni gorunum: raflar uzerinde acik panel, solda 3B kitap
export default function Login({ onLogin }) {
  useEffect(() => { document.title = 'Kütüphane'; }, []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError('Kullanıcı adı ve şifreyi yaz.');
    setBusy(true);
    setError('');
    try {
      const r = await api.login(username.trim(), password);
      onLogin(r.user);
      autoEnablePush(r.user.id, { prompt: true }); // varsayılan açık: bu cihaz bildirimlere bağlanır (kullanıcı kapattıysa bağlanmaz)
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reg-wrap">
      <Shelves />
      <div className="reg-veil" />
      <div className="reg-inner reg-login">
        <h1 className="reg-title">Kütüphane</h1>
        <div className="reg-panel">
          <div className="reg-side">
            <BookArt />
            <p className="reg-cap">Ne okuduk, ne izledik – hepsi burada.</p>
          </div>
          <form className="reg-form" onSubmit={submit} noValidate>
            <h2>Giriş yap</h2>
            <label className="field">
              <span>Kullanıcı adı</span>
              <input type="text" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Şifre</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <div className="err" role="alert">{error}</div>}
            <div className="reg-actions">
              <button className="btn" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
              <Link className="btn ghost" to="/kayit">Hesap aç</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
