import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { autoEnablePush } from '../pushClient.js';
import { Avatar } from '../ui.jsx';
import { BookArt } from './AuthArt.jsx';
import { Shelves } from './AuthArtShelves.jsx';
import { AccountInputs, accountBody, accountError, useAccountForm } from '../AccountFields.jsx';

// Kitap hakkinda sohbet eden iki kisi (2B, inline SVG)
function ReadersArt() {
  return (
    <div className="reg-art" aria-hidden="true">
      <svg className="readers" viewBox="0 0 300 190" width="300" height="190" role="img" aria-label="">
        <ellipse cx="150" cy="176" rx="125" ry="7" fill="currentColor" opacity=".1" />
        <g className="rd-l">
          <rect x="62" y="104" width="46" height="66" rx="20" fill="#d9693b" />
          <circle cx="85" cy="82" r="21" fill="#f1c9a5" />
          <path d="M64 78a21 21 0 0 1 42 0c-10-8-32-8-42 0z" fill="#5b3a29" />
          <circle cx="79" cy="84" r="2" fill="#2d2620" /><circle cx="92" cy="84" r="2" fill="#2d2620" />
          <path d="M80 92q5 4 10 0" stroke="#2d2620" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <g className="rd-book"><rect x="76" y="126" width="38" height="26" rx="3" fill="#3b82f6" /><path d="M95 126v26" stroke="#fff" strokeWidth="1.5" opacity=".7" /></g>
        </g>
        <g className="rd-r">
          <rect x="192" y="104" width="46" height="66" rx="20" fill="#14b8a6" />
          <circle cx="215" cy="82" r="21" fill="#e3b08a" />
          <path d="M194 80a21 21 0 0 1 42 0c0-10-42-10-42 0z" fill="#2d2620" />
          <circle cx="209" cy="85" r="2" fill="#2d2620" /><circle cx="222" cy="85" r="2" fill="#2d2620" />
          <path d="M210 93q5 4 10 0" stroke="#2d2620" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <g className="rd-book b2"><rect x="186" y="128" width="38" height="26" rx="3" fill="#eab308" /><path d="M205 128v26" stroke="#fff" strokeWidth="1.5" opacity=".7" /></g>
        </g>
        <g className="bub b1"><path d="M44 18h74a12 12 0 0 1 12 12v18a12 12 0 0 1-12 12H84l-14 12v-12H56a12 12 0 0 1-12-12V30a12 12 0 0 1 12-12z" fill="#fff" stroke="#e8dfd2" /><circle cx="68" cy="39" r="3" className="dt" /><circle cx="82" cy="39" r="3" className="dt d2" /><circle cx="96" cy="39" r="3" className="dt d3" /></g>
        <g className="bub b2"><path d="M190 8h76a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12h-12v12l-14-12h-50a12 12 0 0 1-12-12V20a12 12 0 0 1 12-12z" fill="#fbe3d6" /><path d="M204 24h56M204 35h34" stroke="#d9693b" strokeWidth="4" strokeLinecap="round" /></g>
        <g className="star"><path d="M150 68l3.5 8 8.5 1-6.5 6 2 8.5-7.5-4.5-7.5 4.5 2-8.5-6.5-6 8.5-1z" fill="#eab308" /></g>
      </svg>
    </div>
  );
}

