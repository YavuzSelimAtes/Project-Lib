import { useState } from 'react';
import { api } from './api.js';
import { Avatar, ErrorBox, timeAgo, useAsync } from './ui.jsx';

// Hikaye yorum sayfasi: yorum yaz, yoruma yanit ver (tek seviye); yazar ve yorum sahibi silebilir
export default function StoryComments({ storyId, onClose }) {
  const list = useAsync(() => api.storyComments(storyId), [storyId]);
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null); // {id, name}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const all = list.data?.comments || [];
  const tops = all.filter((c) => !c.parent_id);
  const kids = (id) => all.filter((c) => c.parent_id === id);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { await api.addStoryComment(storyId, text.trim(), reply?.id); setText(''); setReply(null); list.reload(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const del = async (c) => {
    if (!window.confirm('Yorum silinsin mi?')) return;
    try { await api.deleteStoryComment(storyId, c.id); list.reload(); } catch (x) { setErr(x); }
  };
  const Row = ({ c, child }) => (
    <div className={'sc-row' + (child ? ' child' : '')}>
      <Avatar user={c.user} size="sm" />
      <div className="sc-body">
        <div><b>{c.user.display_name}</b> <span className="small muted">{timeAgo(c.created_at)}</span></div>
        <div className="sc-text">{c.body}</div>
        <div className="small">
          <button className="sc-link" onClick={() => setReply({ id: c.id, name: c.user.display_name })}>Yanıtla</button>
          {c.can_delete && <button className="sc-link" onClick={() => del(c)}>Sil</button>}
        </div>
      </div>
    </div>
  );
  return (
    <div className="sc" role="dialog" aria-label="Yorumlar">
      <div className="sc-head">
        <b>💬 Yorumlar{all.length ? ` (${all.length})` : ''}</b>
        <button className="sr-btn" onClick={onClose} aria-label="Yorumları kapat">✕</button>
      </div>
      <div className="sc-list">
        {list.loading && !list.data && <p className="small muted">Yükleniyor…</p>}
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.data && !tops.length && <p className="small muted">Henüz yorum yok. İlk yorumu sen yaz.</p>}
        {tops.map((c) => (
          <div key={c.id}>
            <Row c={c} />
            {kids(c.id).map((k) => <Row key={k.id} c={k} child />)}
          </div>
        ))}
      </div>
      <form className="sc-form" onSubmit={send}>
        {reply && <div className="small muted">↪ {reply.name} adlı kişiye yanıt <button type="button" className="sc-link" onClick={() => setReply(null)}>vazgeç</button></div>}
        <ErrorBox error={err} />
        <div className="row" style={{ gap: 8 }}>
          <input className="grow" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={reply ? 'Yanıtın…' : 'Yorum yaz…'} aria-label="Yorum" />
          <button className="btn small" disabled={busy || !text.trim()}>Gönder</button>
        </div>
      </form>
    </div>
  );
}
