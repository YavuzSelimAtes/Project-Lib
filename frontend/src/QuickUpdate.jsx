import { useEffect, useState } from 'react';
import { api } from './api.js';
import { today } from './ui.jsx';

const Msg = ({ msg }) =>
  msg ? (
    <div className={`small ${msg.ok ? 'ok-note' : ''}`} style={msg.ok ? undefined : { color: 'var(--danger)' }}>
      {msg.text}
    </div>
  ) : null;

// Kitap: o gun okunan sayfa + tarih (varsayilan bugun) + Ekle; dizi: sezon/bolum.
// onSaved(entry), onOpen(): acik gun varsa detayi acar.
export default function QuickUpdate({ entry, onSaved, onOpen }) {
  const type = entry.type || entry.catalog?.type;
  const id = entry.id ?? entry.entry_id;
  if (type === 'book') return <BookQuick entry={entry} id={id} onSaved={onSaved} onOpen={onOpen} />;
  if (type === 'series') return <SeriesQuick entry={entry} id={id} onSaved={onSaved} />;
  return null;
}

function BookQuick({ entry, id, onSaved, onOpen }) {
  const [pages, setPages] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    if (!onOpen || entry.status !== 'devam') return;
    let alive = true;
    api.openDays(id).then((r) => alive && setOpenCount(r.count || 0), () => {});
    return () => {
      alive = false;
    };
  }, [id, entry.updated_at, entry.status, onOpen]);

  const submit = async (e) => {
    e.preventDefault();
    const n = Number(pages);
    if (pages === '' || !Number.isInteger(n) || n < 1) return setMsg({ ok: false, text: 'O gün kaç sayfa okuduğunu yaz (en az 1).' });
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.dayLogs(id, { days: [{ date, pages: n }], add: true });
      setPages('');
      setMsg({ ok: true, text: r.entry?.status === 'bitti' ? '🎉 Tebrikler, kitabı bitirdin!' : `+${n} sayfa eklendi` });
      onSaved?.(r.entry, r);
    } catch (x) {
      setMsg({ ok: false, text: x.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <form className="quick" onSubmit={submit}>
        <input type="number" min="1" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="Kaç sayfa?" aria-label="O gün okunan sayfa sayısı" style={{ width: 110 }} />
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} aria-label="Okuma tarihi" style={{ width: 'auto' }} />
        <button className="btn small" disabled={busy}>
          Ekle
        </button>
      </form>
      {openCount > 0 && onOpen && (
        <button className="btn small ghost" style={{ marginTop: 6 }} onClick={onOpen}>
          📅 {openCount} gün boş – doldur
        </button>
      )}
      <Msg msg={msg} />
    </div>
  );
}

function SeriesQuick({ entry, id, onSaved }) {
  const [season, setSeason] = useState(entry.season ?? 1);
  const [episode, setEpisode] = useState(entry.episode ?? 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.seriesProgress(id, Number(season), Number(episode));
      setMsg({ ok: true, text: 'Kaydedildi' });
      onSaved?.(r.entry, r);
    } catch (x) {
      setMsg({ ok: false, text: x.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <form className="quick" onSubmit={submit}>
        <label className="small muted">Sezon</label>
        <input type="number" min="1" value={season} onChange={(e) => setSeason(e.target.value)} style={{ width: 70 }} aria-label="Sezon" />
        <label className="small muted">Bölüm</label>
        <input type="number" min="1" value={episode} onChange={(e) => setEpisode(e.target.value)} style={{ width: 70 }} aria-label="Bölüm" />
        <button className="btn small" disabled={busy}>
          Kaydet
        </button>
      </form>
      <Msg msg={msg} />
    </div>
  );
}

// Gun gun "kac sayfa okudun?" listesi (detay penceresinde)
export function OpenDays({ entryId, onChanged }) {
  const [days, setDays] = useState(null);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => api.openDays(entryId).then((r) => setDays(r.days), (e) => setErr(e));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const send = async (body) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.dayLogs(entryId, body);
      setVals({});
      setDays(r.open_days ?? []);
      onChanged?.();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  if (!days || days.length === 0) return err ? <div className="err" role="alert">{err.message}</div> : null;
  const fill = days.filter((d) => vals[d.date] !== undefined && vals[d.date] !== '').map((d) => ({ date: d.date, pages: Number(vals[d.date]) }));

  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <b>📅 {days.length} gün boş</b>
      <p className="small muted" style={{ margin: '4px 0 8px' }}>O gün kaç sayfa okudun? Okumadıysan “Okumadım” de.</p>
      {days.map((d) => (
        <div className="row" key={d.date} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
          <span style={{ width: 92 }}>{d.date.split('-').reverse().join('.')}</span>
          <input type="number" min="0" inputMode="numeric" className="grow" value={vals[d.date] ?? ''} placeholder={d.state === 'estimated' ? `~${d.pages}` : 'sayfa'} onChange={(e) => setVals((v) => ({ ...v, [d.date]: e.target.value }))} aria-label={`${d.date} okunan sayfa`} />
          <button className="btn small ghost" disabled={busy} onClick={() => send({ days: [{ date: d.date, pages: 0 }] })}>
            Okumadım
          </button>
        </div>
      ))}
      <div className="row">
        <button className="btn small" disabled={busy || fill.length === 0} onClick={() => send({ days: fill })}>
          Girdiklerimi kaydet
        </button>
        <button className="btn small ghost" disabled={busy} onClick={() => window.confirm('Boş günlerin hepsi "okumadım" olarak işaretlensin mi?') && send({ skip_open: true })}>
          Hepsini okumadım
        </button>
      </div>
      {err && <div className="err" role="alert">{err.message}</div>}
    </div>
  );
}
