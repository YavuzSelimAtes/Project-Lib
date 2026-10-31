// DEMO VERI: calisan sunucunun API'sine konusur (hesaplar, gruplar + otomatik yonetici hesaplari, katalog, kayitlar, puan/yorum).
// Kullanim:  cd backend && node scripts/seed-demo.js        (sunucu acik olmali; BASE_URL ile degisir, varsayilan http://localhost:4000)
// Tekrar calistirilabilir: var olan hesap/grup/katalog atlanir; kaydi olan hesaba tekrar kayit eklenmez.
// Hepsi herkese acik DEMO sifresidir (gercek sifre degil); sadece yerel/test veritabani icin.
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const DEMO_PW = 'demo1234';

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return ymd(d); };

function client() {
  let ck = '';
  const call = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  return call;
}
const ok = (r, what) => { if (r.s >= 300) throw new Error(`${what}: ${r.s} ${JSON.stringify(r.j)}`); return r; };

const USERS = [
  { username: 'demo-ysa', display_name: 'Yaşar', avatar: '🦊', color: '#e11d48' },
  { username: 'demo-ada', display_name: 'Ada', avatar: '🐱', color: '#9333ea' },
  { username: 'demo-mert', display_name: 'Mert', avatar: '🐻', color: '#2563eb' },
  { username: 'demo-deniz', display_name: 'Deniz', avatar: '🐬', color: '#0891b2' },
  { username: 'demo-kaan', display_name: 'Kaan', avatar: '🦉', color: '#16a34a' },
];
// kisi basina: bitmis kitap sayisi, devam eden kitaplar, dizi / film
const PLAN = {
  'demo-ysa': { done: 12, reading: 2, series: [['Çarpışma', 2, 5]], movies: ['Coco'] },
  'demo-ada': { done: 0, reading: 1, series: [], movies: ['Inception'] },
  'demo-mert': { done: 8, reading: 1, series: [['Avrupa Yakası', 1, 9]], movies: ['Eşkıya', 'Titanic'] },
  'demo-deniz': { done: 6, reading: 2, series: [['The Office', 3, 4]], movies: ['Coco'] },
  'demo-kaan': { done: 4, reading: 1, series: [], movies: ['Babam ve Oğlum'] },
};
const GROUPS = [
  { name: 'Aile Kütüphanesi', creator: 'demo-ysa', members: ['demo-ada', 'demo-mert', 'demo-deniz'] },
  { name: 'Kitap Kulübü', creator: 'demo-deniz', members: ['demo-ysa', 'demo-kaan'] },
];
// [baslik, yazar, sayfa]: 30-60, ~120, ~250, ~400, ~600, 900+ sayfa
const BOOKS = [
  ['Kısa Öyküler Seçkisi', 'Çeşitli Yazarlar', 32], ['Şiir Defteri', 'Demo Şair', 48], ['Çocuk Masalları', 'Demo Yazar', 58],
  ['Hayvan Çiftliği', 'George Orwell', 120], ['Ağrı Dağı Efsanesi', 'Yaşar Kemal', 124], ['Kürk Mantolu Madonna', 'Sabahattin Ali', 160],
  ['Sineklerin Tanrısı', 'William Golding', 248], ['Beyaz Diş', 'Jack London', 256], ['Harry Potter ve Felsefe Taşı', 'J.K. Rowling', 336],
  ['Saatleri Ayarlama Enstitüsü', 'Ahmet Hamdi Tanpınar', 408], ['İnce Memed', 'Yaşar Kemal', 436], ['Çalıkuşu', 'Reşat Nuri Güntekin', 480],
  ['Suç ve Ceza', 'Fyodor Dostoyevski', 596], ['Tutunamayanlar', 'Oğuz Atay', 724], ['Don Kişot', 'Miguel de Cervantes', 944],
  ['Yüzüklerin Efendisi', 'J.R.R. Tolkien', 1178], ['Sefiller', 'Victor Hugo', 1488], ['Simyacı', 'Paulo Coelho', 184],
];
const SERIES = [['Çarpışma', 3], ['Avrupa Yakası', 5], ['The Office', 9], ['Breaking Bad', 5]];
const MOVIES = ['Coco', 'Inception', 'Eşkıya', 'Titanic', 'Babam ve Oğlum'];
const COMMENTS = ['Çok sürükleyiciydi, tavsiye ederim.', 'Sonu beklediğimden farklıydı.', 'Biraz yavaş başladı ama değdi.', 'Karakterler çok canlı.', 'Tekrar okurum.', 'Dili ağır ama güzel.'];

