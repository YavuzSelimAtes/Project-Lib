import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.js';
import { Avatar, Cover, ErrorBox, Modal, Progress, Skeleton, TYPE_LABEL, fmtDate, timeAgo, useAsync } from './ui.jsx';
import QuickUpdate from './QuickUpdate.jsx';

const STATUS = { devam: 'Devam ediyor', bitti: 'Bitti', birakildi: 'Bırakıldı', planlandi: 'Planlandı' };

export default function EntryDetail({ entryId, onClose, onChanged }) {
  const { user: me } = useAuth();
  const detail = useAsync(() => api.entry(entryId), [entryId]);
  const comments = useAsync(() => api.comments(entryId), [entryId]);
  const questions = useAsync(() => api.questions(entryId), [entryId]);
  const [version, setVersion] = useState(0);

  const e = detail.data?.entry;
  const mine = e && e.user_id === me.id;
  const cat = e?.catalog;

  const changed = useCallback(() => {
    detail.reload();
    onChanged?.();
    setVersion((v) => v + 1);
  }, [detail, onChanged]);

  return (
    <Modal title={cat?.title || 'Detay'} onClose={onClose}>
      {detail.loading && !e && <Skeleton h={100} n={2} />}
      <ErrorBox error={detail.error} onRetry={detail.reload} />
      {e && (
        <>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <Cover src={cat.cover_url} title={cat.title} large />
            <div className="grow">
              <div className="small muted">
                {TYPE_LABEL[e.type]} {cat.author_or_creator && `· ${cat.author_or_creator}`} {cat.year && `· ${cat.year}`}
              </div>
              <div className="row" style={{ margin: '6px 0' }}>
                <Avatar user={e.user} size="sm" />
                <b>{mine ? 'Sen' : e.user.display_name}</b>
                <span className="chip">{STATUS[e.status]}</span>
              </div>
              {e.type === 'book' && e.total_pages ? (
                <>
                  <div className="small">
                    {e.current_page}/{e.total_pages} sayfa · %{Math.floor(e.percent ?? 0)}
                  </div>
                  <Progress value={e.percent} color={e.user.color} />
                  {e.avg_source === 'no_dates' && (
                    <div className="small muted" style={{ marginTop: 4 }}>Tarih bilgisi yok; günlük ortalamaya katılmaz.</div>
                  )}
                  {e.avg_pages_per_day != null && (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      Günlük ortalama ~{e.avg_pages_per_day.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sayfa
                      {e.avg_source === 'estimated' ? ' (tahmini)' : ''}
                    </div>
                  )}
                </>
              ) : null}
              {e.type === 'series' && e.season && (
                <div className="small">
                  S{e.season} B{e.episode}
                </div>
              )}
              <div className="small muted">
                {e.start_date && `Başlangıç: ${fmtDate(e.start_date)}`} {e.end_date && ` · Bitiş: ${fmtDate(e.end_date)}`}
              </div>
              {mine && e.status !== 'bitti' && (e.type === 'book' || e.type === 'series') && (
                <QuickUpdate
                  key={e.updated_at}
                  entry={e}
                  onSaved={() => changed()}
                />
              )}
              {!mine && e.type !== 'movie' && <WishButton catalogId={cat.id} />}
              {mine && <OwnerActions e={e} onChanged={changed} onClose={onClose} />}
            </div>
          </div>
          {cat.description && (
            <p className="small muted" style={{ maxHeight: 90, overflow: 'auto' }}>
              {cat.description}
            </p>
          )}

          <Others catalogId={cat.id} selfEntryId={e.id} onOpen={onClose} />

          <h3>❓ Sorular</h3>
          <Questions key={'q' + version} state={questions} entryId={entryId} mine={mine} />
          <h3>💬 Yorumlar</h3>
          <Comments state={comments} entryId={entryId} />
        </>
      )}
    </Modal>
  );
}

// "Listeme al": kendi planlandi listeme ekler
function WishButton({ catalogId }) {
  const [state, setState] = useState({ busy: false, done: false, error: null });
  const add = async () => {
    setState({ busy: true, done: false, error: null });
    try {
      await api.createEntry({ catalog_id: catalogId, status: 'planlandi' });
      setState({ busy: false, done: true, error: null });
    } catch (x) {
      setState({ busy: false, done: false, error: x });
    }
  };
  return (
    <div style={{ marginTop: 8 }}>
      {state.done ? (
        <span className="ok-note small">✅ Listene eklendi (Rafım’da “Planlandı”)</span>
      ) : (
        <button className="btn small ghost" disabled={state.busy} onClick={add}>
          ➕ Listeme al
        </button>
      )}
      <ErrorBox error={state.error} />
    </div>
  );
}

// ayni eseri okuyan / izleyen diger aile uyeleri
function Others({ catalogId, selfEntryId, onOpen }) {
  const { data } = useAsync(() => api.catalogItem(catalogId), [catalogId]);
  const list = (data?.entries || []).filter((x) => x.id !== selfEntryId);
  if (!list.length) return null;
  const label = { devam: 'devam ediyor', bitti: 'bitirdi', birakildi: 'bıraktı', planlandi: 'listesine ekledi' };
  return (
    <div style={{ margin: '10px 0' }}>
      <b className="small">Ailede bunu da:</b>
      <div className="row" style={{ marginTop: 4 }}>
        {list.map((x) => (
          <Link key={x.id} to={`/uye/${x.user.id}`} onClick={onOpen} className="chip" style={{ textDecoration: 'none' }}>
            {x.user.avatar} {x.user.display_name} · {label[x.status]}
            {x.rating ? ` ${'⭐'.repeat(x.rating)}` : ''}
          </Link>
        ))}
      </div>
    </div>
  );
}

function OwnerActions({ e, onChanged, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const act = async (fn) => {
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
  return (
    <div style={{ marginTop: 10 }}>
      <div className="row">
        {e.status !== 'bitti' && (
          <button className="btn small ghost" disabled={busy} onClick={async () => (await act(() => api.updateEntry(e.id, { status: 'bitti' }))) && onChanged()}>
            ✅ Bitti işaretle
          </button>
        )}
        {e.status === 'devam' && (
          <button className="btn small ghost" disabled={busy} onClick={async () => (await act(() => api.updateEntry(e.id, { status: 'birakildi' }))) && onChanged()}>
            Bıraktım
          </button>
        )}
        {(e.status === 'bitti' || e.status === 'birakildi') && (
          <button className="btn small ghost" disabled={busy} onClick={async () => (await act(() => api.updateEntry(e.id, { status: 'devam' }))) && onChanged()}>
            Devam et
          </button>
        )}
        <button
          className="btn small danger"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm('Bu kaydı silmek istediğine emin misin? Yorumlar ve sorular da silinir.')) return;
            if (await act(() => api.deleteEntry(e.id))) {
              onChanged();
              onClose();
            }
          }}
        >
          Sil
        </button>
      </div>
      <ErrorBox error={err} />
    </div>
  );
}

