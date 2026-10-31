import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api.js';
import { ErrorBox, Modal } from './ui.jsx';

export const FB_KINDS = [
  ['oneri', '💡', 'Öneri'],
  ['hata', '🐞', 'Hata'],
  ['begendim', '❤️', 'Beğendim'],
];
const MAX = 2000;

// Avatar menusunden acilan kisa geri bildirim penceresi
export default function FeedbackModal({ onClose }) {
  const { pathname } = useLocation();
  const [kind, setKind] = useState('oneri');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const text = message.trim();

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const send = async (e) => {
    e.preventDefault();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.sendFeedback({ kind, message: text, page: pathname });
      setDone(true);
    } catch (x) {
      setErr(x);
      setBusy(false);
    }
  };

  return (
    <Modal title="Fikrini belirt" onClose={onClose}>
      {done ? (
        <div className="fb-thanks" role="status">
          <svg viewBox="0 0 64 56" width="72" height="62" aria-hidden="true">
            <rect className="fb-bk" style={{ '--i': 0 }} x="8" y="14" width="12" height="34" rx="2" fill="#d9693b" />
            <rect className="fb-bk" style={{ '--i': 1 }} x="22" y="22" width="10" height="26" rx="2" fill="#5f8f6b" />
            <rect className="fb-bk" style={{ '--i': 2 }} x="34" y="10" width="14" height="38" rx="2" fill="#c9a15a" />
            <rect x="4" y="48" width="56" height="4" rx="2" fill="#a8703f" />
            <path className="fb-heart" d="M52 8c-2-4-8-3-8 1.5 0 3.500 8 8 8 8s8-4.500 8-8c0-4.500-6-5.500-8-1.500z" fill="#e0556b" />
          </svg>
          <b>Teşekkürler!</b>
          <span className="muted small">Fikrin iletildi.</span>
        </div>
      ) : (
        <form onSubmit={send}>
          <div className="tabs sm fb-kinds" role="radiogroup" aria-label="Tür">
            {FB_KINDS.map(([k, ic, l]) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} aria-pressed={kind === k} className="tab" onClick={() => setKind(k)} disabled={busy}>
                {ic} {l}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="sr-only">Mesajın</span>
            <textarea
              value={message}
              maxLength={MAX}
              rows={5}
              placeholder={kind === 'hata' ? 'Ne oldu, nerede gördün?' : kind === 'begendim' ? 'Neyi sevdin?' : 'Ne olsun istersin?'}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <ErrorBox error={err} />
          <div className="row fb-foot">
            <span className="small muted grow">{message.length}/{MAX}</span>
            <button className="btn" disabled={!text || busy}>{busy ? 'Gönderiliyor…' : 'Gönder'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
