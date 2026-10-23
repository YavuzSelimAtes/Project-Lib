import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Avatar, Cover, Empty, ErrorBox, Skeleton, TYPE_LABEL, timeAgo, useAsync } from '../ui.jsx';

const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦉', '🐰', '🐻', '🦄', '🐧', '🐱'];
const COLORS = ['#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6', '#22c55e', '#eab308'];
const RSTATUS = { acik: 'Açık', inceleniyor: 'İnceleniyor', tamamlandi: 'Tamamlandı', reddedildi: 'Reddedildi' };

export default function Admin() {
  const [tab, setTab] = useState('inbox');
  const inbox = useAsync(() => api.adminRequests(), []);
  const open = inbox.data?.counts?.acik ?? 0;
  return (
    <>
      <h1>Yönetim</h1>
      <p className="sub">Aile üyelerini, talepleri ve kataloğu buradan yönet.</p>
      <div className="tabs" role="tablist">
        <button role="tab" className="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>
          📥 Gelen kutusu{open > 0 ? ` (${open})` : ''}
        </button>
        <button role="tab" className="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>
          👥 Kullanıcılar
        </button>
        <button role="tab" className="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>
          ➕ Katalog ekle
        </button>
        <button role="tab" className="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')}>
          📚 Katalog listesi
        </button>
      </div>
      {tab === 'inbox' && <Inbox state={inbox} />}
      {tab === 'users' && <Users />}
      {tab === 'catalog' && <CatalogForm onDone={inbox.reload} />}
      {tab === 'list' && <CatalogList />}
    </>
  );
}

/* ---------- gelen kutusu ---------- */
function Inbox({ state }) {
  const [filter, setFilter] = useState('');
  const list = (state.data?.requests || []).filter((r) => !filter || r.status === filter);
  return (
    <>
      <div className="tabs">
        {[['', 'Hepsi'], ...Object.entries(RSTATUS)].map(([k, l]) => (
          <button key={k} className="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
            {l}
            {k && state.data?.counts ? ` (${state.data.counts[k] ?? 0})` : ''}
          </button>
        ))}
      </div>
      {state.loading && !state.data && <Skeleton h={90} n={2} />}
      <ErrorBox error={state.error} onRetry={state.reload} />
      {state.data && list.length === 0 && (
        <Empty icon="📭" title="Gelen kutusu boş">
          Aile bir şey istediğinde burada görünecek.
        </Empty>
      )}
      <div className="shelf-list">
        {list.map((r) => (
          <RequestCard key={r.id} r={r} reload={state.reload} />
        ))}
      </div>
    </>
  );
}

