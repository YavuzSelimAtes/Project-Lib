import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import StoryComments from './StoryComments.jsx';
import { ErrorBox, Skeleton, useAsync } from './ui.jsx';
import { STORY_COLORS } from './StoryCard.jsx';

// ---- sayfalama: bolum metni, sayfa kutusuna sigdigi kadar parcalanir (olcerek) ----
const TOK = /\n+|[^\s]+/g;
const tokenize = (body) => [...body.matchAll(TOK)].map((m) => ({ t: m[0][0] === '\n' ? null : m[0], i: m.index }));
function parasOf(toks, a, b) {
  const mid = a > 0 && toks[a - 1].t !== null; // sayfa paragrafin ortasindan basliyorsa girinti yok
  const paras = [];
  let cur = null;
  for (let k = a; k < b; k++) {
    if (toks[k].t === null) { cur = null; continue; }
    if (!cur) { cur = { words: [], cont: paras.length === 0 && mid }; paras.push(cur); }
    cur.words.push(toks[k].t);
  }
  return paras.map((p) => ({ text: p.words.join(' '), cont: p.cont }));
}
function fill(el, paras, head) {
  el.textContent = '';
  if (head) {
    const h = document.createElement('h3');
    h.className = 'pg-title';
    h.textContent = head;
    el.appendChild(h);
  }
  for (const p of paras) {
    const e = document.createElement('p');
    if (p.cont) e.className = 'cont';
    e.textContent = p.text;
    el.appendChild(e);
  }
}
function paginate(chapters, el) {
  const pages = [];
  chapters.forEach((ch, ci) => {
    const toks = tokenize(ch.body);
    const n = toks.length;
    const head = `${ch.n}. ${ch.title}`;
    let a = 0;
    let first = true;
    while (a < n) {
      while (a < n && toks[a].t === null) a++;
      if (a >= n) break;
      const fits = (b) => {
        fill(el, parasOf(toks, a, b), first ? head : null);
        return el.scrollHeight <= el.clientHeight + 1;
      };
      let good = a + 1;
      let bad = null;
      let probe = Math.min(n, a + 80);
      for (;;) {
        if (fits(probe)) {
          good = probe;
          if (probe === n) break;
          probe = Math.min(n, probe + Math.max(40, probe - a));
        } else { bad = probe; break; }
      }
      if (bad !== null) {
        let l = good;
        let h = bad;
        while (h - l > 1) {
          const m = (l + h) >> 1;
          if (fits(m)) l = m; else h = m;
        }
        good = l;
      }
      pages.push({ ci, chapterId: ch.id, start: toks[a].i, head: first ? head : null, paras: parasOf(toks, a, good) });
      a = good;
      first = false;
    }
  });
  return pages;
}

function PageFace({ page, no, total, side = 'r' }) {
  const cls = side === 'l' ? 'pg l' : 'pg';
  if (!page) return <div className={cls} />;
  return (
    <div className={cls}>
      <div className="pg-in">
        {page.head && <h3 className="pg-title">{page.head}</h3>}
        {page.paras.map((p, i) => <p key={i} className={p.cont ? 'cont' : undefined}>{p.text}</p>)}
      </div>
      <div className="pg-no">{no} / {total}</div>
    </div>
  );
}

const getFs = () => {
  try { return Number(localStorage.getItem('story_fs')) || 17; } catch { return 17; }
};

