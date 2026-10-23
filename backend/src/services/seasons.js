// Dizi sezon/bolum bilgisi (TVMaze): series_seasons tablosu + dogrulama + istatistik yardimcilari
import { tx } from '../db.js';
import { bad } from '../util.js';
import { fetchShowSeasons } from './sources.js';

const DAY = 24 * 3600 * 1000;
const lastFail = new Map(); // catalog_id -> zaman (hata sonrasi 5 dk tekrar denenmez)
const inflight = new Map();

export const seasonRows = (db, catalogId) =>
  db.prepare('SELECT season,episodes,total_episodes,runtime FROM series_seasons WHERE catalog_id=? AND episodes>0 ORDER BY season').all(catalogId);

export function seasonInfo(db, cat) {
  const seasons = seasonRows(db, cat.id);
  return {
    known: seasons.length > 0,
    seasons,
    total_seasons: seasons.length,
    total_episodes: seasons.reduce((a, s) => a + s.episodes, 0),
    runtime: cat.runtime ?? null,
  };
}

// Sezon bilgisini (yoksa ya da devam eden dizide 24 saatten eskiyse) TVMaze'den cekip kaydeder. Asla firlatmaz.
const lastForce = new Map(); // catalog_id -> zorla yenileme zamani (30 sn'den sik yenilenmez)
export async function ensureSeasons(db, cat, { force = false, timeout = 5000 } = {}) {
  if (!cat || cat.type !== 'series' || cat.source !== 'tvmaze' || !cat.external_id) return { ok: true, skipped: true, errors: [] };
  const fresh = db.prepare('SELECT seasons_fetched_at, show_status FROM catalog WHERE id=?').get(cat.id) || {};
  const have = fresh.seasons_fetched_at != null;
  const stale = !have || (fresh.show_status !== 'Ended' && Date.now() - fresh.seasons_fetched_at > DAY);
  if (!force && !stale) return { ok: true, skipped: true, errors: [] };
  if (force && Date.now() - (lastForce.get(cat.id) || 0) < 30 * 1000) return { ok: have, skipped: true, errors: [] };
  if (force) lastForce.set(cat.id, Date.now());
  if (!force && Date.now() - (lastFail.get(cat.id) || 0) < 5 * 60 * 1000) return { ok: have, skipped: true, errors: have ? [] : ['tvmaze: yakin zamanda basarisiz oldu'] };
  if (inflight.has(cat.id)) return inflight.get(cat.id);
  const p = (async () => {
    try {
      const r = await fetchShowSeasons(cat.external_id, timeout);
      tx(db, () => {
        db.prepare('DELETE FROM series_seasons WHERE catalog_id=?').run(cat.id);
        const ins = db.prepare('INSERT INTO series_seasons (catalog_id,season,episodes,total_episodes,runtime) VALUES (?,?,?,?,?)');
        for (const s of r.seasons) ins.run(cat.id, s.season, s.episodes, s.total_episodes, s.runtime ?? null);
        const watchable = r.seasons.filter((s) => s.episodes > 0).length;
        db.prepare('UPDATE catalog SET seasons=COALESCE(?,seasons), runtime=COALESCE(?,runtime), show_status=?, seasons_fetched_at=? WHERE id=?')
          .run(watchable || null, r.runtime ?? null, r.status, Date.now(), cat.id);
      });
      lastFail.delete(cat.id);
      return { ok: true, errors: [] };
    } catch (e) {
      lastFail.set(cat.id, Date.now());
      return { ok: false, errors: [`tvmaze: ${e?.name === 'TimeoutError' ? 'zaman asimi' : e?.message || 'hata'}`] };
    } finally {
      inflight.delete(cat.id);
    }
  })();
  inflight.set(cat.id, p);
  return p;
}

// Dizi kaydinda sezon/bolum dogrulamasi. Bilgi yoksa { unknown:true } (eski serbest davranis).
export function validateSeriesPosition(db, cat, season, episode) {
  const info = seasonInfo(db, cat);
  if (!info.known) return { unknown: true, info };
  if (season !== null && season !== undefined) {
    const s = info.seasons.find((x) => x.season === season);
    if (!s) throw bad(`Bu dizide ${info.total_seasons} sezon var.`, { season: 'gecersiz' });
    if (episode !== null && episode !== undefined && episode > s.episodes) throw bad(`Bu dizide ${season}. sezon ${s.episodes} bolumden olusuyor.`, { episode: 'gecersiz' });
  } else if (episode !== null && episode !== undefined) {
    throw bad('Bolum icin sezonu da secin.', { season: 'gerekli' });
  }
  return { unknown: false, info };
}

