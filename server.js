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
// КЭШ ИНВЕНТАРЯ
// =====================================================

const inventoryCache = new Map();

const INVENTORY_CACHE_TIME = 5 * 60 * 1000; // 5 минут

function getCachedInventory(steamId) {
    const cached = inventoryCache.get(steamId);

    if (!cached) {
        return null;
    }

    const age = Date.now() - cached.timestamp;

    if (age > INVENTORY_CACHE_TIME) {
        inventoryCache.delete(steamId);
        return null;
    }

    return cached.items;
}

function setCachedInventory(steamId, items) {
    inventoryCache.set(steamId, {
        timestamp: Date.now(),
        items
    });
}


// =====================================================
// ПОСЛЕДНИЙ ЗАПРОС К STEAM
// =====================================================

let lastSteamInventoryRequest = 0;

const STEAM_REQUEST_DELAY = 5000;


// =====================================================
// CS2 INVENTORY
// =====================================================

app.post('/api/get-inventory', async (req, res) => {

    if (!req.user) {
        return res.status(401).json({
            error: 'Войдите через Steam'
        });
    }

    const steamId = String(req.user.id);

    // -----------------------------------------------
    // Сначала проверяем кэш
    // -----------------------------------------------

    const cachedItems = getCachedInventory(steamId);

    if (cachedItems) {

        console.log(
            `📦 Используем кэш инвентаря ${steamId}`
        );

        return res.json({
            success: true,
            cached: true,
            items: cachedItems
        });
    }


    // -----------------------------------------------
    // Защита от слишком частых запросов
    // -----------------------------------------------

    const now = Date.now();

    const timeSinceLastRequest =
        now - lastSteamInventoryRequest;

    if (
        timeSinceLastRequest <
        STEAM_REQUEST_DELAY
    ) {

        const wait =
            Math.ceil(
                (
                    STEAM_REQUEST_DELAY -
                    timeSinceLastRequest
                ) / 1000
            );

        return res.status(429).json({
            error:
                `Подождите ${wait} сек. перед повторной загрузкой инвентаря.`
        });
    }

    lastSteamInventoryRequest = now;


    try {

        console.log(
            `📦 Запрашиваем CS2 inventory: ${steamId}`
        );


        // -----------------------------------------------
        // ОДИН запрос к Steam
        // -----------------------------------------------

        const inventoryUrl =
            `https://steamcommunity.com/inventory/${steamId}/730/2` +
            `?l=english&count=2000`;


        const response =
            await axios.get(
                inventoryUrl,
                {
                    timeout: 20000,

                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',

                        'Accept':
                            'application/json,text/plain,*/*',

                        'Accept-Language':
                            'en-US,en;q=0.9',

                        'Referer':
                            'https://steamcommunity.com/'
                    },

                    validateStatus:
                        () => true
                }
            );


        console.log(
            `Steam inventory response: ${response.status}`
        );


        // -----------------------------------------------
        // 429
        // -----------------------------------------------

        if (
            response.status === 429
        ) {

            console.error(
                '❌ Steam вернул 429 Too Many Requests'
            );

            return res.status(429).json({
                error:
                    'Steam временно ограничил запросы к инвентарю. Подождите немного и попробуйте позже.'
            });
        }


        // -----------------------------------------------
        // Другие ошибки
        // -----------------------------------------------

        if (
            response.status !== 200
        ) {

            console.error(
                '❌ Steam HTTP:',
                response.status
            );

            return res.status(502).json({
                error:
                    'Steam временно не отвечает на запрос инвентаря.'
            });
        }


        const inventory =
            response.data;


        // -----------------------------------------------
        // Проверка ответа
        // -----------------------------------------------

        if (
            !inventory ||
            inventory.success === false
        ) {

            return res.status(400).json({
                error:
                    'Steam не разрешил получить инвентарь. Проверьте настройки приватности Steam.'
            });
        }


        if (
            !Array.isArray(
                inventory.assets
            ) ||
            !Array.isArray(
                inventory.descriptions
            )
        ) {

            return res.json({
                success: true,
                items: []
            });
        }


        // -----------------------------------------------
        // DESCRIPTION MAP
        // -----------------------------------------------

        const descriptions = {};


        for (
            const desc
            of inventory.descriptions
        ) {

            const key =
                `${desc.classid}_${desc.instanceid}`;

            descriptions[key] =
                desc;
        }


        // -----------------------------------------------
        // ITEMS
        // -----------------------------------------------

        const items = [];


        for (
            const asset
            of inventory.assets
        ) {

            const key =
                `${asset.classid}_${asset.instanceid}`;


            const desc =
                descriptions[key];


            if (!desc) {
                continue;
            }


            const name =
                desc.market_hash_name ||
                desc.name ||
                '';


            if (!name) {
                continue;
            }


            const lowerName =
                name.toLowerCase();


            // -------------------------------------------
            // Исключаем мусор
            // -------------------------------------------

            if (
                lowerName.includes('case') ||
                lowerName.includes('crate') ||
                lowerName.includes('capsule') ||
                lowerName.includes('sticker') ||
                lowerName.includes('graffiti') ||
                lowerName.includes('music kit') ||
                lowerName.includes('souvenir package') ||
                lowerName.includes('charm')
            ) {
                continue;
            }


            // -------------------------------------------
            // Проверяем, что предмет похож на скин
            // -------------------------------------------

            let isSkin = false;


            // Большинство обычных CS2 скинов
            if (
                name.includes('|')
            ) {
                isSkin = true;
            }


            // Ножи / перчатки
            if (
                lowerName.includes('knife') ||
                lowerName.includes('karambit') ||
                lowerName.includes('bayonet') ||
                lowerName.includes('butterfly') ||
                lowerName.includes('gloves')
            ) {
                isSkin = true;
            }


            if (!isSkin) {
                continue;
            }


            const image =
                desc.icon_url
                    ? `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}`
                    : '';


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
                    desc.type ||
                    'Скин',

                tradable:
                    desc.tradable === 1,

                marketable:
                    desc.marketable === 1

            });
        }


        // -----------------------------------------------
        // КЭШ
        // -----------------------------------------------

        setCachedInventory(
            steamId,
            items
        );


        console.log(
            `✅ ${steamId}: найдено ${items.length} скинов`
        );


        return res.json({

            success: true,

            cached: false,

            items: items

        });


    } catch (error) {

        console.error(
            '❌ Ошибка Steam inventory:',
            error.response?.status ||
            error.code ||
            error.message
        );


        return res.status(500).json({
            error:
                'Ошибка соединения со Steam. Попробуйте позже.'
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