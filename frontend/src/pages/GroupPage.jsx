import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { GroupCtx } from '../auth.js';
import { Avatar, Empty, ErrorBox, Skeleton, fmtDate, useAsync } from '../ui.jsx';
import Home from './Home.jsx';
import Leaderboard from './Leaderboard.jsx';
import Shelf from './Shelf.jsx';
import { RouteTabs } from './Ben.jsx';

const Library = lazy(() => import('./Library.jsx'));

const TABS = [
  ['', 'Ana sayfa'],
  ['liderlik', 'Liderlik'],
  ['rafim', 'Rafım'],
  ['kitaplik', 'Kitaplık'],
  ['bilgi', 'Bilgi ve üyeler'],
];

export default function GroupPage() {
  const { gid } = useParams();
  const id = Number(gid);
  const info = useAsync(() => api.group(id), [id]);
  const loc = useLocation();
  const rest = loc.pathname.replace(`/g/${gid}`, '').replace(/^\//, '').split('/')[0];
  const current = rest === 'uye' ? 'rafim' : rest;
  const g = info.data?.group;

  if (info.error?.status === 404 || Number.isNaN(id)) {
    return (
      <Empty icon="🔍" title="Bu grubu bulamadım">
        Grubun üyesi olmayabilirsin.
        <div style={{ marginTop: 12 }}>
          <Link className="btn" to="/ben/gruplarim" style={{ textDecoration: 'none' }}>Gruplarıma dön</Link>
        </div>
      </Empty>
    );
  }
  return (
    <GroupCtx.Provider value={id} key={id}>
      <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>{g?.name || 'Grup'}</h1>
        {g && <span className="muted small">{g.member_count} üye</span>}
      </div>
      <RouteTabs tabs={TABS} current={current} base={`/g/${gid}`} label="Grup bölümleri" />
      <ErrorBox error={info.error} onRetry={info.reload} />
      <Suspense fallback={<Skeleton h={80} n={3} />}>
        <Routes>
          <Route index element={<Home />} />
          <Route path="liderlik" element={<Leaderboard />} />
          <Route path="rafim" element={<Shelf />} />
          <Route path="uye/:userId" element={<Shelf />} />
          <Route path="kitaplik" element={<Library />} />
          <Route path="bilgi" element={<Info g={g} loading={info.loading} gid={id} />} />
          <Route path="*" element={<Navigate to={`/g/${gid}`} replace />} />
        </Routes>
      </Suspense>
    </GroupCtx.Provider>
  );
}

function Info({ g, loading, gid }) {
  if (loading && !g) return <Skeleton h={80} n={2} />;
  if (!g) return null;
  return (
    <div className="card">
      <b>{g.name}</b>
      {g.invite_name && <div className="small muted">Davet eden: {g.invite_name}</div>}
      <h3>Üyeler ({g.member_count})</h3>
      {g.members.map((m) => (
        <Link key={m.id} to={`/g/${gid}/uye/${m.id}`} className="lrow row" style={{ padding: '6px 0', textDecoration: 'none', color: 'inherit' }}>
          <Avatar user={m} size="sm" />
          <span className="grow">{m.display_name}</span>
          {m.role === 'owner' && <span className="chip">Yönetici</span>}
          {m.joined_at && <span className="small muted">{fmtDate(m.joined_at.slice(0, 10))}</span>}
        </Link>
      ))}
    </div>
  );
}