async function main() {
  const probe = await fetch(BASE + '/api/auth/me').catch(() => null);
  if (!probe) { console.error(`Sunucu yok: ${BASE} (once sunucuyu baslatin)`); process.exit(1); }

  // ---- hesaplar ----
  const U = {};
  for (const u of USERS) {
    const c = client();
    let r = await c('POST', '/api/auth/register', { ...u, password: DEMO_PW });
    if (r.s === 409) r = ok(await c('POST', '/api/auth/login', { username: u.username, password: DEMO_PW }), `giris ${u.username}`);
    else ok(r, `kayit ${u.username}`);
    const me = ok(await c('GET', '/api/auth/me'), 'me').j.user;
    U[u.username] = { c, id: me.id, name: u.username };
  }

  // ---- gruplar + yonetici hesaplari + uyeler ----
  const G = {};
  for (const g of GROUPS) {
    const cr = U[g.creator];
    const mine = ok(await cr.c('GET', '/api/groups'), 'gruplar').j.groups;
    let grp = mine.find((x) => x.name === g.name);
    if (!grp) grp = ok(await cr.c('POST', '/api/groups', { name: g.name }), `grup ${g.name}`).j.group;
    const linked = ok(await cr.c('GET', '/api/auth/linked'), 'linked').j.accounts;
    const mgr = linked.find((a) => a.is_manager && a.managed_group_id === grp.id);
    if (!mgr) throw new Error(`yonetici hesap bulunamadi: ${g.name}`);
    const mc = client(); // yonetici hesaba gecis: kisisel hesapla giris + switch
    ok(await mc('POST', '/api/auth/login', { username: g.creator, password: DEMO_PW }), 'giris');
    ok(await mc('POST', '/api/auth/switch', { user_id: mgr.id }), 'gecis');
    const tok = ok(await mc('GET', `/api/groups/${grp.id}/invite`), 'davet').j.token;
    for (const m of g.members) {
      const has = ok(await U[m].c('GET', '/api/groups'), 'gruplar').j.groups.some((x) => x.id === grp.id);
      if (!has) ok(await U[m].c('POST', `/api/join/${tok}`, {}), `katilim ${m}`);
    }
    G[g.name] = { id: grp.id, mc, mgrName: mgr.display_name };
  }
  const mc = G[GROUPS[0].name].mc; // katalog ekleme: grup yonetici hesabi

  // ---- katalog ----
  const cat = async (type, title, author, pages, extra = {}) => {
    let r = await mc('POST', '/api/admin/catalog', { type, title, author_or_creator: author, pages, year: ri(1950, 2022), description: 'Demo kaydı', ...extra });
    if (r.s === 409) {
      const q = ok(await mc('GET', `/api/admin/catalog?type=${type}&q=${encodeURIComponent(title)}&limit=50`), 'katalog ara').j;
      const f = (q.items || []).find((i) => i.title === title);
      if (f) return f.id;
    }
    return ok(r, `katalog ${title}`).j.item.id;
  };
  const bookId = {}, serId = {}, movId = {};
  for (const [t, a, p] of BOOKS) bookId[t] = await cat('book', t, a, p);
  for (const [t, n] of SERIES) serId[t] = await cat('series', t, 'Demo', null, { seasons: n });
  for (const t of MOVIES) movId[t] = await cat('movie', t, 'Demo', null);

  // ---- kayitlar ----
  const summary = {};
  const keys = Object.keys(bookId);
  let rot = 0;
  const metrics = ok(await U['demo-ysa'].c('GET', '/api/book-metrics'), 'metrikler').j.genres.kurgu.metrics.map((m) => m.key);
  for (const [uname, plan] of Object.entries(PLAN)) {
    const u = U[uname];
    const have = ok(await u.c('GET', '/api/entries'), 'kayitlar').j;
    const n = (have.entries || have.items || []).length;
    if (n > 0) { summary[uname] = `atlandi (${n} kayit var)`; continue; }
    // dagilimli kitap secimi: her kisi farkli noktadan baslar, tekrar etmez
    const order = keys.map((_, i) => keys[(i * 5 + rot * 3 + i) % keys.length]).filter((k, i, a) => a.indexOf(k) === i);
    for (const k of keys) if (!order.includes(k)) order.push(k);
    rot++;
    let done = 0, idx = 0;
    while (done < plan.done && idx < order.length) {
      const title = order[idx++], pages = BOOKS.find((b) => b[0] === title)[2];
      // gun gun okunmus gibi: bitisten onceki gunler backfill ile, bitis gunu progress ile (sayfalar isi/rafi besler)
      const n = Math.max(3, Math.min(28, Math.round(pages / ri(30, 60)))), endAgo = ri(1, 88 - n), base = Math.max(1, Math.floor(pages / (n + 1)));
      const days = [];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0 && rnd() < 0.2) continue; // arada okunmayan gunler
        const p = Math.max(1, Math.min(base + ri(-Math.floor(base / 3), Math.floor(base / 3)), pages - 1 - sum - 1));
        if (p < 1 || sum + p >= pages) break;
        days.push({ date: daysAgo(endAgo + n - i), pages: p }); sum += p;
      }
      if (!days.length) days.push({ date: daysAgo(endAgo + n), pages: 1 }), sum = 1;
      const r = ok(await u.c('POST', '/api/entries', { catalog_id: bookId[title], status: 'devam', start_date: daysAgo(endAgo + n + 1), current_page: sum, backfill: 'manual', days }), `bitmis ${title}`);
      ok(await u.c('POST', `/api/entries/${r.j.entry.id}/progress`, { current_page: pages, date: daysAgo(endAgo) }), `bitir ${title}`);
      done++;
      if (rnd() < 0.55) {
        const scores = Object.fromEntries(metrics.map((m) => [m, ri(3, 5)]));
        ok(await u.c('PUT', `/api/catalog/${bookId[title]}/ratings`, { genre: 'kurgu', scores }), 'puan');
      }
      if (rnd() < 0.4) ok(await u.c('POST', `/api/entries/${r.j.entry.id}/comments`, { body: COMMENTS[ri(0, COMMENTS.length - 1)] }), 'yorum');
    }
    // okuyor: gunluk kayitlarla bugune kadar seri
    let reading = 0;
    while (reading < plan.reading && idx < order.length) {
      const title = order[idx++], pages = BOOKS.find((b) => b[0] === title)[2];
      if (pages < 250) continue;
      const len = ri(5, 12), days = [];
      let sum = 0;
      for (let i = len; i >= 1; i--) { const p = ri(8, Math.min(40, Math.floor(pages / (len * 2)))); days.push({ date: daysAgo(i), pages: p }); sum += p; }
      const e = ok(await u.c('POST', '/api/entries', { catalog_id: bookId[title], status: 'devam', start_date: days[0].date, current_page: sum, backfill: 'manual', days }), `okuyor ${title}`).j.entry;
      ok(await u.c('POST', `/api/entries/${e.id}/progress`, { current_page: sum + ri(8, 30) }), 'bugun ilerleme'); // bugune kadar seri
      reading++;
    }
    for (const [t, season, episode] of plan.series) ok(await u.c('POST', '/api/entries', { catalog_id: serId[t], status: 'devam', season, episode }), `dizi ${t}`);
    for (const t of plan.movies) ok(await u.c('POST', '/api/entries', { catalog_id: movId[t], status: 'bitti', end_date: daysAgo(ri(1, 60)) }), `film ${t}`);
    summary[uname] = `${done} bitmiş kitap, ${reading} okuyor, ${plan.series.length} dizi, ${plan.movies.length} film`;
  }

  console.log('Demo veri hazır. Şifre (hepsi): ' + DEMO_PW);
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  for (const g of GROUPS) console.log(`  grup "${g.name}" (id ${G[g.name].id}): ${[g.creator, ...g.members].join(', ')} — yönetici hesap: ${G[g.name].mgrName}`);
}
main().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
