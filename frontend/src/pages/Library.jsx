import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useGroup } from '../auth.js';
import { Avatar, Cover, Empty, Hint, PageHead, ErrorBox, Modal, Skeleton, timeAgo, useAsync } from '../ui.jsx';
import { RatingBadge, Reactions, genreLabel } from '../Rating.jsx';

const SORTS = { recent: 'En yeni', title: 'Ada göre', rating: 'Puana göre', readers: 'Okuyan sayısı' };

export default function Library() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState('recent');
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const gid = useGroup();
  const lib = useAsync(() => api.library({ q: dq, genre, sort, limit: 60, group: gid }), [dq, genre, sort, gid]);
  const items = lib.data?.items || [];
  const [added, setAdded] = useState([]); // bu oturumda listeme eklenenler
  const onAdded = (id) => setAdded((a) => [...a, id]);

  return (
    <>
      <PageHead title="Kitaplık" sub={gid ? 'Bu gruptaki üyelerin okuduğu ve izlediği her şey.' : 'Uygulamadaki tüm kitaplar, puanlar ve yorumlar.'} />
      <div className="row toolbar" style={{ justifyContent: 'stretch' }}>
        <input type="search" className="grow" placeholder="Kitap adı + yazar ara (örn. Gora Tagore)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Kitap ara" />
        <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Tür">
          <option value="">Tüm türler</option>
          <option value="kurgu">Kurgu</option>
          <option value="felsefe">Felsefe</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sıralama">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {lib.loading && !lib.data && <Skeleton h={110} n={3} />}
      <ErrorBox error={lib.error} onRetry={lib.reload} />
      {lib.data && items.length === 0 && (
        <Empty icon="📚" title={dq || genre ? 'Sonuç bulunamadı' : 'Kitaplık henüz boş'}>
          {dq || genre ? 'Aramayı değiştirmeyi dene.' : 'Biri bir kitaba başlayınca burada görünür.'}
        </Empty>
      )}
      <div className="lib-grid">
        {items.map((b) => (
          <div key={b.id}>
          <button className="lib-card" style={{ width: '100%' }} onClick={() => setOpenId(b.id)} aria-label={`Detay: ${b.title}`}>
            <Cover src={b.cover_url} fallback={b.cover_fallback} title={b.title} />
            <div className="grow" style={{ minWidth: 0 }}>
              <b style={{ wordBreak: 'break-word' }}>{b.title}</b>
              {b.author_or_creator && <div className="small muted">{b.author_or_creator}</div>}
              <div className="small" style={{ marginTop: 4 }}>
                👥{' '}
                {[b.reading_count > 0 && `${b.reading_count} okuyan`, b.finished_count > 0 && `${b.finished_count} bitirdi`].filter(Boolean).join(' · ') ||
                  `${b.readers_count ?? 0} kişi bıraktı`}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                {b.rating_count > 0 ? <RatingBadge average={b.rating_average} count={b.rating_count} /> : <span className="small muted">Puan yok</span>}
                {genreLabel(b.genre) && <span className="chip">{genreLabel(b.genre)}</span>}
              </div>
            </div>
          </button>
          </div>
        ))}
      </div>
      {lib.data && lib.data.total > items.length && <p className="small muted">İlk {items.length} kitap gösteriliyor ({lib.data.total} içinden). Aramayı daralt.</p>}
      {openId && <BookDetail id={openId} added={added.includes(openId)} onAdded={onAdded} onClose={() => setOpenId(null)} />}
    </>
  );
}

// Rafımda kaydı yoksa "Listeme ekle" (planlandı olarak); varsa hiçbir şey göstermez
function AddToList({ catalogId, mine, onAdded }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (mine) return null;
  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.createEntry({ catalog_id: catalogId, status: 'planlandi' });
      onAdded(catalogId);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 6 }}>
      <button className="btn small ghost" disabled={busy} onClick={add}>
        ➕ Listeme ekle
      </button>
      <ErrorBox error={err} />
    </div>
  );
}

