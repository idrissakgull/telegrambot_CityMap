require('dotenv').config();
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userData = {};

// JSON’dan il-ilçe verisini oku
const ilIlceVeri = JSON.parse(fs.readFileSync('illist.json', 'utf-8'));

// Şehir listesi
const cities = ilIlceVeri.map(i => i.il);

// İlçeleri nesne olarak hazırla { il: [ilçeler] }
const districts = {};
ilIlceVeri.forEach(item => {
  districts[item.il] = item.ilceleri;
});

// Kategoriler
const categories = [
  'Hastaneler',
  'Okullar',
  'AVM',
  'Restoranlar',
  'Camiler',
  'Benzin İstasyonları',
  'Oteller'
];

const geoapifyCategoryMap = {
  'Hastaneler': 'healthcare.hospital',
  'Okullar': 'education.school',
  'AVM': 'commercial.shopping_mall',
  'Restoranlar': 'catering.restaurant',
  'Camiler': 'religion.place_of_worship',
  'Benzin İstasyonları': 'service.vehicle.fuel', // düzeltildi
  'Oteller': 'accommodation.hotel',
};


// Emoji eşlemesi
function getCategoryEmoji(kategori) {
  switch (kategori) {
    case 'Hastaneler': return '🏥';
    case 'Okullar': return '🏫';
    case 'AVM': return '🛍️';
    case 'Restoranlar': return '🍽️';
    case 'Camiler': return '🕌';
    case 'Benzin İstasyonları': return '⛽';
    case 'Oteller': return '🏨';
    default: return '📍';
  }
}

// İlçe için koordinat al
async function getCoords(il, ilce) {
  try {
    const response = await axios.get(`https://api.geoapify.com/v1/geocode/search`, {
      params: {
        text: `${ilce}, ${il}, Türkiye`,
        apiKey: GEOAPIFY_KEY,
        limit: 1
      }
    });

    const location = response.data.features[0];
    if (location) {
      return {
        lat: location.geometry.coordinates[1],
        lng: location.geometry.coordinates[0]
      };
    } else {
      return null;
    }

  } catch (e) {
    console.error("Koordinat alınamadı:", e.message);
    return null;
  }
}

// /start komutu - şehir seçimi başlat
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userData[chatId] = {};
  bot.sendMessage(chatId, "🏙️ Şehir seçiniz:", {
    reply_markup: {
      keyboard: cities.map(c => [c]),
      resize_keyboard: true,
    },
  });
});

// Mesaj işleme
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!userData[chatId]) return;
  const current = userData[chatId];

  // Şehir seçimi
  if (cities.includes(text)) {
    current.sehir = text;
    current.ilce = null;
    current.kategori = null;

    const ilceler = districts[text];

    bot.sendMessage(chatId, `🏘️ *${text}* şehri seçildi.\nLütfen bir ilçe seçin:`, {
      reply_markup: {
        keyboard: ilceler.map(i => [i]),
        resize_keyboard: true,
      },
      parse_mode: 'Markdown'
    });
    return;
  }

  // İlçe seçimi
  if (current.sehir && districts[current.sehir] && districts[current.sehir].includes(text)) {
    current.ilce = text;

    bot.sendMessage(chatId, `📍 *${text}* ilçesi seçildi.\nŞimdi kategori seçiniz:`, {
      reply_markup: {
        keyboard: categories.map(k => [k]),
        resize_keyboard: true,
      },
      parse_mode: 'Markdown'
    });
    return;
  }

  // Kategori seçimi
  if (categories.includes(text)) {
    if (!current.ilce) {
      bot.sendMessage(chatId, "Lütfen önce ilçe seçiniz.");
      return;
    }

    current.kategori = text;
    const il = current.sehir;
    const ilce = current.ilce;
    const kategori = current.kategori;

    bot.sendMessage(chatId, `🔍 *${ilce}* ilçesinde *${kategori.toLowerCase()}* aranıyor...`, {
      parse_mode: 'Markdown'
    });

    const geoCategory = geoapifyCategoryMap[kategori];
    const coords = await getCoords(il, ilce);

    if (!coords) {
      bot.sendMessage(chatId, "Konum bulunamadı, lütfen tekrar deneyin.");
      return;
    }

    try {
      const response = await axios.get(`https://api.geoapify.com/v2/places`, {
        params: {
          categories: geoCategory,
          filter: `circle:${coords.lng},${coords.lat},5000`,
          bias: `proximity:${coords.lng},${coords.lat}`,
          limit: 50,
          apiKey: GEOAPIFY_KEY,
        }
      });

      const places = response.data.features;

      if (!places || places.length === 0) {
        bot.sendMessage(chatId, "😔 Hiç sonuç bulunamadı.");
        return;
      }

      for (const place of places) {
        const name = place.properties.name || 'Adı yok';
        const lat = place.geometry.coordinates[1];
        const lng = place.geometry.coordinates[0];
        const emoji = getCategoryEmoji(current.kategori);

        const mapsUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

        await bot.sendMessage(chatId, `${emoji} *${name}*\n📍 [Haritada Aç](${mapsUrl})`, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });
      }

      await bot.sendMessage(chatId, `✅ *${places.length} sonuç listelendi.*`, {
        parse_mode: 'Markdown'
      });

    } catch (err) {
      console.error("Geoapify API hatası:", err.message);
      bot.sendMessage(chatId, "Bir hata oluştu.");
    }
    return;
  }
});
