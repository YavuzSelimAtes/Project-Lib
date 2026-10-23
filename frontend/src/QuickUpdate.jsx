import { useState } from 'react';
import { api } from './api.js';
import { yesterday } from './ui.jsx';

// Kitap: sayfa girip kaydet (+10 hizli buton); dizi: sezon/bolum. onSaved(entry)
export default function QuickUpdate({ entry, onSaved }) {
  const type = entry.type || entry.catalog?.type;
  const [page, setPage] = useState(entry.current_page ?? 0);
  const [season, setSeason] = useState(entry.season ?? 1);
  const [episode, setEpisode] = useState(entry.episode ?? 1);
  const [busy, setBusy] = useState(false);
  const [yest, setYest] = useState(false);
  const [msg, setMsg] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: r.finished ? '🎉 Tebrikler, kitabı bitirdin!' : r.delta > 0 ? `+${r.delta} sayfa kaydedildi${r.spread_days > 1 ? ` (${r.spread_days} güne dağıttık)` : ''}` : 'Kaydedildi' });
      onSaved?.(r.entry, r);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (type === 'book') {
    const total = entry.total_pages;
    const save = (p) => {
      if (p === '' || p == null || !Number.isInteger(Number(p)) || Number(p) < 1) {
        return setMsg({ ok: false, text: 'Geçerli bir sayfa numarası yaz (en az 1).' });
      }
      const n = Math.min(total ?? Infinity, Number(p));
      const cur = Number(entry.current_page || 0);
      const back = n < cur;
      if (back && !window.confirm(`${cur}. sayfadan ${n}. sayfaya düşüyorsun (bir düzeltme olarak kaydedilir). Emin misin?`)) return;
      setPage(n);
      run(() => api.progress(entry.id ?? entry.entry_id, n, yest ? yesterday() : undefined, back));
    };
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <form
          className="quick"
          onSubmit={(e) => {
            e.preventDefault();
            save(page);
          }}
        >
          <label className="small muted" htmlFor={`pg-${entry.id ?? entry.entry_id}`}>
            Sayfa:
          </label>
          <input id={`pg-${entry.id ?? entry.entry_id}`} type="number" min="0" max={total || undefined} value={page} onChange={(e) => setPage(e.target.value)} />
          <button className="btn small" disabled={busy}>
            Kaydet
          </button>
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => save(Number(entry.current_page || 0) + 10)} title="10 sayfa ekle">
            +10
          </button>
        </form>
        <label className="small muted" style={{ display: 'block', marginTop: 4 }}>
          <input type="checkbox" checked={yest} onChange={(e) => setYest(e.target.checked)} /> Dün için kaydet
        </label>
        {msg && <div className={`small ${msg.ok ? 'ok-note' : ''}`} style={msg.ok ? undefined : { color: 'var(--danger)' }}>{msg.text}</div>}
      </div>
    );
  }
  if (type === 'series') {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <form
          className="quick"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.seriesProgress(entry.id ?? entry.entry_id, Number(season), Number(episode)));
          }}
        >
          <label className="small muted">Sezon</label>
          <input type="number" min="1" value={season} onChange={(e) => setSeason(e.target.value)} style={{ width: 70 }} aria-label="Sezon" />
          <label className="small muted">Bölüm</label>
          <input type="number" min="1" value={episode} onChange={(e) => setEpisode(e.target.value)} style={{ width: 70 }} aria-label="Bölüm" />
          <button className="btn small" disabled={busy}>
            Kaydet
          </button>
        </form>
        {msg && <div className={`small ${msg.ok ? 'ok-note' : ''}`} style={msg.ok ? undefined : { color: 'var(--danger)' }}>{msg.text}</div>}
      </div>
    );
  }
  return null;
}