// Genis ekran: acik kitap (iki yaprak, sol + sag). Dar ekran: tek yaprak, solda ince bos bir yaprak.
const SPREAD_Q = '(min-width: 900px)';
function useSpread() {
  const [s, setS] = useState(() => window.matchMedia(SPREAD_Q).matches);
  useEffect(() => {
    const m = window.matchMedia(SPREAD_Q);
    const f = () => setS(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return s;
}

// 3B kitap: kapagi acilir, sayfalar cevrilir. Yazarsa duzenleme ekranina da gecer.
// idx = sag yapragin sayfa numarasi (iki yaprakli modda hep cift: 0 = sol bos / sag ilk sayfa)
// Bolum cubugu: okuyan sayisi (kucuk), okudum isareti ve bolum puani
function ChapterBar({ storyId, chapter, mine }) {
  const [st, setSt] = useState(null);
  useEffect(() => { setSt(null); }, [chapter?.id]);
  if (!chapter) return null;
  const v = { read_count: chapter.read_count, my_read: chapter.my_read, rating_avg: chapter.rating_avg, rating_count: chapter.rating_count, my_rating: chapter.my_rating, ...(st || {}) };
  const act = async (fn) => { try { setSt(await fn()); } catch { /* onemsiz */ } };
  return (
    <div className="sr-chbar">
      <span className="sr-chn">{chapter.n}. {chapter.title}</span>
      <span title="Bu bölümü okuyan kişi sayısı">👁 {v.read_count}</span>
      {!mine && (
        <>
          <button className={'sr-chb' + (v.my_read ? ' on' : '')} onClick={() => act(() => api.chapterRead(storyId, chapter.id, !v.my_read))}>{v.my_read ? '✔ Okudum' : 'Okudum'}</button>
          <span className="sr-stars" role="group" aria-label="Bölüm puanı">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= (v.my_rating || 0) ? 'on' : ''} aria-label={n + ' yıldız'} onClick={() => act(() => api.chapterRating(storyId, chapter.id, v.my_rating === n ? null : n))}>★</button>
            ))}
          </span>
        </>
      )}
      {v.rating_count > 0 && <span title="Bölüm puan ortalaması">⭐ {v.rating_avg} ({v.rating_count})</span>}
    </div>
  );
}

