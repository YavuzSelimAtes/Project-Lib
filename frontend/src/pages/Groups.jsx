import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Avatar, Empty, ErrorBox, Skeleton, useAsync } from '../ui.jsx';
import { InviteLink } from './Admin.jsx';

const ROLE = { owner: 'Yönetici', member: 'Üye' };

// Uyesi oldugum gruplar: ac, ayril, (sahibi isem) yonet
export default function Groups() {
  const { refresh } = useAuth();
  const list = useAsync(() => api.groups(), []);
  const [manage, setManage] = useState(null);
  const [err, setErr] = useState(null);
  const groups = list.data?.groups || [];

  const leave = async (g) => {
    if (!window.confirm(`“${g.name}” grubundan ayrılmak istiyor musun? Kayıtların bu grupta artık görünmez; serin ve istatistiklerin etkilenmez.`)) return;
    setErr(null);
    try {
      await api.leaveGroup(g.id);
      await refresh();
      list.reload();
    } catch (x) {
      setErr(x);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <p className="sub grow" style={{ margin: 0 }}>Katıldığın gruplar. Kayıtların hangi gruplarda görüneceğini Hesabım’dan seçersin.</p>
        <Link className="btn small" to="/grup-olustur" style={{ textDecoration: 'none' }}>+ Grup oluştur</Link>
      </div>
      {list.loading && !list.data && <Skeleton h={80} n={2} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      <ErrorBox error={err} />
      {list.data && groups.length === 0 && (
        <Empty icon="👥" title="Henüz bir grubun yok">
          Bir davet linkiyle gruba katılabilir ya da kendi grubunu kurabilirsin.
          <div style={{ marginTop: 12 }}>
            <Link className="btn" to="/grup-olustur" style={{ textDecoration: 'none' }}>Grup oluştur</Link>
          </div>
        </Empty>
      )}
      {groups.map((g) => (
        <div className="card" key={g.id} style={{ marginBottom: 12 }}>
          <div className="row">
            <Link to={`/g/${g.id}`} className="grow" style={{ textDecoration: 'none', color: 'inherit' }}>
              <b style={{ fontSize: '1.1em' }}>{g.name}</b>
              <div className="small muted">{g.member_count} üye</div>
            </Link>
            <span className="chip">{ROLE[g.role] || g.role}</span>
            <Link className="btn small" to={`/g/${g.id}`} style={{ textDecoration: 'none' }}>Aç</Link>
            {g.role === 'owner' ? (
              <button className="btn small ghost" onClick={() => setManage(manage === g.id ? null : g.id)}>{manage === g.id ? 'Kapat' : 'Yönet'}</button>
            ) : (
              <button className="btn small ghost" onClick={() => leave(g)}>Gruptan ayrıl</button>
            )}
          </div>
          {manage === g.id && <Manage gid={g.id} onChanged={() => { list.reload(); refresh(); }} />}
        </div>
      ))}
    </>
  );
}

// Grup sahibi: davet linki + ad ayarlari (InviteLink) ve uye cikarma
function Manage({ gid, onChanged }) {
  const { user } = useAuth();
  const info = useAsync(() => api.group(gid), [gid]);
  const [err, setErr] = useState(null);
  const members = info.data?.group?.members || [];
  const remove = async (m) => {
    if (!window.confirm(`${m.display_name} gruptan çıkarılsın mı? Kayıtları bu grupta artık görünmez.`)) return;
    setErr(null);
    try {
      await api.removeMember(gid, m.id);
      info.reload();
      onChanged();
    } catch (x) {
      setErr(x);
    }
  };
  return (
    <div style={{ marginTop: 12 }}>
      <InviteLink gid={gid} />
      <b className="small">Üyeler</b>
      <ErrorBox error={info.error} onRetry={info.reload} />
      <ErrorBox error={err} />
      {members.map((m) => (
        <div className="lrow row" key={m.id} style={{ padding: '6px 0' }}>
          <Avatar user={m} size="sm" />
          <span className="grow">{m.display_name} <span className="muted small">@{m.username}</span></span>
          <span className="chip">{ROLE[m.role] || m.role}</span>
          {m.id !== user.id && m.role !== 'owner' && (
            <button className="btn small ghost" style={{ color: 'var(--danger)' }} onClick={() => remove(m)}>Çıkar</button>
          )}
        </div>
      ))}
    </div>
  );
}
