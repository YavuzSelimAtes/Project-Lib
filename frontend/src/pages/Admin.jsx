import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { RouteTabs } from './Ben.jsx';
import { useAuth } from '../auth.js';
import { Avatar, Cover, Empty, ErrorBox, PageHead, SearchMeta, Skeleton, TYPE_LABEL, timeAgo, useAsync } from '../ui.jsx';
import { AvatarPicker, ColorPicker, COLORS, validateName } from '../Profile.jsx';
import { flattenEditions } from '../Editions.jsx';
import { langLabel } from '../ui.jsx';
const GroupManage = lazy(() => import('./Groups.jsx').then((m) => ({ default: m.Manage })));
const RSTATUS = { acik: 'Açık', inceleniyor: 'İnceleniyor', tamamlandi: 'Tamamlandı', reddedildi: 'Reddedildi' };

export default function Admin() {
  const { user } = useAuth();
  const platform = user.role === 'admin'; // platform yöneticisi: kullanıcılar + okuma durumu da
  const ownedAll = (user.groups || []).filter((g) => g.role === 'owner');
  const { tab = 'inbox' } = useParams();
  const inbox = useAsync(() => api.adminRequests(), []);
  const open = inbox.data?.counts?.acik ?? 0;
  const mgr = !!user.is_manager; // grup yonetici hesabi: sade grup ayarlari
  const tabs = mgr ? [['inbox', 'İstekler'], ['link', 'Grup'], ['catalog', 'Katalog ekle'], ['list', 'Katalog listesi']] : [
    ['inbox', `Gelen kutusu${open > 0 ? ` (${open})` : ''}`],
    ...(ownedAll.length ? [['link', 'Katılım linki']] : []),
    ...(platform ? [['users', 'Kullanıcılar'], ['reading', 'Okuma durumu'], ['feedback', 'Geri bildirim']] : []),
    ['catalog', 'Katalog ekle'],
    ['list', 'Katalog listesi'],
  ];
  if (!tabs.some(([k]) => k === tab)) return <Navigate to="/yonetim" replace />;
  const MGR_TITLE = { inbox: 'İstekler', link: 'Grup', catalog: 'Katalog', list: 'Katalog' };
  return (
    <>
      <PageHead
        title={mgr ? MGR_TITLE[tab] : 'Yönetim'}
        sub={mgr ? (user.managed_group_name ? `${user.managed_group_name} · yönetici hesabı` : 'Yönetici hesabı') : undefined}
      />
      {(!mgr || tab === 'catalog' || tab === 'list') && (
        <RouteTabs tabs={mgr ? tabs.slice(2) : tabs} current={tab} base="/yonetim" label="Yönetim bölümleri" />
      )}
      {tab === 'inbox' && <Inbox state={inbox} />}
      {tab === 'link' && mgr && user.managed_group_id && (
        <Suspense fallback={<Skeleton h={80} n={2} />}><GroupManage gid={user.managed_group_id} onChanged={() => {}} /></Suspense>
      )}
      {tab === 'link' && !mgr && ownedAll.map((g) => (
        <section key={g.id}>
          {ownedAll.length > 1 && <h2 className="small muted">{g.name}</h2>}
          <Suspense fallback={<Skeleton h={80} n={2} />}><GroupManage gid={g.id} onChanged={() => {}} /></Suspense>
        </section>
      ))}
      {tab === 'users' && platform && <Users />}
      {tab === 'reading' && platform && <ReadingStatus />}
      {tab === 'feedback' && platform && <FeedbackList />}
      {tab === 'catalog' && <CatalogForm onDone={inbox.reload} />}
      {tab === 'list' && <CatalogList />}
    </>
  );
}

