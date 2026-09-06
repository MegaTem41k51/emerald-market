const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const SteamCommunity = require('steamcommunity');

const app = express();
const PORT = process.env.PORT || 3000;

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecret';
const BASE_URL = process.env.BASE_URL || `https://emerald-market-2.onrender.com`;

const community = new SteamCommunity();

app.use(express.static(__dirname));
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

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
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

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

// ЭТОТ КОД ПОЛУЧАЕТ ИНВЕНТАРЬ ЧЕРЕЗ БИБЛИОТЕКУ, КОТОРАЯ САМА ОБХОДИТ БАНЫ
app.post('/api/get-inventory', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    const steamId = String(req.user.id);

    // Библиотека steamcommunity сама делает запрос и возвращает скины
    community.getInventoryItems(steamId, 730, 2, (err, items) => {
        if (err) {
            console.error('Ошибка при получении инвентаря:', err.message);
            return res.status(500).json({ error: 'Не удалось получить инвентарь. Подожди 5 минут и попробуй снова.' });
        }

        // Фильтруем и возвращаем только нужные скины
        const result = items.map(item => ({
            assetid: item.assetid,
            name: item.market_hash_name || item.name,
            image: item.icon_url ? `https://community.akamai.steamstatic.com/economy/image/${item.icon_url}` : '',
            type: item.type || ''
        }));

        res.json({ success: true, items: result });
    });
});

// 2. СОХРАНЕНИЕ TRADE URL (по-прежнему работает)
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