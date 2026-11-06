import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WHATS_NEW, whatsNewActive } from './whatsNew.js';

const KEY = 'whatsnew-seen';
const seenGet = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const seenSet = () => { try { localStorage.setItem(KEY, WHATS_NEW.date); } catch { /* onemsiz */ } };

// "🎨 Metin: aciklama" -> ikon + baslik + aciklama
const parse = (t) => {
  const m = t.match(/^(\S+)\s+([^:]+):\s*(.*)$/);
  return m ? { icon: m[1], head: m[2], text: m[3] } : { icon: '✨', head: '', text: t };
};

// Bildirim butonunun yanindaki ünlem: son yenilikler; surum tarihinden 3 gun sonra gorunmez
export default function WhatsNew() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => seenGet() === WHATS_NEW.date);
  useEffect(() => {
    if (!open) return;
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [open]);
  if (!whatsNewActive()) return null;
  const toggle = () => { setOpen(true); seenSet(); setSeen(true); };
  return (
    <>
      <button className="icon-btn" onClick={toggle} aria-label="Yenilikler" style={{ position: 'relative', fontWeight: 900 }}>
        ❗
        {!seen && <span style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: 99, background: 'var(--danger)' }} />}
      </button>
      {open && createPortal(
        <div className="wn-back" onClick={() => setOpen(false)}>
          <div className="wn" role="dialog" aria-modal="true" aria-label={WHATS_NEW.title} onClick={(e) => e.stopPropagation()}>
            <div className="wn-head">
              <div>
                <div className="wn-title">✨ {WHATS_NEW.title}</div>
                <div className="wn-sub">Son güncellemeyle gelenler</div>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Kapat">✕</button>
            </div>
            <ul className="wn-list">
              {WHATS_NEW.items.map((t) => {
                const p = parse(t);
                return (
                  <li key={t}>
                    <span className="wn-ic">{p.icon}</span>
                    <span>{p.head && <b>{p.head}</b>}{p.head && <br />}<span className="wn-tx">{p.text}</span></span>
                  </li>
                );
              })}
            </ul>
            <button className="btn wn-ok" onClick={() => setOpen(false)}>Tamam</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
