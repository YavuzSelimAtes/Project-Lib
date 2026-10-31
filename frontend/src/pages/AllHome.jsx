import { Link, Navigate, useParams } from 'react-router-dom';
import { GroupCtx, useAuth } from '../auth.js';
import { Empty } from '../ui.jsx';
import { RouteTabs } from './Ben.jsx';
import Home from './Home.jsx';

const LAST = 'ana-grup';
const remembered = () => { try { return Number(localStorage.getItem(LAST)) || 0; } catch { return 0; } };

// Hesap modunda "Ana sayfa": gruplar sekme olur, her sekme o grubun akisini (kim ne okudu) acar
export default function AllHome() {
  const { user } = useAuth();
  const groups = user.groups || [];
  const { gid } = useParams();
  if (!groups.length) {
    return (
      <Empty icon="📚" title="Henüz bir grubun yok">
        Bir gruba katıldığında arkadaşlarının ne okuduğunu burada görürsün.
        <div style={{ marginTop: 12 }}><Link className="btn" to="/gruplar" style={{ textDecoration: 'none' }}>Gruplarıma git</Link></div>
      </Empty>
    );
  }
  const cur = groups.find((g) => g.id === Number(gid));
  if (!cur) return <Navigate to={`/ana/${(groups.find((g) => g.id === remembered()) || groups[0]).id}`} replace />;
  try { localStorage.setItem(LAST, String(cur.id)); } catch { /* tercih saklanamazsa onemli degil */ }
  return (
    <>
      {<RouteTabs tabs={groups.map((g) => [String(g.id), g.name])} current={String(cur.id)} base="/ana" label="Gruplar" />}
      <GroupCtx.Provider value={cur.id} key={cur.id}><Home /></GroupCtx.Provider>
    </>
  );
}
