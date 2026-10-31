import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { autoEnablePush } from '../pushClient.js';
import { AccountInputs, accountBody, accountError, useAccountForm } from '../AccountFields.jsx';

// /katil/:token — oturum yoksa "Giriş yap" / "Hesap aç" sekmeleri, oturum varsa tek tıkla "Gruba katıl"
export default function Join({ user, onLogin }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [owner, setOwner] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [invalid, setInvalid] = useState('');
  const [mode, setMode] = useState('login');
  const [f, set] = useAccountForm();
  const [share, setShare] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.joinInfo(token).then((r) => {
      setOwner(r.owner_name);
      setGroupName(r.group_name);
      document.title = r.group_name;
    }, (e) => setInvalid(e.message));
  }, [token]);

  const finish = (u) => {
    navigate('/', { replace: true });
    onLogin(u);
    if (!user) autoEnablePush(u.id, { prompt: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!user && mode === 'login' && (!f.username.trim() || !f.password)) return setError('Kullanıcı adı ve şifreyi yaz.');
    if (!user && mode === 'register' && accountError(f)) return setError(accountError(f));
    setBusy(true);
    try {
      if (user) {
        finish((await api.join(token, { share_existing: share })).user);
      } else if (mode === 'login') {
        await api.login(f.username.trim(), f.password);
        finish((await api.join(token, { share_existing: share })).user);
      } else {
        finish((await api.join(token, accountBody(f))).user);
      }
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
          <Link className="btn" style={{ width: '100%', textAlign: 'center', boxSizing: 'border-box' }} to="/">Ana sayfaya git</Link>
        </div>
      </div>
    );
  }
  const shareBox = (
    <label className="small" style={{ display: 'block', margin: '0 0 12px' }}>
      <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Eski kayıtlarımı da paylaş
      <span className="muted"> (şimdiye kadarki kitap/film kayıtlarım bu grupta da görünsün)</span>
    </label>
  );
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit} noValidate>
        <h1><img src="/brand.png" alt="" width="40" height="40" style={{ verticalAlign: 'middle', marginRight: 8 }} />{groupName || 'Kütüphane'}</h1>
        <p className="sub" style={{ textAlign: 'center' }}>
          {!owner ? 'Davet kontrol ediliyor…' : user ? `${owner} seni “${groupName}” grubuna davet etti.` : `${owner} seni davet etti. Giriş yap ya da hesap aç, otomatik katılırsın.`}
        </p>
        {user ? (
          <>
            <p style={{ textAlign: 'center', margin: '0 0 12px' }}><b>{user.display_name}</b> hesabıyla katılacaksın.</p>
            {shareBox}
          </>
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Katılım yolu" style={{ justifyContent: 'center', marginBottom: 12 }}>
              <button type="button" role="tab" className="tab sm" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Giriş yap</button>
              <button type="button" role="tab" className="tab sm" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>Hesap aç</button>
            </div>
            {mode === 'login' ? (
              <>
                <label className="field">
                  <span>Kullanıcı adı</span>
                  <input type="text" autoComplete="username" autoCapitalize="none" value={f.username} onChange={(e) => set('username')(e.target.value)} autoFocus />
                </label>
                <label className="field">
                  <span>Şifre</span>
                  <input type="password" autoComplete="current-password" value={f.password} onChange={(e) => set('password')(e.target.value)} />
                </label>
                {shareBox}
              </>
            ) : (
              <AccountInputs f={f} set={set} autoFocus />
            )}
          </>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn" style={{ width: '100%' }} disabled={busy || !owner}>
          {busy ? 'Katılınıyor…' : user ? 'Gruba katıl' : mode === 'login' ? 'Giriş yap ve katıl' : 'Hesap aç ve katıl'}
        </button>
        {user && <Link className="btn ghost" style={{ width: '100%', textAlign: 'center', boxSizing: 'border-box', marginTop: 8 }} to="/">Vazgeç</Link>}
      </form>
    </div>
  );
}
