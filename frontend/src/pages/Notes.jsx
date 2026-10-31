import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Cover, Empty, Hint, PageHead, ErrorBox, Skeleton, fmtDate, today, useAsync, yesterday } from '../ui.jsx';
import { GroupPicker, visPut } from '../Visibility.jsx';

const dayOf = (iso) => (iso || '').slice(0, 10);
function dayLabel(iso) {
  const d = dayOf(iso);
  if (d === today()) return 'Bugün';
  if (d === yesterday()) return 'Dün';
  return fmtDate(d);
}
const catOf = (n) => n.catalog || { id: n.catalog_id, title: n.title || n.catalog_title || 'Kayıt', cover_url: n.cover_url, type: n.type };

// Kitap/film/dizi bazli hizli not defteri
export default function Notes() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useAsync(() => api.notes({ q: dq, catalog_id: catalogId, limit: 100 }), [dq, catalogId]);
  const notes = list.data?.notes || [];
  // filtre secenekleri: gorunen notlardaki eserler (filtre aktifken secili eser korunur)
  const [known, setKnown] = useState({});
  useEffect(() => {
    if (!notes.length) return;
    setKnown((k) => {
      const n = { ...k };
      notes.forEach((x) => {
        const c = catOf(x);
        if (c.id) n[c.id] = c.title;
      });
      return n;
    });
  }, [notes]);

  return (
    <>
      <PageHead title="Defterim" sub="Okurken ya da izlerken aklına gelenleri hızlıca not al; istersen yorum olarak paylaş.">
        <button className="btn" onClick={() => setComposing((v) => !v)}>{composing ? 'Kapat' : '+ Yeni not'}</button>
      </PageHead>
      {composing && <Composer onSaved={() => { setComposing(false); list.reload(); }} onCancel={() => setComposing(false)} />}
      <div className="row toolbar" style={{ justifyContent: 'stretch' }}>
        <input type="search" className="grow" placeholder="Notlarda ara…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Notlarda ara" />
        <select value={catalogId} onChange={(e) => setCatalogId(e.target.value)} aria-label="Esere göre filtrele">
          <option value="">Tüm eserler</option>
          {Object.entries(known).map(([id, t]) => (
            <option key={id} value={id}>{t}</option>
          ))}
        </select>
      </div>
      {list.loading && !list.data && <Skeleton h={90} n={3} />}
      {list.error?.status === 404 ? (
        <Hint>Defter henüz hazır değil (sunucu bu özelliği henüz açmadı).</Hint>
      ) : (
        <ErrorBox error={list.error} onRetry={list.reload} />
      )}
      {list.data && notes.length === 0 && (
        <Empty icon="📝" title={dq || catalogId ? 'Eşleşen not yok' : 'Defterin boş'}>
          {dq || catalogId ? 'Aramayı ya da filtreyi değiştir.' : 'İlk notunu eklemek için “Yeni not”a dokun.'}
        </Empty>
      )}
      <div className="notes">
        {notes.map((n) => (
          <NoteCard key={n.id} n={n} onChanged={list.reload} />
        ))}
      </div>
    </>
  );
}

