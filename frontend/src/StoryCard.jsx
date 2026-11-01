import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox, Modal, timeAgo } from './ui.jsx';

export const STORY_COLORS = ['#8a3a1f', '#2f5d62', '#4a3f8f', '#6b2d5c', '#2e6b3f', '#a8741f'];

// Ana sayfa kartinda hikaye satiri: kucuk 3B kitap + baslik; dokununca okuyucu acilir
export function StoryRow({ story, mine, authorName, onOpen }) {
  return (
    <button className="item" onClick={() => onOpen(story.id)} aria-label={`Hikaye: ${story.title}`}>
      <span className="sbook-mini" style={{ '--bc': story.color }} aria-hidden="true">
        <i />
        <b>{story.title.trim().charAt(0).toUpperCase()}</b>
      </span>
      <div className="meta">
        <div className="t">{mine ? `“${story.title}” hikayeni yazıyorsun` : `${authorName} “${story.title}” hikayesini yazıyor`}</div>
        <div className="line">
          {[story.chapters ? `${story.chapters} bölüm` : 'henüz bölüm yok', story.started && !mine ? 'devam et' : 'oku', timeAgo(story.updated_at)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </button>
  );
}

// Yazar: yeni hikaye baslat
export function NewStory({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [color, setColor] = useState(STORY_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createStory({ title: title.trim(), summary: summary.trim(), color });
      onCreated(r.id);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Hikaye başlat" onClose={onClose}>
      <form onSubmit={save}>
        <label className="field">
          <span>Hikayenin adı</span>
          <input type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Kısa tanıtım (isteğe bağlı)</span>
          <textarea rows={3} maxLength={600} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <div className="field">
          <span>Kapak rengi</span>
          <div className="row" style={{ gap: 8 }}>
            {STORY_COLORS.map((c) => (
              <button type="button" key={c} className="swatch" style={{ background: c, outline: c === color ? '3px solid var(--accent)' : 'none' }} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <p className="small muted">Hikaye, üyesi olduğun gruplardaki herkese açılır; bölümleri yayınlayana kadar sadece sen görürsün.</p>
        <ErrorBox error={err} />
        <div className="row">
          <button type="button" className="btn ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn" disabled={busy || !title.trim()}>{busy ? 'Oluşturuluyor…' : 'Başlat'}</button>
        </div>
      </form>
    </Modal>
  );
}
