import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox, Modal, fmtDayLong, useAsync } from './ui.jsx';

const DOW = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const dowOf = (key) => (new Date(key + 'T00:00:00Z').getUTCDay() + 6) % 7;

// Seri takvimi: gercek okuma gunleri otomatik sayilir; tahmini (esit dagitilan) ve bos gunler dokununca seriye eklenir/cikarilir.
export default function StreakCalendar({ onClose, onChanged }) {
  const cal = useAsync(() => api.streakCalendar(), []);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [local, setLocal] = useState({}); // date -> marked (iyimser guncelleme)

  const toggle = async (d) => {
    if (d.state === 'real' || busy) return;
    const next = !(local[d.date] ?? d.marked);
    setBusy(d.date);
    setError(null);
    setLocal((l) => ({ ...l, [d.date]: next }));
    try {
      await api.setStreakDay(d.date, next);
      onChanged?.();
    } catch (x) {
      setLocal((l) => ({ ...l, [d.date]: !next }));
      setError(x);
    } finally {
      setBusy(null);
    }
  };

  const days = cal.data?.days || [];
  const cells = days.length ? [...Array(dowOf(days[0].date)).fill(null), ...days] : [];

  return (
    <Modal title="Seriyi takvimden düzenle" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Okuduğun gerçek günler seriye otomatik sayılır. Sayfaları sonradan eşit bölünerek eklenen (“~”) günler ve boş günler seriye <b>sayılmaz</b>; okuduysan o güne dokunarak seriye ekleyebilirsin.
      </p>
      <ErrorBox error={cal.error} onRetry={cal.reload} />
      <ErrorBox error={error} />
      {!cal.data && !cal.error && <div className="skel" style={{ height: 160 }} />}
      {cells.length > 0 && (
        <div className="sc-grid" role="group" aria-label="Seri takvimi">
          {DOW.map((n) => (
            <span key={n} className="sc-dow small muted">{n}</span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={'p' + i} />;
            const marked = local[d.date] ?? d.marked;
            const counted = d.state === 'real' || marked;
            const label = `${fmtDayLong(d.date)} - ${d.state === 'real' ? 'okundu (otomatik)' : marked ? 'seriye eklendi' : d.state === 'estimated' ? 'tahmini gün, seriye sayılmıyor' : 'seriye sayılmıyor'}`;
            return (
              <button
                type="button"
                key={d.date}
                className="sc-cell"
                data-state={d.state}
                data-counted={counted ? 'true' : undefined}
                data-today={d.date === cal.data.today ? 'true' : undefined}
                disabled={d.state === 'real' || busy === d.date}
                aria-pressed={counted}
                aria-label={label}
                title={label}
                onClick={() => toggle(d)}
              >
                {d.date.slice(8)}
              </button>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        ■ seride &nbsp; ▨ tahmini gün (dokununca eklenir) &nbsp; □ boş gün. Son {days.length || 62} gün düzenlenebilir.
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={onClose}>Kapat</button>
      </div>
    </Modal>
  );
}
