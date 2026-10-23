import { useEffect, useRef, useState, useCallback } from 'react';

export function Avatar({ user, size = '' }) {
  const u = user || {};
  return (
    <span className={`avatar ${size}`} style={{ '--c': u.color ? u.color + '33' : undefined }} aria-hidden="true">
      {u.avatar || '🙂'}
    </span>
  );
}

const PH_COLORS = ['#d9693b', '#4a8f7c', '#7a6bb0', '#c2557a', '#4f7cac', '#a5883a'];
export function Cover({ src, title = '?', large }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (src && !bad) {
    return (
      <div className={`cover${large ? ' lg' : ''}`}>
        <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />
      </div>
    );
  }
  const i = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % PH_COLORS.length;
  return (
    <div className={`cover ph${large ? ' lg' : ''}`} style={{ background: PH_COLORS[i] }} aria-hidden="true">
      {[...title.trim()][0]?.toLocaleUpperCase('tr') || '?'}
    </div>
  );
}

export function Progress({ value, color }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: v + '%', '--c': color }} />
    </div>
  );
}

export function Skeleton({ h = 120, n = 1 }) {
  return Array.from({ length: n }, (_, i) => <div key={i} className="skel" style={{ height: h, marginBottom: 14 }} />);
}

export function Empty({ icon = '📚', title, children }) {
  return (
    <div className="empty">
      <span className="big">{icon}</span>
      <b>{title}</b>
      <div>{children}</div>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="err" role="alert">
      {error.message || String(error)}{' '}
      {onRetry && (
        <button className="btn small ghost" onClick={onRetry}>
          Tekrar dene
        </button>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, hideClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // yalniz acilista calisir (onClose her render'da degisse de odak calinmaz)
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') return closeRef.current();
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          {!hideClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Kapat">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// veri cekme kancasi
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    let alive = true;
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: null, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => run(), [run]);
  return { ...state, reload: run };
}

export function useCountUp(target, ms = 700, animate = true) {
  const [v, setV] = useState(animate ? 0 : Number(target) || 0);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const to = Number(target) || 0;
    if (reduce || !animate) return setV(to);
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, animate]);
  return v;
}

export function CountUp({ value, decimals = 0, animate = true }) {
  const v = useCountUp(value, 700, animate);
  return <>{v.toLocaleString('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z').getTime()) / 1000;
  if (isNaN(s)) return '';
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} saat önce`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} gün önce`;
  return new Date(iso).toLocaleDateString('tr-TR');
}

// "2026-10-22" -> "22.10.2026"
export function fmtDate(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

export const TYPE_LABEL = { book: 'Kitap', movie: 'Film', series: 'Dizi' };
export const TYPE_ICON = { book: '📖', movie: '🎬', series: '📺' };
// Tarihler Europe/Istanbul'a gore (backend ile ayni)
const ymd = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(d);
export const today = () => ymd(new Date());
export const yesterday = () => ymd(new Date(Date.now() - 86400000));

// ---- dil / sure / tarih yardimcilari (v5) ----
const LANG_ALIAS = { tur: 'tr', eng: 'en', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', rus: 'ru', ara: 'ar', jpn: 'ja', por: 'pt', dut: 'nl', nld: 'nl' };
export function normLang(code) {
  if (!code) return '';
  const c = String(code).toLowerCase().trim();
  return LANG_ALIAS[c] || c.slice(0, 2);
}
export function langLabel(code) {
  const c = normLang(code);
  if (!c) return 'Diğer';
  try {
    const n = new Intl.DisplayNames(['tr'], { type: 'language' }).of(c);
    if (n && n !== c) return n.charAt(0).toLocaleUpperCase('tr') + n.slice(1);
  } catch {
    /* yoksay */
  }
  return c.toUpperCase();
}

// 760 -> "12 sa 40 dk", 45 -> "45 dk"
export function fmtMinutes(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  if (n < 60) return `${n} dk`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h.toLocaleString('tr-TR')} sa ${r} dk` : `${h.toLocaleString('tr-TR')} sa`;
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DOW3 = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
// "2026-03-12" -> "12 Mart Per" (farkli yildaysa yil da eklenir)
export function fmtDayLong(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '';
  const [y, m, day] = d.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  const thisYear = Number(today().slice(0, 4));
  return `${day} ${MONTHS[m - 1]}${y !== thisYear ? ' ' + y : ''} ${DOW3[dow]}`;
}

// arama sonucu / baski ozeti: yayinevi, diller, baski sayisi
export function SearchMeta({ it }) {
  if (it.type !== 'book') return null;
  const pub = it.publisher || (Array.isArray(it.publishers) ? it.publishers[0] : null);
  const langs = [...new Set((it.languages || []).map(normLang).filter(Boolean))].map(langLabel);
  const parts = [pub, langs.length ? langs.join(', ') : null, it.editions_count > 0 ? `${it.editions_count} baskı` : null].filter(Boolean);
  return parts.length ? <div className="line sm">{parts.join(' · ')}</div> : null;
}
