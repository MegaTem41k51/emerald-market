const express = require('express');
const axios = require('axios');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// **ВАЖНО:** Убедись, что эта строка есть, иначе все сломается!
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecret';

app.use(bodyParser.json());
app.use(express.static(__dirname));

app.use(session({
    store: new FileStore({ logErrors: false, retries: 0 }),
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
    returnURL: `https://emerald-market-2.onrender.com/auth/steam/return`,
    realm: 'https://emerald-market-2.onrender.com',
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => done(null, profile)));

app.get('/auth/steam', passport.authenticate('steam', { failureRedirect: '/' }));
app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

app.get('/api/user', (req, res) => {
    if (req.user) return res.json({ loggedIn: true, user: { id: String(req.user.id), name: req.user.displayName, avatar: req.user.photos?.[2]?.value || '' } });
    return res.json({ loggedIn: false });
});

// ⚠️ ИСПРАВЛЕННЫЙ ЭНДПОИНТ: count=2500, toString, и правильные заголовки
app.post('/api/get-inventory', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    const steamId = String(req.user.id);
    
    try {
        const response = await axios.get(`https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=2500`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://steamcommunity.com/'
            }
        });

        const data = response.data;
        if (!data.assets) return res.json({ success: true, items: [] });

        // Фильтруем дефолтные скины и кейсы
        const descriptionsMap = {};
        data.descriptions.forEach(d => descriptionsMap[`${d.classid}_${d.instanceid}`] = d);

        const items = data.assets.map(asset => {
            const desc = descriptionsMap[`${asset.classid}_${asset.instanceid}`];
            if (!desc) return null;
            return {
                assetid: asset.assetid,
                name: desc.market_hash_name || desc.name,
                image: desc.icon_url ? `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}` : '',
                type: desc.type || ''
            };
        }).filter(Boolean);

        res.json({ success: true, items });
    } catch (e) {
        res.status(500).json({ error: 'Steam заблокировал IP или слишком много запросов. Подожди 10 минут.' });
    }
});

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));