const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecret';
const BASE_URL = process.env.BASE_URL || `https://emerald-market-2.onrender.com`;

app.use(express.static(__dirname));
app.use(bodyParser.json());

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
    if (req.user) return res.json({ loggedIn: true, user: { id: String(req.user.id), name: req.user.displayName, avatar: req.user.photos?.[2]?.value || '' } });
    return res.json({ loggedIn: false });
});

// Этот эндпоинт берет данные напрямую из браузера (без банов)
app.post('/api/get-inventory', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });

    // Сюда пользователь отправляет SteamID (мы получаем его из req.user.id)
    const steamId = String(req.user.id);

    try {
        // 1. Получаем список предметов через Steam Web API (это самый надежный способ)
        const response = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`);
        const data = await response.json();

        if (!data.response.players.length) {
            return res.status(404).json({ error: 'Профиль не найден' });
        }

        // 2. Получаем инвентарь через официальный API (без банов)
        // Используем метод /GetPlayerItems/ (AppID 730 для CS2)
        const inv = await fetch(`https://api.steampowered.com/IEconService/GetPlayerItems/v1/?key=${STEAM_API_KEY}&steamid=${steamId}`);
        const invData = await inv.json();

        if (!invData.result || !invData.result.items) {
            return res.status(404).json({ error: 'Инвентарь пуст или скрыт' });
        }

        const items = invData.result.items.map(item => ({
            assetid: item.assetid,
            name: `Item ${item.itemid}`,
            image: '',
            type: 'Предмет'
        }));

        res.json({ success: true, items });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка при получении инвентаря' });
    }
});

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));