/* ---------- geri bildirim (yalniz platform admin) ---------- */
const FB_LABEL = { oneri: ['💡', 'Öneri'], hata: ['🐞', 'Hata'], begendim: ['❤️', 'Beğendim'] };
function FeedbackList() {
  const list = useAsync(() => api.adminFeedback(), []);
  const [err, setErr] = useState(null);
  const items = list.data?.items || [];
  const del = async (it) => {
    if (!window.confirm('Bu geri bildirim silinsin mi?')) return;
    setErr(null);
    try {
      await api.adminDeleteFeedback(it.id);
      list.reload();
    } catch (x) {
      setErr(x);
    }
  };
  return (
    <>
      {list.loading && !list.data && <Skeleton h={80} n={3} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      <ErrorBox error={err} />
      {list.data && items.length === 0 && <Empty icon="💌" title="Henüz geri bildirim yok">Kullanıcılar avatar menüsünden “Fikrini belirt” ile yazınca burada görünür.</Empty>}
      <div className="shelf-list">
        {items.map((it) => {
          const [ic, label] = FB_LABEL[it.kind] || ['💬', it.kind];
          return (
            <div className="card fb-item" key={it.id}>
              <div className="row">
                <span className={`chip fb-${it.kind}`}>{ic} {label}</span>
                <span className="small muted grow" title={it.created_at}>{timeAgo(it.created_at)}</span>
                <button className="btn small ghost" onClick={() => del(it)}>Sil</button>
              </div>
              <p className="fb-msg">{it.message}</p>
              <div className="small muted">
                {it.user ? `${it.user.display_name} (@${it.user.username})` : 'Bilinmiyor'}
                {it.user?.kind === 'manager' ? ' · yönetici hesabı' : ''}
                {it.page ? ` · ${it.page}` : ''}
                {' · '}{it.emailed ? 'e-posta gitti' : 'e-posta gitmedi'}
              </div>
            </div>
          );
        })}
      </div>
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
          <button key={k} className="tab sm" aria-selected={filter === k} onClick={() => setFilter(k)}>
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
      <div className="my-8">
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
            <div className="item static" key={it.id ?? it.key}>
              <Cover src={it.cover_url} title={it.title} />
              <div className="meta">
                <div className="t">{it.title}</div>
                <div className="line">{[it.author_or_creator, it.year].filter(Boolean).join(' · ')}</div>
                <SearchMeta it={it} />
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
          <label className="field mt-10">
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
export function InviteLink({ gid }) {
  const inv = useAsync(() => api.groupInvite(gid), [gid]);
  const [msg, setMsg] = useState('');
  const url = inv.data ? `${window.location.origin}/katil/${inv.data.token}` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setMsg('Kopyalandı');
    } catch {
      setMsg('Kopyalanamadı, linki elle seç');
    }
  };
  const regen = async () => {
    if (!window.confirm('Eski link çalışmaz olur. Yeni link oluşturulsun mu?')) return;
    try {
      await api.groupInviteRegen(gid);
      inv.reload();
      setMsg('Yeni link oluşturuldu');
    } catch (x) {
      setMsg(x.message);
    }
  };
  const { user, refresh } = useAuth();
  const [gname, setGname] = useState((user.groups || []).find((g) => g.id === gid)?.name || user.group_name || '');
  const saveName = async (e) => {
    e.preventDefault();
    try {
      const r = await api.groupName(gid, gname.trim());
      setGname(r.group_name);
      await refresh();
      setMsg('Ad kaydedildi');
    } catch (x) {
      setMsg(x.message);
    }
  };
  return (
    <div className="card">
      <h2>Grup bilgisi</h2>
      <form className="row mb-12" onSubmit={saveName}>
        <label className="field grow flush">
          <span>Grup adı (üst barda görünür)</span>
          <input type="text" maxLength={40} value={gname} onChange={(e) => setGname(e.target.value)} />
        </label>
        <button className="btn small btn-end">Kaydet</button>
      </form>
      {inv.data && <InviteName gid={gid} key={inv.data.invite_name} initial={inv.data.invite_name} fallback={user.display_name} setMsg={setMsg} />}
      <div className="card-sec">
      <h2>Katılım linki</h2>
      <p className="muted small">Bu linki paylaştığın kişi hesap açıp senin grubuna katılır.</p>
      <ErrorBox error={inv.error} onRetry={inv.reload} />
      {url && (
        <div className="row">
          <input type="text" className="link-in" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn small" onClick={copy}>📋 Kopyala</button>
          <button type="button" className="btn small ghost" onClick={regen}>Yenile</button>
        </div>
      )}
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </div>
  );
}

function InviteName({ gid, initial, fallback, setMsg }) {
  const [v, setV] = useState(initial);
  const save = async (e) => {
    e.preventDefault();
    try {
      const r = await api.groupInviteName(gid, v.trim());
      setV(r.invite_name);
      setMsg('Davet eden adı kaydedildi');
    } catch (x) {
      setMsg(x.message);
    }
  };
  return (
    <form className="row mt-12" onSubmit={save}>
      <label className="field grow flush">
        <span>Davet eden adı (katılım sayfasında "… seni davet etti")</span>
        <input type="text" maxLength={40} value={v} placeholder={fallback} onChange={(e) => setV(e.target.value)} />
      </label>
      <button className="btn small btn-end">Kaydet</button>
    </form>
  );
}

function Users() {
  const { user: me } = useAuth();
  const users = useAsync(() => api.adminUsers(), []);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', avatar: '🦊', color: COLORS[0], role: 'member' });
  const [err, setErr] = useState(null);
  const [okMsg, setOkMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const nameCheck = form.display_name ? validateName(form.display_name) : { norm: '', error: null };
  const add = async (e) => {
    e.preventDefault();
    if (nameCheck.error) return setErr(new Error(nameCheck.error));
    setBusy(true);
    setErr(null);
    setOkMsg('');
    try {
      await api.adminAddUser({ ...form, display_name: nameCheck.norm });
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
  const resetName = async (u) => {
    try {
      await api.adminUpdateUser(u.id, { reset_name_change: true });
      setOkMsg(`${u.display_name} görünen adını bir kez daha değiştirebilir.`);
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
      <form className="card" onSubmit={add}>
        <h2>Kullanıcı ekle</h2>
        <div className="row row-stretch">
          <label className="field grow">
            <span>Kullanıcı adı</span>
            <input type="text" value={form.username} onChange={set('username')} autoCapitalize="none" placeholder="ayse" required />
            {err?.fields?.username && <span className="small err-text">{err.fields.username}</span>}
          </label>
          <label className="field grow">
            <span>Görünen ad</span>
            <input type="text" value={form.display_name} onChange={set('display_name')} placeholder="Ayşe" required maxLength={40} aria-invalid={!!nameCheck.error} />
            {nameCheck.error && <span className="small err-text">{nameCheck.error}</span>}
          </label>
          <label className="field grow">
            <span>Şifre (en az 6)</span>
            <input type="text" value={form.password} onChange={set('password')} autoComplete="off" required minLength={6} />
          </label>
        </div>
        <div className="field">
          <span>Avatar</span>
          <div className="mt-4">
            <AvatarPicker value={form.avatar} onChange={(a) => setForm((f) => ({ ...f, avatar: a }))} />
          </div>
        </div>
        <div className="field">
          <span>Renk</span>
          <div className="mt-4">
            <ColorPicker value={form.color} onChange={(c) => setForm((f) => ({ ...f, color: c }))} />
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

      <div className="card">
        <h2>Yedek</h2>
        <p className="small muted">Veritabanının bir kopyasını bilgisayarına indirir. Düzenli aralıklarla almanı öneririz.</p>
        <a className="btn small" href="/api/admin/backup" download>
          💾 Yedeği indir
        </a>
      </div>

      <div className="card">
        <h2>Aile üyeleri</h2>
        {users.loading && !users.data && <Skeleton h={50} n={2} />}
        <ErrorBox error={users.error} onRetry={users.reload} />
        {users.data?.users.map((u) => (
          <div className="lrow" key={u.id}>
            <Avatar user={u} size="sm" />
            <div className="fill">
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
                {u.name_changed && <button className="btn small ghost" onClick={() => resetName(u)} title="Kullanıcı görünen adını bir kez daha değiştirebilsin">Ad hakkını sıfırla</button>}
                {u.id !== me.id && (
                  <button className="btn small danger" onClick={() => del(u)}>Pasife al</button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <LinkGroups users={users.data?.users || []} />
    </>
  );
}

/* ---------- hesap baglantilari ---------- */
function LinkGroups({ users }) {
  const groups = useAsync(() => api.adminLinkGroups(), []);
  const [sel, setSel] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const candidates = users.filter((u) => u.active !== false);
  const adminSel = sel.filter((id) => users.find((u) => u.id === id)?.role === 'admin').length;
  const adminBad = adminSel > 0 && (adminSel > 1 || sel.length !== 2);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const link = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.adminSetLinkGroup(sel);
      setSel([]);
      groups.reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (g) => {
    if (!window.confirm('Bu bağlantı kaldırılsın mı? Hesaplar artık birbirine şifresiz geçemez.')) return;
    try {
      await api.adminDeleteLinkGroup(g.id);
      groups.reload();
    } catch (x) {
      setErr(x);
    }
  };

  return (
    <div className="card">
      <h2>Hesap bağlantıları</h2>
      <p className="small muted">Bağlı hesaplar birbirine şifresiz, tek dokunuşla geçebilir. Yönetici hesap yalnızca kendi kullanıcı hesabıyla (tam 2 hesap) bağlanabilir.</p>
      {groups.loading && !groups.data && <Skeleton h={40} n={1} />}
      <ErrorBox error={groups.error} onRetry={groups.reload} />
      {groups.data?.groups.map((g) => (
        <div className="lrow" key={g.id}>
          <div className="fill">{g.users.map((u, i) => <span key={u.id ?? i} className="head-who">{i > 0 && ' • '}<Avatar user={u} size="xs" /> {u.display_name}</span>)}</div>
          <button className="btn small danger" onClick={() => unlink(g)}>
            Bağlantıyı kaldır
          </button>
        </div>
      ))}
      {groups.data && !groups.data.groups.length && <p className="small muted">Henüz bağlantı yok.</p>}
      <h3>Yeni bağlantı</h3>
      <fieldset className="bare">
        <legend className="small muted">Bağlanacak hesapları seç (en az 2). Zaten bağlı olanlar yeni gruba taşınır.</legend>
        {candidates.map((u) => (
          <label key={u.id} className="row pick-row">
            <input type="checkbox" checked={sel.includes(u.id)} onChange={() => toggle(u.id)} />
            <Avatar user={u} size="sm" /> {u.display_name} <span className="muted small">@{u.username}</span>
          </label>
        ))}
      </fieldset>
      {adminBad && <p className="small err-text">Yönetici ile yalnızca bir kullanıcı hesabı bağlanabilir (toplam 2 hesap).</p>}
      <ErrorBox error={err} />
      <button className="btn" disabled={busy || sel.length < 2 || adminBad} onClick={link}>
        Bağla
      </button>
    </div>
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
  const [imported, setImported] = useState(null);
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
  const markWrong = async (it, wrong) => {
    setErr(null);
    try {
      await api.adminMarkWrong(it.id, wrong);
      setImported((l) => l.map((x) => (x.id === it.id ? { ...x, wrong } : x)));
    } catch (x) {
      setErr(x);
    }
  };
  const doImport = async () => {
    setBusy(true);
    setErr(null);
    setOkMsg('');
    setImported(null);
    try {
      const r = await api.adminImport(f.type, importQ.trim());
      setImported(r.items);
      if (!r.items.length) setOkMsg('İnternette eşleşme bulunamadı.');
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>İnternetten otomatik ekle</h2>
        <div className="row">
          <select value={f.type} onChange={set('type')} className="w-auto" aria-label="Tür">
            <option value="book">Kitap</option>
            <option value="movie">Film</option>
            <option value="series">Dizi</option>
          </select>
          <input type="text" className="grow" value={importQ} onChange={(e) => setImportQ(e.target.value)} placeholder="Adını yaz…" aria-label="İnternette ara" />
          <button className="btn" disabled={busy || importQ.trim().length < 2} onClick={doImport}>İçe aktar</button>
        </div>
        {imported?.map((it) => (
          <div key={it.id} className={it.wrong ? 'row row-top mt-10 dim' : 'row row-top mt-10'}>
            <Cover src={it.cover_url} title={it.title} />
            <div className="grow small">
              <strong>{it.title}</strong>{it.author_or_creator ? <> — {it.author_or_creator}</> : null}
              <div className="muted">
                {[TYPE_LABEL[it.type], it.year, it.pages ? `${it.pages} sayfa` : null, it.source].filter(Boolean).join(' · ')}
              </div>
              {it.description && <div className="muted">{it.description.slice(0, 140)}{it.description.length > 140 ? '…' : ''}</div>}
              <div className="muted">{it.already_in_catalog ? 'Zaten katalogdaydı' : 'Kataloğa eklendi'}{it.wrong ? ' · YANLIŞ KİTAP olarak işaretlendi (katalogdan kaldırıldı; elle ekleyebilirsin)' : ''}</div>
            </div>
            <button type="button" className="btn small ghost" onClick={() => markWrong(it, !it.wrong)}>{it.wrong ? 'Geri al' : 'Yanlış kitap'}</button>
          </div>
        ))}
      </div>
      <form className="card" onSubmit={submit}>
        <h2>Elle ekle</h2>
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
        <div className="row row-stretch">
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
  const [edOpen, setEdOpen] = useState(null);
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
      <div className="row mb-12">
        <input type="search" className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Katalogda ara…" aria-label="Katalogda ara" />
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-auto" aria-label="Tür">
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
            <div className="item static">
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
                  {it.type === 'book' && <button className="btn small ghost" onClick={() => setEdOpen(edOpen === it.id ? null : it.id)}>📘 Baskılar</button>}
                  <button className="btn small danger" onClick={() => del(it)}>Sil</button>
                </div>
              </div>
            </div>
            {edOpen === it.id && <EditionsAdmin catalogId={it.id} />}
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
    <form className="mt-10" onSubmit={save}>
      <label className="field"><span>Başlık</span><input type="text" value={f.title} onChange={set('title')} required /></label>
      <label className="field"><span>Yazar / yapımcı</span><input type="text" value={f.author_or_creator} onChange={set('author_or_creator')} /></label>
      <div className="row row-stretch">
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

/* ---------- baski ekle / sil (admin) ---------- */
const LANG_OPTS = ['tr', 'en', 'de', 'fr', 'es', 'it', 'ru', 'ar'];
function EditionsAdmin({ catalogId }) {
  const state = useAsync(async () => flattenEditions(await api.catalogItem(catalogId).then((r) => ({ editions: r.editions || r.item?.editions || [] }))), [catalogId]);
  const [f, setF] = useState({ language: 'tr', publisher: '', pages: '', year: '', isbn: '', cover_url: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const add = async (e) => {
    e.preventDefault();
    if (!f.publisher.trim() && !f.pages) return setErr(new Error('Yayınevi ya da sayfa sayısından en az birini yaz.'));
    setBusy(true);
    setErr(null);
    try {
      const d = { language: f.language || undefined, publisher: f.publisher.trim() || undefined };
      if (f.pages) d.pages = Number(f.pages);
      if (f.year) d.year = Number(f.year);
      if (f.isbn.trim()) d.isbn = f.isbn.trim();
      if (f.cover_url.trim()) d.cover_url = f.cover_url.trim();
      await api.adminAddEdition(catalogId, d);
      setF((x) => ({ ...x, publisher: '', pages: '', year: '', isbn: '', cover_url: '' }));
      state.reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const del = async (ed) => {
    if (!window.confirm('Bu baskı silinsin mi? Bağlı kayıtların toplam sayfası korunur.')) return;
    setErr(null);
    try {
      await api.adminDeleteEdition(ed.id);
      state.reload();
    } catch (x) {
      setErr(x);
    }
  };
  const list = state.data || [];
  return (
    <div className="card-sec">
      <b className="small">Baskılar</b>
      {state.loading && !state.data && <p className="small muted">Yükleniyor…</p>}
      <ErrorBox error={state.error} onRetry={state.reload} />
      {state.data && list.length === 0 && <p className="small muted">Henüz baskı yok.</p>}
      {list.map((ed) => (
        <div className="lrow" key={ed.id}>
          <div className="fill">
            <b>{ed.publisher || 'Yayınevi yok'}</b>{' '}
            <span className="small muted">
              {[ed.language ? langLabel(ed.language) : null, ed.pages ? `${ed.pages} sayfa` : 'sayfa yok', ed.year, ed.isbn].filter(Boolean).join(' · ')}
              {ed.source ? ` · ${ed.source}` : ''}
            </span>
          </div>
          <button className="btn small danger" onClick={() => del(ed)} aria-label="Baskıyı sil">Sil</button>
        </div>
      ))}
      <form className="mt-10" onSubmit={add}>
        <b className="small">Baskı ekle</b>
        <div className="row row-stretch mt-6">
          <label className="field grow"><span>Dil</span>
            <select value={f.language} onChange={set('language')}>
              {LANG_OPTS.map((l) => <option key={l} value={l}>{langLabel(l)}</option>)}
              <option value="">Belirtme</option>
            </select>
          </label>
          <label className="field grow"><span>Yayınevi</span><input type="text" value={f.publisher} onChange={set('publisher')} maxLength={120} /></label>
        </div>
        <div className="row row-stretch">
          <label className="field grow"><span>Sayfa</span><input type="number" min="1" value={f.pages} onChange={set('pages')} /></label>
          <label className="field grow"><span>Yıl</span><input type="number" value={f.year} onChange={set('year')} /></label>
          <label className="field grow"><span>ISBN</span><input type="text" value={f.isbn} onChange={set('isbn')} maxLength={20} /></label>
        </div>
        <label className="field"><span>Kapak URL’si (isteğe bağlı)</span><input type="url" value={f.cover_url} onChange={set('cover_url')} placeholder="https://…" /></label>
        <ErrorBox error={err} />
        <button className="btn small" disabled={busy}>Baskıyı ekle</button>
      </form>
    </div>
  );
}

/* ---------- neden okumuyorsun ---------- */
function ReadingStatus() {
  const [all, setAll] = useState(false);
  const st = useAsync(() => api.adminReadingStatus(all), [all]);
  const [sent, setSent] = useState({}); // id -> 'ok' | 'dup'
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const nudge = async (u) => {
    setBusyId(u.id);
    setErr(null);
    try {
      await api.adminNudge(u.id);
      setSent((s) => ({ ...s, [u.id]: 'ok' }));
    } catch (x) {
      if (x.status === 409) setSent((s) => ({ ...s, [u.id]: 'dup' }));
      else setErr(x);
    } finally {
      setBusyId(null);
    }
  };
  const users = st.data?.users || [];
  return (
    <div className="card">
      <div className="row">
        <h2 className="grow flush">Okuma durumu</h2>
        <label className="small row gap-6">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Hepsini göster
        </label>
      </div>
      {st.loading && !st.data && <Skeleton h={50} n={2} />}
      <ErrorBox error={st.error} onRetry={st.reload} />
      <ErrorBox error={err} />
      {st.data && users.length === 0 && <p className="muted small">Bugün herkes okumuş görünüyor 🎉</p>}
      {users.map((r) => {
        const u = r.user;
        const flag = sent[u.id];
        const done = r.nudged_today || flag;
        return (
          <div className="lrow" key={u.id}>
            <Avatar user={u} size="sm" />
            <div className="fill">
              <b>{u.display_name}</b>
              <div className="row gap-6 mt-2">
                {r.bugun_okumadi && <span className="chip">Bugün okumadı</span>}
                {r.aktif_kitap_yok && <span className="chip">{r.kitap_eklemedi ? 'Hiç kitap eklemedi' : 'Aktif kitap yok'}</span>}
                <span className="small muted">Son okuma: {r.last_read_date ? timeAgo(r.last_read_date) : 'hiç'}</span>
              </div>
              {flag === 'dup' && <div className="small muted">Bugün zaten gönderildi</div>}
              {flag === 'ok' && <div className="ok-note small">✅ Gönderildi</div>}
            </div>
            <button className="btn small" disabled={done || busyId === u.id} onClick={() => nudge(u)}>
              Neden okumuyorsun? 📖
            </button>
          </div>
        );
      })}
      {users.some((r) => r.nudged_today) && <p className="small muted">Bugün hatırlatma gönderilenlerin düğmesi devre dışıdır.</p>}
    </div>
  );
}
