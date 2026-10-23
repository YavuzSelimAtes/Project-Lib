// Populer kitap/film/dizi listesinden katalog doldurur. Nazik: istekler arasi bekler, hata olursa atlar.
// Kullanim: npm run seed            (hepsi)
//           npm run seed -- book    (sadece bir tur: book|movie|series)
// Tekrar calistirmak guvenlidir (var olanlari atlar).
import { openDb } from '../src/db.js';
import { searchBooksOL, searchBooksGoogle, searchSeries, searchMovies, norm } from '../src/services/sources.js';
import { insertCatalog, downloadCover, findExisting } from '../src/services/catalog.js';

// [arama metni, beklenen baslik parcasi (opsiyonel dogrulama)]
const BOOKS = [
  'Suç ve Ceza Dostoyevski', 'Karamazov Kardeşler Dostoyevski', 'Budala Dostoyevski', 'Yeraltından Notlar Dostoyevski', 'Savaş ve Barış Tolstoy',
  'Anna Karenina Tolstoy', 'İvan İlyiç\'in Ölümü Tolstoy', 'Bülbülü Öldürmek Harper Lee', '1984 George Orwell', 'Hayvan Çiftliği George Orwell',
  'Cesur Yeni Dünya Aldous Huxley', 'Fahrenheit 451 Ray Bradbury', 'Küçük Prens Saint-Exupéry', 'Sefiller Victor Hugo', 'Notre Dame\'ın Kamburu Victor Hugo',
  'Simyacı Paulo Coelho', 'Veronika Ölmek İstiyor Paulo Coelho', 'Yüzüklerin Efendisi Tolkien', 'Hobbit Tolkien', 'Harry Potter ve Felsefe Taşı',
  'Harry Potter ve Sırlar Odası', 'Harry Potter ve Azkaban Tutsağı', 'Narnia Günlükleri Aslan Cadı ve Dolap C.S. Lewis', 'Charlie\'nin Çikolata Fabrikası Roald Dahl', 'Matilda Roald Dahl',
  'Küçük Kadınlar Louisa May Alcott', 'Gurur ve Önyargı Jane Austen', 'Emma Jane Austen', 'Jane Eyre Charlotte Bronte', 'Uğultulu Tepeler Emily Bronte',
  'Dorian Gray\'in Portresi Oscar Wilde', 'Dracula Bram Stoker', 'Frankenstein Mary Shelley', 'Dr. Jekyll ve Mr. Hyde Stevenson', 'Define Adası Stevenson',
  'Robinson Crusoe Defoe', 'Gulliver\'in Gezileri Swift', 'Oliver Twist Dickens', 'Büyük Umutlar Dickens', 'Bir Noel Şarkısı Dickens',
  'Tom Sawyer\'ın Maceraları Mark Twain', 'Huckleberry Finn\'in Maceraları Mark Twain', 'Denizler Altında Yirmi Bin Fersah Jules Verne', 'Dünyanın Merkezine Yolculuk Jules Verne', 'Seksen Günde Devrialem Jules Verne',
  'Yaşlı Adam ve Deniz Hemingway', 'Çan Kimin İçin Çalıyor Hemingway', 'Muhteşem Gatsby Fitzgerald', 'Gazap Üzümleri Steinbeck', 'Fareler ve İnsanlar Steinbeck',
  'Çavdar Tarlasında Çocuklar Salinger', 'Sineklerin Tanrısı William Golding', 'Yabancı Albert Camus', 'Veba Albert Camus', 'Dönüşüm Franz Kafka',
  'Dava Franz Kafka', 'Şato Franz Kafka', 'Körlük Jose Saramago', 'Yüzyıllık Yalnızlık Gabriel Garcia Marquez', 'Kolera Günlerinde Aşk Marquez',
  'Da Vinci Şifresi Dan Brown', 'Melekler ve Şeytanlar Dan Brown', 'Doğu Ekspresinde Cinayet Agatha Christie', 'Nil\'de Ölüm Agatha Christie', 'Ve Sonra Hiç Kimse Kalmadı Agatha Christie',
  'Sherlock Holmes Kızıl Dosya Conan Doyle', 'Baskerville\'lerin Köpeği Conan Doyle', 'Hızlı ve Yavaş Düşünme Kahneman', 'Sapiens Yuval Noah Harari', 'Homo Deus Harari',
  'Atomik Alışkanlıklar James Clear', 'Dune Frank Herbert', 'Vakıf Isaac Asimov', 'Otostopçunun Galaksi Rehberi Douglas Adams', 'Oyunun Kuralları Hunger Games Suzanne Collins',
  'Açlık Oyunları Suzanne Collins', 'Percy Jackson Şimşek Hırsızı', 'Kitap Hırsızı Markus Zusak', 'Bir Delinin Hatıra Defteri Gogol', 'Ölü Canlar Gogol',
  'Usta ile Margarita Bulgakov', 'Doktor Jivago Pasternak', 'Tüfek Mikrop Çelik Jared Diamond', 'Nutuk Mustafa Kemal Atatürk', 'İnce Memed Yaşar Kemal',
  'Yılanı Öldürseler Yaşar Kemal', 'Kuyucaklı Yusuf Sabahattin Ali', 'Kürk Mantolu Madonna Sabahattin Ali', 'İçimizdeki Şeytan Sabahattin Ali', 'Tutunamayanlar Oğuz Atay',
  'Saatleri Ayarlama Enstitüsü Ahmet Hamdi Tanpınar', 'Huzur Ahmet Hamdi Tanpınar', 'Çalıkuşu Reşat Nuri Güntekin', 'Yaprak Dökümü Reşat Nuri Güntekin', 'Aşk-ı Memnu Halit Ziya',
  'Sinekli Bakkal Halide Edib Adıvar', 'Mai ve Siyah Halit Ziya Uşaklıgil', 'Araba Sevdası Recaizade Mahmut Ekrem', 'Safahat Mehmet Akif Ersoy', 'Kuyucaklı Yusuf',
  'Benim Adım Kırmızı Orhan Pamuk', 'Kar Orhan Pamuk', 'Masumiyet Müzesi Orhan Pamuk', 'Kara Kitap Orhan Pamuk', 'Beyaz Kale Orhan Pamuk',
  'Şu Çılgın Türkler Turgut Özakman', 'Bir Ömür Nasıl Yaşanır Ahmet Hamdi', 'Ayışığında Çalışkan Abdülhamit', 'Sefiller Hugo', 'Çocukluğum Maksim Gorki',
  'Memleketimden İnsan Manzaraları Nazım Hikmet', 'Kuvayi Milliye Destanı Nazım Hikmet', 'Karagöz Yılmaz Güney', 'Dokuzuncu Hariciye Koğuşu Peyami Safa', 'Fatih-Harbiye Peyami Safa',
  'Nasreddin Hoca Fıkraları', 'Ince Memed 1', 'Çalıkuşu', 'Yedi Güzel Adam Cahit Sıtkı', 'Zeytindağı Falih Rıfkı Atay',
  'Sherlock Holmes Çiğ Etüt Kırmızıyla Doyle', 'Alice Harikalar Diyarında Lewis Carroll', 'Peter Pan J.M. Barrie', 'Pinokyo Carlo Collodi', 'Heidi Johanna Spyri',
  'Pippi Uzunçorap Astrid Lindgren', 'Momo Michael Ende', 'Bitmeyen Öykü Michael Ende', 'Gece Yarısı Kütüphanesi Matt Haig', 'Hayat Kitabı Elif Şafak',
  'İskender Elif Şafak', 'Aşk Elif Şafak Forty Rules', 'Kürk Mantolu Madonna', 'Şeker Portakalı José Mauro de Vasconcelos', 'Bir Gün Ahmet Ümit',
  'Sultanı Öldürmek Ahmet Ümit', 'Kavim Ahmet Ümit', 'Beyoğlu Rapsodisi Ahmet Ümit', 'Çocuklar İçin Felsefe',
];
const MOVIES = [
  'Inception', 'The Shawshank Redemption', 'The Godfather', 'The Dark Knight', 'Pulp Fiction', 'Forrest Gump', 'Fight Club', 'The Matrix', 'Interstellar', 'Gladiator',
  'Titanic', 'Avatar', 'Jurassic Park', 'Star Wars', 'Back to the Future', 'The Lion King', 'Toy Story', 'Finding Nemo', 'Up', 'WALL-E',
  'Coco', 'Frozen', 'Shrek', 'Harry Potter and the Philosopher\'s Stone', 'The Lord of the Rings: The Fellowship of the Ring', 'The Hobbit: An Unexpected Journey', 'Spirited Away', 'My Neighbor Totoro', 'Ratatouille', 'Inside Out',
  'Life Is Beautiful', 'Cinema Paradiso', 'Amélie', 'Parasite', 'Schindler\'s List', 'Saving Private Ryan', 'Braveheart', 'The Green Mile', 'Home Alone', 'Mrs. Doubtfire',
  'Eşkıya', 'Hababam Sınıfı', 'G.O.R.A.', 'Vizontele', 'Babam ve Oğlum', 'Kelebeğin Rüyası', 'Recep İvedik', 'Düğün Dernek', 'Organize İşler', 'Ayla',
  'Av Mevsimi', 'Selvi Boylum Al Yazmalım', 'Tosun Paşa', 'Çalgı Çengi', 'Müslüm', 'Kış Uykusu', 'Bir Zamanlar Anadolu\'da', 'Yedi Kocalı Hürmüz', 'Neşeli Günler', 'Kurtlar Vadisi Irak',
];
const SERIES = [
  'Breaking Bad', 'Game of Thrones', 'Friends', 'The Office', 'Stranger Things', 'The Big Bang Theory', 'How I Met Your Mother', 'Sherlock', 'Doctor Who', 'The Crown',
  'Peaky Blinders', 'Money Heist', 'Dark', 'The Witcher', 'Black Mirror', 'Better Call Saul', 'The Mandalorian', 'Lost', 'Prison Break', 'House',
  'Modern Family', 'Brooklyn Nine-Nine', 'Seinfeld', 'The Simpsons', 'Rick and Morty', 'Avatar: The Last Airbender', 'Planet Earth', 'Chernobyl', 'The Queen\'s Gambit', 'Squid Game',
  'Kurtlar Vadisi', 'Leyla ile Mecnun', 'Behzat Ç. Bir Ankara Polisiyesi', 'Avrupa Yakası', 'Gönül Dağı', 'Aşk-ı Memnu', 'Diriliş: Ertuğrul', 'Muhteşem Yüzyıl', 'Ezel', 'Poyraz Karayel',
  'Şahsiyet', 'Masumlar Apartmanı', 'Bir Başkadır', 'Çocuklar Duymasın', 'Yalan Dünya', 'Cennet Mahallesi', 'Kuzey Güney', 'Ben de Özledim', 'Hanım Köylü', 'Eşkıya Dünyaya Hükümdar Olmaz',
  'Mucize Doktor', 'Bizim Hikaye', 'Kimse Bilmez', 'Yaprak Dökümü', 'Sihirli Annem', 'Arka Sokaklar', 'Kardeşlerim', 'Saygı', 'Çukur', 'Kara Para Aşk',
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];
const db = openDb();