export default function Register({ user, onLogin, initialMode = null }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode || (user ? 'group' : 'account')); // 'account' | 'group'
  const [f, set] = useAccountForm();
  const [gname, setGname] = useState('');
  const [adm, setAdm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fromGroup, setFromGroup] = useState(false);
  const [shareOld, setShareOld] = useState(false);

  const pick = (m) => { setMode(m); setError(''); setFromGroup(false); };

  const submitAccount = async (e) => {
    e.preventDefault();
    const msg = accountError(f);
    if (msg) return setError(msg);
    setBusy(true);
    setError('');
    try {
      const r = await api.register(accountBody(f));
      navigate(fromGroup ? '/grup-olustur' : '/', { replace: true });
      onLogin(r.user);
      autoEnablePush(r.user.id, { prompt: true });
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  };

  const submitGroup = async (e) => {
    e.preventDefault();
    const name = gname.trim();
    if (!name) return setError('Grup adını yaz.');
    if (!user && (!adm.username.trim() || !adm.password)) return setError('Hesabının kullanıcı adı ve şifresini yaz.');
    setBusy(true);
    setError('');
    try {
      if (!user) await api.login(adm.username.trim().toLowerCase(), adm.password);
      await api.createGroup(name, shareOld);
      const me = (await api.me()).user;
      navigate(user ? '/gruplar' : '/', { replace: true });
      onLogin(me);
      if (!user) autoEnablePush(me.id, { prompt: true });
    } catch (x) {
      setError(x.message);
      // giris basarili ama grup acilamadiysa oturum acik kalir: arayuzu sunucuyla esle
      if (!user) {
        try {
          const me = (await api.me()).user;
          if (me) {
            navigate('/grup-olustur', { replace: true });
            onLogin(me);
          }
        } catch {
          /* oturum yok */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reg-wrap reg-fit">
      <Shelves />
      <div className="reg-veil" />
      <div className="reg-inner">
        <Link to="/" className="reg-back">← {user ? 'Ana sayfa' : 'Girişe dön'}</Link>
        <h1 className="reg-title">Kütüphane’ye hoş geldin</h1>
        <div className="reg-tabs" role="group" aria-label="Seçenekler">
          {!user && (
            <button type="button" className="reg-tab" aria-pressed={mode === 'account'} onClick={() => pick('account')}>Hesap aç</button>
          )}
          <button type="button" className="reg-tab" aria-pressed={mode === 'group'} onClick={() => pick('group')}>Grup oluştur</button>
        </div>

        <div className="reg-panel" aria-live="polite" key={mode}>
          <div className="reg-side">
            {mode === 'account' ? <BookArt /> : <ReadersArt />}
            <p className="reg-cap">{mode === 'account' ? 'Kendi rafını kur, istersen sonra bir gruba katıl.' : 'Aileni ya da arkadaşlarını topla, birlikte oku.'}</p>
          </div>

          {mode === 'account' && (
            <form className="reg-form" onSubmit={submitAccount} noValidate>
              <h2>Hesap aç</h2>
              <AccountInputs f={f} set={set} autoFocus />
              {error && <div className="err" role="alert">{error}</div>}
              <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Hesap açılıyor…' : fromGroup ? 'Hesap aç, sonra grubu kur' : 'Hesap aç'}</button>
            </form>
          )}

          {mode === 'group' && (
            <form className="reg-form" onSubmit={submitGroup} noValidate>
              <h2>Grup oluştur</h2>
              <label className="field">
                <span>Grup adı</span>
                <input type="text" maxLength={40} value={gname} onChange={(e) => setGname(e.target.value)} autoFocus placeholder="Örn. Yılmaz Ailesi" />
              </label>
              <label className="small" style={{ display: 'block', margin: '0 0 10px' }}>
                <input type="checkbox" checked={shareOld} onChange={(e) => setShareOld(e.target.checked)} /> Eski kayıtlarımı da bu grupta paylaş
              </label>
              <div className="field" role="group" aria-label="Grup yönetimi">
                <span>Grup yönetimi</span>
                {user ? (
                  <div className="reg-me"><Avatar user={user} size="sm" /> <span className="muted small">Grup için ayrı bir yönetici hesabı açılır. Sen üye kalırsın, menüden o hesaba geçip grubu yönetirsin.</span></div>
                ) : (
                  <>
                    <p className="muted small" style={{ margin: '2px 0 8px' }}>Hesabınla doğrula; grup için ayrı bir yönetici hesabı açılır, sen üye kalırsın.</p>
                    <label className="field">
                      <span>Kullanıcı adı</span>
                      <input type="text" autoComplete="username" autoCapitalize="none" value={adm.username} onChange={(e) => setAdm({ ...adm, username: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Şifre</span>
                      <input type="password" autoComplete="current-password" value={adm.password} onChange={(e) => setAdm({ ...adm, password: e.target.value })} />
                    </label>
                    <p className="small" style={{ margin: 0 }}>
                      Hesabın yok mu? Grup açmak için önce hesap gerekir.{' '}
                      <button type="button" className="linkbtn" onClick={() => { setMode('account'); setFromGroup(true); setError(''); }}>Önce hesap aç</button>
                    </p>
                  </>
                )}
              </div>
              {error && <div className="err" role="alert">{error}</div>}
              <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Oluşturuluyor…' : 'Grubu oluştur'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
