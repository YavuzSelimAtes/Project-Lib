import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import { Avatar } from './ui.jsx';
import { flushQueue, queueCount } from './offlineQueue.js';
import { moveSubscriptionToCurrentUser } from './pushClient.js';

// Tek hesap menusu: avatar -> profil, tema, bagli hesaplara gecis, cikis.
export default function AccountMenu({ user, dark, toggleTheme, onProfile, onFeedback, onLogout }) {
  const [accounts, setAccounts] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    api.linkedAccounts().then((r) => alive && setAccounts(r?.accounts || []), () => {});
    return () => {
      alive = false;
    };
  }, [user.id]);

  useEffect(() => {
    if (!open) return;
    const down = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const key = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const go = async (a) => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      // Bekleyen çevrimdışı güncellemeler mevcut hesaba yazılmalı; kalan varsa geçme
      await flushQueue();
      if ((await queueCount()) > 0) {
        setMsg('Bekleyen güncellemelerin var, internet gelince tekrar dene.');
        setBusy(false);
        return;
      }
      await api.switchAccount(a.id);
      await moveSubscriptionToCurrentUser();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.body.classList.add('switching');
        await new Promise((r) => setTimeout(r, 200));
      }
      window.location.reload();
    } catch (x) {
      setMsg(x?.message || 'Geçiş yapılamadı.');
      setBusy(false);
    }
  };

  const pick = (fn) => () => {
    setOpen(false);
    fn();
  };
  const kind = (a) => (a.is_manager ? `Grup yönetimi · ${a.managed_group_name || ''}` : '');
  return (
    <div ref={box} className="acct">
      <button className="who" onClick={() => setOpen((o) => !o)} aria-label="Hesap menüsü" aria-haspopup="true" aria-expanded={open}>
        <Avatar user={user} size="sm" />
      </button>
      {open && (
        <div role="menu" aria-label="Hesap" className="sw-menu">
          <div className="sw-me">
            <Avatar user={user} size="sm" />
            <span className="sw-txt"><b>{user.display_name}</b>{kind(user) && <span className="muted small">{kind(user)}</span>}</span>
          </div>
          {user.is_manager && <button role="menuitem" className="sw-item" onClick={pick(onProfile)}>Profili düzenle</button>}
          {!user.is_manager && <Link role="menuitem" className="sw-item" to="/ben/ayarlar" onClick={() => setOpen(false)}>Hesap ayarları</Link>}
          <button role="menuitem" className="sw-item" onClick={pick(onFeedback)}>Fikrini belirt</button>
          <button role="menuitem" className="sw-item" onClick={toggleTheme}>{dark ? 'Açık tema' : 'Koyu tema'}</button>
          {accounts.length > 0 && <div className="sw-h">{user.is_manager ? 'Kişisel hesaba geç' : 'Hesap değiştir'}</div>}
          {accounts.map((a) => (
            <button key={a.id} role="menuitem" className="sw-item sw-acc" disabled={busy} onClick={() => go(a)}>
              <Avatar user={a} size="sm" />
              <span className="sw-txt"><span>{a.display_name}</span>{kind(a) && <span className="muted small">{kind(a)}</span>}</span>
            </button>
          ))}
          {msg && <p className="small sw-err" role="alert">{msg}</p>}
          <button role="menuitem" className="sw-item sw-out" onClick={pick(onLogout)}>Çıkış</button>
        </div>
      )}
    </div>
  );
}
