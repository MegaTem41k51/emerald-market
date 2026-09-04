const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ЗАМЕНИ ЭТО НА ТВОЙ КЛЮЧ ИЗ STEAM!
const STEAM_API_KEY = 'E52875DA759E6AA9444A85EFEB292102';

app.use(bodyParser.json());
app.use(express.static(__dirname)); // Раздаем твой HTML файл

// Файл для хранения привязанных пользователей
const DB_FILE = path.join(__dirname, 'users.json');

let users = {};
if (fs.existsSync(DB_FILE)) {
    users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveUsers() {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

// Эндпоинт для привязки трейд-ссылки
app.post('/api/bind-trade', async (req, res) => {
    const { tradeUrl, username } = req.body;

    // 1. Проверяем формат ссылки
    if (!tradeUrl || !tradeUrl.includes('partner=')) {
        return res.status(400).json({ error: 'Неверный формат Trade URL' });
    }

    // 2. Достаем Steam ID из ссылки
    const partnerMatch = tradeUrl.match(/partner=(\d+)/);
    if (!partnerMatch) return res.status(400).json({ error: 'Не найден ID партнера' });

    const steamId = partnerMatch[1];

    // 3. Делаем запрос к Steam API
    try {
        const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`;
        const response = await axios.get(apiUrl);
        const player = response.data.response.players[0];

        if (!player) return res.status(404).json({ error: 'Профиль не найден' });

        // 4. Сохраняем пользователя
        users[username] = {
            username,
            steamId: steamId,
            steamName: player.personaname,
            avatar: player.avatarfull,
            tradeUrl: tradeUrl,
            boundAt: new Date().toISOString()
        };
        saveUsers();

        res.json({ success: true, player: { name: player.personaname, avatar: player.avatarfull, steamId: steamId } });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка при проверке Steam' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});