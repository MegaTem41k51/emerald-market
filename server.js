const express = require('express');
const session = require('express-session');
const SqliteStore = require("better-sqlite3-session-store")(session)
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'my_secret_123';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Используем SQLite базу данных вместо файлов
app.use(session({
    store: new SqliteStore({
        client: require('better-sqlite3')('sessions.db'),
        expired: {
            clear: true,
            intervalMs: 900000 // 15 минут
        }
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 дней
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

app.get('/api/user', (req, res) => {
    if (req.user) {
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

app.post('/api/get-inventory', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Пожалуйста, войдите через Steam' });
    const steamId = String(req.user.id);

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
        res.status(500).json({ error: 'Не удалось получить инвентарь. Проверьте, открыт ли ваш инвентарь.' });
    }
});

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));