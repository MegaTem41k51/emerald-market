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

// =====================================================
// НАСТРОЙКИ
// =====================================================

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecret';

const BASE_URL =
    process.env.BASE_URL ||
    'https://emerald-market-2.onrender.com';

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.static(__dirname));

app.use(bodyParser.json());

app.use(express.urlencoded({
    extended: true
}));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// =====================================================
// STEAM AUTH
// =====================================================

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

passport.use(
    new SteamStrategy(
        {
            returnURL: `${BASE_URL}/auth/steam/return`,
            realm: BASE_URL,
            apiKey: STEAM_API_KEY
        },

        (identifier, profile, done) => {
            return done(null, profile);
        }
    )
);

// Вход через Steam
app.get(
    '/auth/steam',
    passport.authenticate('steam', {
        failureRedirect: '/'
    })
);

// Возврат после Steam
app.get(
    '/auth/steam/return',
    passport.authenticate('steam', {
        failureRedirect: '/'
    }),
    (req, res) => {
        res.redirect('/');
    }
);

// Выход
app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

// =====================================================
// API: ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
// =====================================================

app.get('/api/user', (req, res) => {

    if (!req.user) {
        return res.json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,

        user: {
            id: String(req.user.id),

            name:
                req.user.displayName ||
                req.user.username ||
                'Steam User',

            avatar:
                req.user.photos?.[2]?.value ||
                req.user.photos?.[1]?.value ||
                req.user.photos?.[0]?.value ||
                ''
        }
    });
});

// =====================================================
// ХРАНЕНИЕ ДАННЫХ ПОЛЬЗОВАТЕЛЕЙ
// =====================================================

const DB_FILE = path.join(
    __dirname,
    'userData.json'
);

let userData = {};

if (fs.existsSync(DB_FILE)) {

    try {

        userData = JSON.parse(
            fs.readFileSync(DB_FILE, 'utf8')
        );

    } catch (error) {

        console.error(
            'Ошибка чтения userData.json:',
            error.message
        );

        userData = {};
    }
}

function saveUserData() {

    try {

        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(userData, null, 2),
            'utf8'
        );

    } catch (error) {

        console.error(
            'Ошибка сохранения userData.json:',
            error.message
        );
    }
}

// =====================================================
// НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ
// =====================================================

app.post('/api/save-settings', (req, res) => {

    if (!req.user) {
        return res.status(401).json({
            error: 'Войдите через Steam'
        });
    }

    const steamId = String(req.user.id);

    if (!userData[steamId]) {
        userData[steamId] = {};
    }

    userData[steamId].theme =
        req.body.theme === 'light'
            ? 'light'
            : 'dark';

    userData[steamId].rain =
        req.body.rain !== false;

    saveUserData();

    res.json({
        success: true
    });
});

app.get('/api/get-settings', (req, res) => {

    if (!req.user) {

        return res.json({
            theme: 'dark',
            rain: true
        });
    }

    const steamId = String(req.user.id);

    res.json({

        theme:
            userData[steamId]?.theme ||
            'dark',

        rain:
            userData[steamId]?.rain !== false

    });
});

// =====================================================
// TRADE URL
// =====================================================

function isValidTradeUrl(url) {

    if (!url || typeof url !== 'string') {
        return false;
    }

    try {

        const parsed = new URL(url);

        if (parsed.hostname !== 'steamcommunity.com') {
            return false;
        }

        if (
            parsed.pathname !==
            '/tradeoffer/new/'
        ) {
            return false;
        }

        const partner =
            parsed.searchParams.get('partner');

        const token =
            parsed.searchParams.get('token');

        return Boolean(partner && token);

    } catch (error) {

        return false;
    }
}

app.post('/api/save-trade-url', (req, res) => {

    if (!req.user) {

        return res.status(401).json({
            error: 'Войдите через Steam'
        });
    }

    const steamId = String(req.user.id);

    const tradeUrl =
        String(req.body.tradeUrl || '').trim();

    if (!isValidTradeUrl(tradeUrl)) {

        return res.status(400).json({
            error:
                'Неверная Trade URL. Вставьте ссылку из Steam.'
        });
    }

    if (!userData[steamId]) {
        userData[steamId] = {};
    }

    userData[steamId].tradeUrl =
        tradeUrl;

    saveUserData();

    res.json({
        success: true
    });
});

app.get('/api/get-trade-url', (req, res) => {

    if (!req.user) {

        return res.json({
            tradeUrl: ''
        });
    }

    const steamId = String(req.user.id);

    res.json({
        tradeUrl:
            userData[steamId]?.tradeUrl ||
            ''
    });
});

// =====================================================
// STEAM INVENTORY
// =====================================================

async function getSteamInventory(
    steamId,
    startAssetId = ''
) {

    let url =
        `https://steamcommunity.com/inventory/${steamId}/730/2` +
        `?l=english&count=2000`;

    if (startAssetId) {
        url += `&start_assetid=${startAssetId}`;
    }

    const response = await axios.get(
        url,
        {
            timeout: 15000,

            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',

                'Accept':
                    'application/json, text/plain, */*',

                'Referer':
                    'https://steamcommunity.com/'
            }
        }
    );

    return response.data;
}

