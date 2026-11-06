import { useRef, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.js';
import { coverColor, useAsync } from './ui.jsx';

// Sayfa sayisina gore sirt olcusu: [ust sinir, yukseklik px, genislik px]
const TIERS = [
  [50, 22, 6],
  [150, 28, 8],
  [300, 35, 10],
  [500, 42, 12],
  [800, 48, 14],
  [Infinity, 54, 16],
];
const MID = 2; // sayfa sayisi bilinmiyorsa orta kademe (<=300)
export const spineSize = (pages) => {
  const i = pages > 0 ? TIERS.findIndex(([max]) => pages <= max) : MID;
  return { h: TIERS[i][1], w: TIERS[i][2] };
};

// Hesabim ustu: bitirilen her kitap icin rafta bir sirt (olcu = sayfa sayisi). Renk/stil/sira/cerceve kisiye ozel (users.shelf); sahibi 'Rafi duzenle' ile degistirir
const STYLE_LABEL = { band: 'Bantlı', plain: 'Düz', dots: 'Noktalı', stripe: 'Çizgili', double: 'Çift bant', foil: 'Yaldız', label: 'Etiketli', shade: 'Gölgeli', leather: 'Deri' };
const PALETTE = ['#c0392b', '#e67e22', '#d4a72c', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#d35fa0', '#7f8c8d', '#2c3e50', '#8b5a2b', '#1a1a1a'];
export default function FinishedShelf({ uid, gid, version }) {
  const { user: me } = useAuth();
  const own = me?.id === uid;
  const res = useAsync(() => api.entries({ user_id: uid, type: 'book', limit: 500, group: gid }), [uid, gid, version]);
  const saved = useAsync(() => api.userShelf(uid), [uid]);
  const [edit, setEdit] = useState(null); // {frame, order:[ids], books:{id:{color,style}}}
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const drag = useRef(null);

  const cfg = edit || saved.data?.shelf || {};
  const byId = new Map((res.data?.entries || []).filter((e) => e.status === 'bitti').map((e) => [e.id, e]));
  const rank = new Map((cfg.order || []).map((id, i) => [id, i]));
  const done = [...byId.values()].sort((a, b) => (rank.has(a.id) || rank.has(b.id)
    ? (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)
    : 0) || (a.end_date || '').localeCompare(b.end_date || '') || a.id - b.id);
  const ids = done.map((e) => e.id);

  const startEdit = () => { setEdit({ frame: cfg.frame || '', order: ids, books: { ...(cfg.books || {}) } }); setSel(null); setErr(null); };
  const move = (id, to) => setEdit((s) => {
    const o = s.order.filter((x) => x !== id);
    o.splice(Math.max(0, Math.min(o.length, to)), 0, id);
    return { ...s, order: o };
  });
  const setBook = (id, patch) => setEdit((s) => ({ ...s, books: { ...s.books, [id]: { ...(s.books[id] || {}), ...patch } } }));
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.saveShelf({ frame: edit.frame, order: edit.order, books: edit.books }); setEdit(null); setSel(null); saved.reload(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  const shown = done;
  const frame = cfg.frame || null;
  const selE = sel != null ? byId.get(sel) : null;
  const selIdx = sel != null ? (edit?.order || []).indexOf(sel) : -1;
  return (
    <>
      <div className="fs" style={frame ? { '--frame': frame } : undefined} role="img" aria-label={done.length ? `${done.length} kitap bitirdi` : 'Henüz bitirilen kitap yok'}>
        {shown.map((e, i) => {
          const pg = e.total_pages || e.catalog?.pages || 0;
          const { h, w } = spineSize(pg);
          const title = e.catalog?.title || 'Kitap';
          const b = cfg.books?.[e.id] || {};
          return (
            <span
              key={e.id}
              className={'fs-slot' + (edit ? ' edit' : '') + (sel === e.id ? ' sel' : '')}
              tabIndex={0}
              data-tip={`${title}${pg ? ` · ${pg} sayfa` : ''}`}
              style={{ width: w }}
              draggable={!!edit}
              onClick={() => edit && setSel(e.id)}
              onDragStart={() => { drag.current = e.id; }}
              onDragOver={(ev) => edit && ev.preventDefault()}
              onDrop={() => { if (edit && drag.current != null && drag.current !== e.id) move(drag.current, edit.order.indexOf(e.id)); drag.current = null; }}
            >
              <i data-style={b.style || 'band'} style={{ height: h, backgroundColor: b.color || coverColor(title), '--i': Math.min(i, 30) }} />
            </span>
          );
        })}
      </div>
      {own && !edit && done.length > 0 && <button className="btn small ghost" style={{ margin: '-8px 0 12px' }} onClick={startEdit}>🎨 Rafı düzenle</button>}
      {edit && (
        <div className="fs-edit">
          <section>
            <h4>Raf rengi</h4>
            <div className="rowc">
              {['#8a5d36', '#5b3a29', '#2f4f6f', '#3f6b4f', '#6b2f3a', '#3a3a3a', '#c9a15c'].map((col) => (
                <button key={col} type="button" className={'sw' + ((edit.frame || '#8a5d36') === col ? ' on' : '')} style={{ background: col }} aria-label={col} onClick={() => setEdit({ ...edit, frame: col === '#8a5d36' ? '' : col })} />
              ))}
              <input type="color" value={edit.frame || '#8a5d36'} onChange={(ev) => setEdit({ ...edit, frame: ev.target.value })} aria-label="Özel raf rengi" />
            </div>
          </section>
          {selE ? (
            <>
              <section>
                <div className="hd">
                  <i className="sp sp-big" data-style={edit.books[sel]?.style || 'band'} style={{ backgroundColor: edit.books[sel]?.color || coverColor(selE.catalog?.title || 'Kitap') }} />
                  <div><h4>Seçili kitap</h4><b>{selE.catalog?.title}</b></div>
                </div>
              </section>
              <section>
                <h4>Renk</h4>
                <div className="rowc">
                  {PALETTE.map((col) => (
                    <button key={col} type="button" className={'sw' + (edit.books[sel]?.color === col ? ' on' : '')} style={{ background: col }} aria-label={col} onClick={() => setBook(sel, { color: col })} />
                  ))}
                  <input type="color" value={edit.books[sel]?.color || '#888888'} onChange={(ev) => setBook(sel, { color: ev.target.value })} aria-label="Özel kitap rengi" />
                  <button className="btn small ghost" onClick={() => setBook(sel, { color: '' })}>Otomatik</button>
                </div>
              </section>
              <section>
                <h4>Görünüm</h4>
                <div className="tiles">
                  {Object.entries(STYLE_LABEL).map(([k, l]) => (
                    <button key={k} type="button" className={'tile' + ((edit.books[sel]?.style || 'band') === k ? ' on' : '')} onClick={() => setBook(sel, { style: k })}>
                      <i className="sp" data-style={k} style={{ backgroundColor: edit.books[sel]?.color || coverColor(selE.catalog?.title || 'Kitap') }} />
                      {l}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h4>Sıra</h4>
                <div className="rowc">
                  <button className="btn small ghost" disabled={selIdx <= 0} onClick={() => move(sel, selIdx - 1)}>← Sola</button>
                  <button className="btn small ghost" disabled={selIdx >= edit.order.length - 1} onClick={() => move(sel, selIdx + 1)}>Sağa →</button>
                  <span className="small muted">ya da rafta sürükle</span>
                </div>
              </section>
            </>
          ) : <section><p className="small muted" style={{ margin: 0 }}>Düzenlemek için rafta bir kitaba dokun. Kitapları sürükleyerek de sıralayabilirsin.</p></section>}
          {err && <section><div className="small" style={{ color: 'var(--danger, #b3261e)' }}>{err}</div></section>}
          <div className="foot">
            <button className="btn small grow" disabled={busy} onClick={save}>Kaydet</button>
            <button className="btn small ghost" disabled={busy} onClick={() => { setEdit(null); setSel(null); }}>Vazgeç</button>
          </div>
        </div>
      )}
    </>
  );
}
