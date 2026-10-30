import { lazy, Suspense } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '../ui.jsx';
import Shelf from './Shelf.jsx';

const Groups = lazy(() => import('./Groups.jsx'));
const Notes = lazy(() => import('./Notes.jsx'));
const Goals = lazy(() => import('./Goals.jsx'));

const TABS = [
  ['hesabim', 'Hesabım'],
  ['gruplarim', 'Gruplarım'],
  ['defterim', 'Defterim'],
  ['hedefler', 'Hedefler ve özet'],
];

// Adres tabanli sekme cubugu (Ben ve grup sayfasinda ortak)
export function RouteTabs({ tabs, current, base, label }) {
  const nav = useNavigate();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" className="tab" aria-selected={current === k} onClick={() => nav(k ? `${base}/${k}` : base)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function Ben() {
  const { tab = 'hesabim' } = useParams();
  if (!TABS.some(([k]) => k === tab)) return <Navigate to="/ben" replace />;
  return (
    <>
      <RouteTabs tabs={TABS} current={tab} base="/ben" label="Kişisel bölümler" />
      <Suspense fallback={<Skeleton h={80} n={3} />}>
        {tab === 'hesabim' && <Shelf />}
        {tab === 'gruplarim' && <Groups />}
        {tab === 'defterim' && <Notes />}
        {tab === 'hedefler' && <Goals />}
      </Suspense>
    </>
  );
}