function Comments({ state, entryId }) {
  const { user: me } = useAuth();
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = state.data?.comments || [];
  const send = async (ev) => {
    ev.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.addComment(entryId, text.trim());
      setText('');
      state.reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <ErrorBox error={state.error} onRetry={state.reload} />
      {!state.loading && !state.error && list.length === 0 && <p className="muted small">Henüz yorum yok. İlk yorumu sen yaz!</p>}
      {list.map((c) => (
        <div className="comment" key={c.id}>
          <div className="row">
            <Avatar user={c.user} size="sm" />
            <b>{c.user.display_name}</b>
            <span className="muted small">{timeAgo(c.created_at)}</span>
            <span className="spacer" />
            {(c.user_id === me.id || me.role === 'admin') && (
              <button
                className="btn small ghost"
                aria-label="Yorumu sil"
                onClick={async () => {
                  try {
                    await api.deleteComment(c.id);
                    state.reload();
                  } catch (x) {
                    setErr(x);
                  }
                }}
              >
                🗑
              </button>
            )}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
        </div>
      ))}
      <form onSubmit={send} className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
        <input type="text" className="grow" placeholder="Bir yorum yaz…" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Yorum" />
        <button className="btn small" disabled={busy || !text.trim()}>
          Gönder
        </button>
      </form>
      <ErrorBox error={err} />
    </div>
  );
}

function Questions({ state, entryId, mine }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = state.data?.questions || [];
  const ask = async (ev) => {
    ev.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.ask(entryId, text.trim());
      setText('');
      state.reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <ErrorBox error={state.error} onRetry={state.reload} />
      {!state.loading && !state.error && list.length === 0 && (
        <p className="muted small">{mine ? 'Henüz soru gelmedi.' : 'Merak ettiğin bir şey var mı? Aşağıdan sor.'}</p>
      )}
      {list.map((q) => (
        <QA key={q.id} q={q} mine={mine} reload={state.reload} />
      ))}
      {!mine && (
        <form onSubmit={ask} className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
          <input type="text" className="grow" placeholder="Bu konuda bir soru sor…" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Soru" />
          <button className="btn small" disabled={busy || !text.trim()}>
            Sor
          </button>
        </form>
      )}
      <ErrorBox error={err} />
    </div>
  );
}

export function QA({ q, mine, reload }) {
  const [ans, setAns] = useState(q.answer || '');
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (ev) => {
    ev.preventDefault();
    if (!ans.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.answer(q.id, ans.trim());
      setEditing(false);
      reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="qa">
      <div className="row">
        <Avatar user={q.asker} size="sm" />
        <b>{q.asker?.display_name}</b>
        <span className="muted small">{timeAgo(q.created_at)}</span>
      </div>
      <div style={{ wordBreak: 'break-word' }}>{q.question}</div>
      {q.answer && !editing && (
        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '3px solid var(--accent)' }}>
          <span className="small muted">Cevap:</span> {q.answer}{' '}
          {mine && (
            <button className="btn small ghost" onClick={() => setEditing(true)}>
              Düzenle
            </button>
          )}
        </div>
      )}
      {mine && (!q.answer || editing) && (
        <form onSubmit={save} className="row" style={{ marginTop: 6, flexWrap: 'nowrap' }}>
          <input type="text" className="grow" placeholder="Cevabını yaz…" value={ans} maxLength={2000} onChange={(e) => setAns(e.target.value)} aria-label="Cevap" />
          <button className="btn small" disabled={busy || !ans.trim()}>
            Cevapla
          </button>
        </form>
      )}
      {!q.answer && !mine && <div className="small muted">Henüz cevaplanmadı.</div>}
      <ErrorBox error={err} />
    </div>
  );
}

