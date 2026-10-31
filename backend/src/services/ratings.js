import { bad, err, round1, nowIso, publicUser } from '../util.js';
import { userGroups, ratingVisibleSql, ratingGroupIds } from '../groups.js';

// Kitap puanlama: tur (genre) katalog seviyesindedir (catalog.genre); metrikler sunucuda sabittir.
export const GENRES = {
  kurgu: {
    label: 'Kurgu',
    metrics: [
      { key: 'senaryo', name: 'Senaryo', description: 'Olay örgüsü, sürprizler ve son ne kadar tutarlı ve ilgi çekici?' },
      { key: 'akicilik', name: 'Akıcılık', description: 'Sayfalar kendiliğinden akıp gidiyor mu, yoksa okurken takılıyor muyum?' },
      { key: 'karakterler', name: 'Karakterler', description: 'Karakterler inandırıcı, derin ve akılda kalıcı mı? Karakter gelişimi var mı?' },
      { key: 'dil', name: 'Dil ve Anlatım', description: 'Üslup, kelime seçimi ve betimlemelerin kalitesi.' },
      { key: 'duygu', name: 'Duygusal Etki', description: 'Heyecan, hüzün ya da kahkaha hissettirdi mi; bitince içimde iz bıraktı mı?' },
    ],
  },
  felsefe: {
    label: 'Felsefe',
    metrics: [
      { key: 'onem', name: 'Fikrin Önemi', description: 'Tartışılan düşünce felsefe ve insanlık için ne kadar temel ve önemli?' },
      { key: 'anlasilirlik', name: 'Anlaşılırlık', description: 'Zor konuyu rahatça takip edebildim mi?' },
      { key: 'arguman', name: 'Argüman Gücü', description: 'Savunduğu şeyi tutarlı ve ikna edici şekilde temellendiriyor mu?' },
      { key: 'ornek', name: 'Örnek ve Anlatım', description: 'Örnekler, benzetmeler ve dil kalitesi.' },
      { key: 'butunluk', name: 'Bütünlük', description: 'Konuların sırası ve kitabın tek parça gibi ilerlemesi.' },
    ],
  },
};
export const GENRE_KEYS = Object.keys(GENRES);
export const SCALE = { 1: 'Çok kötü', 2: 'Kötü', 3: 'İdare eder', 4: 'İyi', 5: 'Çok iyi' };

// Katalog turunu ayarla. Bu kitaba zaten puan verilmisse baska ture gecis 409 (metrikler uyusmaz).
export function setGenre(db, catalogId, genre) {
  const cat = db.prepare('SELECT id,type,genre FROM catalog WHERE id=?').get(catalogId);
  if (!cat) throw err(404, 'Katalog kaydi bulunamadi');
  if (genre === null || genre === undefined || genre === '') return cat.genre;
  if (!GENRE_KEYS.includes(genre)) throw bad(`genre su degerlerden biri olmali: ${GENRE_KEYS.join(', ')}`, { genre: 'gecersiz deger' });
  if (cat.type !== 'book') throw bad('Tur sadece kitaplar icin secilir', { genre: 'gecersiz' });
  if (cat.genre === genre) return genre;
  if (cat.genre && db.prepare('SELECT 1 FROM book_ratings WHERE catalog_id=?').get(catalogId)) {
    throw err(409, 'Bu kitaba puan verilmis; tur artik degistirilemez', { genre: 'puanli' });
  }
  db.prepare('UPDATE catalog SET genre=? WHERE id=?').run(genre, catalogId);
  return genre;
}

// Kitap puani ozeti: tum kullanici puanlarinin tum metriklerle ortalamasi + kullanici ve metrik bazli ortalamalar
// Bakan kisinin (meId) gorebildigi puanlarla sinirli: kendi puani + uyesi oldugu gruplara (groupIds ile tek gruba) acik olanlar
export function ratingSummary(db, catalogId, meId = null, groupIds = null) {
  const cat = db.prepare('SELECT id,genre FROM catalog WHERE id=?').get(catalogId);
  const gids = groupIds || (meId != null ? userGroups(db, meId).map((g) => g.id) : []);
  const rows = db.prepare(`SELECT r.user_id,r.metric,r.score FROM book_ratings r WHERE r.catalog_id=? AND ${ratingVisibleSql(meId ?? 0, gids, 'r')} ORDER BY r.user_id`).all(catalogId);
  const users = new Map();
  const metricSum = {};
  let total = 0;
  for (const r of rows) {
    if (!users.has(r.user_id)) users.set(r.user_id, {});
    users.get(r.user_id)[r.metric] = r.score;
    (metricSum[r.metric] ||= []).push(r.score);
    total += r.score;
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const byUser = [...users].map(([uid, scores]) => ({
    user: publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(uid)),
    scores, average: round1(mean(Object.values(scores))),
  }));
  const byMetric = {};
  for (const [k, a] of Object.entries(metricSum)) byMetric[k] = round1(mean(a));
  const mine = meId != null && users.has(meId) ? { scores: users.get(meId), average: round1(mean(Object.values(users.get(meId)))) } : null;
  return {
    catalog_id: catalogId, genre: cat?.genre ?? null,
    metrics: cat?.genre ? GENRES[cat.genre].metrics : [],
    average: rows.length ? Math.round((total / rows.length) * 100) / 100 : null, // tum puanlarin ortalamasi (2 basamak)
    count: users.size, by_user: byUser, by_metric: byMetric, mine,
    mine_group_ids: meId != null ? ratingGroupIds(db, meId, catalogId) : [],
  };
}

// Puan verme kurali: kitap, kullanicinin kayitlarinda 'bitti' / 'birakildi' durumunda olmali (planlandi ve devam yetmez)
export const canRate = (db, userId, catalogId) => !!db.prepare("SELECT 1 FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? AND e.catalog_id=? AND c.type='book' AND e.status IN ('bitti','birakildi')").get(userId, catalogId);

export function saveRatings(db, userId, catalogId, genre, scores) {
  const g = setGenre(db, catalogId, genre);
  if (!g) throw bad('Once kitabin turunu secin (genre: kurgu | felsefe)', { genre: 'gerekli' });
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw bad('scores nesne olmali', { scores: 'gecersiz' });
  const keys = GENRES[g].metrics.map((m) => m.key);
  for (const k of Object.keys(scores)) if (!keys.includes(k)) throw bad(`Bilinmeyen metrik: ${k}`, { scores: 'gecersiz metrik' });
  for (const k of keys) {
    const v = scores[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw bad(`${k} icin 1-5 arasi tam sayi puan gerekli`, { scores: `${k}: 1-5` });
  }
  const now = nowIso();
  const up = db.prepare(`INSERT INTO book_ratings (user_id,catalog_id,metric,score,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id,catalog_id,metric) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at`);
  for (const k of keys) up.run(userId, catalogId, k, scores[k], now, now);
}
