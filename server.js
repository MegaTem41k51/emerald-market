const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const PROXIES = [
    'http://qigocgbt:7sdfc9sdwkkv@185.49.165.64:6754'
];

const STEAM_API_KEY = process.env.STEAM_API_KEY;

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

// Функция, которая ДЕЙСТВИТЕЛЬНО работает с прокси
function createAxiosWithProxy() {
    if (PROXIES.length === 0) {
        return axios.create({ timeout: 15000 });
    }
    const proxyUrl = PROXIES[0]; // Берем наш рабочий прокси
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const httpsAgent = new HttpsProxyAgent(proxyUrl);
    return axios.create({ httpsAgent, timeout: 15000 });
}

// ТЕСТ ПРОКСИ (оставляем для проверки)
app.get('/test', async (req, res) => {
    try {
        const client = createAxiosWithProxy();
        const response = await client.get('https://api.ipify.org?format=json');
        res.json({ message: 'Прокси работает! Ваш IP:', ip: response.data.ip });
    } catch (error) {
        res.status(500).json({ message: 'Прокси НЕ работает', error: error.message });
    }
});

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
        // 1. Проверяем профиль через прокси
        const client = createAxiosWithProxy();
        const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`;
        const profileResponse = await client.get(profileUrl);
        if (!profileResponse.data.response.players[0]) return res.status(404).json({ error: 'Профиль не найден' });

        // 2. Задержка 3 секунды, чтобы Steam не начал банить прокси за частые запросы
        await new Promise(r => setTimeout(r, 3000));

        // 3. Получаем инвентарь через ТОТ ЖЕ прокси (axios)
        const inventoryUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=500`;
        const inventoryResponse = await client.get(inventoryUrl, {
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
        console.error('Ошибка при получении инвентаря:', error.message);
        res.status(500).json({ error: 'Не удалось получить инвентарь. Проверьте, работает ли прокси и не заблокирован ли Steam.' });
    }
});

app.listen(PORT, () => { console.log(`✅ Сервер запущен на порту ${PORT}`); });