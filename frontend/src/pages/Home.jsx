import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronRight, Plus, Search, SlidersHorizontal, Sparkles, Users } from 'lucide-react';
import { api } from '../api.js';
import { useAuth, useGroup } from '../auth.js';
import Gundem from '../Gundem.jsx';
import { Avatar, Cover, Empty, ErrorBox, Progress, SegTabs, Skeleton, timeAgo, useAsync } from '../ui.jsx';
import EntryDetail from '../EntryDetail.jsx';
import AddFlow from '../AddFlow.jsx';
import { QA } from '../EntryDetail.jsx';
import { NewStory } from '../StoryCard.jsx';

const StoryReader = lazy(() => import('../StoryReader.jsx'));

// Profil kartinda tek satirlik durum: fiil + eser + kisa ilerleme
const VERB = { reading: 'Okuyor', watching_series: 'İzliyor', finished_book: 'Bitirdi', finished_series: 'Bitirdi', watched_movie: 'İzledi' };

function progressText(it) {
  if (it.catalog.type === 'book' && it.total_pages && it.kind === 'reading') return `%${Math.floor(it.percent ?? 0)}`;
  if (it.kind === 'watching_series' && it.season) return `S${it.season} B${it.episode}`;
  if (it.kind === 'watched_movie' && it.rating) return '⭐'.repeat(it.rating);
  return null;
}

// Uyenin yalniz en son aktivitesi; gecmisin tamami rafinda
function LatestActivity({ it, color, onOpen }) {
  const extra = progressText(it);
  const reading = it.kind === 'reading' && it.catalog.type === 'book' && it.total_pages;
  return (
    <button className="pc-act" onClick={() => onOpen(it.entry_id)} aria-label={`${VERB[it.kind] || ''} ${it.catalog.title}, detayı aç`}>
      <span className="pc-cov"><Cover src={it.catalog.cover_url} fallback={it.catalog.cover_fallback} title={it.catalog.title} /></span>
      <span className="pc-meta">
        <span className="pc-verb">
          <span>{VERB[it.kind] || 'Son kayıt'}{extra ? ` · ${extra}` : ''}</span>
          {it.updated_at && <time className="pc-ago" dateTime={it.updated_at}>{timeAgo(it.updated_at)}</time>}
        </span>
        <span className="pc-title">{it.catalog.title}</span>
        {reading ? <Progress value={it.percent} color={color} /> : null}
      </span>
    </button>
  );
}

const PER_CARD = 3;

function MemberCard({ c, me, to, onOpen, onStory, onNewStory }) {
  const mine = c.user.id === me.id;
  // yalniz devam eden kayitlar, en son guncellenen ustte; en fazla 3 tane
  const ongoing = c.items.filter((it) => it.status === 'devam').sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const shown = ongoing.slice(0, PER_CARD);
  const more = ongoing.length - shown.length;
  const story = (c.stories || [])[0];
  const metaLine = [c.last_activity && timeAgo(c.last_activity), c.current_streak >= 2 && `🔥${c.current_streak}`].filter(Boolean).join(' · ');
  return (
    <section className="card pcard" aria-label={c.user.display_name}>
      <Link to={to} className="pc-head" title="Rafına bak">
        <Avatar user={c.user} size="sm" />
        <span className="pc-who">
          <b>{mine ? 'Sen' : c.user.display_name}</b>
          {metaLine && <span className="pc-when">{metaLine}</span>}
        </span>
        <span className="pc-go" aria-hidden="true">›</span>
      </Link>
      {shown.length > 0 ? (
        <div className="pc-list">
          {shown.map((it) => <LatestActivity key={it.entry_id} it={it} color={c.user.color} onOpen={onOpen} />)}
        </div>
      ) : (
        <p className="pc-empty">{mine ? 'Şu an bir şey okumuyorsun.' : 'Şu an bir şey okumuyor / izlemiyor.'}</p>
      )}
      {(story || more > 0 || (mine && me.story_author)) && (
        <div className="pc-foot">
          {story ? (
            <button className="pc-link" onClick={() => onStory(story.id)}>📖 Hikaye: “{story.title}”</button>
          ) : mine && me.story_author ? (
            <button className="pc-link" onClick={onNewStory}>✍️ Hikaye başlat</button>
          ) : null}
          {more > 0 && <Link className="pc-link pc-more" to={to}>+{more} devam eden daha</Link>}
        </div>
      )}
    </section>
  );
}

