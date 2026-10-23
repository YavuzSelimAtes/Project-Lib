import { useEffect, useRef } from 'react';
import { api } from './api.js';
import { useAsync } from './ui.jsx';

// Kisitli sezon/bolum secici. Olmayan sezon/bolum secilemez.
// season / episode: sayi ya da '' ; onChange(season, episode)
// allowNone: sezon icin "secme" secenegi (henuz izlemedim)
// refresh: acilirken sezon bilgisini zorla tazele (?refresh=1; dizi yeni secilirken)
// reloadKey: degisince liste yeniden cekilir (kayit 400 verdikten sonra)
// Sezon bilgisi yoksa (catalogId yok / uc hata verdi / bos) eski serbest giris + not.
// Kayitli sezon/bolum listede yoksa (bayat onbellek) SESSIZCE degistirilmez: kayitli deger secenek olarak korunur.
export default function SeasonPicker({ catalogId, season, episode, onChange, allowNone = false, refresh = false, reloadKey = 0 }) {
  const force = useRef(false);
  const { data, loading, reload: rawReload } = useAsync(async () => {
    const refresh2 = refresh || force.current;
    force.current = false;
    if (!catalogId) return { seasons: [], reason: 'none' };
    try {
      return await api.catalogSeasons(catalogId, refresh2);
    } catch (e) {
      if (refresh2) {
        try {
          return await api.catalogSeasons(catalogId, false);
        } catch (e2) {
          return { seasons: [], reason: 'error', error: e2 };
        }
      }
      return { seasons: [], reason: 'error', error: e };
    }
  }, [catalogId, reloadKey]);

  const reload = () => {
    force.current = true;
    rawReload();
  };
  const list = (data?.seasons || []).filter((s) => s && s.episodes > 0).map((s) => ({ ...s }));
  const known = list.length > 0;
  const sNum = season === '' || season == null ? null : Number(season);
  const eNum = episode === '' || episode == null ? null : Number(episode);
  // kayitli konum listeden buyukse (bayat veri) secenek olarak koru
  let extra = false;
  if (known && sNum != null) {
    const found = list.find((s) => s.season === sNum);
    if (!found) {
      list.push({ season: sNum, episodes: Math.max(eNum || 1, 1) });
      extra = true;
    } else if (eNum != null && eNum > found.episodes) {
      found.episodes = eNum;
      extra = true;
    }
  }
  list.sort((a, b) => a.season - b.season);
  const curSeason = list.find((s) => s.season === sNum);

  // sezon secili ama bolum bos -> 1
  useEffect(() => {
    if (known && curSeason && (eNum == null || eNum < 1)) onChange(curSeason.season, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, sNum, eNum]);

  if (catalogId && loading && !data) return <span className="small muted">Sezon bilgisi alınıyor…</span>;

  if (!known) {
    return (
      <>
        <label className="small muted">Sezon</label>
        <input type="number" min="1" value={season ?? ''} onChange={(e) => onChange(e.target.value, episode)} style={{ width: 70 }} aria-label="Sezon" />
        <label className="small muted">Bölüm</label>
        <input type="number" min="1" value={episode ?? ''} onChange={(e) => onChange(season, e.target.value)} style={{ width: 70 }} aria-label="Bölüm" />
        <span className="small muted" style={{ flexBasis: '100%' }}>
          {data?.reason === 'error' ? 'Sezon bilgisi alınamadı (bağlantı sorunu olabilir); sayıları elle yaz.' : 'Bu dizi için sezon bilgisi yok; sayıları elle yaz.'}{' '}
          {catalogId && (
            <button type="button" className="btn small ghost" onClick={reload}>
              Tekrar dene
            </button>
          )}
        </span>
      </>
    );
  }

  return (
    <>
      <select
        value={season ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') return onChange('', '');
          const s = list.find((x) => x.season === Number(v));
          onChange(Number(v), Math.min(Math.max(Number(episode) || 1, 1), s.episodes));
        }}
        className="sp-sel"
        aria-label="Sezon"
      >
        {allowNone && <option value="">Seçme</option>}
        {list.map((s) => (
          <option key={s.season} value={s.season}>
            {s.season}. sezon ({s.episodes})
          </option>
        ))}
      </select>
      {curSeason && (
        <select value={episode ?? 1} onChange={(e) => onChange(curSeason.season, Number(e.target.value))} className="sp-sel" aria-label="Bölüm">
          {Array.from({ length: curSeason.episodes }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}. bölüm / {curSeason.episodes}
            </option>
          ))}
        </select>
      )}
      {extra && (
        <span className="small muted" style={{ flexBasis: '100%' }}>
          Kayıtlı konum güncel listede yok.{' '}
          <button type="button" className="btn small ghost" onClick={reload}>
            Listeyi yenile
          </button>
        </span>
      )}
    </>
  );
}
