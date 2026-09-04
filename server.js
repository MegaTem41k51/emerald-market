const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Переменные окружения (обязательно добавь на Render)
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'my_super_secret_key';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(bodyParser.json());
app.use(express.static(__dirname));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' } // На Render нужен secure
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: `${BASE_URL}/auth/steam/return`,
    realm: BASE_URL,
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {
    return done(null, profile); // profile содержит steamid, имя, аватарку
}));

// Файл для хранения привязанных пользователей
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

// ==========================================
// 1. МАРШРУТЫ АВТОРИЗАЦИИ STEAM
// ==========================================
app.get('/auth/steam', passport.authenticate('steam', { failureRedirect: '/' }));
app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/');
});
app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});
app.get('/api/user', (req, res) => {
    if (req.user) {
        // Возвращаем данные пользователя Steam
        res.json({ 
            loggedIn: true, 
            user: { 
                id: String(req.user.id), 
                name: req.user.displayName, 
                avatar: req.user.photos && req.user.photos[2] ? req.user.photos[2].value : ''
            } 
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// ==========================================
// 2. ПОЛУЧЕНИЕ ИНВЕНТАРЯ (теперь только для авторизованных)
// ==========================================
app.post('/api/get-inventory', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Пожалуйста, войдите через Steam' });
    }
    const steamId = String(req.user.id); // Берем ID из сессии, а не из ссылки!

    try {
        const inventoryUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=1000`;
        const inventoryResponse = await axios.get(inventoryUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://steamcommunity.com/'
            }
        });

        const inventory = inventoryResponse.data;
        if (!inventory.assets || inventory.assets.length === 0) return res.json({ success: true, items: [] });

        const items = [];
        const descriptions = {};
        inventory.descriptions.forEach(desc => { descriptions[`${desc.classid}_${desc.instanceid}`] = desc; });

        inventory.assets.forEach(asset => {
            const key = `${asset.classid}_${asset.instanceid}`;
            const desc = descriptions[key];
            if (desc) {
                items.push({
                    assetid: asset.assetid,
                    name: desc.market_hash_name || desc.name,
                    image: desc.icon_url ? `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}` : '',
                    type: desc.type || ''
                });
            }
        });

        res.json({ success: true, items });
    } catch (error) {
        console.error('Ошибка при получении инвентаря:', error.message);
        res.status(500).json({ error: 'Не удалось получить инвентарь. Вы точно вошли через Steam и инвентарь открыт?' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});