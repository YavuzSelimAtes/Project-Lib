import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { Skeleton, setTimeZone } from './ui.jsx';
import Login from './pages/Login.jsx';
const Join = lazy(() => import('./pages/Join.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
import Ben from './pages/Ben.jsx';
const GroupPage = lazy(() => import('./pages/GroupPage.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const AllHome = lazy(() => import('./pages/AllHome.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
import Bell from './Bell.jsx';
import AccountMenu from './AccountSwitch.jsx';
import FeedbackModal from './Feedback.jsx';
import ChangePassword from './ChangePassword.jsx';
import ProfileEdit from './Profile.jsx';
import { dropPushOnLogout, autoEnablePush } from './pushClient.js';

import { AuthCtx } from './auth.js';
import { flushQueue, queueCount } from './offlineQueue.js';

function PendingBadge() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const upd = () => queueCount().then(setN);
    upd();
    window.addEventListener('queue-changed', upd);
    return () => window.removeEventListener('queue-changed', upd);
  }, []);
  return n > 0 ? (
    <span className="small muted" title="İnternet gelince gönderilecek" style={{ whiteSpace: 'nowrap' }}>
      ⏳ {n} bekleyen güncelleme
    </span>
  ) : null;
}

const ACCOUNT_NAV = [
  ['/ana', 'Ana sayfa', (p) => p.startsWith('/ana')],
  ['/ben', 'Hesabım', (p) => p === '/ben' || p === '/ben/' || p.startsWith('/ben/hesabim')],
  ['/ben/defterim', 'Defterim', (p) => p.startsWith('/ben/defterim')],
  ['/ben/hedefler', 'Hedefler', (p) => p.startsWith('/ben/hedefler')],
  ['/gruplar', 'Gruplar', (p) => p.startsWith('/gruplar') || p.startsWith('/grup-olustur')],
  ['/library', 'Kitaplık', (p) => p.startsWith('/library')],
];

// Grup icindeyken ayni tek bar grubun sekmelerini tasir
const groupNav = (gid, uid) => [
  [`/g/${gid}`, 'Ana sayfa', (p) => p === `/g/${gid}` || p === `/g/${gid}/`],
  [`/g/${gid}/liderlik`, 'Liderlik', (p) => p.startsWith(`/g/${gid}/liderlik`)],
  [`/g/${gid}/rafim`, 'Rafım', (p) => p.startsWith(`/g/${gid}/rafim`) || p.startsWith(`/g/${gid}/uye/${uid}`)],
  [`/g/${gid}/kitaplik`, 'Kitaplık', (p) => p.startsWith(`/g/${gid}/kitaplik`)],
  [`/g/${gid}/bilgi`, 'Üyeler', (p) => p.startsWith(`/g/${gid}/bilgi`) || (p.startsWith(`/g/${gid}/uye`) && !p.startsWith(`/g/${gid}/uye/${uid}`))],
];

// Grup yonetici hesabi: sade grup ayarlari (okuyucu sayfalari yok)
const MANAGER_NAV = [
  ['/yonetim', 'İstekler', (p) => p === '/yonetim' || p === '/yonetim/' || p.startsWith('/yonetim/inbox')],
  ['/yonetim/link', 'Grup', (p) => p.startsWith('/yonetim/link')],
  ['/yonetim/reading', 'Okuma', (p) => p.startsWith('/yonetim/reading')],
  ['/yonetim/list', 'Katalog', (p) => p.startsWith('/yonetim/list') || p.startsWith('/yonetim/catalog')],
];

// Nav + kayan aktif pill: mod degisince (key) ogeler yeniden belirir, pill ayni modda kayar
function Nav({ items, pathname, label }) {
  const ref = useRef(null);
  const [ind, setInd] = useState(null);
  const [anim, setAnim] = useState(false);
  const measure = useCallback(() => {
    const a = ref.current?.querySelector('a.active');
    setInd(a ? { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight } : null);
  }, []);
  useLayoutEffect(measure, [measure, pathname]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnim(true));
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);
  return (
    <nav className="nav" aria-label={label} ref={ref}>
      {ind && (
        <span
          className={anim ? 'nav-ind anim' : 'nav-ind'}
          aria-hidden="true"
          style={{ width: ind.w, height: ind.h, transform: `translate(${ind.x}px, ${ind.y}px)` }}
        />
      )}
      {items.map(([to, text, match]) => (
        <Link key={to} to={to} className={match(pathname) ? 'active' : undefined} aria-current={match(pathname) ? 'page' : undefined}>
          {text}
        </Link>
      ))}
    </nav>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme');
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [theme]);
  const toggle = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* yoksay */
    }
    setTheme(next);
  };
  return [document.documentElement.dataset.theme === 'dark', toggle];
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = yukleniyor, null = giris yok
  const [dark, toggleTheme] = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const { pathname } = useLocation();
  const mainRef = useRef(null);

  // Sayfa gecisi: icerik kisa solarak belirir (yeniden mount etmeden)
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.classList.remove('route-in');
    void el.offsetWidth;
    el.classList.add('route-in');
    // Giris hareketi yalniz sayfa acilirken (veri gelene kadar ~1 sn); sonraki yeniden cizimler sessiz
    const t = setTimeout(() => el.classList.remove('route-in'), 1100);
    return () => clearTimeout(t);
  }, [pathname]);

  // Cevrimdisi kuyruk: giris yapildiginda/acilista ve internet gelince gonder
  const loggedIn = !!user;
  useEffect(() => {
    if (!loggedIn) return;
    flushQueue();
    window.addEventListener('online', flushQueue);
    return () => window.removeEventListener('online', flushQueue);
  }, [loggedIn]);

  const uid = user?.id;
  useEffect(() => {
    if (uid) autoEnablePush(uid); // izin zaten verilmişse aboneliği sessizce yeniden bağlar
  }, [uid]);

  const refresh = useCallback(async () => {
    try {
      const r = await api.me();
      setUser(r?.user ?? r ?? null);
    } catch {
      setUser(null);
    }
  }, []);
  useEffect(() => {
    refresh();
    const expired = () => setUser(null);
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, [refresh]);

  const logout = async () => {
    try {
      await dropPushOnLogout();
      await api.logout();
    } catch {
      /* yoksay */
    }
    setUser(null);
  };

  if (user === undefined) {
    return (
      <div className="page">
        <Skeleton h={80} n={3} />
      </div>
    );
  }
  if (!user) {
    return (
      <>
        <Suspense fallback={<div className="page"><Skeleton h={80} n={3} /></div>}>
          <Routes>
            <Route path="/kayit" element={<Register onLogin={setUser} />} />
            <Route path="/grup-olustur" element={<Register onLogin={setUser} initialMode="group" />} />
            <Route path="/katil/:token" element={<Join onLogin={setUser} />} />
            <Route path="*" element={<Login onLogin={setUser} />} />
          </Routes>
        </Suspense>
        <ThemeBtn dark={dark} toggle={toggleTheme} floating />
      </>
    );
  }

  document.title = 'Kütüphane';
  setTimeZone(user.tz); // tarih islemleri (bugun/dun) kisinin saat dilimine gore
  const isAdmin = user.role === "admin";
  const canManage = isAdmin || (user.groups || []).some((g) => g.role === 'owner');
  const gm = pathname.match(/^\/g\/(\d+)/);
  // Uyesi olmadigim/olmayan grup adresinde bar hesap modunda kalir (sayfa kendi "bulamadim" ekranini gosterir)
  const gid = gm && (user.groups || []).some((g) => g.id === Number(gm[1])) ? Number(gm[1]) : null;
  const group = gid ? (user.groups || []).find((g) => g.id === gid) : null;
  const isManager = !!user.is_manager;
  const mode = isManager ? 'manager' : gid ? 'group' : 'account';
  const items = isManager ? MANAGER_NAV : gid ? groupNav(gid, user.id) : [...ACCOUNT_NAV, ...(canManage ? [['/yonetim', 'Yönetim', (p) => p.startsWith('/yonetim')]] : [])];
  const mgrName = user.managed_group_name || 'Grup';
  return (
    <AuthCtx.Provider value={{ user, refresh, editProfile: () => setProfileOpen(true) }}>
      <header className="topbar">
        <div className="topbar-in">
          {isManager ? (
            <Link key="m" to="/yonetim" className="brand brand-group">
              <img className="brand-tile" src="/brand.png" alt="" width="28" height="28" />
              <span>{mgrName}</span>
              <span className="chip mgr-chip">Yönetici</span>
            </Link>
          ) : gid ? (
            <span key="g" className="brand-wrap">
              <Link to="/ben" className="back-pill" aria-label="Hesabıma dön" title="Hesabıma dön">
                <span aria-hidden="true">‹</span> <span className="back-txt">Hesabım</span>
              </Link>
              <Link to={`/g/${gid}`} className="brand brand-group">
                <img className="brand-tile" src="/brand.png" alt="" width="28" height="28" />
                <span>{group?.name || 'Grup'}</span>
              </Link>
            </span>
          ) : (
            <Link key="a" to="/ben" className="brand">
              <img src="/brand.png" alt="" width="28" height="28" /> <span>Kütüphane</span>
            </Link>
          )}
          <Nav key={mode} items={items} pathname={pathname} label={isManager ? 'Grup ayarları' : gid ? 'Grup menüsü' : 'Ana menü'} />
          <span className="spacer" />
          <PendingBadge />
          <Bell />
          <AccountMenu user={user} dark={dark} toggleTheme={toggleTheme} onProfile={() => setProfileOpen(true)} onFeedback={() => setFbOpen(true)} onLogout={logout} />
        </div>
      </header>
      {user.must_change_pw && <ChangePassword forced onDone={refresh} />}
      {fbOpen && !user.must_change_pw && <FeedbackModal onClose={() => setFbOpen(false)} />}
      {profileOpen && !user.must_change_pw && <ProfileEdit onClose={() => setProfileOpen(false)} />}
      <main className="page" ref={mainRef}>
        {isManager ? (
          <Routes>
            <Route path="/yonetim/:tab?" element={<Suspense fallback={<Skeleton h={80} n={3} />}><Admin /></Suspense>} />
            <Route path="*" element={<Navigate to="/yonetim" replace />} />
          </Routes>
        ) : (
        <Routes>
          <Route path="/" element={<Navigate to="/ben" replace />} />
          <Route path="/ben/:tab?" element={<Ben />} />
          <Route path="/ana/:gid?" element={<Suspense fallback={<Skeleton h={80} n={3} />}><AllHome /></Suspense>} />
          <Route path="/gruplar" element={<Suspense fallback={<Skeleton h={80} n={3} />}><Groups /></Suspense>} />
          <Route path="/g/:gid/*" element={<Suspense fallback={<Skeleton h={80} n={3} />}><GroupPage /></Suspense>} />
          <Route path="/liderlik" element={<Navigate to="/gruplar" replace />} />
          <Route path="/rafim" element={<Navigate to="/ben" replace />} />
          <Route path="/uye/:id" element={<Navigate to="/gruplar" replace />} />
          <Route path="/library" element={<Suspense fallback={<Skeleton h={80} n={3} />}><Library /></Suspense>} />
          <Route path="/kayit" element={<Navigate to="/ben" replace />} />
          <Route path="/grup-olustur" element={<Suspense fallback={<Skeleton h={80} n={3} />}><Register user={user} onLogin={setUser} initialMode="group" /></Suspense>} />
          <Route path="/katil/:token" element={<Suspense fallback={<Skeleton h={80} n={3} />}><Join user={user} onLogin={setUser} /></Suspense>} />
          <Route path="/kutuphane" element={<Navigate to="/library" replace />} />
          <Route path="/yonetim/:tab?" element={canManage ? <Suspense fallback={<Skeleton h={80} n={3} />}><Admin /></Suspense> : <Navigate to="/ben" replace />} />
          <Route path="*" element={<Navigate to="/ben" replace />} />
        </Routes>
        )}
      </main>
    </AuthCtx.Provider>
  );
}

function ThemeBtn({ dark, toggle, floating }) {
  return (
    <button
      className="icon-btn"
      onClick={toggle}
      aria-label={dark ? 'Açık temaya geç' : 'Koyu temaya geç'}
      title={dark ? 'Açık tema' : 'Koyu tema'}
      style={floating ? { position: 'fixed', top: 12, right: 12 } : undefined}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

