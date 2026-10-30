import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom';
import { api } from './api.js';
import { Avatar, Skeleton, setTimeZone } from './ui.jsx';
import Login from './pages/Login.jsx';
import Join from './pages/Join.jsx';
import Home from './pages/Home.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Shelf from './pages/Shelf.jsx';
import Admin from './pages/Admin.jsx';
const Library = lazy(() => import('./pages/Library.jsx'));
import Bell from './Bell.jsx';
import AccountSwitch from './AccountSwitch.jsx';
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
  const joinToken = (window.location.pathname.match(/^\/katil\/([\w-]+)\/?$/) || [])[1];

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
        {joinToken ? <Join token={joinToken} onLogin={setUser} /> : <Login onLogin={setUser} />}
        <ThemeBtn dark={dark} toggle={toggleTheme} floating />
      </>
    );
  }

  document.title = user.group_name || 'Aile Kütüphanesi';
  setTimeZone(user.tz); // tarih islemleri (bugun/dun) kisinin saat dilimine gore
  const isAdmin = user.role === 'admin';
  return (
    <AuthCtx.Provider value={{ user, refresh, editProfile: () => setProfileOpen(true) }}>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand">
            <img src="/brand.png" alt="" width="28" height="28" /> <span>{user.group_name || 'Aile Kütüphanesi'}</span>
          </Link>
          <nav className="nav" aria-label="Ana menü">
            <NavLink to="/" end>
              Ana Sayfa
            </NavLink>
            <NavLink to="/liderlik">Liderlik</NavLink>
            <NavLink to="/rafim">Rafım</NavLink>
            <NavLink to="/library">Kitaplık</NavLink>
            {isAdmin && <NavLink to="/yonetim">Yönetim</NavLink>}
          </nav>
          <span className="spacer" />
          <PendingBadge />
          <Bell />
          <ThemeBtn dark={dark} toggle={toggleTheme} />
          <button className="who" onClick={() => setProfileOpen(true)} title="Profili düzenle" aria-label="Profili düzenle">
            <Avatar user={user} size="sm" />
          </button>
          <AccountSwitch userId={user.id} />
          <button className="btn small ghost" onClick={logout}>
            Çıkış
          </button>
        </div>
      </header>
      {user.must_change_pw && <ChangePassword forced onDone={refresh} />}
      {profileOpen && !user.must_change_pw && <ProfileEdit onClose={() => setProfileOpen(false)} />}
      <main className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/liderlik" element={<Leaderboard />} />
          <Route path="/rafim" element={<Shelf />} />
          <Route path="/uye/:id" element={<Shelf />} />
          <Route path="/library" element={<Suspense fallback={<Skeleton h={80} n={3} />}><Library /></Suspense>} />
          <Route path="/kutuphane" element={<Navigate to="/library" replace />} />
          <Route path="/yonetim" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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

