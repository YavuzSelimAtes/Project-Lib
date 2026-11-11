import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { ErrorBox, Modal, timeAgo } from './ui.jsx';
import EntryDetail from './EntryDetail.jsx';
import { Post } from './Gundem.jsx';

const StoryReader = lazy(() => import('./StoryReader.jsx'));
const LINKS = ['entry', 'story', 'post'];

// Bildirimden acilan Gundem paylasimi (yorumlar acik gelir)
function PostView({ id, me, onClose, onOpenEntry }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.post(id).then((r) => setP(r.post), setErr); }, [id]);
  return (
    <Modal title="Paylaşım" onClose={onClose}>
      <ErrorBox error={err} />
      {!p && !err && <p className="muted">Yükleniyor…</p>}
      {p && <Post p={p} me={me} defaultOpen onOpen={(eid) => { onClose(); onOpenEntry(eid); }} />}
    </Modal>
  );
}

export default function Bell({ me }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('new'); // new | archive | settings
  const [arch, setArch] = useState({ list: null, q: '' });
  const [settings, setSettings] = useState(null);
  const [target, setTarget] = useState(null); // {type:'entry'|'story', id}
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
  // arsiv aramasi (yazdikca kisa gecikmeyle)
  useEffect(() => {
    if (!open || view !== 'archive') return;
    const t = setTimeout(() => api.notifications({ archived: 1, q: arch.q }).then((r) => setArch((s) => ({ ...s, list: r.notifications })), () => {}), 250);
    return () => clearTimeout(t);
  }, [open, view, arch.q]);
  useEffect(() => {
    if (open && view === 'settings') api.notifSettings().then((r) => setSettings(r.groups), () => {});
  }, [open, view]);

  const unread = data?.unread || 0;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setView('new');
    if (next && unread > 0) api.readNotifications({ all: true }).then(() => setTimeout(load, 3000), () => {});
  };
  const go = (n) => {
    if (n.link && LINKS.includes(n.link.type)) {
      setTarget(n.link);
      setOpen(false);
    }
  };
  const mute = async (g) => {
    setSettings((s) => s.map((x) => (x.id === g.id ? { ...x, muted: !g.muted } : x)));
    try { await api.muteGroup(g.id, !g.muted); } catch { setSettings((s) => s.map((x) => (x.id === g.id ? { ...x, muted: g.muted } : x))); }
  };

  const item = (n) => {
    const clickable = n.link && LINKS.includes(n.link.type);
    return (
      <div
        key={n.id}
        className="comment"
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        style={{ fontWeight: n.is_read ? 400 : 700, cursor: clickable ? 'pointer' : 'default' }}
        onClick={() => go(n)}
        onKeyDown={(e) => clickable && (e.key === 'Enter' || e.key === ' ') && go(n)}
      >
        <div>{n.title}</div>
        {n.body && <div className="small muted" style={{ fontWeight: 400 }}>{n.body}</div>}
        <div className="small muted" style={{ fontWeight: 400 }}>{timeAgo(n.created_at)}{clickable ? ' · aç ›' : ''}</div>
      </div>
    );
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={toggle} aria-label={`Bildirimler${unread ? `, ${unread} yeni` : ''}`} aria-expanded={open}>
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--danger)', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 800, padding: '1px 6px' }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && <div className="bell-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div className="card bell-panel" role="region" aria-label="Bildirimler">
          <div className="bell-head">
            <b>Bildirimler</b>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Kapat">✕</button>
          </div>
          <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {[['new', 'Yeni'], ['archive', 'Arşiv'], ['settings', '⚙ Gruplar']].map(([k, l]) => (
              <button key={k} className={'btn small ' + (view === k ? '' : 'ghost')} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          {view === 'new' && (!data?.notifications?.length ? <p className="muted" style={{ margin: 0 }}>Henüz bildirim yok.</p> : data.notifications.slice(0, 30).map((n) => item(n)))}
          {view === 'archive' && (
            <>
              <input type="search" value={arch.q} onChange={(e) => setArch((s) => ({ ...s, q: e.target.value }))} placeholder="Arşivde ara…" aria-label="Arşivde ara" style={{ width: '100%', marginBottom: 8 }} />
              <p className="small muted" style={{ margin: '0 0 6px' }}>5 günden eski bildirimler buraya taşınır.</p>
              {arch.list == null ? <p className="muted">Yükleniyor…</p> : !arch.list.length ? <p className="muted" style={{ margin: 0 }}>{arch.q ? 'Sonuç yok.' : 'Arşiv boş.'}</p> : arch.list.map((n) => item(n))}
            </>
          )}
          {view === 'settings' && (
            <>
              <p className="small muted" style={{ margin: '0 0 6px' }}>Susturduğun grubun bildirimleri (telefon dahil) gelmez; diğer gruplar etkilenmez.</p>
              {!settings ? <p className="muted">Yükleniyor…</p> : !settings.length ? <p className="muted" style={{ margin: 0 }}>Henüz bir grupta değilsin.</p> : settings.map((g) => (
                <label key={g.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', gap: 8 }}>
                  <span>{g.name}</span>
                  <span className="small"><input type="checkbox" checked={!g.muted} onChange={() => mute(g)} /> {g.muted ? 'Sessiz' : 'Açık'}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
      {target?.type === 'entry' && <EntryDetail entryId={target.id} onClose={() => setTarget(null)} onChanged={load} />}
      {target?.type === 'post' && <PostView id={target.id} me={me} onClose={() => setTarget(null)} onOpenEntry={(eid) => setTarget({ type: 'entry', id: eid })} />}
      {target?.type === 'story' && <Suspense fallback={null}><StoryReader id={target.id} onClose={() => setTarget(null)} onChanged={load} /></Suspense>}
    </div>
  );
}