const READ_LABEL ={ devam: 'okuyor', bitti: 'bitirdi', birakildi: 'bıraktı' };

function BookDetail({ id, added, onAdded, onClose }) {
  const gid = useGroup();
  const d = useAsync(() => api.libraryItem(id, gid), [id, gid]);
  const comments = useAsync(() => api.libraryComments(id, { limit: 100, group: gid }), [id, gid]);
  const questions = useAsync(() => api.libraryQuestions(id, { limit: 100, group: gid }), [id, gid]);
  const it = d.data?.item;
  const rating = d.data?.rating;
  const cl = comments.data?.comments || [];
  const ql = questions.data?.questions || [];
  return (
    <Modal title={it?.title || 'Kitap'} onClose={onClose}>
      {d.loading && !it && <Skeleton h={100} n={2} />}
      <ErrorBox error={d.error} onRetry={d.reload} />
      {it && (
        <>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <Cover src={it.cover_url} fallback={it.cover_fallback} title={it.title} large />
            <div className="grow">
              <div className="small muted">{it.author_or_creator}</div>
              <div className="row" style={{ gap: 6, margin: '6px 0' }}>
                {genreLabel(it.genre) && <span className="chip">{genreLabel(it.genre)}</span>}
                {it.rating_count > 0 ? <RatingBadge average={it.rating_average} count={it.rating_count} /> : <span className="small muted">Henüz puan yok</span>}
              </div>
              {rating?.by_metric && Object.keys(rating.by_metric).length > 0 && (
                <div className="small muted">
                  {(rating.metrics || []).map((m) => (rating.by_metric[m.key] != null ? `${m.name}: ${rating.by_metric[m.key]}` : null)).filter(Boolean).join(' · ')}
                </div>
              )}
              <AddToList catalogId={it.id} mine={!!it.my_status || added} onAdded={onAdded} />
            </div>
          </div>
          {d.data.readers?.length > 0 && (
            <div className="row" style={{ marginTop: 10, gap: 6 }}>
              {d.data.readers.map((r) => (
                <span key={r.entry_id} className="chip">
                  <Avatar user={r.user} size="xs" /> {r.user.display_name} · {READ_LABEL[r.status] || r.status}
                </span>
              ))}
            </div>
          )}

          <h3>💬 Yorumlar ({comments.data?.total ?? d.data.comment_count ?? 0})</h3>
          <ErrorBox error={comments.error} onRetry={comments.reload} />
          {!comments.loading && !comments.error && cl.length === 0 && <Hint>Henüz yorum yok.</Hint>}
          {cl.map((c) => (
            <div className="comment" key={c.id}>
              <div className="row">
                <Avatar user={c.user} size="sm" />
                <b>{c.user.display_name}</b>
                <span className="muted small">{timeAgo(c.created_at)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
              <Reactions comment={c} />
            </div>
          ))}

          <h3>❓ Sorular ({questions.data?.total ?? d.data.question_count ?? 0})</h3>
          <ErrorBox error={questions.error} onRetry={questions.reload} />
          {!questions.loading && !questions.error && ql.length === 0 && <Hint>Henüz soru yok.</Hint>}
          {ql.map((q) => (
            <div className="qa" key={q.id}>
              <div className="row">
                <Avatar user={q.asker} size="sm" />
                <b>{q.asker?.display_name}</b>
                <span className="muted small">{timeAgo(q.created_at)}</span>
                {q.entry?.user && <span className="muted small">→ {q.entry.user.display_name}</span>}
              </div>
              <div style={{ wordBreak: 'break-word' }}>{q.question}</div>
              {q.answer ? (
                <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '3px solid var(--accent)' }}>
                  <span className="small muted">{q.entry?.user?.display_name || 'Cevap'}:</span> {q.answer}
                </div>
              ) : (
                <div className="small muted">Henüz cevaplanmadı.</div>
              )}
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
