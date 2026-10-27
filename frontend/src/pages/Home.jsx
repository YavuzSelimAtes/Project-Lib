import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Avatar, Cover, Empty, ErrorBox, Progress, Skeleton, timeAgo, useAsync } from '../ui.jsx';
import { CongratsButton } from '../Rating.jsx';
import EntryDetail from '../EntryDetail.jsx';
import AddFlow from '../AddFlow.jsx';
import { QA } from '../EntryDetail.jsx';

function describe(it) {
  const n = it.catalog.title;
  switch (it.kind) {
    case 'reading':
      return `“${n}” kitabını okuyor`;
    case 'watching_series':
      return `“${n}” dizisini izliyor`;
    case 'finished_book':
      return `“${n}” kitabını bitirdi 🎉`;
    case 'finished_series':
      return `“${n}” dizisini bitirdi 🎉`;
    case 'watched_movie':
      return `“${n}” filmini izledi`;
    default:
      return n;
  }
}

function FeedItem({ it, color, onOpen }) {
  const book = it.catalog.type === 'book';
  return (
    <div>
      <button className="item" onClick={() => onOpen(it.entry_id)} aria-label={`Detay: ${it.catalog.title}`}>
        <Cover src={it.catalog.cover_url} fallback={it.catalog.cover_fallback} title={it.catalog.title} />
        <div className="meta">
          <div className="t">{describe(it)}</div>
          <div className="line">
            {[
              book && it.total_pages ? `${it.current_page}/${it.total_pages} sayfa · %${Math.floor(it.percent ?? 0)}` : null,
              it.kind === 'watching_series' && it.season ? `S${it.season} B${it.episode}` : null,
              it.kind === 'watched_movie' && it.rating ? '⭐'.repeat(it.rating) : null,
              book && it.pages_today > 0 ? `bugün +${it.pages_today}` : null,
              timeAgo(it.updated_at),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {book && it.total_pages ? <Progress value={it.percent} color={color} /> : null}
        </div>
      </button>
      {!mine && it.status === 'bitti' && <div style={{ paddingLeft: 6 }}><CongratsButton entryId={it.entry_id} count={it.congrats_count || 0} sent={!!it.i_congratulated} /></div>}
    </div>
  );
}

export default function Home() {
  const { user: me } = useAuth();
  const feed = useAsync(() => api.feed(), []);
  const pending = useAsync(() => api.pending(), []);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showQ, setShowQ] = useState(false);
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
  const allEmpty = visible.length > 0 && visible.every((c) => c.items.length === 0);

  return (
    <>
      <h1>Son güncellemeler</h1>
      <p className="sub">Ailede kim ne okuyor, ne izliyor.</p>

      {pending.data?.questions?.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div className="row">
            <b className="grow">❓ Cevap bekleyen {pending.data.questions.length} sorun var</b>
            <button className="btn small" onClick={() => setShowQ((v) => !v)}>
              {showQ ? 'Gizle' : 'Cevapla'}
            </button>
          </div>
          {showQ &&
            pending.data.questions.map((q) => (
              <div key={q.id}>
                <div className="small muted" style={{ marginTop: 8 }}>
                  “{q.entry?.catalog?.title}” hakkında:
                </div>
                <QA q={q} mine reload={reload} />
              </div>
            ))}
        </div>
      )}

      {feed.loading && !feed.data && (
        <div className="grid">
          <Skeleton h={190} n={3} />
        </div>
      )}
      <ErrorBox error={feed.error} onRetry={feed.reload} />

      {feed.data && visible.length === 0 && (
        <Empty icon="👨‍👩‍👧" title="Henüz kimse yok">
          Yönetici aile üyelerini ekleyince burada görünecekler.
        </Empty>
      )}
      {allEmpty && (
        <Empty icon="📚" title="Raflar henüz boş">
          İlk kitabı, filmi ya da diziyi sen ekle!
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setAdding(true)}>
              + Yeni ekle
            </button>
          </div>
        </Empty>
      )}

      <div className="grid">
        {sorted.map((c) => (
          <section key={c.user.id} className="card ucard" style={{ '--c': c.user.color }} aria-label={c.user.display_name}>
            <Link to={c.user.id === me.id ? '/rafim' : `/uye/${c.user.id}`} className="ucard-head" style={{ textDecoration: 'none' }} title="Rafına bak">
              <Avatar user={c.user} />
              <div className="grow">
                <b>{c.user.id === me.id ? 'Sen' : c.user.display_name}</b>
                {c.current_streak >= 2 && (
                  <span className="small" title={`${c.current_streak} gündür her gün okuyor`} style={{ marginLeft: 6 }}>
                    🔥{c.current_streak}
                  </span>
                )}
                {c.last_activity && <div className="small muted">{timeAgo(c.last_activity)} güncelledi</div>}
              </div>
              <span className="muted" aria-hidden="true">›</span>
            </Link>
            {c.items.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {c.user.id === me.id ? 'Şu an bir şey okumuyorsun. Başlamak için + Yeni ekle.' : 'Şu an bir şey okumuyor / izlemiyor.'}
              </p>
            )}
            {c.items.map((it) => (
              <FeedItem key={it.entry_id} it={it} color={c.user.color} onOpen={setOpenId} />
            ))}
            {c.more_count > 0 && (
              <Link className="btn small ghost" style={{ textAlign: 'center', textDecoration: 'none' }} to={c.user.id === me.id ? '/rafim' : `/uye/${c.user.id}`}>
                {c.more_count} tane daha
              </Link>
            )}
          </section>
        ))}
      </div>

      <button className="fab" onClick={() => setAdding(true)} aria-label="Yeni ekle">
        + Yeni ekle
      </button>
      {adding && <AddFlow onClose={() => setAdding(false)} onAdded={reload} />}
      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}