// kitap secici: kendi kayitlarim + (yazinca) katalogda arama
function WorkPicker({ value, onChange }) {
  const mine = useAsync(() => api.entries({ limit: 200 }), []);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api.library({ q: q.trim(), limit: 8 }).then((r) => alive && setFound(r.items || []), () => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  const own = useMemo(() => {
    const seen = new Set();
    return (mine.data?.entries || []).map((e) => e.catalog).filter((c) => c && !seen.has(c.id) && seen.add(c.id));
  }, [mine.data]);
  const needle = q.trim().toLowerCase();
  const ownShown = own.filter((c) => !needle || c.title.toLowerCase().includes(needle)).slice(0, 8);
  const ownIds = new Set(own.map((c) => c.id));
  const extra = found.filter((c) => !ownIds.has(c.id));
  if (value) {
    return (
      <div className="row">
        <Cover src={value.cover_url} fallback={value.cover_fallback} title={value.title} />
        <b className="grow">{value.title}</b>
        <button type="button" className="btn small ghost" onClick={() => onChange(null)}>Değiştir</button>
      </div>
    );
  }
  const row = (c) => (
    <button type="button" key={c.id} className="item" style={{ width: '100%' }} onClick={() => onChange(c)}>
      <Cover src={c.cover_url} fallback={c.cover_fallback} title={c.title} />
      <div className="meta"><div className="t">{c.title}</div>{c.author_or_creator && <div className="line">{c.author_or_creator}</div>}</div>
    </button>
  );
  return (
    <div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kitap, film ya da dizi seç ya da ara…" aria-label="Eser ara" />
      <div className="notes-pick">
        {mine.loading && !mine.data && <Skeleton h={50} />}
        {ownShown.length > 0 && <div className="small muted" style={{ margin: '6px 0 2px' }}>Kayıtlarımdan</div>}
        {ownShown.map(row)}
        {extra.length > 0 && <div className="small muted" style={{ margin: '6px 0 2px' }}>Kitaplıktan</div>}
        {extra.map(row)}
        {!mine.loading && ownShown.length === 0 && extra.length === 0 && <p className="small muted">Eşleşen eser yok.</p>}
      </div>
    </div>
  );
}

function Composer({ onSaved, onCancel }) {
  const [work, setWork] = useState(null);
  const [ref, setRef] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    if (!work) return setErr(new Error('Önce bir eser seç.'));
    setBusy(true);
    setErr(null);
    try {
      await api.addNote({ catalog_id: work.id, body: body.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) });
      onSaved();
    } catch (x) {
      setErr(x.status === 404 ? new Error('Defter henüz hazır değil.') : x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={save} style={{ marginBottom: 12 }}>
      <WorkPicker value={work} onChange={setWork} />
      <label className="field" style={{ marginTop: 10 }}>
        <span>Sayfa / bölüm (isteğe bağlı)</span>
        <input type="text" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Örn. s. 112, 3. bölüm, 01:12:30" />
      </label>
      <label className="field">
        <span>Not</span>
        <textarea rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ne düşündün?" />
      </label>
      <ErrorBox error={err} />
      <div className="row">
        <button type="button" className="btn ghost" onClick={onCancel}>Vazgeç</button>
        <button className="btn" disabled={busy || !body.trim() || !work}>{busy ? 'Kaydediliyor…' : 'Notu kaydet'}</button>
      </div>
    </form>
  );
}

function NoteCard({ n, onChanged }) {
  const c = catOf(n);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(n.body);
  const [ref, setRef] = useState(n.ref || '');
  const [sharing, setSharing] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      return true;
    } catch (x) {
      setErr(x);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async (e) => {
    e.preventDefault();
    if (await run(() => api.updateNote(n.id, { body: body.trim(), ref: ref.trim() }))) {
      setEditing(false);
      onChanged();
    }
  };
  const del = async () => {
    if (!window.confirm('Bu not silinsin mi?')) return;
    if (await run(() => api.deleteNote(n.id))) onChanged();
  };
  return (
    <article className="card note">
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Cover src={c.cover_url} fallback={c.cover_fallback} title={c.title} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <b className="grow" style={{ overflowWrap: 'anywhere' }}>{c.title}</b>
            <span className="small muted" title={n.created_at}>{dayLabel(n.created_at)}</span>
          </div>
          {n.ref && !editing && <span className="chip" style={{ margin: '4px 0' }}>{n.ref}</span>}
          {editing ? (
            <form onSubmit={save}>
              <input type="text" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Sayfa / bölüm" aria-label="Sayfa veya bölüm" />
              <textarea rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Not" style={{ marginTop: 6 }} />
              <div className="row" style={{ marginTop: 6 }}>
                <button type="button" className="btn small ghost" onClick={() => { setEditing(false); setBody(n.body); setRef(n.ref || ''); }}>Vazgeç</button>
                <button className="btn small" disabled={busy || !body.trim()}>Kaydet</button>
              </div>
            </form>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.body}</div>
          )}
        </div>
      </div>
      {!editing && (
        <div className="row small" style={{ marginTop: 8 }}>
          <button className="btn small ghost" onClick={() => setEditing(true)}>Düzenle</button>
          <button className="btn small ghost" onClick={() => setSharing((v) => !v)}>💬 Yorum olarak paylaş</button>
          <button className="btn small ghost" style={{ color: 'var(--danger)' }} disabled={busy} onClick={del}>Sil</button>
        </div>
      )}
      {sharing && <Share n={n} onDone={() => setSharing(false)} />}
      <ErrorBox error={err} />
    </article>
  );
}

function Share({ n, onDone }) {
  const { user } = useAuth();
  const all = (user.groups || []).map((g) => ({ id: g.id, name: g.name }));
  // yorum yalniz kaydin gorunur oldugu gruplara acilabilir: kaydin gruplarini yukle
  const vis = useAsync(async () => {
    const list = await api.entries();
    const mine = (list.entries || []).filter((e) => e.catalog_id === n.catalog_id).sort((a, b) => b.id - a.id)[0];
    return mine ? api.entryGroups(mine.id) : null;
  }, [n.catalog_id]);
  const visible = new Set((vis.data?.groups || []).filter((g) => g.visible).map((g) => g.id));
  const groups = all.filter((g) => visible.has(g.id));
  const hidden = all.filter((g) => !visible.has(g.id));
  const [picked, setPicked] = useState(null);
  const val = (picked ?? groups.map((g) => g.id)).filter((id) => visible.has(id));
  const setVal = setPicked;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.shareNote(n.id, groups.length ? visPut(groups, val) : { none: true });
      setOk(true);
      setTimeout(onDone, 900);
    } catch (x) {
      setErr(x); // 409: bu eser icin kaydin yok vb. mesaji sunucudan
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
      <div className="small muted">Yorumu görecek gruplar (hiçbiri = sadece ben):</div>
      {vis.loading ? <p className="small muted">Yükleniyor…</p> : vis.error ? <ErrorBox error={vis.error} onRetry={vis.reload} /> : vis.data === null ? <p className="small muted">Bu eser kitaplığında yok; önce ekle, sonra yorum olarak paylaşabilirsin.</p> : groups.length === 0 ? <p className="small muted">{all.length ? 'Kaydın hiçbir grupta görünmüyor; yorum sadece sana görünür.' : 'Henüz bir grubun yok; yorum sadece sana görünür.'}</p> : <GroupPicker groups={groups} value={val} onChange={setVal} disabled={busy} />}
      {!vis.loading && vis.data && groups.length > 0 && hidden.length > 0 && <p className="small muted">Kaydın şu gruplarda gizli, yorum orada görünmez: {hidden.map((g) => g.name).join(', ')}</p>}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" disabled={busy || ok || vis.loading || !!vis.error || vis.data === null} onClick={go}>{ok ? '✅ Paylaşıldı' : 'Yorum olarak paylaş'}</button>
        <button className="btn small ghost" disabled={busy} onClick={onDone}>Kapat</button>
      </div>
      <ErrorBox error={err} />
    </div>
  );
}
