import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { autoEnablePush } from '../pushClient.js';

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
    <div className="login-wrap">
      <form className="card login" onSubmit={submit} noValidate>
        <h1><img src="/brand.png" alt="" width="40" height="40" style={{ verticalAlign: 'middle', marginRight: 8 }} />Kütüphane</h1>
        <p className="sub" style={{ textAlign: 'center' }}>
          Ne okuduk, ne izledik – hepsi burada.
        </p>
        <label className="field">
          <span>Kullanıcı adı</span>
          <input type="text" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Şifre</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <div className="err" role="alert">
            {error}
          </div>
        )}
        <button className="btn" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
        <Link className="btn ghost" style={{ width: '100%', textAlign: 'center', boxSizing: 'border-box' }} to="/kayit">
          Hesap aç
        </Link>
      </form>
    </div>
  );
}
