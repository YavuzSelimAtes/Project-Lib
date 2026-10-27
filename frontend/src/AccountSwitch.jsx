import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Avatar } from './ui.jsx';
import { flushQueue, queueCount } from './offlineQueue.js';
import { moveSubscriptionToCurrentUser } from './pushClient.js';

// Bagli hesaplar arasinda sifresiz gecis. Bagli hesap yoksa hicbir sey cizmez.
export default function AccountSwitch({ userId }) {
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
  }, [userId]);

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

  if (!accounts.length) return null;

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
      window.location.reload();
    } catch (x) {
      setMsg(x?.message || 'Geçiş yapılamadı.');
      setBusy(false);
    }
  };

  const single = accounts.length === 1 ? accounts[0] : null;
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        className="btn small ghost"
        onClick={() => (single ? go(single) : setOpen((o) => !o))}
        disabled={busy}
        title={single ? `${single.display_name} hesabına geç` : 'Hesap değiştir'}
        aria-label={single ? `${single.display_name} hesabına geç` : 'Hesap değiştir'}
        aria-haspopup={single ? undefined : 'true'}
        aria-expanded={single ? undefined : open}
        style={{ minHeight: 36, whiteSpace: 'nowrap' }}
      >
        🔁 <span className="acc-label">{single ? single.display_name : 'Hesap değiştir'}</span>
      </button>
      {single && msg && (
        <p className="small" role="alert" style={{ position: 'absolute', right: 0, top: '100%', margin: '4px 0 0', padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, width: 220, zIndex: 60, color: 'var(--danger)' }}>
          {msg}
        </p>
      )}
      {open && !single && (
        <div
          role="menu"
          aria-label="Bağlı hesaplar"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, minWidth: 220, maxWidth: 'calc(100vw - 20px)',
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow)', padding: 6,
          }}
        >
          {accounts.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              disabled={busy}
              onClick={() => go(a)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '6px 10px',
                background: 'none', border: 0, borderRadius: 10, cursor: 'pointer', color: 'var(--text)', font: 'inherit', textAlign: 'left',
              }}
            >
              <Avatar user={a} size="sm" />
              <span>{a.display_name}</span>
            </button>
          ))}
          {msg && (
            <p className="small" role="alert" style={{ margin: '6px 10px', color: 'var(--danger)' }}>
              {msg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
