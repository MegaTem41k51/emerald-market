const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const Inventory = require('steam-inventory-api-ng');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// НАСТРОЙКИ ПРОКСИ
// ==========================================
const PROXIES = [
    'http://qigocgbt:7sdfc9sdwkkv@31.59.20.176:6754'
];
// ==========================================
// 2. Если хотите использовать переменные окружения Render, оставьте пустым:
// const PROXIES = process.env.PROXIES ? process.env.PROXIES.split(',') : [];
// ==========================================

const STEAM_API_KEY = process.env.STEAM_API_KEY; // Ключ из переменных окружения Render

app.use(bodyParser.json());
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'users.json');
let users = {};
if (fs.existsSync(DB_FILE)) {
    users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveUsers() { fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2)); }

function convertToSteamId64(steamId) {
    if (/^\d{17}$/.test(steamId)) return steamId;
    if (/^\d{1,10}$/.test(steamId)) return (BigInt(steamId) + 76561197960265728n).toString();
    return null;
}

// Функция для создания axios-клиента с прокси
function createAxiosWithProxy() {
    if (PROXIES.length === 0) {
        // Если прокси не указаны, работаем напрямую (может быть забанено)
        return axios.create({ timeout: 10000 });
    }

    const proxyUrl = PROXIES[Math.floor(Math.random() * PROXIES.length)];
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const httpsAgent = new HttpsProxyAgent(proxyUrl);

    return axios.create({ httpsAgent, timeout: 10000 });
}

app.post('/api/bind-trade', async (req, res) => {
    const { tradeUrl, username } = req.body;
    if (!tradeUrl || !tradeUrl.includes('partner=')) return res.status(400).json({ error: 'Неверный формат Trade URL' });
    
    const partnerMatch = tradeUrl.match(/partner=(\d+)/);
    if (!partnerMatch) return res.status(400).json({ error: 'Не найден ID партнера' });

    const rawId = partnerMatch[1];
    const steamId = convertToSteamId64(rawId);
    if (!steamId) return res.status(400).json({ error: 'Некорректный Steam ID в ссылке' });

    try {
        const client = createAxiosWithProxy();
        const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`;
        const response = await client.get(apiUrl);
        const player = response.data.response.players[0];
        if (!player) return res.status(404).json({ error: 'Профиль не найден. Проверьте, что ссылка ведет на реальный аккаунт!' });

        users[username] = { username, steamId, steamName: player.personaname, avatar: player.avatarfull, tradeUrl, boundAt: new Date().toISOString() };
        saveUsers();
        res.json({ success: true, player: { name: player.personaname, avatar: player.avatarfull, steamId } });
    } catch (error) {
        console.error('Ошибка при привязке:', error.message);
        res.status(500).json({ error: 'Ошибка при проверке Steam. Проверьте API ключ!' });
    }
});

app.post('/api/get-inventory', async (req, res) => {
    const { tradeUrl } = req.body;

    const partnerMatch = tradeUrl.match(/partner=(\d+)/);
    if (!partnerMatch) return res.status(400).json({ error: 'Неверный формат Trade URL' });

    const rawId = partnerMatch[1];
    const steamId = convertToSteamId64(rawId);
    if (!steamId) return res.status(400).json({ error: 'Некорректный Steam ID' });

    try {
        const client = createAxiosWithProxy();
        
        const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`;
        const profileResponse = await client.get(profileUrl);
        if (!profileResponse.data.response.players[0]) return res.status(404).json({ error: 'Профиль не найден' });

        // Используем steam-inventory-api-ng для получения инвентаря
        const options = {
            steamID: steamId,
            appID: '730',
            contextID: '2',
            method: 'new',
            language: 'english'
        };

        // Пробуем использовать прокси через библиотеку, если они настроены
        if (PROXIES.length > 0) {
            options.proxies = PROXIES; // Библиотека сама ротирует прокси
        }

        const inventory = new Inventory(options);
        const items = await inventory.get();
        
        // Преобразуем полученные предметы в нужный формат
        const formattedItems = items.map(item => ({
            assetid: item.assetid,
            name: item.market_hash_name || item.name,
            image: item.icon_url ? `https://community.akamai.steamstatic.com/economy/image/${item.icon_url}` : '',
            type: item.type || ''
        }));

        res.json({ success: true, items: formattedItems });
    } catch (error) {
        console.error('Ошибка при получении инвентаря:', error.message);
        res.status(500).json({ error: 'Не удалось получить инвентарь. Перезапустите сервер или проверьте настройки прокси.' });
    }
});

app.get('/test', async (req, res) => {
    try {
        const client = createAxiosWithProxy();
        const response = await client.get('https://api.ipify.org?format=json');
        res.json({ message: 'Прокси работает! Ваш IP:', ip: response.data.ip });
    } catch (error) {
        res.status(500).json({ message: 'Прокси НЕ работает', error: error.message });
    }
});

app.listen(PORT, () => { console.log(`✅ Сервер запущен на порту ${PORT}`); });