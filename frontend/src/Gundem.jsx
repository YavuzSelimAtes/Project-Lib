import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Avatar, Cover, Empty, ErrorBox, Skeleton, timeAgo } from './ui.jsx';

const when = (iso) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Paylasim metni birinci agizdan: kisi kendisi paylasmis gibi
function say(p) {
  const d = p.data || {};
  switch (p.kind) {
    case 'read': return <><b className="gd-big">{d.last} sayfa</b> {d.times > 1 ? 'daha ' : ''}okudum 📖</>;
    case 'watch': return <><b className="gd-big">{d.last} bölüm</b> {d.times > 1 ? 'daha ' : ''}izledim 📺</>;
    case 'started': return p.catalog?.type === 'series' ? <>Yeni bir diziye başladım 📺</> : <>Yeni bir kitaba başladım 📖</>;
    case 'finished': return p.catalog?.type === 'movie' ? <>Bu filmi izledim 🎬</> : p.catalog?.type === 'series' ? <>Bu diziyi bitirdim 🎉</> : <>Bu kitabı bitirdim 🎉</>;
    case 'rating': return <>Bu kitaba <b className="gd-big">{p.rating?.average ?? '–'}</b> puan verdim <span className="gd-stars">{'★'.repeat(Math.round(p.rating?.average || 0))}</span></>;
    default: return null;
  }
}

const HeartIc = ({ on }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
);
const CommentIc = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>
);

function Thread({ post, onCount }) {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = () => api.postComments(post.id).then((r) => { setList(r.comments); onCount(r.comments.length); }, setErr);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { await api.addPostComment(post.id, text.trim()); setText(''); await load(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const del = async (c) => { try { await api.deletePostComment(post.id, c.id); await load(); } catch (x) { setErr(x); } };
  return (
    <div className="gd-thread">
      {(list || []).map((c) => (
        <div key={c.id} className="gd-c">
          <Avatar user={c.user} size="xs" />
          <div className="grow" style={{ minWidth: 0 }}>
            <b>{c.user.display_name}</b> <span className="small muted">{timeAgo(c.created_at)}</span>
            {c.can_delete && <button className="sc-link" style={{ marginLeft: 8 }} onClick={() => del(c)}>Sil</button>}
            <div style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
        </div>
      ))}
      <ErrorBox error={err} />
      <form className="row" style={{ gap: 6 }} onSubmit={send}>
        <input className="grow" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Yorum yaz…" aria-label="Yorum" />
        <button className="btn small" disabled={busy || !text.trim()}>Gönder</button>
      </form>
    </div>
  );
}

// Uzun metin: ilk satirlar, 'Devamini oku' ile acilir
function LongText({ text }) {
  const [more, setMore] = useState(false);
  const long = text.length > 240 || text.split('\n').length > 5;
  return (
    <div>
      <p className={'gd-text' + (long && !more ? ' clamp' : '')}>{text}</p>
      {long && <button className="gd-more" onClick={() => setMore((v) => !v)}>{more ? 'Daha az göster' : 'Devamını oku'}</button>}
    </div>
  );
}

function Post({ p, me, onOpen }) {
  const [liked, setLiked] = useState(p.i_liked);
  const [likes, setLikes] = useState(p.like_count);
  const [open, setOpen] = useState(false);
  const [cc, setCc] = useState(p.comment_count);
  const like = async () => {
    const was = liked;
    setLiked(!was); setLikes((n) => n + (was ? -1 : 1));
    try { const r = await (was ? api.unlikePost(p.id) : api.likePost(p.id)); setLikes(r.like_count); setLiked(r.i_liked); }
    catch { setLiked(was); setLikes((n) => n + (was ? 1 : -1)); }
  };
  const d = p.data || {};
  const pct = p.entry?.type === 'book' && p.entry.total_pages > 0 && p.kind === 'read' ? Math.min(100, Math.round((p.entry.current_page / p.entry.total_pages) * 100)) : null;
  const sub = [p.catalog?.author, p.entry?.type === 'series' && p.entry.season != null && p.kind !== 'finished' ? 'S' + p.entry.season + ' B' + p.entry.episode : null].filter(Boolean).join(' · ');
  const total = (p.kind === 'read' || p.kind === 'watch') && d.total > d.last ? 'Bugün toplam ' + d.total + (p.kind === 'read' ? ' sayfa' : ' bölüm') : null;
  return (
    <article className="gd-post">
      <header className="gd-head">
        <Avatar user={p.user} />
        <div className="gd-who">
          <b>{p.user.display_name}</b>{p.user.id === me.id && <span className="gd-me">Sen</span>}
        </div>
        <time className="gd-time" dateTime={p.at} title={when(p.at)}>{timeAgo(p.at)}</time>
      </header>
      {p.kind === 'comment' && p.comment && <LongText text={p.comment.body} />}
      {p.kind !== 'comment' && <p className="gd-text">{say(p)}</p>}
      {p.kind === 'rating' && p.rating?.comments?.length > 0 && (
        <div className="gd-quote">{p.rating.comments.map((c) => <div key={c.metric}>“{c.text}”</div>)}</div>
      )}
      {p.catalog && (
        <button className="gd-book" onClick={() => p.entry_id && onOpen(p.entry_id)} disabled={!p.entry_id} aria-label={p.catalog.title}>
          <span className="gd-cov"><Cover src={p.catalog.cover_url} title={p.catalog.title} /></span>
          <span className="gd-bm">
            <b className="gd-bt">{p.catalog.title}</b>
            {sub && <span className="gd-bs">{sub}</span>}
            {total && <span className="gd-bs">{total}</span>}
            {pct != null && <span className="gd-bar" aria-label={'%' + pct}><i style={{ width: pct + '%' }} /></span>}
          </span>
          <span className="gd-go" aria-hidden="true">›</span>
        </button>
      )}
      <footer className="gd-foot">
        <button className={'gd-btn like' + (liked ? ' on' : '')} onClick={like} aria-pressed={liked} aria-label="Beğen"><HeartIc on={liked} /><span>{likes > 0 ? likes : ''}</span></button>
        <button className={'gd-btn' + (open ? ' on' : '')} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Yorumlar"><CommentIc /><span>{cc > 0 ? cc : ''}</span></button>
        <span className="gd-exact">{when(p.at)}</span>
      </footer>
      {open && <Thread post={p} onCount={setCc} />}
    </article>
  );
}

// Gundem: grup uyelerinin son hareketleri, en yeni en ustte (twitter/instagram gibi)
export default function Gundem({ gid, me, onOpen }) {
  const [posts, setPosts] = useState(null);
  const [next, setNext] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = (reset) => {
    setBusy(true);
    api.gundem(gid, reset ? undefined : next).then((r) => { setPosts((cur) => (reset ? r.posts : [...(cur || []), ...r.posts])); setNext(r.next); setErr(null); }, setErr).finally(() => setBusy(false));
  };
  useEffect(() => { setPosts(null); load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gid]);
  useEffect(() => { const t = setInterval(() => !document.hidden && load(true), 60000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gid]);
  return (
    <div className="gd">
      {posts == null && !err && <Skeleton h={120} n={3} />}
      <ErrorBox error={err} onRetry={() => load(true)} />
      {posts && posts.length === 0 && <Empty icon="📰" title="Gündem henüz boş">Biri okuyunca, izleyince ya da yorum yazınca burada görünür.</Empty>}
      {(posts || []).map((p) => <Post key={p.id + '-' + p.at} p={p} me={me} onOpen={onOpen} />)}
      {next && <button className="btn ghost" disabled={busy} onClick={() => load(false)}>Daha fazla göster</button>}
    </div>
  );
}
