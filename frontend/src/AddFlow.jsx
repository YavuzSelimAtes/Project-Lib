import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Cover, ErrorBox, Modal, SearchMeta, TYPE_ICON, TYPE_LABEL, fmtDate, today, yesterday } from './ui.jsx';
import EditionPicker from './Editions.jsx';
import SeasonPicker from './Seasons.jsx';

// ayni arama anahtari icin tek kalici kayit (cift cagriyi onler)
const pickCache = new Map();
function pickOnce(key) {
  if (!pickCache.has(key)) pickCache.set(key, api.pickCatalog(key).catch((e) => { pickCache.delete(key); throw e; }));
  return pickCache.get(key);
}

const LANGS = [
  ['', 'Hepsi'],
  ['tr', 'TR'],
  ['en', 'EN'],
];

// "2026-10-20".."2026-10-22" -> ["2026-10-20","2026-10-21","2026-10-22"]
function daysBetween(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const TYPES = [
  ['book', '📖 Kitap'],
  ['series', '📺 Dizi'],
  ['movie', '🎬 Film'],
];

// 1) ara  2) sec + tarih  3) kaydet.  Bulunamazsa talep gonder.
export default function AddFlow({ onClose, onAdded, initialType = 'book' }) {
  const [type, setType] = useState(initialType);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  const [res, setRes] = useState(null); // {items, online}
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);
  const [requesting, setRequesting] = useState(false);

  // yazarken gecikmeli ara
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.search(q.trim(), type, type === 'book' ? lang : '');
        if (alive) {
          setRes(r);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setSearching(false);
      }
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, type, lang]);

  if (picked) return <PickedForm item={picked} onBack={() => setPicked(null)} onClose={onClose} onAdded={onAdded} />;
  if (requesting) return <RequestForm type={type} title={q} onBack={() => setRequesting(false)} onClose={onClose} />;

  return (
    <Modal title="Yeni ekle" onClose={onClose}>
      <div className="tabs" role="tablist">
        {TYPES.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={type === k} className="tab" onClick={() => setType(k)}>
            {l}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={type === 'book' ? 'Kitap adı + yazar (örn. Gora Tagore)…' : type === 'movie' ? 'Film adı…' : 'Dizi adı…'}
        aria-label="Ara"
        autoFocus
      />
      {type === 'book' && (
        <div className="tabs" role="group" aria-label="Dil filtresi" style={{ marginTop: 8, marginBottom: 0 }}>
          {LANGS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={lang === k} className="tab sm" onClick={() => setLang(k)}>
              {k ? l : '🌐 ' + l}
            </button>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
      {searching && <p className="muted">Kütüphanede ve internette aranıyor, birkaç saniye sürebilir…</p>}
      {res && !searching && res.online && !res.online.ok && (
        <p className="small muted">İnternet kaynaklarına ulaşılamadı; sadece kütüphanedeki kayıtlar gösteriliyor.</p>
      )}
      {res && !searching && res.items.length === 0 && <p className="muted">“{q}” için sonuç bulunamadı.</p>}
      <div className="shelf-list" style={{ marginTop: 10 }}>
        {res?.items.map((it) => (
          <button key={it.id ?? it.key} className="item card" style={{ padding: 10 }} onClick={() => setPicked(it)}>
            <Cover src={it.cover_url} title={it.title} />
            <div className="meta">
              <div className="t">{it.title}</div>
              <div className="line">
                {TYPE_LABEL[it.type]}
                {it.author_or_creator ? ` · ${it.author_or_creator}` : ''}
                {it.year ? ` · ${it.year}` : ''}
                {it.pages ? ` · ${it.pages} sayfa` : ''}
              </div>
              <SearchMeta it={it} />
            </div>
          </button>
        ))}
      </div>
      {q.trim().length >= 2 && !searching && (
        <div className="card" style={{ marginTop: 14, textAlign: 'center' }}>
          Bulamadın mı?{' '}
          <button className="btn small ghost" onClick={() => setRequesting(true)}>
            Yöneticiden iste
          </button>
        </div>
      )}
    </Modal>
  );
}

function PickedForm({ item, onBack, onClose, onAdded }) {
  const isBook = item.type === 'book';
  const isMovie = item.type === 'movie';
  const isSeries = item.type === 'series';
  // baski / sezon bilgisi icin katalog kimligi lazim; internet sonucuysa simdi kalici kaydedilir
  const [catId, setCatId] = useState(item.id ?? null);
  const [pickErr, setPickErr] = useState(null);
  const [pickTry, setPickTry] = useState(0);
  useEffect(() => {
    if (isMovie || catId != null || !item.key) return;
    let alive = true;
    setPickErr(null);
    pickOnce(item.key).then(
      (r) => alive && setCatId(r.item.id),
      (e) => alive && setPickErr(e),
    );
    return () => {
      alive = false;
    };
  }, [isMovie, catId, item.key, pickTry]);
  const [edition, setEdition] = useState(null);
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const [start, setStart] = useState(today());
  const [pages, setPages] = useState(item.pages || '');
  const [status, setStatus] = useState(isMovie ? 'bitti' : 'devam');
  const [rating, setRating] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [end, setEnd] = useState(today());
  const [unknownStart, setUnknownStart] = useState(false);
  const [curPage, setCurPage] = useState('');
  const finishedPast = !isMovie && status === 'bitti';
  // gecmis baslangic + sayfa>0: gunleri doldurma secimi (v7)
  const needsBackfill = isBook && status === 'devam' && Number(curPage) > 0 && start && start < today();
  const pastDays = needsBackfill ? daysBetween(start, yesterday()) : [];
  const manualOk = pastDays.length > 0 && pastDays.length <= 60;
  const [mode, setMode] = useState('manual');
  const [dayVals, setDayVals] = useState({});
  const effMode = manualOk ? mode : 'spread';
  const sumDays = pastDays.reduce((a, d) => a + (Number(dayVals[d]) || 0), 0);
  const remainder = Number(curPage) - sumDays;

  const save = async (e) => {
    e.preventDefault();
    if (isBook && !pages) return setError(new Error('Bu kitabın sayfa sayısını yaz, ilerlemeni ona göre hesaplayacağız.'));
    if (finishedPast && !unknownStart && start > end) return setError(new Error('Bitiş tarihi başlangıçtan önce olamaz.'));
    if (isBook && status === 'devam' && curPage !== '' && (Number(curPage) < 0 || Number(curPage) > Number(pages))) {
      return setError(new Error('Şu anki sayfa 0 ile toplam sayfa arasında olmalı.'));
    }
    setBusy(true);
    setError(null);
    try {
      const cid = item.id ?? catId;
      const body = cid != null ? { catalog_id: cid, status } : { catalog_key: item.key, status };
      if (isBook && edition) body.edition_id = edition.id;
      if (isSeries && status === 'devam' && season && episode) {
        body.season = Number(season);
        body.episode = Number(episode);
      }
      if (isMovie) body.end_date = start;
      else if (finishedPast) {
        if (!unknownStart) body.start_date = start;
        body.end_date = end;
      } else if (status !== 'planlandi') body.start_date = start;
      if (isBook && status === 'devam' && Number(curPage) > 0) body.current_page = Number(curPage);
      if (needsBackfill && pastDays.length > 0) {
        if (effMode === 'manual') {
          if (remainder < 0) throw new Error(`Girdiğin günlerin toplamı (${sumDays}) şu anki sayfadan (${curPage}) büyük olamaz.`);
          body.backfill = 'manual';
          body.days = pastDays.map((d) => ({ date: d, pages: Number(dayVals[d]) || 0 }));
        } else body.backfill = 'spread';
      }
      if (isBook) body.total_pages = Number(pages);
      if (rating) body.rating = Number(rating);
      await api.createEntry(body);
      onAdded?.();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={item.title} onClose={onClose}>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', marginBottom: 14 }}>
        <Cover src={item.cover_url} title={item.title} large />
        <div>
          <div className="muted">
            {TYPE_ICON[item.type]} {item.author_or_creator} {item.year && `· ${item.year}`}
          </div>
          {item.description && <p className="small muted" style={{ maxHeight: 80, overflow: 'hidden' }}>{item.description}</p>}
        </div>
      </div>
      <form onSubmit={save}>
        {!isMovie && (
          <label className="field">
            <span>Durum</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="devam">{isBook ? 'Şu an okuyorum' : 'Şu an izliyorum'}</option>
              <option value="planlandi">Sonra {isBook ? 'okuyacağım' : 'izleyeceğim'}</option>
              <option value="bitti">Zaten bitirdim</option>
            </select>
          </label>
        )}
        {(isMovie || status !== 'planlandi') && !(finishedPast && unknownStart) && (
          <label className="field">
            <span>{isMovie ? 'İzlediğin tarih' : 'Başlangıç tarihi'}</span>
            <input type="date" value={start} max={today()} onChange={(e) => setStart(e.target.value)} required />
          </label>
        )}
        {finishedPast && (
          <>
            <label className="small" style={{ display: 'block', marginBottom: 12 }}>
              <input type="checkbox" checked={unknownStart} onChange={(e) => setUnknownStart(e.target.checked)} /> Ne zaman başladığımı bilmiyorum
              <span className="muted"> (günlük ortalamana katılmaz)</span>
            </label>
            <label className="field">
              <span>Bitiş tarihi</span>
              <input type="date" value={end} min={unknownStart ? undefined : start} max={today()} onChange={(e) => setEnd(e.target.value)} required />
            </label>
          </>
        )}
        {pickErr && !isMovie && (
          <div className="err" role="alert">
            {isBook ? 'Baskı ve dil bilgisi alınamadı' : 'Sezon bilgisi alınamadı'}: {pickErr.message}{' '}
            <button type="button" className="btn small ghost" onClick={() => setPickTry((n) => n + 1)}>
              Yeniden dene
            </button>
            <div className="small" style={{ fontWeight: 400 }}>İstersen bu bilgi olmadan da kaydedebilirsin.</div>
          </div>
        )}
        {isBook && catId != null && (
          <div className="field">
            <span>Baskı / dil</span>
            <div style={{ marginTop: 6 }}>
              <EditionPicker
                catalogId={catId}
                selectedId={edition?.id ?? null}
                onSelect={(ed) => {
                  setEdition(ed);
                  setPages(ed ? ed.pages || '' : item.pages || '');
                  if (ed && !ed.pages) setTimeout(() => document.getElementById('total-pages')?.focus(), 0);
                }}
              />
            </div>
          </div>
        )}
        {isSeries && status === 'devam' && catId != null && (
          <div className="field">
            <span>Kaçıncı bölümdesin? (isteğe bağlı)</span>
            <div className="quick" style={{ marginTop: 6 }}>
              <SeasonPicker catalogId={catId} refresh allowNone season={season} episode={episode} onChange={(sn, ep) => { setSeason(sn); setEpisode(ep); }} />
            </div>
          </div>
        )}
        {isBook && status === 'devam' && (
          <label className="field">
            <span>Kaçıncı sayfadasın? (boşsa baştan başlıyorsun)</span>
            <input type="number" min="0" max={pages || undefined} value={curPage} onChange={(e) => setCurPage(e.target.value)} placeholder="0" />
          </label>
        )}
        {isBook && (
          <label className="field">
            <span>Toplam sayfa</span>
            <input id="total-pages" type="number" min="1" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="örn. 320" />
            {edition && !edition.pages && <span className="small muted">Bu baskının sayfa sayısı bilinmiyor; elindeki kitaba bakıp yaz.</span>}
          </label>
        )}
        {needsBackfill && pastDays.length > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            <b>Geçen günleri nasıl sayalım?</b>
            <label style={{ display: 'block', margin: '8px 0 2px' }}>
              <input type="radio" name="bf" checked={effMode === 'manual'} disabled={!manualOk} onChange={() => setMode('manual')} /> Gün gün doldur
              {!manualOk && <span className="small muted"> (60 günden uzun aralıkta kapalı)</span>}
            </label>
            <label style={{ display: 'block' }}>
              <input type="radio" name="bf" checked={effMode === 'spread'} onChange={() => setMode('spread')} /> Günlere eşit dağıt
            </label>
            {effMode === 'spread' ? (
              <p className="small muted">Sayfalar günlere eşit dağıtılacak; bu günler rekora ve günlük seriye sayılmaz.</p>
            ) : (
              <>
                <p className="small muted" style={{ margin: '8px 0' }}>Her gün kaç sayfa okudun? Boş bırakırsan “okumadım” sayılır.</p>
                {pastDays.map((d) => (
                  <div className="row" key={d} style={{ marginBottom: 4, flexWrap: 'nowrap' }}>
                    <span style={{ width: 92 }}>{fmtDate(d)}</span>
                    <input type="number" min="0" inputMode="numeric" className="grow" value={dayVals[d] ?? ''} onChange={(e) => setDayVals((v) => ({ ...v, [d]: e.target.value }))} aria-label={`${d} okunan sayfa`} />
                  </div>
                ))}
                <p className={remainder < 0 ? 'small' : 'small muted'} style={remainder < 0 ? { color: 'var(--danger)' } : undefined}>
                  {remainder < 0 ? `Toplam ${sumDays}, şu anki sayfadan fazla.` : `Bugün: kalan ${remainder} sayfa bugüne yazılacak.`}
                </p>
              </>
            )}
          </div>
        )}
        {(isMovie || status === 'bitti') && (
          <label className="field">
            <span>Puanın (isteğe bağlı)</span>
            <select value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="">Puan verme</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {'⭐'.repeat(n)}
                </option>
              ))}
            </select>
          </label>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn ghost" onClick={onBack}>
            ← Geri
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RequestForm({ type, title: t0, onBack, onClose }) {
  const [rtype, setRtype] = useState(type);
  const [title, setTitle] = useState(t0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createRequest({ type: rtype, title: title.trim(), note: note.trim() || undefined });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <Modal title="Talebin gönderildi" onClose={onClose}>
        <p>✅ Yönetici bakıp kütüphaneye ekleyince sana haber verilecek (üstteki 🔔).</p>
        <button className="btn" onClick={onClose}>
          Tamam
        </button>
      </Modal>
    );

  return (
    <Modal title="Yöneticiden iste" onClose={onClose}>
      <form onSubmit={send}>
        <label className="field">
          <span>Tür</span>
          <select value={rtype} onChange={(e) => setRtype(e.target.value)}>
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Adı</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </label>
        <label className="field">
          <span>Not (isteğe bağlı)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Yazar, yıl, hangi baskı gibi ipuçları…" maxLength={1000} />
        </label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn ghost" onClick={onBack}>
            ← Geri
          </button>
          <button className="btn" disabled={busy || !title.trim()}>
            Talep gönder
          </button>
        </div>
      </form>
    </Modal>
  );
}
