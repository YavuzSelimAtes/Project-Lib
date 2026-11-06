import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox, fmtDate, useAsync } from './ui.jsx';

const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Dizi icin gun gun kayit (kitaptaki gunluk kayit gibi): "su gun N bolum izledim"
export default function SeriesDays({ entryId, version, onChanged }) {
  const list = useAsync(() => api.seriesDays(entryId), [entryId, version]);
  const [date, setDate] = useState(iso());
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(false);
    try { await api.addSeriesDay(entryId, date, Number(n)); setOk(true); list.reload(); onChanged?.(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const days = list.data?.days || [];
  return (
    <div className="card" style={{ margin: '10px 0' }}>
      <b>📺 Gün gün izleme</b>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }} onSubmit={add}>
        <input type="date" value={date} max={iso()} onChange={(e) => setDate(e.target.value)} aria-label="Tarih" />
        <input type="number" min="1" max="200" value={n} onChange={(e) => setN(e.target.value)} style={{ width: 70 }} aria-label="Bölüm sayısı" />
        <span className="small muted">bölüm izledim</span>
        <button className="btn small" disabled={busy || !date || !(Number(n) >= 1)}>Ekle</button>
        {ok && <span className="ok-note small">✅ Eklendi</span>}
      </form>
      <ErrorBox error={err} />
      {days.length > 0 && (
        <div className="small" style={{ marginTop: 8, display: 'grid', gap: 2 }}>
          {days.slice(0, 14).map((d) => (
            <div key={d.date} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{fmtDate(d.date)}</span><b>{d.episodes} bölüm</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