// Entry / feed cevabi icin: season_count, episode_count (secili sezon), seasons_unknown
export function seriesExtras(db, catalogId, season, cat = null) {
  const rows = seasonRows(db, catalogId);
  if (!rows.length) return { season_count: null, episode_count: null, seasons_unknown: true };
  const s = season != null ? rows.find((x) => x.season === season) : null;
  return { season_count: rows.length, episode_count: s ? s.episodes : null, seasons_unknown: false };
}

// Dizi kaydinin geldigi konuma kadar izlenen yayinlanmis bolum ve dakika. rows bos ise unknown.
export function watchedOf(rows, e, catalogRuntime = null) {
  if (e.status === 'planlandi') return { episodes: 0, minutes: 0, unknown: false };
  if (!rows.length) return { episodes: 0, minutes: 0, unknown: true };
  let episodes = 0;
  let minutes = 0;
  for (const s of rows) {
    let n = 0;
    if (e.status === 'bitti') n = s.episodes;
    else if (e.season != null) {
      if (s.season < e.season) n = s.episodes;
      else if (s.season === e.season) n = Math.min(e.episode || 0, s.episodes);
    }
    episodes += n;
    minutes += n * (s.runtime ?? catalogRuntime ?? 0);
  }
  return { episodes, minutes, unknown: false };
}

// Dizi kaydi dogrulamasindan ONCE: devam eden dizide bilgi 24 saatten eskiyse ya da istenen sezon/bolum bilinenden buyukse
// reddetmeden once TVMaze'den kisa zaman asimiyla (4 sn) tazeler; hata olursa eski bilgiyle devam eder. Asla firlatmaz.
export async function ensureForPosition(db, cat, season, episode) {
  if (!cat) return;
  await ensureSeasons(db, cat, { timeout: 4000 });
  const info = seasonInfo(db, cat);
  if (!info.known || season == null) return;
  const s = info.seasons.find((x) => x.season === season);
  const beyond = !s || (episode != null && episode > s.episodes);
  if (!beyond) return;
  const st = db.prepare('SELECT show_status FROM catalog WHERE id=?').get(cat.id)?.show_status;
  if (st === 'Ended') return; // bitmis dizide yeni bolum gelmez
  await ensureSeasons(db, cat, { force: true, timeout: 4000 });
}

// Biten dizinin bolum/dakika toplamini bitis aninda entry uzerine sabitler (yeni sezon sonradan sisirmesin).
// Sezon bilgisi yoksa NULL kalir; ilk istatistik hesabinda (bilgi gelince) sabitlenir.
export function pinSeriesFinish(db, entryId) {
  const e = db.prepare('SELECT * FROM entries WHERE id=?').get(entryId);
  if (!e || e.type !== 'series') return;
  if (e.status !== 'bitti') {
    db.prepare('UPDATE entries SET finished_episodes=NULL, finished_minutes=NULL WHERE id=?').run(entryId);
    return;
  }
  const rows = seasonRows(db, e.catalog_id);
  if (!rows.length) { db.prepare('UPDATE entries SET finished_episodes=NULL, finished_minutes=NULL WHERE id=?').run(entryId); return; }
  const crt = db.prepare('SELECT runtime FROM catalog WHERE id=?').get(e.catalog_id)?.runtime ?? null;
  const w = watchedOf(rows, e, crt);
  db.prepare('UPDATE entries SET finished_episodes=?, finished_minutes=? WHERE id=?').run(w.episodes, Math.round(w.minutes), entryId);
}

// Bolum ilerlemesi gunlugu (donemli istatistik icin): konum degisince fark (bolum, dakika) bugune yazilir. Sezon bilgisi yoksa yazilmaz.
export function logSeriesProgress(db, before, after, date) {
  try {
    const rows = seasonRows(db, after.catalog_id);
    if (!rows.length) return;
    const crt = db.prepare('SELECT runtime FROM catalog WHERE id=?').get(after.catalog_id)?.runtime ?? null;
    if (after.status === 'bitti' || after.status === 'planlandi') return; // bitenler bitis aninda sabitlenir
    const b0 = before.status === 'devam' || before.status === 'birakildi' ? before : { ...before, status: 'planlandi' };
    const a = watchedOf(rows, b0, crt);
    const b = watchedOf(rows, after, crt);
    const de = b.episodes - a.episodes;
    const dm = Math.round(b.minutes - a.minutes);
    if (de === 0 && dm === 0) return;
    db.prepare('INSERT INTO series_progress (entry_id,user_id,date,episodes,minutes) VALUES (?,?,?,?,?)').run(after.id, after.user_id, date, de, dm);
  } catch { /* gunluk opsiyonel */ }
}
