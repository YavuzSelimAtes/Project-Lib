import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Avatar, Empty, PageHead, ErrorBox, Skeleton, useAsync } from '../ui.jsx';
import { InviteLink } from './Admin.jsx';
import { flushQueue, queueCount } from '../offlineQueue.js';
import { moveSubscriptionToCurrentUser } from '../pushClient.js';

const ROLE = { owner: 'Yönetici', member: 'Üye' };

// Uyesi oldugum gruplar: ac, ayril, (sahibi isem) yonet
export default function Groups() {
  const { refresh } = useAuth();
  const list = useAsync(() => api.groups(), []);
  const [busy, setBusy] = useState(false);
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

  // Grubu yonetmek = o grubun yonetici hesabina gecmek (tek yol; ayri bir yonetim formu yok)
  const manageGroup = async (g) => {
    setErr(null);
    setBusy(true);
    try {
      await flushQueue();
      if ((await queueCount()) > 0) throw new Error('Bekleyen güncellemelerin var, internet gelince tekrar dene.');
      await api.switchAccount(g.manager.id);
      await moveSubscriptionToCurrentUser();
      window.location.assign('/yonetim');
    } catch (x) {
      setErr(x);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Gruplar" sub="Katıldığın gruplar. Kayıtların hangi gruplarda görüneceğini Hesabım’dan seçersin.">
        <Link className="btn" to="/grup-olustur" style={{ textDecoration: 'none' }}>+ Grup oluştur</Link>
      </PageHead>
      {list.loading && !list.data && <Skeleton h={80} n={2} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      <ErrorBox error={err} />
      {list.data && groups.length === 0 && (
        <Empty icon="👥" title="Henüz bir grubun yok">
          Bir davet linkiyle gruba katılabilir ya da yukarıdan kendi grubunu kurabilirsin.
        </Empty>
      )}
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row grp-row">
            <Link to={`/g/${g.id}`} className="grp-main" title="Grubu aç">
              <b>{g.name}</b>
              <div className="small muted">{g.member_count} üye · {ROLE[g.role] || g.role}</div>
            </Link>
            <div className="grp-actions">
              {g.role === 'owner' ? (
                <Link className="btn small ghost" to="/yonetim/link">Yönet</Link>
              ) : (
                <>
                  {g.manager?.linked && (
                    <button className="btn small ghost" disabled={busy} onClick={() => manageGroup(g)}>Yönet</button>
                  )}
                  <button className="btn small ghost" onClick={() => leave(g)}>Gruptan ayrıl</button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// Grup sahibi: davet linki + ad ayarlari (InviteLink) ve uye cikarma
export function Manage({ gid, onChanged }) {
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
    <>
      <InviteLink gid={gid} />
      <div className="card">
      <h2>Üyeler</h2>
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
    </>
  );
}
