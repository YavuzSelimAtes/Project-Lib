import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox } from './ui.jsx';

// Gruplari secilebilir etiketler olarak gosterir; "Hepsi" / "Hiçbiri" kisayollari var.
// groups: [{id, name}], value: secili id dizisi
export function GroupPicker({ groups, value, onChange, disabled }) {
  if (!groups?.length) return null;
  const on = new Set(value);
  const toggle = (id) => onChange(on.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="gpick" role="group" aria-label="Görünür olacağı gruplar">
      {groups.map((g) => (
        <button key={g.id} type="button" className={'gchip' + (on.has(g.id) ? ' on' : '')} aria-pressed={on.has(g.id)} disabled={disabled} onClick={() => toggle(g.id)}>
          {on.has(g.id) ? '✓ ' : ''}
          {g.name}
        </button>
      ))}
      {groups.length > 1 && (
        <>
          <button type="button" className="linkbtn small" disabled={disabled} onClick={() => onChange(groups.map((g) => g.id))}>Hepsi</button>
          <button type="button" className="linkbtn small" disabled={disabled} onClick={() => onChange([])}>Hiçbiri</button>
        </>
      )}
    </div>
  );
}

// secimi API govdesine cevirir: hepsi secili -> varsayilan (bos), hic -> {none:true}, aksi halde {group_ids}
export function visBody(groups, value) {
  if (!groups?.length) return undefined;
  if (value.length === 0) return { none: true };
  if (groups.every((g) => value.includes(g.id))) return undefined;
  return { group_ids: value };
}
// "kayit yok = herkese" yerine acik govde (PUT ucu icin)
export const visPut = (groups, value) => (value.length === 0 ? { none: true } : groups.every((g) => value.includes(g.id)) ? { all: true } : { group_ids: value });

export function visSummary(groups, ids) {
  if (!groups?.length) return '';
  if (!ids?.length) return 'Sadece ben';
  if (groups.every((g) => ids.includes(g.id))) return groups.length === 1 ? groups[0].name : 'Tüm gruplarım';
  return ids.map((i) => groups.find((g) => g.id === i)?.name).filter(Boolean).join(', ');
}

// Kaydedilmis bir secimi duzenlemek icin kucuk ac/kapa: "👁 Tüm gruplarım · Değiştir"
export function VisEditor({ label = 'Kimler görsün', groups, ids, save, onSaved }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(ids || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!groups?.length) return null;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await save(visPut(groups, val));
      setOpen(false);
      onSaved?.(val);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="small" style={{ marginTop: 4 }}>
      <span className="muted">👁 {label}: </span>
      <b>{visSummary(groups, ids)}</b>{' '}
      {!open && (
        <button type="button" className="linkbtn small" onClick={() => { setVal(ids || []); setOpen(true); }}>Değiştir</button>
      )}
      {open && (
        <div style={{ marginTop: 6 }}>
          <GroupPicker groups={groups} value={val} onChange={setVal} disabled={busy} />
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="btn small" disabled={busy} onClick={go}>Kaydet</button>
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => setOpen(false)}>Vazgeç</button>
          </div>
          <ErrorBox error={err} />
        </div>
      )}
    </div>
  );
}