function RequestCard({ r, reload }) {
  const [note, setNote] = useState(r.admin_note || '');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null);
  const [searchQ, setSearchQ] = useState(r.title);

  const patch = async (data) => {
    setBusy(true);
    setErr(null);
    try {
      await api.adminUpdateRequest(r.id, { admin_note: note || undefined, ...data });
      reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const search = async () => {
    setBusy(true);
    setErr(null);
    try {
      const x = await api.search(searchQ, r.type);
      setFound(x.items);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="row">
        <Avatar user={r.user} size="sm" />
        <b>{r.user.display_name}</b>
        <span className="muted small">{timeAgo(r.created_at)}</span>
        <span className="spacer" />
        <span className="chip">{RSTATUS[r.status]}</span>
      </div>
      <div style={{ margin: '8px 0' }}>
        <b>{r.title}</b> <span className="muted">({TYPE_LABEL[r.type]})</span>
        {r.note && <div className="small muted">Not: {r.note}</div>}
        {r.resolved_catalog && <div className="small ok-note">Bağlandı: {r.resolved_catalog.title}</div>}
      </div>
      {(r.status === 'acik' || r.status === 'inceleniyor') && (
        <>
          <div className="row">
            <input type="text" className="grow" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} aria-label="Katalogda ara" />
            <button className="btn small" disabled={busy || searchQ.trim().length < 2} onClick={search}>
              🔎 Ara
            </button>
          </div>
          {found && found.length === 0 && <p className="small muted">Sonuç yok. “Katalog ekle” sekmesinden elle ekleyebilirsin.</p>}
          {found?.slice(0, 6).map((it) => (
            <div className="item" key={it.id ?? it.key} style={{ cursor: 'default' }}>
              <Cover src={it.cover_url} title={it.title} />
              <div className="meta">
                <div className="t">{it.title}</div>
                <div className="line">{[it.author_or_creator, it.year].filter(Boolean).join(' · ')}</div>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={async () => {
                    let id = it.id;
                    if (id == null) {
                      try {
                        id = (await api.pickCatalog(it.key)).item.id;
                      } catch (e) {
                        return setErr(e);
                      }
                    }
                    patch({ resolved_catalog_id: id });
                  }}
                >
                  Bunu bağla ve tamamla
                </button>
              </div>
            </div>
          ))}
          <label className="field" style={{ marginTop: 10 }}>
            <span>Yönetici notu (talep sahibi görür)</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          <div className="row">
            {r.status === 'acik' && (
              <button className="btn small ghost" disabled={busy} onClick={() => patch({ status: 'inceleniyor' })}>
                İnceleniyor
              </button>
            )}
            <button className="btn small danger" disabled={busy} onClick={() => patch({ status: 'reddedildi' })}>
              Reddet
            </button>
          </div>
        </>
      )}
      <ErrorBox error={err} />
    </div>
  );
}

/* ---------- kullanicilar ---------- */
function Users() {
  const { user: me } = useAuth();
  const users = useAsync(() => api.adminUsers(), []);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', avatar: AVATARS[0], color: COLORS[0], role: 'member' });
  const [err, setErr] = useState(null);
  const [okMsg, setOkMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOkMsg('');
    try {
      await api.adminAddUser(form);
      setOkMsg(`${form.display_name} eklendi. Kullanıcı adı ve şifreyi kendisine ilet.`);
      setForm((f) => ({ ...f, username: '', display_name: '', password: '' }));
      users.reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (u) => {
    const pw = window.prompt(`${u.display_name} için yeni şifre (en az 6 karakter):`);
    if (!pw) return;
    try {
      await api.adminResetPassword(u.id, pw);
      setOkMsg(`${u.display_name} şifresi sıfırlandı.`);
    } catch (x) {
      setErr(x);
    }
  };
  const del = async (u, hard) => {
    const q = hard
      ? `${u.display_name} KALICI olarak silinsin mi? Tüm kayıtları, yorumları ve soruları da silinir. Bu geri alınamaz.`
      : `${u.display_name} pasife alınsın mı? Giriş yapamaz ve listelerden kalkar; verileri korunur, istersen tekrar açabilirsin.`;
    if (!window.confirm(q)) return;
    try {
      await api.adminDeleteUser(u.id, hard);
      users.reload();
    } catch (x) {
      setErr(x);
    }
  };
  const activate = async (u) => {
    try {
      await api.adminActivateUser(u.id);
      users.reload();
    } catch (x) {
      setErr(x);
    }
  };

  return (
    <>
      <form className="card" onSubmit={add} style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Kullanıcı ekle</h2>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <label className="field grow">
            <span>Kullanıcı adı</span>
            <input type="text" value={form.username} onChange={set('username')} autoCapitalize="none" placeholder="ayse" required />
            {err?.fields?.username && <span className="small" style={{ color: 'var(--danger)' }}>{err.fields.username}</span>}
          </label>
          <label className="field grow">
            <span>Görünen ad</span>
            <input type="text" value={form.display_name} onChange={set('display_name')} placeholder="Ayşe" required />
          </label>
          <label className="field grow">
            <span>Şifre (en az 6)</span>
            <input type="text" value={form.password} onChange={set('password')} autoComplete="off" required minLength={6} />
          </label>
        </div>
        <div className="field">
          <span>Avatar</span>
          <div className="row" style={{ marginTop: 4 }}>
            {AVATARS.map((a) => (
              <button type="button" key={a} className="icon-btn" aria-pressed={form.avatar === a} aria-label={`Avatar ${a}`} onClick={() => setForm((f) => ({ ...f, avatar: a }))} style={form.avatar === a ? { borderColor: 'var(--accent)', borderWidth: 3 } : undefined}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Renk</span>
          <div className="row" style={{ marginTop: 4 }}>
            {COLORS.map((c) => (
              <button type="button" key={c} aria-label={`Renk ${c}`} aria-pressed={form.color === c} onClick={() => setForm((f) => ({ ...f, color: c }))} style={{ width: 32, height: 32, borderRadius: '50%', background: c, border: form.color === c ? '4px solid var(--text)' : '2px solid var(--line)', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <label className="field">
          <span>Rol</span>
          <select value={form.role} onChange={set('role')}>
            <option value="member">Aile üyesi</option>
            <option value="admin">Yönetici</option>
          </select>
        </label>
        <ErrorBox error={err} />
        {okMsg && <p className="ok-note">{okMsg}</p>}
        <button className="btn" disabled={busy}>
          Kullanıcıyı ekle
        </button>
      </form>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Yedek</h2>
        <p className="small muted">Veritabanının bir kopyasını bilgisayarına indirir. Düzenli aralıklarla almanı öneririz.</p>
        <a className="btn small" href="/api/admin/backup" download>
          💾 Yedeği indir
        </a>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Aile üyeleri</h2>
        {users.loading && !users.data && <Skeleton h={50} n={2} />}
        <ErrorBox error={users.error} onRetry={users.reload} />
        {users.data?.users.map((u) => (
          <div className="lrow" key={u.id}>
            <Avatar user={u} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{u.display_name}</b> <span className="muted small">@{u.username}</span> {u.role === 'admin' && <span className="chip">yönetici</span>}
              <div className="small muted">{u.entry_count} kayıt</div>
            </div>
            {u.active === false ? (
              <>
                <span className="chip">pasif</span>
                <button className="btn small" onClick={() => activate(u)}>Etkinleştir</button>
                <button className="btn small danger" onClick={() => del(u, true)}>Kalıcı sil</button>
              </>
            ) : (
              <>
                <button className="btn small ghost" onClick={() => reset(u)}>Şifre sıfırla</button>
                {u.id !== me.id && (
                  <button className="btn small danger" onClick={() => del(u)}>Pasife al</button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- katalog ekle ---------- */
function CatalogForm({ onDone }) {
  const [f, setF] = useState({ type: 'book', title: '', author_or_creator: '', year: '', pages: '', seasons: '', description: '', cover_url: '' });
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [okMsg, setOkMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [importQ, setImportQ] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      return setErr(new Error('Kapak dosyası jpg, png veya webp olmalı ve 5 MB’ı geçmemeli.'));
    }
    setBusy(true);
    setErr(null);
    setOkMsg('');
    try {
      const data = { ...f };
      if (data.type !== 'book') delete data.pages;
      if (data.type !== 'series') delete data.seasons;
      ['year', 'pages', 'seasons'].forEach((k) => data[k] === '' || data[k] == null ? delete data[k] : (data[k] = Number(data[k])));
      Object.keys(data).forEach((k) => data[k] === '' && delete data[k]);
      if (file) delete data.cover_url;
      const r = await api.adminAddCatalog(data, file);
      setOkMsg(`“${r.item.title}” kataloğa eklendi.`);
      setF((x) => ({ ...x, title: '', author_or_creator: '', year: '', pages: '', seasons: '', description: '', cover_url: '' }));
      setFile(null);
      onDone?.();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const doImport = async () => {
    setBusy(true);
    setErr(null);
    setOkMsg('');
    try {
      const r = await api.adminImport(f.type, importQ.trim());
      setOkMsg(r.items.length ? `İnternetten eklendi: ${r.items.map((i) => i.title).join(', ')}` : 'İnternette eşleşme bulunamadı.');
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>İnternetten otomatik ekle</h2>
        <div className="row">
          <select value={f.type} onChange={set('type')} style={{ width: 'auto' }} aria-label="Tür">
            <option value="book">Kitap</option>
            <option value="movie">Film</option>
            <option value="series">Dizi</option>
          </select>
          <input type="text" className="grow" value={importQ} onChange={(e) => setImportQ(e.target.value)} placeholder="Adını yaz…" aria-label="İnternette ara" />
          <button className="btn" disabled={busy || importQ.trim().length < 2} onClick={doImport}>İçe aktar</button>
        </div>
      </div>
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>Elle ekle</h2>
        <label className="field">
          <span>Tür</span>
          <select value={f.type} onChange={set('type')}>
            <option value="book">Kitap</option>
            <option value="movie">Film</option>
            <option value="series">Dizi</option>
          </select>
        </label>
        <label className="field"><span>Başlık *</span><input type="text" value={f.title} onChange={set('title')} required maxLength={300} /></label>
        <label className="field"><span>{f.type === 'book' ? 'Yazar' : 'Yönetmen / yapımcı'}</span><input type="text" value={f.author_or_creator} onChange={set('author_or_creator')} /></label>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <label className="field grow"><span>Yıl</span><input type="number" value={f.year} onChange={set('year')} /></label>
          {f.type === 'book' && <label className="field grow"><span>Sayfa sayısı</span><input type="number" min="1" value={f.pages} onChange={set('pages')} /></label>}
          {f.type === 'series' && <label className="field grow"><span>Sezon sayısı</span><input type="number" min="1" value={f.seasons} onChange={set('seasons')} /></label>}
        </div>
        <label className="field"><span>Açıklama</span><textarea value={f.description} onChange={set('description')} /></label>
        <label className="field"><span>Kapak URL’si</span><input type="url" value={f.cover_url} onChange={set('cover_url')} placeholder="https://…" disabled={!!file} /></label>
        <label className="field"><span>… veya kapak dosyası yükle (jpg/png/webp, en fazla 5 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        <ErrorBox error={err} />
        {okMsg && <p className="ok-note">{okMsg}</p>}
        <button className="btn" disabled={busy || !f.title.trim()}>Kataloğa ekle</button>
      </form>
    </>
  );
}

/* ---------- katalog listesi / duzenle / sil ---------- */
function CatalogList() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [dq, setDq] = useState('');
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 350);
    return () => clearTimeout(t);
  }, [q]);
  const list = useAsync(() => api.adminCatalog({ q: dq, type, limit: 50 }), [dq, type]);

  const del = async (it) => {
    if (!window.confirm(`“${it.title}” katalogdan silinsin mi?`)) return;
    setErr(null);
    try {
      await api.adminDeleteCatalog(it.id);
      list.reload();
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="search" className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Katalogda ara…" aria-label="Katalogda ara" />
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }} aria-label="Tür">
          <option value="">Hepsi</option>
          <option value="book">Kitap</option>
          <option value="movie">Film</option>
          <option value="series">Dizi</option>
        </select>
      </div>
      {list.loading && !list.data && <Skeleton h={70} n={3} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      <ErrorBox error={err} />
      {list.data && list.data.items.length === 0 && <Empty icon="🔎" title="Kayıt bulunamadı" />}
      {list.data && <p className="small muted">{list.data.total} kayıt</p>}
      <div className="shelf-list">
        {list.data?.items.map((it) => (
          <div className="card" key={it.id}>
            <div className="item" style={{ cursor: 'default' }}>
              <Cover src={it.cover_url} title={it.title} />
              <div className="meta">
                <div className="t">{it.title}</div>
                <div className="line">
                  {TYPE_LABEL[it.type]}
                  {it.author_or_creator ? ` · ${it.author_or_creator}` : ''}
                  {it.year ? ` · ${it.year}` : ''}
                  {it.pages ? ` · ${it.pages} sayfa` : ''} · {it.entry_count} kayıt
                </div>
                <div className="row">
                  <button className="btn small ghost" onClick={() => setEditing(editing === it.id ? null : it.id)}>Düzenle</button>
                  <button className="btn small danger" onClick={() => del(it)}>Sil</button>
                </div>
              </div>
            </div>
            {editing === it.id && <CatalogEdit it={it} onDone={() => { setEditing(null); list.reload(); }} />}
          </div>
        ))}
      </div>
    </>
  );
}

function CatalogEdit({ it, onDone }) {
  const [f, setF] = useState({
    title: it.title,
    author_or_creator: it.author_or_creator || '',
    year: it.year ?? '',
    pages: it.pages ?? '',
    description: it.description || '',
    cover_url: '',
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const d = { title: f.title.trim(), author_or_creator: f.author_or_creator, description: f.description };
      if (f.year !== '') d.year = Number(f.year);
      if (it.type === 'book' && f.pages !== '') d.pages = Number(f.pages);
      if (f.cover_url) d.cover_url = f.cover_url;
      await api.adminUpdateCatalog(it.id, d);
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} style={{ marginTop: 10 }}>
      <label className="field"><span>Başlık</span><input type="text" value={f.title} onChange={set('title')} required /></label>
      <label className="field"><span>Yazar / yapımcı</span><input type="text" value={f.author_or_creator} onChange={set('author_or_creator')} /></label>
      <div className="row" style={{ alignItems: 'stretch' }}>
        <label className="field grow"><span>Yıl</span><input type="number" value={f.year} onChange={set('year')} /></label>
        {it.type === 'book' && <label className="field grow"><span>Sayfa</span><input type="number" min="1" value={f.pages} onChange={set('pages')} /></label>}
      </div>
      <label className="field"><span>Açıklama</span><textarea value={f.description} onChange={set('description')} /></label>
      <label className="field"><span>Yeni kapak URL’si (boşsa değişmez)</span><input type="url" value={f.cover_url} onChange={set('cover_url')} placeholder="https://…" /></label>
      <ErrorBox error={err} />
      <button className="btn small" disabled={busy}>Kaydet</button>
    </form>
  );
}