// Проверяем, является ли предмет скином/оружием
function isSkinItem(desc) {

    const name =
        String(
            desc.market_hash_name ||
            desc.name ||
            ''
        );

    const lowerName =
        name.toLowerCase();

    // Кейсы
    if (
        lowerName.includes('case') ||
        lowerName.includes('crate') ||
        lowerName.includes('capsule') ||
        lowerName.includes('package') ||
        lowerName.includes('container')
    ) {
        return false;
    }

    // Стикеры
    if (
        lowerName.includes('sticker')
    ) {
        return false;
    }

    // Graffiti
    if (
        lowerName.includes('graffiti')
    ) {
        return false;
    }

    // Музыкальные наборы
    if (
        lowerName.includes('music kit')
    ) {
        return false;
    }

    // Чармы
    if (
        lowerName.includes('charm')
    ) {
        return false;
    }

    // Скины обычно имеют разделитель |
    if (name.includes('|')) {
        return true;
    }

    // Дополнительно проверяем категории Steam
    if (Array.isArray(desc.tags)) {

        const categories =
            desc.tags.map(tag =>
                String(
                    tag.category ||
                    ''
                ).toLowerCase()
            );

        if (
            categories.includes('weapon') ||
            categories.includes('knife') ||
            categories.includes('gloves')
        ) {
            return true;
        }
    }

    return false;
}

// =====================================================
// API ПОЛУЧЕНИЯ CS2 ИНВЕНТАРЯ
// =====================================================

app.post('/api/get-inventory', async (req, res) => {

    if (!req.user) {

        return res.status(401).json({
            error:
                'Войдите через Steam'
        });
    }

    const steamId =
        String(req.user.id);

    console.log(
        `📦 Запрос инвентаря CS2: ${steamId}`
    );

    try {

        let allAssets = [];
        let allDescriptions = [];

        let startAssetId = '';

        // Ограничиваем количество страниц,
        // чтобы случайно не создать слишком много запросов
        const MAX_PAGES = 5;

        for (
            let page = 0;
            page < MAX_PAGES;
            page++
        ) {

            console.log(
                `📦 Steam inventory page ${page + 1}`
            );

            const inventory =
                await getSteamInventory(
                    steamId,
                    startAssetId
                );

            if (
                !inventory ||
                inventory.success === false
            ) {

                return res.status(400).json({
                    error:
                        'Не удалось получить инвентарь Steam. Проверьте, что ваш инвентарь открыт.'
                });
            }

            if (
                Array.isArray(
                    inventory.assets
                )
            ) {

                allAssets =
                    allAssets.concat(
                        inventory.assets
                    );
            }

            if (
                Array.isArray(
                    inventory.descriptions
                )
            ) {

                allDescriptions =
                    allDescriptions.concat(
                        inventory.descriptions
                    );
            }

            // Steam сообщает, есть ли ещё предметы
            if (
                !inventory.more_items ||
                !inventory.last_assetid
            ) {
                break;
            }

            startAssetId =
                inventory.last_assetid;
        }

        // Если Steam ничего не вернул
        if (
            allAssets.length === 0 ||
            allDescriptions.length === 0
        ) {

            return res.json({
                success: true,
                items: []
            });
        }

        // =================================================
        // СОЗДАЁМ ТАБЛИЦУ DESCRIPTIONS
        // =================================================

        const descriptions = {};

        for (
            const desc of allDescriptions
        ) {

            const key =
                `${desc.classid}_${desc.instanceid}`;

            descriptions[key] =
                desc;
        }

        // =================================================
        // СОБИРАЕМ СКИНЫ
        // =================================================

        const items = [];

        for (
            const asset of allAssets
        ) {

            const key =
                `${asset.classid}_${asset.instanceid}`;

            const desc =
                descriptions[key];

            if (!desc) {
                continue;
            }

            if (!isSkinItem(desc)) {
                continue;
            }

            const name =
                desc.market_hash_name ||
                desc.name ||
                'Неизвестный предмет';

            let image = '';

            if (desc.icon_url) {

                image =
                    `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}`;
            }

            items.push({

                assetid:
                    String(asset.assetid),

                classid:
                    String(asset.classid),

                instanceid:
                    String(asset.instanceid),

                name:
                    name,

                image:
                    image,

                type:
                    desc.type || 'Скин',

                marketable:
                    desc.marketable === 1,

                tradable:
                    desc.tradable === 1

            });
        }

        console.log(
            `✅ ${steamId}: найдено ${items.length} скинов`
        );

        res.json({

            success: true,

            items: items

        });

    } catch (error) {

        console.error(
            '❌ Ошибка Steam inventory:',
            error.response?.status ||
            error.message
        );

        if (
            error.response?.status === 403
        ) {

            return res.status(403).json({
                error:
                    'Steam запретил доступ к инвентарю. Убедитесь, что инвентарь открыт.'
            });
        }

        if (
            error.response?.status === 429
        ) {

            return res.status(429).json({
                error:
                    'Steam временно ограничил запросы. Подождите немного и попробуйте снова.'
            });
        }

        res.status(500).json({
            error:
                'Не удалось получить инвентарь Steam. Попробуйте ещё раз через некоторое время.'
        });
    }
});

// =====================================================
// ГЛАВНАЯ
// =====================================================

app.get('/', (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            'index.html'
        )
    );
});

// =====================================================
// ЗАПУСК
// =====================================================

app.listen(
    PORT,
    () => {

        console.log(
            `====================================`
        );

        console.log(
            `✅ EMERALD Market запущен`
        );

        console.log(
            `🌐 PORT: ${PORT}`
        );

        console.log(
            `🌐 BASE_URL: ${BASE_URL}`
        );

        console.log(
            `====================================`
        );
    }
);