// Ust bolum: grup rozeti (birden cok grupta secici), sicak baslik, ana eylem
function GroupChip({ group, count, switchable }) {
  const nav = useNavigate();
  return (
    <div className="hh-chip">
      <BookOpen size={15} aria-hidden="true" />
      {switchable?.length > 1 ? (
        <span className="hh-chip-sel">
          <select aria-label="Grup seç" value={group.id} onChange={(e) => nav(`/ana/${e.target.value}`)}>
            {switchable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </span>
      ) : (
        <b>{group.name}</b>
      )}
      {count ? <span className="hh-chip-n">· {count} üye</span> : null}
    </div>
  );
}

// Ozel ada yonelme eki: "Aile Kütüphanesi'ne", "Kitap Kulübü'ne", "Okurlar'a", "Sinema'ya"
function toName(name) {
  const n = name.trim();
  const last = n.toLocaleLowerCase('tr').match(/[aeıioöuü]/g)?.pop() || 'e';
  const e = 'aıou'.includes(last) ? 'a' : 'e';
  const lastWord = n.split(/\s+/).pop().toLocaleLowerCase('tr');
  if (!/[aeıioöuü]$/.test(lastWord)) return `${n}'${e}`;
  // birden cok kelimeli ve i/ı/u/ü ile biten adlar tamlamadir (Kütüphanesi, Kulübü): -na/-ne
  const compound = n.includes(' ') && /[ıiuü]$/.test(lastWord);
  return `${n}'${compound ? 'n' : 'y'}${e}`;
}

function HomeHero({ group, count, switchable, onAdd }) {
  return (
    <header className="hh">
      {group && <GroupChip group={group} count={count} switchable={switchable} />}
      {group && switchable && (
        <Link to={`/g/${group.id}`} className="hh-go">
          {toName(group.name)} git <ChevronRight size={15} aria-hidden="true" />
        </Link>
      )}
      <div className="hh-row">
        <div className="hh-t">
          <h1>{group ? 'Aynı hikâyede buluşalım.' : 'Son güncellemeler'}</h1>
          <p>{group ? 'Grubumuzda kim ne okuyor, ne izliyor?' : 'Hesabındaki son güncellemeler.'}</p>
        </div>
        <button className="btn hh-cta" onClick={onAdd}>
          <Plus size={18} aria-hidden="true" /> Yeni ekle
        </button>
      </div>
    </header>
  );
}

const FILTERS = [['all', 'Hepsi'], ['comment', 'Yorumlar'], ['rating', 'Puanlar'], ['progress', 'İlerlemeler'], ['finished', 'Bitirilenler']];

function SectionHead({ eyebrow, title, sub, children }) {
  return (
    <div className="sh">
      <div className="sh-t">
        <span className="sh-eye"><Sparkles size={14} aria-hidden="true" /> {eyebrow}</span>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

// Gundem filtresi: gorunmez select'in ustunde sade bir dugme (klavye ve mobilde yerel liste acilir)
function FilterButton({ value, onChange }) {
  const cur = FILTERS.find(([k]) => k === value);
  return (
    <label className={'sh-filter' + (value !== 'all' ? ' on' : '')}>
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span className="sh-filter-t">{value === 'all' ? 'Filtrele' : cur[1]}</span>
      <select aria-label="Paylaşımları filtrele" value={value} onChange={(e) => onChange(e.target.value)}>
        {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

// Yan sutun: grup uyeleri, su an okunan kitap, davet
function FamilyCard({ info, gid, me, showLink }) {
  const [open, setOpen] = useState(false);
  const g = info?.group;
  const members = g?.members || [];
  return (
    <section className="card side-card">
      <button className="side-head" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!members.length}>
        <span className="side-ic"><Users size={18} aria-hidden="true" /></span>
        <b className="grow">Bizim grup</b>
        <ChevronDown size={18} aria-hidden="true" className={'side-chev' + (open ? ' open' : '')} />
      </button>
      <div className="side-stack">
        <span className="av-stack" aria-hidden="true">
          {members.slice(0, 5).map((m) => <Avatar key={m.id} user={m} size="sm" />)}
        </span>
        {g && <span className="small muted">{g.member_count} üye</span>}
      </div>
      {open && (
        <ul className="side-list">
          {members.map((m) => (
            <li key={m.id}>
              <Link to={m.id === me.id ? `/g/${gid}/rafim` : `/g/${gid}/uye/${m.id}`}>
                <Avatar user={m} size="xs" /> <span className="grow">{m.id === me.id ? 'Sen' : m.display_name}</span>
                {m.role === 'owner' && <span className="small muted">yönetici</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="side-foot">
        <span>Küçük bir sayfa, ortak bir hikâye.</span>
        {showLink && <Link to={`/g/${gid}`} className="side-link">Grup sayfası <ChevronRight size={14} aria-hidden="true" /></Link>}
      </div>
    </section>
  );
}

// "Su siralar" kartlari: gruptaki en son guncellenen okunan kitap, izlenen dizi ve izlenen film
const NOW = {
  reading: {
    title: 'Şu sıralar okunuyor', short: 'Okunuyor',
    detail: (it) => (it.total_pages ? `${it.current_page} sayfa okudu · %${Math.floor(it.percent ?? 0)} tamamladı` : 'okunuyor'),
    chip: (it) => (it.total_pages ? `%${Math.floor(it.percent ?? 0)}` : null),
    note: (u, mine) => (mine ? 'Sen şu an bu kitaptasın.' : `${u.display_name} şu an bu kitapta.`),
  },
  watching_series: {
    title: 'Şu sıralar izleniyor', short: 'İzleniyor',
    detail: (it) => (it.season ? `${it.season}. sezon ${it.episode}. bölümde` : 'izleniyor'),
    chip: (it) => (it.season ? `S${it.season} B${it.episode}` : null),
    note: (u, mine) => (mine ? 'Sen şu an bu diziyi izliyorsun.' : `${u.display_name} şu an bu diziyi izliyor.`),
  },
  watched_movie: {
    title: 'Son izlenen film', short: 'İzlendi',
    detail: (it) => [it.rating ? '⭐'.repeat(it.rating) : null, timeAgo(it.updated_at)].filter(Boolean).join(' · '),
    chip: () => null,
    note: (u, mine) => (mine ? 'Bu filmi sen izledin.' : `${u.display_name} bu filmi izledi.`),
  },
};
const NOW_KINDS = Object.keys(NOW);

function latestOfKind(cards, kind) {
  let best = null;
  for (const c of cards) for (const it of c.items) if (it.kind === kind && (!best || String(it.updated_at) > String(best.it.updated_at))) best = { it, user: c.user };
  return best;
}

// Telefonda yan sutun yerine en ustte kucuk bilgi seridi: uyeler + su siralar okunan / izlenenler
function MiniInfo({ info, gid, cards, onOpen }) {
  const g = info?.group;
  const nows = NOW_KINDS.map((k) => [k, latestOfKind(cards, k)]).filter(([, b]) => b);
  if (!g && !nows.length) return null;
  return (
    <div className="mini-info">
      {g && (
        <Link to={`/g/${gid}/bilgi`} className="mini-cell" aria-label={`${g.member_count} üye, üyeleri gör`}>
          <span className="av-stack" aria-hidden="true">
            {(g.members || []).slice(0, 4).map((m) => <Avatar key={m.id} user={m} size="xs" />)}
          </span>
          <span className="mini-t"><b>{g.member_count}</b> üye</span>
        </Link>
      )}
      {nows.map(([k, { it }]) => {
        const chip = NOW[k].chip(it);
        return (
          <button key={k} className="mini-cell mini-read" onClick={() => onOpen(it.entry_id)} aria-label={`${NOW[k].title}: ${it.catalog.title}, detayı aç`}>
            <i className={'live-dot' + (k === 'watched_movie' ? ' past' : '')} aria-hidden="true" />
            <span className="mini-t">
              <span className="mini-l">{NOW[k].short}</span> <b>{it.catalog.title}</b>
              {chip ? <span className="mini-l"> · {chip}</span> : null}
            </span>
            <ChevronRight size={16} aria-hidden="true" className="mini-go" />
          </button>
        );
      })}
    </div>
  );
}

function NowCard({ kind, cards, me, onOpen }) {
  const best = latestOfKind(cards, kind);
  if (!best) return null;
  const { it, user } = best;
  const cfg = NOW[kind];
  return (
    <section className="card side-card">
      <span className="side-eye"><i className={'live-dot' + (kind === 'watched_movie' ? ' past' : '')} aria-hidden="true" /> {cfg.title}</span>
      <button className="side-book" onClick={() => onOpen(it.entry_id)} aria-label={`${it.catalog.title}, detayı aç`}>
        <span className="pc-cov"><Cover src={it.catalog.cover_url} fallback={it.catalog.cover_fallback} title={it.catalog.title} /></span>
        <span className="pc-meta">
          <b className="pc-title">{it.catalog.title}</b>
          <span className="small muted">{cfg.detail(it)}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="muted" />
      </button>
      <p className="side-note"><Avatar user={user} size="xs" /> {cfg.note(user, user.id === me.id)}</p>
    </section>
  );
}

function InviteCard() {
  return (
    <Link to="/yonetim/link" className="side-card invite-card">
      <span className="invite-ic"><Plus size={18} aria-hidden="true" /></span>
      <b>Gruba birini ekle</b>
      <span className="small">Okuma keyfini sevdiklerinle paylaş.</span>
      <span className="invite-go">Davet linkini al <ChevronRight size={14} aria-hidden="true" /></span>
    </Link>
  );
}

export default function Home({ switchable }) {
  const { user: me } = useAuth();
  const gid = useGroup();
  const base = gid ? `/g/${gid}` : '/ben';
  const shelfTo = (c) => (gid ? (c.user.id === me.id ? `${base}/rafim` : `${base}/uye/${c.user.id}`) : '/ben');
  const feed = useAsync(() => api.feed(gid), [gid]);
  const pending = useAsync(() => api.pending(), []);
  const info = useAsync(() => (gid ? api.group(gid) : Promise.resolve(null)), [gid]);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showQ, setShowQ] = useState(false);
  const [story, setStory] = useState(null); // { id, edit }
  const [newStory, setNewStory] = useState(false);
  const [filter, setFilter] = useState('all');
  const [tab, setTabState] = useState(() => { try { return localStorage.getItem('home-tab') || 'gundem'; } catch { return 'gundem'; } });
  const setTab = (k) => { setTabState(k); try { localStorage.setItem('home-tab', k); } catch { /* onemsiz */ } };
  const showGundem = !!gid && tab === 'gundem';
  // profil degisince (avatar/renk/ad) feed'i tazele; o ana kadar kendi kartini guncel profille ciz
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    feed.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.avatar, me.color, me.display_name]);
  const cards = (feed.data?.cards || []).map((c) => (c.user.id === me.id ? { ...c, user: { ...c.user, avatar: me.avatar, color: me.color, display_name: me.display_name } } : c));
  const reload = () => {
    feed.reload();
    pending.reload();
  };
  // yonetici hesabinin kendi okumasi yoksa karti gizle
  const visible = cards.filter((c) => !((c.user.role === 'admin' || (c.user.id === me.id && me.role === 'admin')) && c.items.length === 0));
  const sorted = [...visible].sort((a, b) => (b.user.id === me.id) - (a.user.id === me.id));
  const group = gid ? (me.groups || []).find((g) => g.id === gid) || { id: gid, name: info.data?.group?.name || 'Grup' } : null;
  const isOwner = info.data?.group?.role === 'owner';

  const profiles = (
    <>
      {feed.loading && !feed.data && <div className="pgrid"><Skeleton h={150} n={2} /></div>}
      <ErrorBox error={feed.error} onRetry={feed.reload} />
      {feed.data && visible.length === 0 && (
        <Empty icon="👨‍👩‍👧" title="Henüz kimse yok">Yönetici aile üyelerini ekleyince burada görünecekler.</Empty>
      )}
      <div className="pgrid">
        {sorted.map((c) => (
          <MemberCard key={c.user.id} c={c} me={me} to={shelfTo(c)} onOpen={setOpenId} onStory={(id) => setStory({ id })} onNewStory={() => setNewStory(true)} />
        ))}
      </div>
    </>
  );

  return (
    <>
      <HomeHero group={group} count={info.data?.group?.member_count} switchable={switchable} onAdd={() => setAdding(true)} />

      {pending.data?.questions?.length > 0 && (
        <div className="card notice">
          <div className="row">
            <b className="grow">❓ Cevap bekleyen {pending.data.questions.length} sorun var</b>
            <button className="btn small ghost" onClick={() => setShowQ((v) => !v)} aria-expanded={showQ}>
              {showQ ? 'Gizle' : 'Cevapla'}
            </button>
          </div>
          {showQ &&
            pending.data.questions.map((q) => (
              <div key={q.id}>
                <div className="small muted" style={{ marginTop: 8 }}>“{q.entry?.catalog?.title}” hakkında:</div>
                <QA q={q} mine reload={reload} />
              </div>
            ))}
        </div>
      )}

      {!gid ? (
        profiles
      ) : (
        <>
          <MiniInfo info={info.data} gid={gid} cards={visible} onOpen={setOpenId} />
          <SegTabs
            className="hh-tabs"
            label="Ana sayfa bölümleri"
            idBase="home"
            tabs={[['gundem', '📰 Gündem'], ['profiller', '👥 Profiller']]}
            value={showGundem ? 'gundem' : 'profiller'}
            onChange={setTab}
          />
          <div className="home-layout">
            <div className="home-head">
              {showGundem ? (
                <SectionHead eyebrow="Son paylaşımlar" title="Grupta neler oluyor?" sub="Birbirinizin okuma ve izleme yolculuğuna göz atın.">
                  <FilterButton value={filter} onChange={setFilter} />
                </SectionHead>
              ) : (
                <SectionHead eyebrow="Profiller" title="Kim ne yapıyor?" sub="Herkesin devam eden en son 3 kaydı; tamamı için karta dokun." />
              )}
            </div>
            <div id="home-panel" role="tabpanel" aria-labelledby={`home-tab-${showGundem ? 'gundem' : 'profiller'}`} className="home-main">
              {showGundem ? <Gundem gid={gid} me={me} onOpen={setOpenId} filter={filter} /> : profiles}
            </div>
            <aside className="home-side" aria-label="Grup bilgisi">
              <FamilyCard info={info.data} gid={gid} me={me} showLink={!!switchable} />
              {NOW_KINDS.map((k) => <NowCard key={k} kind={k} cards={visible} me={me} onOpen={setOpenId} />)}
              {isOwner && <InviteCard />}
            </aside>
          </div>
          <footer className="home-foot">
            <span>Birlikte okunan her sayfa, ortak bir anı.</span>
            <Link to={`/g/${gid}/kitaplik`}><Search size={15} aria-hidden="true" /> Kitaplığımızı keşfet <ChevronRight size={14} aria-hidden="true" /></Link>
          </footer>
        </>
      )}

      {adding && <AddFlow onClose={() => setAdding(false)} onAdded={reload} />}
      {newStory && <NewStory onClose={() => setNewStory(false)} onCreated={(id) => { setNewStory(false); setStory({ id, edit: true }); reload(); }} />}
      {story && (
        <Suspense fallback={null}>
          <StoryReader id={story.id} startEditing={story.edit} onClose={() => setStory(null)} onChanged={reload} />
        </Suspense>
      )}
      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}