async function lookup(type, q) {
  if (type === 'book') {
    // arama sorgusunda yazar adi basliga karismasin diye once tum metin, bulunamazsa son kelimeler atilir
    let items = [];
    try { items = await searchBooksOL(q, 5, 'tur'); } catch { /* yedege gec */ }
    if (!items.length) { try { items = await searchBooksOL(q, 5); } catch { /* yedege gec */ } }
    if (!items.length) { try { items = await searchBooksGoogle(q, 3); } catch { /* yoksay */ } }
    if (!items.length) {
      const words = q.split(' ');
      if (words.length > 2) { try { items = await searchBooksOL(words.slice(0, -1).join(' '), 5); } catch { /* yoksay */ } }
    }
    // Kapagi ve sayfa sayisi olani tercih et
    const latin = (x) => (/[Ѐ-ӿ]/.test(x.title) ? 0 : 3);
    items.sort((a, b) => latin(b) + (b.cover_remote ? 2 : 0) + (b.pages ? 1 : 0) - (latin(a) + (a.cover_remote ? 2 : 0) + (a.pages ? 1 : 0)));
    return items[0] || null;
  }
  if (type === 'series') return (await searchSeries(q, 3))[0] || null;
  return (await searchMovies(q, 3))[0] || null;
}

async function run(type, list) {
  let added = 0, skipped = 0, failed = 0;
  const gap = type === 'movie' ? 1500 : 500;
  for (const q of list) {
    try {
      let it;
      try { it = await lookup(type, q); } catch (e) {
        if (!/429/.test(e.message)) throw e;
        await delay(15000); // kaynak sinirladi: bekle, bir kez daha dene
        it = await lookup(type, q);
      }
      if (!it) { failed++; console.log(`  - bulunamadi: ${q}`); await delay(gap); continue; }
      it.type = type;
      if (findExisting(db, it)) { skipped++; await delay(100); continue; }
      const cover = it.cover_remote ? await downloadCover(it.cover_remote) : null;
      insertCatalog(db, { ...it, cover_url: cover });
      added++;
      console.log(`  + ${it.title}${it.year ? ` (${it.year})` : ''}${cover ? '' : ' [kapak yok]'}`);
    } catch (e) {
      failed++;
      console.log(`  ! hata (${q}): ${e.message}`);
    }
    await delay(gap);
  }
  console.log(`${type}: ${added} eklendi, ${skipped} zaten vardi, ${failed} basarisiz`);
}

console.log('Katalog dolduruluyor (internet gerekir, birkac dakika surebilir)...');
if (!only || only === 'book') await run('book', [...new Set(BOOKS)]);
if (!only || only === 'series') await run('series', [...new Set(SERIES)]);
if (!only || only === 'movie') await run('movie', [...new Set(MOVIES)]);
const c = db.prepare('SELECT type, COUNT(*) n FROM catalog GROUP BY type').all();
console.log('Katalog durumu:', c.map((r) => `${r.type}=${r.n}`).join(' '));
db.close();
