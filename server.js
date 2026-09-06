const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecret';
const BASE_URL = process.env.BASE_URL || `https://emerald-market-2.onrender.com`;

// РАЗДАЁМ СТАТИКУ
app.use(express.static(__dirname));
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ПРОСТАЯ СЕССИЯ БЕЗ ФАЙЛОВ (MemoryStore)
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: `${BASE_URL}/auth/steam/return`,
    realm: BASE_URL,
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => done(null, profile)));

app.get('/auth/steam', passport.authenticate('steam', { failureRedirect: '/' }));
app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

// ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user', (req, res) => {
    if (req.user) {
        res.json({ 
            loggedIn: true, 
            user: { 
                id: String(req.user.id), 
                name: req.user.displayName, 
                avatar: req.user.photos?.[2]?.value || ''
            } 
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// ЗАПРОС ИНВЕНТАРЯ
app.post('/api/get-inventory', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    const steamId = String(req.user.id);

    try {
        // Задержка, чтобы Steam не забанил
        await new Promise(r => setTimeout(r, 3000));

        const inventoryUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=300`;
        const inventoryResponse = await axios.get(inventoryUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://steamcommunity.com/'
            }
        });

        const inventory = inventoryResponse.data;
        if (!inventory.assets) return res.json({ success: true, items: [] });

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
        res.status(500).json({ error: 'Не удалось получить инвентарь. Подожди 5 минут и попробуй снова.' });
    }
});

// СОХРАНЕНИЕ TRADE URL
const DB_FILE = path.join(__dirname, 'userData.json');
let userData = {};
if (fs.existsSync(DB_FILE)) {
    userData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

app.post('/api/save-trade-url', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите через Steam' });
    const steamId = String(req.user.id);
    const tradeUrl = req.body.tradeUrl;

    if (!userData[steamId]) userData[steamId] = { tradeUrl: '' };
    userData[steamId].tradeUrl = tradeUrl;
    
    fs.writeFileSync(DB_FILE, JSON.stringify(userData, null, 2));
    res.json({ success: true });
});

app.get('/api/get-trade-url', (req, res) => {
    if (!req.user) return res.json({ tradeUrl: '' });
    const steamId = String(req.user.id);
    res.json({ tradeUrl: userData[steamId] ? userData[steamId].tradeUrl : '' });
});

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));