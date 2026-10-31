import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { GroupCtx, useAuth } from '../auth.js';
import { Avatar, Empty, ErrorBox, PageHead, Skeleton, fmtDate, useAsync } from '../ui.jsx';
import Home from './Home.jsx';
import Leaderboard from './Leaderboard.jsx';
import Shelf from './Shelf.jsx';

const Library = lazy(() => import('./Library.jsx'));

export default function GroupPage() {
  const { gid } = useParams();
  const id = Number(gid);
  const info = useAsync(() => api.group(id), [id]);
  const { user } = useAuth();
  const g = info.data?.group;

  if (info.error?.status === 404 || Number.isNaN(id)) {
    return (
      <Empty icon="🔍" title="Bu grubu bulamadım">
        Grubun üyesi olmayabilirsin.
        <div style={{ marginTop: 12 }}>
          <Link className="btn" to="/gruplar" style={{ textDecoration: 'none' }}>Gruplarıma dön</Link>
        </div>
      </Empty>
    );
  }
  return (
    <GroupCtx.Provider value={id} key={id}>
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
    <>
      <PageHead title="Üyeler" sub={`${g.member_count} üye${g.invite_name ? ` · Davet eden: ${g.invite_name}` : ''}`} />
      <div className="card">
      {g.members.map((m) => (
        <Link key={m.id} to={`/g/${gid}/uye/${m.id}`} className="lrow row" style={{ padding: '6px 0', textDecoration: 'none', color: 'inherit' }}>
          <Avatar user={m} size="sm" />
          <span className="grow">{m.display_name}</span>
          {m.role === 'owner' && <span className="chip">Yönetici</span>}
          {m.joined_at && <span className="small muted">{fmtDate(m.joined_at.slice(0, 10))}</span>}
        </Link>
      ))}
      </div>
    </>
  );
}
