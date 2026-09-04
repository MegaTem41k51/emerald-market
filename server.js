const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ЗАМЕНИ ЭТО НА ТВОЙ КЛЮЧ ИЗ STEAM!
const STEAM_API_KEY = 1D1E17D22BC69F0134219BBD500F9F76;

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Файл для хранения пользователей
const DB_FILE = path.join(__dirname, 'users.json');
let users = {};
if (fs.existsSync(DB_FILE)) {
    users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveUsers() { fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2)); }

// Конвертация ID
function convertToSteamId64(steamId) {
    if (/^\d{17}$/.test(steamId)) return steamId;
    if (/^\d{1,10}$/.test(steamId)) return (BigInt(steamId) + 76561197960265728n).toString();
    return null;
}

// Привязка трейд-ссылки
app.post('/api/bind-trade', async (req, res) => {
    const { tradeUrl, username } = req.body;
    if (!tradeUrl || !tradeUrl.includes('partner=')) return res.status(400).json({ error: 'Неверный формат Trade URL' });
    
    const partnerMatch = tradeUrl.match(/partner=(\d+)/);
    if (!partnerMatch) return res.status(400).json({ error: 'Не найден ID партнера' });

    const rawId = partnerMatch[1];
    const steamId = convertToSteamId64(rawId);
    if (!steamId) return res.status(400).json({ error: 'Некорректный Steam ID в ссылке' });

    try {
        const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`;
        const response = await axios.get(apiUrl);
        const player = response.data.response.players[0];
        if (!player) return res.status(404).json({ error: 'Профиль не найден. Проверьте, что ссылка ведет на реальный аккаунт!' });

        users[username] = { username, steamId, steamName: player.personaname, avatar: player.avatarfull, tradeUrl, boundAt: new Date().toISOString() };
        saveUsers();
        res.json({ success: true, player: { name: player.personaname, avatar: player.avatarfull, steamId } });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка при проверке Steam. Проверьте API ключ!' });
    }
});

// Получение инвентаря
app.post('/api/get-inventory', async (req, res) => {
    const { tradeUrl } = req.body;

    const partnerMatch = tradeUrl.match(/partner=(\d+)/);
    if (!partnerMatch) return res.status(400).json({ error: 'Неверный формат Trade URL' });

    const rawId = partnerMatch[1];
    const steamId = convertToSteamId64(rawId);
    if (!steamId) return res.status(400).json({ error: 'Некорректный Steam ID' });

    try {
        // Проверяем аккаунт
        const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`;
        const profileResponse = await axios.get(profileUrl);
        if (!profileResponse.data.response.players[0]) return res.status(404).json({ error: 'Профиль не найден' });

        // ПРОБУЕМ ПОЛУЧИТЬ ИНВЕНТАРЬ ЧЕРЕЗ API С ЗАДЕРЖКОЙ
        await new Promise(r => setTimeout(r, 2000)); // Ждём 2 секунды
        const inventoryUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=300`;
        const inventoryResponse = await axios.get(inventoryUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        
        const inventory = inventoryResponse.data;
        if (!inventory.assets || inventory.assets.length === 0) return res.status(200).json({ success: true, items: [] });

        const items = [];
        const descriptions = {};
        inventory.descriptions.forEach(desc => { descriptions[`${desc.classid}_${desc.instanceid}`] = desc; });

        inventory.assets.forEach(asset => {
            const key = `${asset.classid}_${asset.instanceid}`;
            const desc = descriptions[key];
            if (desc) {
                items.push({ assetid: asset.assetid, name: desc.market_hash_name || desc.name, image: desc.icon_url ? `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}` : '', type: desc.type || '' });
            }
        });

        res.json({ success: true, items });
    } catch (error) {
        console.error(error);
        // Если Steam все еще банит API, используем резервный вариант (HTML)
        try {
            const pageUrl = `https://steamcommunity.com/profiles/${steamId}/inventory`;
            const pageResponse = await axios.get(pageUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            });
            // Проверяем, что страница загрузилась (это значит, что IP не в бане)
            if (pageResponse.status === 200) {
                // Если API забанен, но HTML загружается, просто возвращаем пустой список
                // (Для реального парсинга нужен Cheerio, но это спасет от падения)
                return res.status(200).json({ success: true, items: [], warning: 'API Steam временно недоступен, попробуйте через минуту.' });
            }
        } catch (pageError) {
            console.error('HTML тоже заблокирован:', pageError.status);
        }
        res.status(500).json({ error: 'Не удалось получить инвентарь. Слишком много запросов! Перезапусти сервер и подожди 10 минут.' });
    }
});

app.listen(PORT, () => { console.log(`✅ Сервер запущен на порту ${PORT}`); });