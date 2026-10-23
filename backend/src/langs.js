// Dil kodlari: Open Library 3 harfli (ISO 639-2) -> iki harfli (ISO 639-1); Turkce dil adlari.
const PAIRS = [
  ['eng', 'en', 'İngilizce'], ['tur', 'tr', 'Türkçe'], ['ger', 'de', 'Almanca', 'deu'], ['fre', 'fr', 'Fransızca', 'fra'],
  ['spa', 'es', 'İspanyolca'], ['ita', 'it', 'İtalyanca'], ['rus', 'ru', 'Rusça'], ['ara', 'ar', 'Arapça'],
  ['per', 'fa', 'Farsça', 'fas'], ['jpn', 'ja', 'Japonca'], ['chi', 'zh', 'Çince', 'zho'], ['kor', 'ko', 'Korece'],
  ['por', 'pt', 'Portekizce'], ['dut', 'nl', 'Felemenkçe', 'nld'], ['pol', 'pl', 'Lehçe'], ['swe', 'sv', 'İsveççe'],
  ['nor', 'no', 'Norveççe'], ['dan', 'da', 'Danca'], ['fin', 'fi', 'Fince'], ['gre', 'el', 'Yunanca', 'ell'],
  ['heb', 'he', 'İbranice'], ['hun', 'hu', 'Macarca'], ['cze', 'cs', 'Çekçe', 'ces'], ['rum', 'ro', 'Rumence', 'ron'],
  ['bul', 'bg', 'Bulgarca'], ['ukr', 'uk', 'Ukraynaca'], ['hrv', 'hr', 'Hırvatça'], ['srp', 'sr', 'Sırpça', 'scc'],
  ['hin', 'hi', 'Hintçe'], ['urd', 'ur', 'Urduca'], ['ind', 'id', 'Endonezce'], ['lat', 'la', 'Latince'],
  ['aze', 'az', 'Azerice'], ['cat', 'ca', 'Katalanca'], ['slo', 'sk', 'Slovakça', 'slk'], ['slv', 'sl', 'Slovence'],
  ['lit', 'lt', 'Litvanca'], ['lav', 'lv', 'Letonca'], ['est', 'et', 'Estonca'], ['alb', 'sq', 'Arnavutça', 'sqi'],
  ['arm', 'hy', 'Ermenice', 'hye'], ['geo', 'ka', 'Gürcüce', 'kat'], ['kaz', 'kk', 'Kazakça'], ['uzb', 'uz', 'Özbekçe'],
  ['tat', 'tt', 'Tatarca'], ['kur', 'ku', 'Kürtçe'], ['vie', 'vi', 'Vietnamca'], ['tha', 'th', 'Tayca'],
  ['ben', 'bn', 'Bengalce'], ['may', 'ms', 'Malayca', 'msa'], ['afr', 'af', 'Afrikaanca'], ['ice', 'is', 'İzlandaca', 'isl'],
  ['gle', 'ga', 'İrlandaca'], ['wel', 'cy', 'Galce', 'cym'], ['baq', 'eu', 'Baskça', 'eus'], ['glg', 'gl', 'Galiçyaca'],
  ['mlt', 'mt', 'Maltaca'], ['mac', 'mk', 'Makedonca', 'mkd'], ['bel', 'be', 'Belarusça'], ['yid', 'yi', 'Yidiş'],
  ['san', 'sa', 'Sanskritçe'], ['ltz', 'lb', 'Lüksemburgca'],
  ['pan', 'pa', 'Pencapça'], ['mal', 'ml', 'Malayalamca'], ['tam', 'ta', 'Tamilce'], ['tel', 'te', 'Teluguca'], ['mar', 'mr', 'Marathice'],
  ['nep', 'ne', 'Nepalce'], ['sin', 'si', 'Seylanca (Sinhala)'], ['swa', 'sw', 'Svahili'], ['epo', 'eo', 'Esperanto'], ['bur', 'my', 'Birmanca', 'mya'],
  ['mon', 'mn', 'Moğolca'], ['tib', 'bo', 'Tibetçe', 'bod'], ['amh', 'am', 'Amharca'], ['kan', 'kn', 'Kannadaca'], ['guj', 'gu', 'Guceratça'],
  ['khm', 'km', 'Kmerce'], ['lao', 'lo', 'Laoca'], ['gla', 'gd', 'İskoç Galcesi'], ['bos', 'bs', 'Boşnakça'], ['fry', 'fy', 'Frizce'],
];
export const OL2ISO = {};
export const ISO2OL = {};
export const LABELS = {};
for (const [ol, iso, label, alt] of PAIRS) {
  OL2ISO[ol] = iso;
  if (alt) OL2ISO[alt] = iso;
  ISO2OL[iso] = ol;
  LABELS[iso] = label;
}
const NONE = new Set(['mul', 'und', 'zxx', 'mis']);

// 'tur' / '/languages/tur' / 'tr' -> 'tr' (bilinmeyen iki harf zaten ISO; bilinmeyen uc harf aynen kalir; yoksa null)
export function isoOf(code) {
  if (!code || typeof code !== 'string') return null;
  const c = code.replace('/languages/', '').trim().toLowerCase();
  if (!c || NONE.has(c)) return null;
  if (OL2ISO[c]) return OL2ISO[c];
  if (/^[a-z]{2}$/.test(c)) return c;
  if (/^[a-z]{3}$/.test(c)) return c;
  return null;
}
export const langLabel = (iso) => (iso ? LABELS[iso] || iso.toUpperCase() : null);
export const NO_LANG_LABEL = 'Dil belirtilmemiş';
export const validIso = (v) => typeof v === 'string' && /^[a-z]{2,3}$/.test(v);

// Dili bos gelen baski icin tahmin: yayinevi adi Turkce kalibi tasiyorsa Turkce say (language_guessed isaretlenir)
export function guessLanguage(normPublisher) {
  if (!normPublisher) return null;
  return /\b(yayin|yayinlari|yayinlar|yaynlar|yayincilik|yayinevi|yayinlarii|basimevi|kitabevi|matbaasi)\b/.test(normPublisher) ? 'tr' : null;
}
