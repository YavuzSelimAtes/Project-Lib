import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '../ui.jsx';
import Shelf from './Shelf.jsx';

const Notes = lazy(() => import('./Notes.jsx'));
const Goals = lazy(() => import('./Goals.jsx'));
const Settings = lazy(() => import('./Goals.jsx').then((m) => ({ default: m.Settings })));

// Adres tabanli sekme cubugu (Yonetim sayfasi kullanir)
export function RouteTabs({ tabs, current, base, label }) {
  const nav = useNavigate();
  const ref = useRef(null);
  const [ind, setInd] = useState(null);
  const [anim, setAnim] = useState(false);
  // Secili sekmenin arkasinda kayan pill
  useLayoutEffect(() => {
    const a = ref.current?.querySelector('[aria-selected="true"]');
    setInd(a ? { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight } : null);
    const id = requestAnimationFrame(() => setAnim(true));
    return () => cancelAnimationFrame(id);
  }, [current, tabs.length]);
  return (
    <div className="tabs tabs-slide" role="tablist" aria-label={label} ref={ref}>
      {ind && <span className={anim ? 'tab-ind anim' : 'tab-ind'} aria-hidden="true" style={{ width: ind.w, height: ind.h, transform: `translate(${ind.x}px, ${ind.y}px)` }} />}
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" className="tab" aria-selected={current === k} onClick={() => nav(k ? `${base}/${k}` : base)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// Sekmeler ust barda (App.jsx); Gruplar kendi adresinde (/gruplar)
export default function Ben() {
  const { tab = 'hesabim' } = useParams();
  if (tab === 'gruplarim') return <Navigate to="/gruplar" replace />;
  if (!['hesabim', 'defterim', 'hedefler', 'ayarlar'].includes(tab)) return <Navigate to="/ben" replace />;
  return (
    <Suspense fallback={<Skeleton h={80} n={3} />}>
      {tab === 'hesabim' && <Shelf />}
      {tab === 'defterim' && <Notes />}
      {tab === 'hedefler' && <Goals />}
      {tab === 'ayarlar' && <Settings />}
    </Suspense>
  );
}
