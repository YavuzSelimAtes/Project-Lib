import { Navigate, useParams } from 'react-router-dom';
import { GroupCtx, useAuth } from '../auth.js';
import Home from './Home.jsx';

const LAST = 'ana-grup';
const remembered = () => { try { return Number(localStorage.getItem(LAST)) || 0; } catch { return 0; } };

// Hesap modunda "Ana sayfa": secili grubun akisini (kim ne okudu) acar
export default function AllHome() {
  const { user } = useAuth();
  const groups = user.groups || [];
  const { gid } = useParams();
  if (!groups.length) return <Home />; // bireysel kullanim: yalniz kendi karti
  const cur = groups.find((g) => g.id === Number(gid));
  if (!cur) return <Navigate to={`/ana/${(groups.find((g) => g.id === remembered()) || groups[0]).id}`} replace />;
  try { localStorage.setItem(LAST, String(cur.id)); } catch { /* tercih saklanamazsa onemli degil */ }
  return (
    <GroupCtx.Provider value={cur.id} key={cur.id}>
      <Home switchable={groups} />
    </GroupCtx.Provider>
  );
}
