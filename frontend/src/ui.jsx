import { useEffect, useRef, useState, useCallback } from 'react';
import { isDice, useDiceSrc } from './diceAvatar.js';

// Resim avatarin metin gereken yerlerde (baslik, liste) yedegi
export const avatarText = (a) => (isDice(a) ? '🙂' : a || '🙂');

export function Avatar({ user, size = '' }) {
  const u = user || {};
  const dice = useDiceSrc(u.avatar);
  return (
    <span className={`avatar ${size}`} style={{ '--c': u.color ? u.color + '33' : undefined }} aria-hidden="true">
      {isDice(u.avatar) ? (dice ? <img src={dice} alt="" /> : null) : u.avatar || '🙂'}
    </span>
  );
}

const PH_COLORS = ['#d9693b', '#4a8f7c', '#7a6bb0', '#c2557a', '#4f7cac', '#a5883a'];
export const coverColor = (title = '?') => PH_COLORS[[...title].reduce((a, c) => a + c.charCodeAt(0), 0) % PH_COLORS.length];

export function Cover({ src, fallback, title = '?', large }) {
  const [fails, setFails] = useState(0); // 0: src, 1: fallback, 2: yer tutucu
  useEffect(() => setFails(0), [src, fallback]);
  const shown = [src, fallback].filter(Boolean)[fails];
  if (shown) {
    return (
      <div className={`cover${large ? ' lg' : ''}`}>
        <img
          src={shown}
          alt=""
          loading="lazy"
          onError={() => setFails((n) => n + 1)}
          ref={(el) => {
            // hata olayi React baglanmadan once atildiysa yer tutucuya dus
            if (el && el.complete && el.naturalWidth === 0) setFails((n) => n + 1);
          }}
        />
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

// Her sayfanin ust baslik blogu: baslik + aciklama solda, eylemler sagda (hep ayni yer, ayni bosluk)
export function PageHead({ title, sub, children }) {
  return (
    <header className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

// Istatistik karti: tum sayfalarda ayni (sayi + etiket + istege bagli ek satir)
const STAT_ICON = [['kitap', '📖'], ['sayfa', '📄'], ['dizi', '📺'], ['bölüm', '🎞️'], ['film', '🎬'], ['seri', '🔥'], ['hedef', '🎯']];
export function Stat({ value, label, extra }) {
  const l = typeof label === 'string' ? label.toLocaleLowerCase('tr') : '';
  const icon = (STAT_ICON.find(([k]) => l.includes(k)) || [0, '✦'])[1];
  return (
    <div className="card stat">
      <span className="stat-ic" aria-hidden="true">{icon}</span>
      <b>{value}</b>
      <span className="stat-l">{label}</span>
      {extra}
    </div>
  );
}

// Kart ici / liste ici kucuk bos durum ("henuz yok") — tum sayfalarda ayni
export function Hint({ children }) {
  return <p className="hint">{children}</p>;
}

// Bos durum: kucuk raf cizimi (kitap sirtlari) + anlami tasiyan rozet
export function Empty({ icon = '📚', title, children }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <svg viewBox="0 0 120 84" width="120" height="84">
          <rect className="bk" style={{ '--i': 0 }} x="22" y="28" width="16" height="44" rx="2" fill="#d9693b" />
          <rect className="bk" style={{ '--i': 1 }} x="40" y="38" width="12" height="34" rx="2" fill="#5f8f6b" />
          <rect className="bk" style={{ '--i': 2 }} x="54" y="22" width="18" height="50" rx="2" fill="#c9a15a" />
          <rect className="bk lean" x="76" y="32" width="14" height="40" rx="2" fill="#6b7f95" />
          <path d="M26 36h8M26 40h8M58 30h10M58 34h10" stroke="rgba(255,255,255,.4)" strokeWidth="2" strokeLinecap="round" />
          <rect x="12" y="72" width="96" height="5" rx="2.5" fill="#a8703f" />
        </svg>
        <span className="empty-badge">{icon}</span>
      </div>
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
// Tarihler kullanicinin profilde sectigi saat dilimine gore (yoksa Europe/Istanbul, backend ile ayni)
let tzName = 'Europe/Istanbul';
export const setTimeZone = (tz) => { tzName = tz || 'Europe/Istanbul'; };
const ymd = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: tzName }).format(d);
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
