// v5 testleri icin ortak yardimcilar: admin istemcisi, gecici uye olusturma, sonda temizlik.
const { Client, waitForServer, daysAgo, ymd } = require('./client');

const ADMIN_PW = process.env.ADMIN_PASSWORD || 'test-admin-123';
const PW = 'Deneme123!';
const RUN = Math.random().toString(36).slice(2, 7);

function setup() {
  const ctx = { admin: null, created: [], RUN, PW };
  ctx.before = async () => {
    await waitForServer();
    ctx.admin = new Client();
    const r = await ctx.admin.login('admin', ADMIN_PW);
    if (r.status !== 200) throw new Error('admin girisi: ' + r.status + ' ' + r.text);
  };
  ctx.after = async () => {
    for (const id of ctx.created) await ctx.admin.del(`/api/admin/users/${id}?hard=1`);
  };
  ctx.mkUser = async (label, extra = {}) => {
    const username = `v5x${label}${RUN}`;
    const r = await ctx.admin.post('/api/admin/users', { username, display_name: `V5 ${label} ${RUN}`, password: PW, role: 'member', ...extra });
    if (r.status !== 201) throw new Error('kullanici olusmadi: ' + r.status + ' ' + r.text);
    ctx.created.push(r.json.user.id);
    const c = new Client();
    const l = await c.login(username, PW);
    if (l.status !== 200) throw new Error('giris: ' + l.status + ' ' + l.text);
    return { c, id: r.json.user.id, username, user: r.json.user };
  };
  return ctx;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Europe/Istanbul takvim gunu (backend'in "bugun"u ile ayni); n gun once.
const istDay = (n = 0) => {
  const d = new Date(Date.now() - n * 86400e3);
  return new Intl.DateTimeFormat('sv', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
module.exports = { setup, Client, daysAgo, ymd, ADMIN_PW, PW, RUN, sleep, istDay };
