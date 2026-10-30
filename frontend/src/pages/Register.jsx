import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { autoEnablePush } from '../pushClient.js';
import { Avatar } from '../ui.jsx';
import { AccountInputs, accountBody, accountError, useAccountForm } from '../AccountFields.jsx';

// Kutuphane raflari: seed'li, sabit kitap sirtlari (dis gorsel dosyasi gerekmez)
const SPINES = ['#7a2e2e', '#2f4b6e', '#3d5a3a', '#8a6a2f', '#5a3a63', '#a14f2c', '#2c5a5e', '#6b4a32', '#8f3b4f', '#3b3f66'];

function Shelves() {
  const rows = useMemo(() => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 6 }, (_, r) => {
      const books = [];
      let x = -10;
      while (x < 1210) {
        const w = 14 + rnd() * 22;
        const h = 90 + rnd() * 70;
        books.push({ x, w, h, c: SPINES[Math.floor(rnd() * SPINES.length)], t: rnd() > 0.6, lean: rnd() > 0.96 });
        x += w + 1;
      }
      return { y: 70 + r * 150, books };
    });
  }, []);
  return (
    <svg className="reg-shelves" viewBox="0 0 1200 960" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="spineShade" x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".35" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#000" stopOpacity=".3" />
        </linearGradient>
      </defs>
      <rect width="1200" height="960" fill="#1d130c" />
      {rows.map((row, i) => {
        const base = row.y + 128;
        return (
          <g key={i}>
            {row.books.map((b, k) => (
              <g key={k} transform={b.lean ? `rotate(8 ${b.x} ${base})` : undefined}>
                <rect x={b.x} y={base - b.h} width={b.w} height={b.h} fill={b.c} />
                <rect x={b.x} y={base - b.h} width={b.w} height={b.h} fill="url(#spineShade)" />
                {b.t && <rect x={b.x} y={base - b.h + 14} width={b.w} height="4" fill="#e9d6a8" opacity=".7" />}
                {b.t && <rect x={b.x} y={base - 22} width={b.w} height="3" fill="#e9d6a8" opacity=".5" />}
              </g>
            ))}
            <rect x="0" y={base} width="1200" height="14" fill="#2b1d14" />
            <rect x="0" y={base} width="1200" height="3" fill="#4a3322" />
          </g>
        );
      })}
    </svg>
  );
}

// Gercek 3B kitap (CSS 3D): doner, kapagi acilir, sayfalari cevrilir
function BookArt() {
  const lines = [0, 1, 2, 3, 4].map((n) => <i key={n} />);
  return (
    <div className="reg-art" aria-hidden="true">
      <div className="b3-scene">
        <div className="b3">
          <div className="b3-face b3-back" />
          <div className="b3-face b3-spine" />
          <div className="b3-face b3-pages" />
          <div className="b3-face b3-top" />
          <div className="b3-face b3-bottom" />
          <div className="b3-face b3-sheet">{lines}</div>
          <div className="b3-leaf"><div className="b3-leaf-f">{lines}</div></div>
          <div className="b3-cover">
            <div className="b3-cover-f"><span className="b3-emb" /><span className="b3-t" /><span className="b3-t s" /></div>
            <div className="b3-cover-b">{lines}</div>
          </div>
        </div>
      </div>
      <div className="b3-shadow" />
    </div>
  );
}

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
    if (!user && (!adm.username.trim() || !adm.password)) return setError('Yönetici hesabının kullanıcı adı ve şifresini yaz.');
    setBusy(true);
    setError('');
    try {
      if (!user) await api.login(adm.username.trim().toLowerCase(), adm.password);
      await api.createGroup(name, shareOld);
      const me = (await api.me()).user;
      navigate('/', { replace: true });
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
    <div className="reg-wrap">
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
              <div className="field" role="group" aria-label="Yönetici hesabı">
                <span>Yönetici hesabı</span>
                {user ? (
                  <div className="reg-me"><Avatar user={user} size="sm" /> <b>{user.display_name}</b> <span className="muted small">(@{user.username}) grubun yöneticisi olacak</span></div>
                ) : (
                  <>
                    <p className="muted small" style={{ margin: '2px 0 8px' }}>Grubu yönetecek mevcut hesabınla doğrula.</p>
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