export default function StoryReader({ id, startEditing, onClose, onChanged }) {
  const d = useAsync(() => api.story(id), [id]);
  const spread = useSpread();
  const [phase, setPhase] = useState('closed'); // closed | open
  const [editing, setEditing] = useState(!!startEditing);
  const [pages, setPages] = useState([]);
  const [idx, setIdx] = useState(0);
  const [turn, setTurn] = useState(null); // { dir: 'next'|'prev', to }
  const [toc, setToc] = useState(false);
  const [cmt, setCmt] = useState(false);
  const [fs, setFs] = useState(getFs);
  const measure = useRef(null);
  const resumed = useRef(false);
  const idxRef = useRef(0);
  idxRef.current = idx;
  const story = d.data?.story;
  const chapters = d.data?.chapters;

  // sayfalama: veri / yazi boyutu / ekran boyutu degisince; bulunulan yer karakter konumuyla korunur
  const repaginate = useCallback(() => {
    if (!measure.current || !chapters) return;
    const keep = pages[idxRef.current];
    const next = paginate(chapters, measure.current);
    setPages(next);
    let at = 0;
    if (keep) {
      at = next.findIndex((p) => p.chapterId === keep.chapterId && p.start >= keep.start);
      if (at < 0) at = next.length - 1;
      else if (next[at].start > keep.start && at > 0 && next[at - 1].chapterId === keep.chapterId) at -= 1;
    } else if (!resumed.current && d.data?.progress) {
      const pr = d.data.progress;
      const inCh = next.map((p, i) => [p, i]).filter(([p]) => p.chapterId === pr.chapter_id);
      const hit = [...inCh].reverse().find(([p]) => p.start <= pr.pos) || inCh[0];
      if (hit) at = hit[1];
    }
    resumed.current = true;
    at = Math.max(0, at);
    setIdx(spread ? at - (at % 2) : at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, fs, d.data?.progress, spread]);
  useLayoutEffect(() => {
    if (editing) return undefined;
    repaginate();
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(repaginate, 250); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, [repaginate, editing]);

  // okuma yerini kaydet
  useEffect(() => {
    const p = pages[spread && idx > 0 ? idx - 1 : idx]; // iki yaprakli modda soldaki sayfa
    if (phase !== 'open' || !p || !story) return undefined;
    const t = setTimeout(() => { api.storyProgress(story.id, { chapter_id: p.chapterId, pos: p.start }).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [idx, phase, pages, story, spread]);

  const go = useCallback((dir) => {
    if (turn) return;
    const to = idx + (dir === 'next' ? 1 : -1) * (spread ? 2 : 1);
    if (dir === 'next' ? idx + 1 >= pages.length : to < 0) return;
    setTurn({ dir, to });
    setToc(false);
  }, [turn, idx, pages.length, spread]);
  const endTurn = useCallback(() => {
    setTurn((t) => { if (t) setIdx(t.to); return null; });
  }, []);
  useEffect(() => {
    if (!turn) return undefined;
    const t = setTimeout(endTurn, 900); // animationend gelmezse
    return () => clearTimeout(t);
  }, [turn, endTurn]);

  useEffect(() => {
    const key = (e) => {
      if (editing) return;
      if (e.key === 'ArrowRight') go('next');
      else if (e.key === 'ArrowLeft') go('prev');
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go, editing, onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const changeFs = (delta) => {
    const next = Math.max(13, Math.min(24, fs + delta));
    setFs(next);
    try { localStorage.setItem('story_fs', String(next)); } catch { /* yoksay */ }
  };
  const touch = useRef(null);
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 'next' : 'prev');
  };
  const onPageTap = (e) => {
    if (phase !== 'open') return;
    if (spread) return go('next');
    const r = e.currentTarget.getBoundingClientRect();
    go(e.clientX - r.left > r.width * 0.4 ? 'next' : 'prev');
  };

  const cur = pages[idx] || pages[idx - 1];
  const total = pages.length;
  // sag/sol yaprakta gorunecek sayfalar (cevirme sirasinda alttaki yapraklar)
  const rightIdx = turn?.dir === 'next' ? turn.to : idx;
  const leftIdx = (turn ? (turn.dir === 'next' ? idx : turn.to) : idx) - 1;
  const lbl = (i) => (i >= 0 && i < total ? i + 1 : null);
  const chStart = (ci) => pages.findIndex((p) => p.ci === ci);
  const color = story?.color || STORY_COLORS[0];
  const hasPages = total > 0;

  return (
    <div className="sr" role="dialog" aria-modal="true" aria-label={story?.title || 'Hikaye'} style={{ '--bc': color, '--fs': `${fs}px` }}>
      <div className="sr-top">
        <button className="sr-btn" onClick={onClose} aria-label="Kapat">✕</button>
        <div className="sr-title">{story?.title || ''}</div>
        {!editing && phase === 'open' && (
          <>
            <button className="sr-btn" onClick={() => changeFs(-1)} aria-label="Yazıyı küçült">A−</button>
            <button className="sr-btn" onClick={() => changeFs(1)} aria-label="Yazıyı büyüt">A+</button>
            <button className="sr-btn" onClick={() => setToc((v) => !v)} aria-label="Bölümler" aria-expanded={toc}>☰</button>
          </>
        )}
        {story && !editing && <button className="sr-btn" onClick={() => setCmt((v) => !v)} aria-label="Yorumlar" aria-expanded={cmt}>💬</button>}
        {story?.mine && (
          <button className="sr-btn" onClick={() => { setEditing((v) => !v); setToc(false); }} aria-label={editing ? 'Okumaya dön' : 'Düzenle'}>{editing ? '📖' : '✎'}</button>
        )}
      </div>

      {story && !editing && phase === 'open' && cur && <ChapterBar storyId={story.id} chapter={(chapters || []).find((c) => c.id === cur.chapterId)} mine={story.mine} />}

      {cmt && story && <StoryComments storyId={story.id} onClose={() => setCmt(false)} />}

      {d.loading && !d.data && <div style={{ padding: 20 }}><Skeleton h={120} n={2} /></div>}
      {d.error && <div style={{ padding: 20 }}><ErrorBox error={d.error} onRetry={d.reload} /></div>}

      {story && editing && <Editor story={story} chapters={chapters} onChanged={() => { d.reload(); onChanged?.(); }} onDeleted={() => { onChanged?.(); onClose(); }} />}

      {story && !editing && (
        <>
          <div className="sr-stage">
            {toc && (
              <div className="sr-toc" role="menu">
                <b>Bölümler</b>
                {chapters.length === 0 && <div className="small muted">Henüz bölüm yok.</div>}
                {chapters.map((c, ci) => (
                  <button key={c.id} role="menuitem" className={cur?.ci === ci ? 'on' : undefined} onClick={() => { const i = chStart(ci); if (i >= 0) { setIdx(spread ? i - (i % 2) : i); setToc(false); } }}>
                    {c.n}. {c.title}{!c.published_at && <span className="chip">taslak</span>}
                  </button>
                ))}
              </div>
            )}
            <div className={`sbk-scene ${phase}${spread ? ' spread' : ''}`}>
              <div className="sbk" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }} onTouchEnd={onTouchEnd}>
                <div className="sbk-face sbk-back" />
                <div className="sbk-face sbk-spine" />
                <div className="sbk-face sbk-edge" />
                {/* sol yaprak: iki yaprakli modda onceki sayfa; dar ekranda ince bos yaprak */}
                <div className="sbk-pl" onClick={() => phase === 'open' && go('prev')}>
                  <PageFace side="l" page={spread ? pages[leftIdx] : undefined} no={lbl(leftIdx)} total={total} />
                </div>
                {/* sag yaprak: cevirmede hedef sayfa; cevirme yoksa gorunen sayfa */}
                <div className="sbk-pr" onClick={onPageTap}>
                  <PageFace page={pages[rightIdx]} no={lbl(rightIdx)} total={total} />
                </div>
                <div className="pg-measure" aria-hidden="true"><div className="pg"><div className="pg-in" ref={measure} /></div></div>
                {turn && (
                  <div className={`sbk-leaf ${turn.dir}`} onAnimationEnd={endTurn}>
                    <div className="lf lf-f"><PageFace page={turn.dir === 'next' ? pages[idx] : pages[turn.to]} no={lbl(turn.dir === 'next' ? idx : turn.to)} total={total} /></div>
                    <div className="lf lf-b"><PageFace side="l" page={spread ? pages[turn.dir === 'next' ? idx + 1 : idx - 1] : undefined} no={lbl(turn.dir === 'next' ? idx + 1 : idx - 1)} total={total} /></div>
                  </div>
                )}
                <div className="sbk-cover" aria-hidden="true">
                  <div className="cv cv-f">
                    <span className="cv-frame" />
                    <span className="cv-title">{story.title}</span>
                    <span className="cv-by">{story.author?.display_name}</span>
                  </div>
                  <div className="cv cv-b" />
                </div>
              </div>
              <div className="sbk-shadow" />
            </div>
          </div>

          {phase === 'closed' ? (
            <div className="sr-bottom">
              {story.summary && <p className="sr-sum">{story.summary}</p>}
              {chapters.length === 0 ? (
                <p className="sr-sum">Henüz yayınlanmış bölüm yok.</p>
              ) : (
                <button className="btn" onClick={() => setPhase('open')} disabled={!hasPages}>
                  {d.data.progress ? 'Okumaya devam et' : 'Okumaya başla'}
                </button>
              )}
            </div>
          ) : (
            <div className="sr-bottom">
              <button className="sr-btn" onClick={() => go('prev')} disabled={idx === 0 || !!turn} aria-label="Önceki sayfa">‹</button>
              <div className="sr-prog">
                <div className="small">{cur ? `${chapters[cur.ci].n}. bölüm · sayfa ${spread && idx > 0 && idx < total ? `${idx}–${idx + 1}` : Math.min(idx + 1, total)}/${total}` : ''}</div>
                <div className="progress"><i style={{ width: `${total ? (Math.min(idx + 1, total) / total) * 100 : 0}%` }} /></div>
              </div>
              <button className="sr-btn" onClick={() => go('next')} disabled={idx + 1 >= total || !!turn} aria-label="Sonraki sayfa">›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Yazar paneli: hikaye bilgileri + bolumler ----
function Editor({ story, chapters, onChanged, onDeleted }) {
  const [info, setInfo] = useState({ title: story.title, summary: story.summary || '', color: story.color });
  const [form, setForm] = useState(null); // { id?, title, body }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState('');
  const run = async (fn, msg) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      if (msg) setSaved(msg);
      onChanged();
      return true;
    } catch (x) {
      setErr(x);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveInfo = (e) => {
    e.preventDefault();
    run(() => api.updateStory(story.id, { title: info.title.trim(), summary: info.summary.trim(), color: info.color }), 'Kaydedildi');
  };
  const saveChapter = async (publish) => {
    const body = { title: form.title.trim(), body: form.body.trim() };
    const ok = await run(() => (form.id
      ? api.updateChapter(story.id, form.id, { ...body, ...(publish ? { published: true } : {}) })
      : api.addChapter(story.id, { ...body, publish })), publish ? 'Yayınlandı' : 'Taslak kaydedildi');
    if (ok) setForm(null);
  };
  const del = async () => {
    if (!window.confirm('Hikaye ve tüm bölümleri kalıcı olarak silinsin mi?')) return;
    try {
      await api.deleteStory(story.id);
      onDeleted();
    } catch (x) { setErr(x); }
  };
  return (
    <div className="sr-edit">
      <form className="card" onSubmit={saveInfo}>
        <b>Hikaye bilgileri</b>
        <label className="field"><span>Ad</span><input type="text" value={info.title} maxLength={120} onChange={(e) => setInfo({ ...info, title: e.target.value })} /></label>
        <label className="field"><span>Kısa tanıtım</span><textarea rows={2} maxLength={600} value={info.summary} onChange={(e) => setInfo({ ...info, summary: e.target.value })} /></label>
        <div className="row" style={{ gap: 8 }}>
          {STORY_COLORS.map((c) => (
            <button type="button" key={c} className="swatch" style={{ background: c, outline: c === info.color ? '3px solid var(--accent)' : 'none' }} aria-label={c} aria-pressed={c === info.color} onClick={() => setInfo({ ...info, color: c })} />
          ))}
          <span className="grow" />
          <button className="btn small" disabled={busy || !info.title.trim()}>Kaydet</button>
        </div>
      </form>

      <div className="card">
        <div className="row"><b className="grow">Bölümler ({chapters.length})</b>
          {!form && <button className="btn small" onClick={() => { setForm({ title: '', body: '' }); setSaved(''); }}>+ Yeni bölüm</button>}
        </div>
        {chapters.map((c) => (
          <div className="row sr-ch" key={c.id}>
            <span className="grow">{c.n}. {c.title} <span className={c.published_at ? 'chip ok' : 'chip'}>{c.published_at ? 'yayında' : 'taslak'}</span></span>
            <button className="btn small ghost" disabled={busy} onClick={() => { setForm({ id: c.id, title: c.title, body: c.body, published: !!c.published_at }); setSaved(''); }}>Düzenle</button>
            <button className="btn small ghost" disabled={busy} onClick={() => run(() => api.updateChapter(story.id, c.id, { published: !c.published_at }))}>{c.published_at ? 'Taslağa al' : 'Yayınla'}</button>
            <button className="btn small ghost" disabled={busy} onClick={() => window.confirm('Bölüm silinsin mi?') && run(() => api.deleteChapter(story.id, c.id))}>Sil</button>
          </div>
        ))}
        {form && (
          <div className="sr-form">
            <label className="field"><span>Bölüm adı</span><input type="text" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field"><span>Metin (paragraflar arasında boş satır bırak)</span><textarea rows={14} value={form.body} maxLength={80000} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
            <div className="row">
              <button className="btn ghost" onClick={() => setForm(null)}>Vazgeç</button>
              <span className="grow" />
              <button className="btn ghost" disabled={busy || !form.title.trim() || !form.body.trim()} onClick={() => saveChapter(false)}>{form.id && form.published ? 'Kaydet' : 'Taslak kaydet'}</button>
              {!(form.id && form.published) && <button className="btn" disabled={busy || !form.title.trim() || !form.body.trim()} onClick={() => saveChapter(true)}>Yayınla</button>}
            </div>
            <p className="small muted">Yayınlayınca gruptakilere “yeni bölüm” bildirimi gider. Yayındaki bölümde düzeltme yapınca bildirim gitmez.</p>
          </div>
        )}
        {saved && <div className="small" style={{ color: 'var(--ok)' }}>{saved}</div>}
        <ErrorBox error={err} />
      </div>
      <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={del}>Hikayeyi sil</button>
    </div>
  );
}
