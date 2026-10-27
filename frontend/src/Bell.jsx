import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { timeAgo } from './ui.jsx';

export default function Bell() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  const load = () => api.notifications().then(setData, () => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e) => !box.current?.contains(e.target) && setOpen(false);
    const prev = document.body.style.overflow;
    if (window.matchMedia('(max-width: 640px)').matches) document.body.style.overflow = 'hidden';
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const unread = data?.unread || 0;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) api.readNotifications({ all: true }).then(() => setTimeout(load, 3000), () => {});
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={toggle} aria-label={`Bildirimler${unread ? `, ${unread} yeni` : ''}`} aria-expanded={open}>
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--danger)', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 800, padding: '1px 6px' }}>{unread}</span>
        )}
      </button>
      {open && <div className="bell-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div className="card bell-panel" role="region" aria-label="Bildirimler">
          <div className="bell-head">
            <b>Bildirimler</b>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Kapat">✕</button>
          </div>
          {!data?.notifications?.length ? (
            <p className="muted" style={{ margin: 0 }}>Henüz bildirim yok.</p>
          ) : (
            data.notifications.slice(0, 20).map((n) => (
              <div key={n.id} className="comment" style={{ fontWeight: n.is_read ? 400 : 700 }}>
                <div>{n.title}</div>
                {n.body && <div className="small muted" style={{ fontWeight: 400 }}>{n.body}</div>}
                <div className="small muted" style={{ fontWeight: 400 }}>{timeAgo(n.created_at)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
