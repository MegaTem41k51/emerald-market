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

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecret';
const BASE_URL = process.env.BASE_URL || `https://emerald-market-2.onrender.com`;

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

// --- ХРАНЕНИЕ НАСТРОЕК И TRADE URL ---
const DB_FILE = path.join(__dirname, 'userData.json');
let userData = {};
if (fs.existsSync(DB_FILE)) {
    userData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveUserData() {
    fs.writeFileSync(DB_FILE, JSON.stringify(userData, null, 2));
}

app.post('/api/save-settings', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите' });
    const steamId = String(req.user.id);
    if (!userData[steamId]) userData[steamId] = {};
    userData[steamId].theme = req.body.theme;
    userData[steamId].rain = req.body.rain;
    saveUserData();
    res.json({ success: true });
});

app.get('/api/get-settings', (req, res) => {
    if (!req.user) return res.json({ theme: 'dark', rain: true });
    const steamId = String(req.user.id);
    res.json({ 
        theme: userData[steamId]?.theme || 'dark', 
        rain: userData[steamId]?.rain !== false 
    });
});

app.post('/api/save-trade-url', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите' });
    const steamId = String(req.user.id);
    const tradeUrl = req.body.tradeUrl;
    if (!userData[steamId]) userData[steamId] = {};
    userData[steamId].tradeUrl = tradeUrl;
    saveUserData();
    res.json({ success: true });
});

app.get('/api/get-trade-url', (req, res) => {
    if (!req.user) return res.json({ tradeUrl: '' });
    const steamId = String(req.user.id);
    res.json({ tradeUrl: userData[steamId]?.tradeUrl || '' });
});

// --- ИНВЕНТАРЬ (снижаем count чтобы Steam не банил) ---
app.post('/api/get-inventory', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите через Steam' });
    const steamId = String(req.user.id);

    try {
        const inventoryUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=300`;
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
                const name = desc.market_hash_name || desc.name;
                const weapon = (name.split('|')[0] || '').toLowerCase().trim();
                const isDefault = DEFAULT_SKINS.includes(weapon) || desc.tags?.some(tag => tag.internal_name === 'normal');
                if (!isDefault && !name.toLowerCase().includes('case') && !name.toLowerCase().includes('crate')) {
                    items.push({
                        assetid: asset.assetid,
                        name: name,
                        image: desc.icon_url ? `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}` : '',
                        type: desc.type || ''
                    });
                }
            }
        });

        res.json({ success: true, items });
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить инвентарь. Подожди 5 минут и попробуй снова.' });
    }
});

const DEFAULT_SKINS = [
    'usp-s', 'glock-18', 'p250', 'deagle', 'five-seven', 'tec-9', 'cz75-auto',
    'ak-47', 'm4a4', 'm4a1-s', 'famas', 'galil ar', 'ssg 08', 'awp', 'scar-20',
    'g3sg1', 'mp9', 'mac-10', 'mp7', 'ump-45', 'p90', 'pp-bizon', 'mp5-sd',
    'nova', 'xm1014', 'mag-7', 'sawed-off', 'm249', 'negev', 'knife', 'taser'
];

const MIN_PRICE = 5;

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));