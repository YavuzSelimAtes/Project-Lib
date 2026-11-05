// Yenilikler penceresi: buton SURUM_TARIHI'nden 3 gun sonra kendiliginden kaybolur. Yeni surumde tarihi ve maddeleri guncelle.
export const WHATS_NEW = {
  date: '2026-11-05',
  days: 3,
  title: 'Neler yeni?',
  items: [
    '📅 Bugün: Liderlik artık “Bugün” sekmesiyle açılır; bugün kim kaç sayfa okudu, ne izledi görürsün. Gece 00:00’da sıfırlanır.',
    '📺 Dizi gün gün: Dizi kartında hangi gün kaç bölüm izlediğini ekleyebilirsin.',
    '💬 Hikaye yorumları: Hikayeyi okurken yorum yazabilir, yorumlara yanıt verebilirsin.',
    '🎨 Rafını düzenle: Hesabım’daki rafta kitapların rengini, görünümünü ve sırasını, rafın rengini değiştirebilirsin. Raf kitap sayısına göre büyür; rafına bakan herkes senin düzenini görür.',
    '⭐ Puanlar: Her başlık için kısa bir yorum yazabilir, “Kim ne puan verdi?” bölümünde herkesin puanını ve ortalamaları görebilirsin.',
    '🔔 Bildirimler: Bildirime dokununca ilgili kitap ya da hikaye açılır. Kitap bitirenler artık bildirimde görünür.',
    '🗄️ Eski bildirimler 5 gün sonra arşive taşınır; arşivde arama yapabilirsin.',
    '🔕 Her grubun bildirimini ayrı ayrı susturabilirsin (bildirim panelinde “Gruplar”).',
    '🎉 Tebrik: Biten kitabında kimlerden tebrik aldığını görürsün; tebrik ettiysen düğme tekrar çıkmaz.',
    '👥 Her hesap en fazla 1 grup oluşturabilir.',
  ],
};
export const whatsNewActive = (now = Date.now()) => now < new Date(WHATS_NEW.date + 'T00:00:00').getTime() + (WHATS_NEW.days + 1) * 86400000;
