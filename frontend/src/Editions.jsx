import { useMemo, useState } from 'react';
import { api } from './api.js';
import { langLabel, normLang, useAsync } from './ui.jsx';

// Sozlesme baskilari "dil gruplayarak" dondurur; bicim farklarina dayanikli duzlestirme.
export function flattenEditions(d) {
  if (!d) return [];
  const out = [];
  const seen = new Set();
  const push = (list, lang) => {
    if (!Array.isArray(list)) return;
    list.forEach((e) => {
      if (!e || e.id == null || seen.has(e.id)) return;
      seen.add(e.id);
      out.push({ ...e, language: e.language ?? lang ?? null });
    });
  };
  push(d.editions);
  push(d.items);
  const groups = d.groups || d.languages || d.by_language;
  if (Array.isArray(groups)) groups.forEach((g) => push(g.editions || g.items, g.language || g.lang || g.code));
  else if (groups && typeof groups === 'object') Object.entries(groups).forEach(([k, v]) => push(Array.isArray(v) ? v : v?.editions || v?.items, k));
  return out;
}

export function editionLine(ed) {
  return [ed.publisher || 'Yayınevi belirtilmemiş', ed.pages ? `${ed.pages} sayfa` : null, ed.year || null].filter(Boolean).join(' · ');
}

const SHOW = 6;

// Baski/dil secici: dil sekmeleri + yayinevi/sayfa kartlari.
// selectedId: secili baski, onSelect(baski | null)
export default function EditionPicker({ catalogId, selectedId, onSelect, allowNone = true, nonePrefix = 'Baskı belirtmeden devam' }) {
  const state = useAsync(async () => {
    try {
      return flattenEditions(await api.catalogEditions(catalogId));
    } catch (e) {
      // baski ucu yoksa eserin kendi baski listesine bak
      try {
        return flattenEditions(await api.catalogItem(catalogId).then((r) => r.item || r));
      } catch {
        throw e;
      }
    }
  }, [catalogId]);
  const [lang, setLang] = useState(null);
  const [all, setAll] = useState(false);

  const groups = useMemo(() => {
    const m = new Map();
    (state.data || []).forEach((e) => {
      const k = normLang(e.language);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    });
    // Turkce one, sonra buyuk gruplar
    return [...m.entries()].sort((a, b) => (b[0] === 'tr') - (a[0] === 'tr') || b[1].length - a[1].length);
  }, [state.data]);

  if (state.loading && !state.data) return <p className="muted small">Baskılar aranıyor, birkaç saniye sürebilir…</p>;
  if (state.error || groups.length === 0) {
    return <p className="muted small">Bu eser için baskı bilgisi bulunamadı; sayfa sayısını elle yazabilirsin.</p>;
  }

  const sel = (state.data || []).find((e) => e.id === selectedId);
  const cur = groups.find(([k]) => k === (lang ?? (sel ? normLang(sel.language) : groups[0][0]))) || groups[0];
  const list = all ? cur[1] : cur[1].slice(0, SHOW);

  return (
    <div className="edpick">
      <div className="tabs" role="tablist" aria-label="Baskı dili" style={{ marginBottom: 8 }}>
        {groups.map(([k, items]) => (
          <button key={k || 'x'} type="button" role="tab" aria-selected={cur[0] === k} className="tab sm" onClick={() => { setLang(k); setAll(false); }}>
            {k ? k.toUpperCase() : 'Diğer'}
            {items.every((e) => e.language_guessed) ? '~' : ''} <span className="small">({items.length})</span>
          </button>
        ))}
      </div>
      <div className="small muted" style={{ marginBottom: 6 }}>{langLabel(cur[0])} baskılar{cur[1].every((e) => e.language_guessed) ? ' (dil tahmini)' : ''}</div>
      <div className="shelf-list">
        {list.map((ed) => (
          <button type="button" key={ed.id} className="ed-card" aria-pressed={selectedId === ed.id} onClick={() => onSelect(ed)}>
            <b>{ed.publisher || 'Yayınevi belirtilmemiş'}</b>
            <span className="small muted">
              {ed.pages ? [`${ed.pages} sayfa`, ed.year || null].filter(Boolean).join(' · ') : [ed.year || null, 'sayfa sayısını sen gir'].filter(Boolean).join(' · ')}
              {ed.language_guessed && <span className="chip" style={{ marginLeft: 6 }} title="Dil, yayınevi adından tahmin edildi">dil tahmini</span>}
            </span>
          </button>
        ))}
      </div>
      {cur[1].length > SHOW && (
        <button type="button" className="btn small ghost" style={{ marginTop: 6 }} onClick={() => setAll((v) => !v)}>
          {all ? 'Daha az göster' : `Tümünü göster (${cur[1].length})`}
        </button>
      )}
      {allowNone && (
        <button type="button" className="btn small ghost" style={{ marginTop: 6, marginLeft: all || cur[1].length > SHOW ? 6 : 0 }} aria-pressed={selectedId == null} onClick={() => onSelect(null)}>
          {selectedId == null ? '✓ ' : ''}{nonePrefix}
        </button>
      )}
    </div>
  );
}
