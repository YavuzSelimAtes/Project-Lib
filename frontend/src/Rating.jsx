import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox, Skeleton, useAsync } from './ui.jsx';
import { useAuth } from './auth.js';
import { GroupPicker, VisEditor, visBody } from './Visibility.jsx';

export const EMOJIS = ['❤️', '👍', '😂', '😮', '🔥'];
const SCALE = { 1: 'Çok kötü', 2: 'Kötü', 3: 'İdare eder', 4: 'İyi', 5: 'Çok iyi' };
const GENRE_LABEL = { kurgu: 'Kurgu', felsefe: 'Felsefe' };
export const genreLabel = (g) => GENRE_LABEL[g] || null;

const fmt = (n) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

// ⭐ 4,3 (5 kişi)
export function RatingBadge({ average, count }) {
  if (!count) return null;
  return (
    <span className="small" title={`${count} kişi puanladı`}>
      ⭐ <b>{fmt(average)}</b> <span className="muted">({count} kişi)</span>
    </span>
  );
}

// Yorum tepki cubugu
export function Reactions({ comment }) {
  const [st, setSt] = useState({ reactions: comment.reactions || {}, mine: comment.my_reaction || null });
  const [busy, setBusy] = useState(false);
  const click = async (emoji) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.react(comment.id, emoji);
      setSt({ reactions: r.reactions || {}, mine: r.my_reaction || null });
    } catch {
      /* sessizce yoksay */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="reactions" role="group" aria-label="Tepkiler">
      {EMOJIS.map((em) => {
        const n = st.reactions[em] || 0;
        return (
          <button key={em} type="button" className={'react' + (st.mine === em ? ' on' : '')} aria-pressed={st.mine === em} disabled={busy} onClick={() => click(em)}>
            {em}
            {n > 0 && <span className="small">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Tebrik butonu (baskasinin biten kaydi)
export function CongratsButton({ entryId, count = 0, sent = false }) {
  const [st, setSt] = useState({ count, sent });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async (ev) => {
    ev.stopPropagation();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.congrats(entryId);
      setSt({ count: r.congrats_count ?? st.count + 1, sent: true });
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ marginTop: 6, gap: 8 }}>
      {!st.sent && (
        <button className="btn small" disabled={busy} onClick={go}>
          🎉 Tebrikler
        </button>
      )}
      {st.count > 0 && <span className="small muted">🎉 {st.count}</span>}
      <ErrorBox error={err} />
    </div>
  );
}

// Kitap puanlama: tur secimi + metrikler. Ozet her zaman, form yalnizca can_rate ise.
export function RatingPanel({ catalogId, genre: initialGenre, onChanged }) {
  const { user } = useAuth();
  const [pick, setPick] = useState(null);
  const rt = useAsync(() => api.ratings(catalogId), [catalogId]);
  const metrics = useAsync(() => api.bookMetrics(), []);
  const [genre, setGenre] = useState(null);
  const [scores, setScores] = useState(null);
  const [cmts, setCmts] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const d = rt.data;
  if (rt.loading && !d) return <Skeleton h={50} />;
  if (rt.error) return rt.error.status === 403 ? null : <ErrorBox error={rt.error} onRetry={rt.reload} />;
  if (!d) return null;

  const lockedGenre = d.genre || initialGenre || null;
  const g = lockedGenre || genre;
  const genres = metrics.data?.genres || {};
  const list = (g && genres[g]?.metrics) || (g === d.genre ? d.metrics : null) || [];
  const cur = scores || d.mine?.scores || {};
  const curC = cmts || d.mine?.comments || {};
  const visGroups = (user.groups || []).filter((x) => (d.allowed_group_ids || []).includes(x.id)).map((x) => ({ id: x.id, name: x.name }));
  const selVis = pick ?? (d.mine ? (d.mine_group_ids || []) : visGroups.map((x) => x.id));
  const complete = list.length > 0 && list.every((m) => cur[m.key] >= 1);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setDone(false);
    try {
      await api.saveRatings(catalogId, g, Object.fromEntries(list.map((m) => [m.key, cur[m.key]])), visBody(visGroups, selVis), Object.fromEntries(list.map((m) => [m.key, curC[m.key] || ''])));
      setPick(null);
      setScores(null); setCmts(null);
      setOpen(false);
      setDone(true);
      rt.reload();
      onChanged?.();
    } catch (x) {
      if (x.status === 403) rt.reload();
      else setErr(x.status === 409 ? new Error('Bu kitaba puan verildiği için tür değiştirilemez.') : x);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm('Puanını silmek istiyor musun?')) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteRatings(catalogId);
      setScores(null); setCmts(null);
      rt.reload();
      onChanged?.();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ margin: '10px 0' }}>
      <div className="row">
        <b className="grow">⭐ Puanlar</b>
        {d.count > 0 ? <RatingBadge average={d.average} count={d.count} /> : <span className="small muted">Henüz puan yok</span>}
        {lockedGenre && <span className="chip">{genreLabel(lockedGenre)}</span>}
      </div>
      {d.mine && !open && (
        <div className="small" style={{ marginTop: 6 }}>
          Senin puanın: <b>{fmt(d.mine.average)}</b>
        </div>
      )}
      {d.count > 0 && !open && (d.by_user || []).length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Kim ne puan verdi?</summary>
          <div style={{ overflowX: 'auto' }}>
            <table className="small" style={{ borderCollapse: 'collapse', width: '100%', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '2px 6px' }}>Kişi</th>
                  {(d.metrics || []).map((m) => <th key={m.key} style={{ padding: '2px 6px' }} title={m.name}>{m.name}</th>)}
                  <th style={{ padding: '2px 6px' }}>Ort.</th>
                </tr>
              </thead>
              <tbody>
                {d.by_user.map((u) => (
                  <tr key={u.user.id}>
                    <td style={{ padding: '2px 6px' }}>{u.user.display_name}</td>
                    {(d.metrics || []).map((m) => <td key={m.key} style={{ textAlign: 'center', padding: '2px 6px' }}>{u.scores[m.key] ?? '–'}</td>)}
                    <td style={{ textAlign: 'center', padding: '2px 6px' }}><b>{fmt(u.average)}</b></td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--line, #ddd)' }}>
                  <td style={{ padding: '2px 6px' }}><b>Ortalama</b></td>
                  {(d.metrics || []).map((m) => <td key={m.key} style={{ textAlign: 'center', padding: '2px 6px' }}><b>{d.by_metric?.[m.key] != null ? fmt(d.by_metric[m.key]) : '–'}</b></td>)}
                  <td style={{ textAlign: 'center', padding: '2px 6px' }}><b>{fmt(d.average)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
          {d.by_user.some((u) => Object.keys(u.comments || {}).length > 0) && (
            <div style={{ marginTop: 8 }}>
              {d.by_user.flatMap((u) => Object.entries(u.comments || {}).map(([k, text]) => (
                <div key={u.user.id + k} className="small" style={{ marginBottom: 4 }}>
                  <b>{u.user.display_name}</b> · <span className="muted">{(d.metrics || []).find((m) => m.key === k)?.name || k}:</span> {text}
                </div>
              )))}
            </div>
          )}
        </details>
      )}
      {d.mine && !open && visGroups.length > 0 && (
        <VisEditor label="Puanımı görenler" groups={visGroups} ids={d.mine_group_ids || []} save={(b) => api.setRatingGroups(catalogId, b)} onSaved={rt.reload} />
      )}
      {d.can_rate && (
        <div style={{ marginTop: 8 }}>
          {!open ? (
            <div className="row">
              <button className="btn small" onClick={() => setOpen(true)}>
                {d.mine ? '✏️ Puanımı düzenle' : '⭐ Puan ver'}
              </button>
              {d.mine && (
                <button className="btn small ghost" disabled={busy} onClick={remove}>
                  Puanımı sil
                </button>
              )}
              {done && <span className="ok-note small">✅ Kaydedildi</span>}
            </div>
          ) : (
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>Kitabın türü</div>
              <div className="row" role="radiogroup" aria-label="Kitap türü">
                {Object.keys(GENRE_LABEL).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={g === k}
                    className={'btn small ' + (g === k ? '' : 'ghost')}
                    disabled={!!lockedGenre && lockedGenre !== k}
                    onClick={() => !lockedGenre && setGenre(k)}
                  >
                    {GENRE_LABEL[k]}
                  </button>
                ))}
              </div>
              {lockedGenre && <p className="small muted" style={{ margin: '4px 0 0' }}>Tür belirlenmiş; puan verildikten sonra değiştirilemez.</p>}
              {!g && <p className="small muted">Önce türü seç.</p>}
              {list.map((m) => (
                <div key={m.key} className="metric">
                  <b>{m.name}</b>
                  {m.description && <div className="small muted">{m.description}</div>}
                  <div className="scale" role="radiogroup" aria-label={m.name}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={cur[m.key] === n}
                        className={'scale-b' + (cur[m.key] === n ? ' on' : '')}
                        onClick={() => setScores({ ...cur, [m.key]: n })}
                      >
                        <b>{n}</b>
                        <span>{SCALE[n]}</span>
                      </button>
                    ))}
                  </div>
                  <input type="text" maxLength={500} value={curC[m.key] || ''} onChange={(ev) => setCmts({ ...curC, [m.key]: ev.target.value })} placeholder={`${m.name} için yorum (isteğe bağlı)`} aria-label={`${m.name} yorumu`} style={{ width: '100%', marginTop: 6 }} />
                </div>
              ))}
              {!d.mine && visGroups.length > 1 && (
                <div style={{ marginTop: 8 }}>
                  <span className="small muted">Puanı görecek gruplar:</span>
                  <GroupPicker groups={visGroups} value={selVis} onChange={setPick} />
                </div>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small" disabled={busy || !complete} onClick={save}>
                  Kaydet
                </button>
                <button
                  className="btn small ghost"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setScores(null); setCmts(null);
                    setErr(null);
                  }}
                >
                  Vazgeç
                </button>
                {!complete && g && <span className="small muted">Tüm başlıkları puanla.</span>}
              </div>
            </div>
          )}
          <ErrorBox error={err} />
        </div>
      )}
    </div>
  );
}
