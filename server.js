const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// =====================================================
// НАСТРОЙКИ
// =====================================================

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecret';

const BASE_URL =
    process.env.BASE_URL ||
    'https://emerald-market-2.onrender.com';

// Render может передавать URL под разными именами в зависимости от способа
// подключения PostgreSQL. Берём первый непустой вариант.
const DATABASE_URL = String(
    process.env.DATABASE_URL ||
    process.env.RENDER_DATABASE_URL ||
    process.env.DATABASE_INTERNAL_URL ||
    process.env.POSTGRES_URL ||
    ''
).trim() || (() => {
    const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
    if (!PGHOST || !PGUSER || !PGPASSWORD || !PGDATABASE) return '';
    const port = PGPORT || '5432';
    return `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${port}/${PGDATABASE}`;
})();

// =====================================================
// ВНУТРЕННИЕ ID / ПРИВАТНЫЙ ДОСТУП
// =====================================================

const OWNER_STEAM_ID = '76561199802780329';
const OWNER_PUBLIC_ID = 666;
const MIN_PUBLIC_ID = 100000;
const MAX_PUBLIC_ID = 999999;

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
            recordLogin(profile)
                .then(() => done(null, profile))
                .catch(error => {
                    console.error('Ошибка выдачи внутреннего ID:', error.message);
                    done(error);
                });
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
app.get('/logout', async (req, res) => {
    try {
        if (pool && dbReady && req.sessionID && req.user) {
            await pool.query('DELETE FROM user_sessions WHERE session_id=$1 AND steam_id=$2', [String(req.sessionID), String(req.user.id)]);
        }
    } catch (error) {
        console.error('⚠️ Ошибка удаления сессии:', error.message);
    }
    req.logout(() => {
        req.session.destroy(() => res.redirect('/'));
    });
});

// =====================================================
// API: ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
// =====================================================

app.get('/api/user', async (req, res) => {

    if (!req.user) {
        return res.json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,

        user: {
            id: String(req.user.id),
            publicId: ensureUserRecord(req.user).publicId,
            isOwner: isOwner(req),
            isAdmin: await isAdmin(req),
            totalSold: Number(ensureUserRecord(req.user).totalSold || 0),
            totalPayout: Number(ensureUserRecord(req.user).totalPayout || 0),
            balance: Number(ensureUserRecord(req.user).balance || 0),
            banned: ensureUserRecord(req.user).banned === true,

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
// ПОСТОЯННАЯ БАЗА ДАННЫХ (PostgreSQL)
// =====================================================

if (!DATABASE_URL) {
    console.warn('⚠️ PostgreSQL не настроен. Добавьте DATABASE_URL в Render → Environment (или PGHOST/PGUSER/PGPASSWORD/PGDATABASE).');
}

const pool = DATABASE_URL
    ? new Pool({
        connectionString: DATABASE_URL,
        // Для Render PostgreSQL SSL обычно нужен. Если конкретный URL
        // явно задаёт sslmode=disable, pg сам использует параметры URL.
        ssl: { rejectUnauthorized: false },
        max: 5,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000
    })
    : null;

console.log(`🔎 PostgreSQL env: ${DATABASE_URL ? 'URL найден' : 'URL НЕ найден'}`);

let userData = {};
let dbReady = false;

// =====================================================
// СЕССИИ ПОЛЬЗОВАТЕЛЕЙ
// =====================================================

function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || '';
}

function getClientCountry(req) {
    return String(
        req.headers['cf-ipcountry'] ||
        req.headers['x-country-code'] ||
        req.headers['x-vercel-ip-country'] ||
        '—'
    ).slice(0, 8).toUpperCase();
}

function getDeviceName(userAgent) {
    const ua = String(userAgent || '');
    const browser =
        /Edg\/([\d.]+)/i.test(ua) ? `Edge ${ua.match(/Edg\/([\d.]+)/i)[1].split('.')[0]}` :
        /Chrome\/([\d.]+)/i.test(ua) ? `Chrome ${ua.match(/Chrome\/([\d.]+)/i)[1].split('.')[0]}` :
        /Firefox\/([\d.]+)/i.test(ua) ? `Firefox ${ua.match(/Firefox\/([\d.]+)/i)[1].split('.')[0]}` :
        /Safari\/([\d.]+)/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari' :
        'Браузер';
    const os =
        /Windows NT/i.test(ua) ? 'Windows' :
        /Android/i.test(ua) ? 'Android' :
        /iPhone|iPad|iPod/i.test(ua) ? 'iOS' :
        /Mac OS X/i.test(ua) ? 'macOS' :
        /Linux/i.test(ua) ? 'Linux' :
        'Устройство';
    return `${os} (${browser})`;
}

app.use(async (req, res, next) => {
    if (!req.user || !pool || !dbReady || !req.sessionID) return next();

    const sessionId = String(req.sessionID);
    const steamId = String(req.user.id);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    const ip = String(getClientIp(req)).slice(0, 100);
    const country = getClientCountry(req);

    try {
        const existing = await pool.query(
            'SELECT 1 FROM user_sessions WHERE session_id=$1 AND steam_id=$2',
            [sessionId, steamId]
        );

        if (!existing.rowCount) {
            await pool.query(
                `INSERT INTO user_sessions
                    (session_id, steam_id, user_agent, ip_address, country)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (session_id) DO UPDATE SET
                    steam_id=EXCLUDED.steam_id,
                    user_agent=EXCLUDED.user_agent,
                    ip_address=EXCLUDED.ip_address,
                    country=EXCLUDED.country,
                    last_seen_at=NOW()`,
                [sessionId, steamId, userAgent, ip, country]
            );
        } else {
            await pool.query(
                `UPDATE user_sessions
                 SET user_agent=$1, ip_address=$2, country=$3, last_seen_at=NOW()
                 WHERE session_id=$4 AND steam_id=$5`,
                [userAgent, ip, country, sessionId, steamId]
            );
        }
    } catch (error) {
        console.error('⚠️ Не удалось обновить сессию:', error.message);
    }

    next();
});


async function initDatabase() {
    if (!pool) return;
    try { await pool.query('SELECT 1'); }
    catch (error) {
        console.error('❌ PostgreSQL: не удалось подключиться:', error.message);
        throw error;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            steam_id TEXT PRIMARY KEY,
            public_id INTEGER UNIQUE NOT NULL,
            username TEXT NOT NULL DEFAULT 'Steam User',
            avatar TEXT NOT NULL DEFAULT '',
            trade_url TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login_at TIMESTAMPTZ,
            login_count INTEGER NOT NULL DEFAULT 0,
            total_sold NUMERIC(14,2) NOT NULL DEFAULT 0,
            total_payout NUMERIC(14,2) NOT NULL DEFAULT 0,
            last_sale_at TIMESTAMPTZ,
            theme TEXT NOT NULL DEFAULT 'dark',
            rain BOOLEAN NOT NULL DEFAULT TRUE,
            balance NUMERIC(14,2) NOT NULL DEFAULT 0,
            banned BOOLEAN NOT NULL DEFAULT FALSE,
            ban_reason TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT ''
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS sales (
            id TEXT PRIMARY KEY,
            steam_id TEXT NOT NULL REFERENCES users(steam_id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            total NUMERIC(14,2) NOT NULL,
            payout NUMERIC(14,2) NOT NULL,
            payment_method TEXT NOT NULL DEFAULT '',
            items JSONB NOT NULL DEFAULT '[]'::jsonb,
            status TEXT NOT NULL DEFAULT 'pending'
        )
    `);

    await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key TEXT NOT NULL DEFAULT ''`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
            session_id TEXT PRIMARY KEY,
            steam_id TEXT NOT NULL REFERENCES users(steam_id) ON DELETE CASCADE,
            user_agent TEXT NOT NULL DEFAULT '',
            ip_address TEXT NOT NULL DEFAULT '',
            country TEXT NOT NULL DEFAULT '—',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_steam_id ON user_sessions(steam_id)`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_grants (
            steam_id TEXT PRIMARY KEY REFERENCES users(steam_id) ON DELETE CASCADE,
            granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            granted_by TEXT NOT NULL
        )
    `);

    const users = await pool.query('SELECT * FROM users ORDER BY public_id');
    for (const row of users.rows) {
        userData[row.steam_id] = dbRowToUser(row);
    }

    const sales = await pool.query('SELECT * FROM sales ORDER BY created_at');
    for (const row of sales.rows) {
        if (!userData[row.steam_id]) continue;
        if (!Array.isArray(userData[row.steam_id].sales)) userData[row.steam_id].sales = [];
        userData[row.steam_id].sales.push({
            id: row.id,
            createdAt: new Date(row.created_at).toISOString(),
            total: Number(row.total),
            payout: Number(row.payout),
            paymentMethod: row.payment_method || '',
            items: Array.isArray(row.items) ? row.items : [],
            status: row.status === 'sold' ? 'sold' : (row.status === 'not_sold' ? 'not_sold' : 'pending')
        });
    }

    // Однократная миграция старых userData.json, если он существует и БД ещё пустая.
    const legacyFile = path.join(__dirname, 'userData.json');
    if (users.rows.length === 0 && fs.existsSync(legacyFile)) {
        try {
            const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
            for (const record of Object.values(legacy)) {
                if (!record?.steamId || !Number.isInteger(Number(record.publicId))) continue;
                await upsertUserToDb(record);
                for (const sale of (Array.isArray(record.sales) ? record.sales : [])) {
                    await insertSaleToDb(record.steamId, sale);
                }
                userData[record.steamId] = { ...record };
            }
            console.log('✅ Старые данные userData.json перенесены в PostgreSQL');
        } catch (error) {
            console.error('⚠️ Ошибка миграции userData.json:', error.message);
        }
    }

    dbReady = true;
    console.log(`🗄️ PostgreSQL подключён. Пользователей: ${Object.keys(userData).length}`);
}

function dbRowToUser(row) {
    return {
        steamId: row.steam_id,
        publicId: Number(row.public_id),
        username: row.username,
        avatar: row.avatar,
        tradeUrl: row.trade_url || '',
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        loginCount: Number(row.login_count || 0),
        totalSold: Number(row.total_sold || 0),
        totalPayout: Number(row.total_payout || 0),
        lastSaleAt: row.last_sale_at ? new Date(row.last_sale_at).toISOString() : null,
        theme: row.theme || 'dark',
        rain: row.rain !== false,
        balance: Number(row.balance || 0),
        banned: row.banned === true,
        banReason: row.ban_reason || '',
        apiKey: row.api_key || '',
        sales: []
    };
}

async function upsertUserToDb(record) {
    if (!pool || !record?.steamId) return;
    await pool.query(`
        INSERT INTO users
            (steam_id, public_id, username, avatar, trade_url, created_at, last_login_at,
             login_count, total_sold, total_payout, last_sale_at, theme, rain, balance, banned, ban_reason, api_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (steam_id) DO UPDATE SET
            public_id=EXCLUDED.public_id,
            username=EXCLUDED.username,
            avatar=EXCLUDED.avatar,
            trade_url=EXCLUDED.trade_url,
            created_at=EXCLUDED.created_at,
            last_login_at=EXCLUDED.last_login_at,
            login_count=EXCLUDED.login_count,
            total_sold=EXCLUDED.total_sold,
            total_payout=EXCLUDED.total_payout,
            last_sale_at=EXCLUDED.last_sale_at,
            theme=EXCLUDED.theme,
            rain=EXCLUDED.rain,
            balance=EXCLUDED.balance,
            banned=EXCLUDED.banned,
            ban_reason=EXCLUDED.ban_reason,
            api_key=EXCLUDED.api_key
    `, [
        String(record.steamId), Number(record.publicId), record.username || 'Steam User', record.avatar || '',
        record.tradeUrl || '', record.createdAt || new Date().toISOString(), record.lastLoginAt || null,
        Number(record.loginCount || 0), Number(record.totalSold || 0), Number(record.totalPayout || 0),
        record.lastSaleAt || null, record.theme === 'light' ? 'light' : 'dark', record.rain !== false,
        Number(record.balance || 0), record.banned === true, record.banReason || '', record.apiKey || ''
    ]);
}

async function insertSaleToDb(steamId, sale) {
    if (!pool || !sale?.id) return;
    await pool.query(`
        INSERT INTO sales (id, steam_id, created_at, total, payout, payment_method, items, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
        ON CONFLICT (id) DO UPDATE SET
            total=EXCLUDED.total, payout=EXCLUDED.payout, payment_method=EXCLUDED.payment_method,
            items=EXCLUDED.items, status=EXCLUDED.status
    `, [sale.id, String(steamId), sale.createdAt || new Date().toISOString(), Number(sale.total || 0),
        Number(sale.payout || 0), sale.paymentMethod || '', JSON.stringify(Array.isArray(sale.items) ? sale.items : []),
        sale.status === 'sold' ? 'sold' : (sale.status === 'not_sold' ? 'not_sold' : 'pending')]);
}

async function saveUserData() {
    if (!pool || !dbReady) return;
    const records = Object.values(userData);
    await Promise.all(records.map(record => upsertUserToDb(record)));
}

async function waitForDatabase() {
    if (!pool) return false;
    while (!dbReady) await new Promise(resolve => setTimeout(resolve, 50));
    return true;
}

function requireDatabase(res) {
    if (!pool || !dbReady) {
        res.status(503).json({ error: 'База данных не подключена. В Render добавьте DATABASE_URL (Internal Database URL) и перезапустите сервис.' });
        return false;
    }
    return true;
}

// =====================================================
// НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ
// =====================================================

app.post('/api/save-settings', async (req, res) => {

    if (!req.user) {
        return res.status(401).json({
            error: 'Войдите через Steam'
        });
    }

    if (!requireDatabase(res)) return;

    const steamId = String(req.user.id);
    ensureUserRecord(req.user);

    userData[steamId].theme =
        req.body.theme === 'light'
            ? 'light'
            : 'dark';

    userData[steamId].rain =
        req.body.rain !== false;

    await saveUserData();

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
    ensureUserRecord(req.user);

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

        // Steam может присылать URL как с завершающим /, так и без него,
        // а иногда ссылка открывается через www.steamcommunity.com.
        const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const pathname = parsed.pathname.replace(/\/+$/, '');

        if (hostname !== 'steamcommunity.com') {
            return false;
        }

        if (pathname !== '/tradeoffer/new') {
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

app.post('/api/save-trade-url', async (req, res) => {

    if (!req.user) {

        return res.status(401).json({
            error: 'Войдите через Steam'
        });
    }

    if (!requireDatabase(res)) return;

    const steamId = String(req.user.id);
    ensureUserRecord(req.user);

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

    await saveUserData();

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
// ПРОФИЛИ / ТРАНЗАКЦИИ / АДМИНКА
// =====================================================

// Выдаём постоянный внутренний ID пользователю.
function getRandomPublicId() {
    const used = new Set(Object.values(userData).map(data => Number(data?.publicId)).filter(Number.isInteger));
    for (let attempt = 0; attempt < 200; attempt++) {
        const id = Math.floor(Math.random() * (MAX_PUBLIC_ID - MIN_PUBLIC_ID + 1)) + MIN_PUBLIC_ID;
        if (id !== OWNER_PUBLIC_ID && !used.has(id)) return id;
    }
    for (let id = MIN_PUBLIC_ID; id <= MAX_PUBLIC_ID; id++) {
        if (id !== OWNER_PUBLIC_ID && !used.has(id)) return id;
    }
    return null;
}

function ensureUserRecord(profile) {
    const steamId = String(profile.id);
    const owner = steamId === OWNER_STEAM_ID;

    if (!userData[steamId]) {
        userData[steamId] = {};
    }

    const record = userData[steamId];

    if (owner) {
        for (const [otherSteamId, otherRecord] of Object.entries(userData)) {
            if (otherSteamId === steamId) continue;
            if (Number(otherRecord?.publicId) === OWNER_PUBLIC_ID) {
                const replacementId = getRandomPublicId();
                if (replacementId === null) {
                    throw new Error('Невозможно освободить ID 666: свободные ID закончились');
                }
                otherRecord.publicId = replacementId;
            }
        }
        record.publicId = OWNER_PUBLIC_ID;
    } else if (Number(record.publicId) === OWNER_PUBLIC_ID) {
        const nextId = getRandomPublicId();
        if (nextId === null) throw new Error('Свободные внутренние ID закончились');
        record.publicId = nextId;
    } else if (!Number.isInteger(Number(record.publicId))) {
        const nextId = getRandomPublicId();
        if (nextId === null) throw new Error('Свободные внутренние ID закончились');
        record.publicId = nextId;
    }

    record.steamId = steamId;
    record.username = profile.displayName || profile.username || record.username || 'Steam User';
    record.avatar =
        profile.photos?.[2]?.value ||
        profile.photos?.[1]?.value ||
        profile.photos?.[0]?.value ||
        record.avatar || '';

    if (!Array.isArray(record.sales)) record.sales = [];
    if (!record.theme) record.theme = 'dark';
    if (typeof record.rain !== 'boolean') record.rain = true;

    return record;
}

function isOwner(req) {
    return Boolean(req.user) && String(req.user.id) === OWNER_STEAM_ID;
}

async function isAdmin(req) {
    if (!req.user) return false;
    if (isOwner(req)) return true;
    if (!pool || !dbReady) return false;
    const result = await pool.query('SELECT 1 FROM admin_grants WHERE steam_id=$1', [String(req.user.id)]);
    return result.rowCount > 0;
}

async function recordLogin(profile) {
    const record = ensureUserRecord(profile);
    const now = new Date().toISOString();
    if (!record.createdAt) record.createdAt = now;
    record.lastLoginAt = now;
    record.loginCount = Number(record.loginCount || 0) + 1;
    await saveUserData();
    return record;
}


// Личные сессии: доступны только владельцу текущего аккаунта.
app.get('/api/profile/sessions', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите через Steam' });
    if (!requireDatabase(res)) return;

    try {
        const result = await pool.query(
            `SELECT session_id, user_agent, ip_address, country, created_at, last_seen_at
             FROM user_sessions
             WHERE steam_id=$1
             ORDER BY last_seen_at DESC`,
            [String(req.user.id)]
        );

        res.json({
            sessions: result.rows.map(row => ({
                id: row.session_id,
                device: getDeviceName(row.user_agent),
                userAgent: row.user_agent,
                ip: row.ip_address || '—',
                country: row.country || '—',
                createdAt: new Date(row.created_at).toISOString(),
                lastSeenAt: new Date(row.last_seen_at).toISOString(),
                current: String(row.session_id) === String(req.sessionID)
            }))
        });
    } catch (error) {
        console.error('Ошибка загрузки сессий:', error.message);
        res.status(500).json({ error: 'Не удалось загрузить сессии' });
    }
});

app.delete('/api/profile/sessions/:sessionId', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите через Steam' });
    if (!requireDatabase(res)) return;

    const sessionId = String(req.params.sessionId || '');
    if (!sessionId || sessionId.length > 300) return res.status(400).json({ error: 'Некорректная сессия' });

    try {
        const result = await pool.query(
            'DELETE FROM user_sessions WHERE session_id=$1 AND steam_id=$2 RETURNING session_id',
            [sessionId, String(req.user.id)]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'Сессия не найдена' });

        if (sessionId === String(req.sessionID)) {
            req.logout(() => {
                req.session.destroy(() => res.json({ success: true, loggedOut: true }));
            });
            return;
        }

        res.json({ success: true, loggedOut: false });
    } catch (error) {
        console.error('Ошибка выхода из сессии:', error.message);
        res.status(500).json({ error: 'Не удалось завершить сессию' });
    }
});

// API-ключ пользователя.
app.get('/api/profile/api-key', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите через Steam' });
    if (!requireDatabase(res)) return;
    try {
        const record = ensureUserRecord(req.user);
        res.json({ apiKey: record.apiKey || '' });
    } catch (error) {
        res.status(500).json({ error: 'Не удалось загрузить API key' });
    }
});

app.post('/api/profile/api-key/generate', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите через Steam' });
    if (!requireDatabase(res)) return;

    try {
        const crypto = require('crypto');
        const record = ensureUserRecord(req.user);
        const apiKey = `emk_${crypto.randomBytes(24).toString('hex')}`;
        record.apiKey = apiKey;
        await upsertUserToDb(record);
        userData[String(req.user.id)] = record;
        res.json({ success: true, apiKey });
    } catch (error) {
        console.error('Ошибка генерации API key:', error.message);
        res.status(500).json({ error: 'Не удалось сгенерировать API key' });
    }
});

// Публичный профиль: только публичные показатели и внутренний ID.
// Steam ID, имя, аватар, Trade URL и платёжные данные наружу не отдаём.
app.get('/api/profile/:publicId', async (req, res) => {
    const publicId = Number(req.params.publicId);
    if (!Number.isInteger(publicId) || publicId < MIN_PUBLIC_ID || publicId > MAX_PUBLIC_ID) {
        return res.status(400).json({ error: 'Некорректный ID профиля' });
    }
    if (!requireDatabase(res)) return;

    try {
        const userResult = await pool.query(
            'SELECT steam_id, public_id, total_sold, total_payout, created_at FROM users WHERE public_id=$1 LIMIT 1',
            [publicId]
        );
        if (!userResult.rowCount) return res.status(404).json({ error: 'Профиль не найден' });

        const user = userResult.rows[0];
        const salesResult = await pool.query(
            'SELECT id, created_at, total, payout, status FROM sales WHERE steam_id=$1 ORDER BY created_at DESC',
            [user.steam_id]
        );

        const sales = salesResult.rows.map(row => ({
            id: row.id,
            createdAt: new Date(row.created_at).toISOString(),
            total: Number(row.total || 0),
            payout: Number(row.payout || 0),
            status: row.status === 'sold' ? 'sold' : (row.status === 'not_sold' ? 'not_sold' : 'pending')
        }));

        const sold = sales.filter(sale => sale.status === 'sold');
        const totalSold = Number(sold.reduce((sum, sale) => sum + sale.total, 0).toFixed(2));
        const totalPayout = Number(sold.reduce((sum, sale) => sum + sale.payout, 0).toFixed(2));

        res.json({
            publicId,
            totalSold,
            totalPayout,
            sales
        });
    } catch (error) {
        console.error('Ошибка публичного профиля:', error.message);
        res.status(500).json({ error: 'Не удалось загрузить профиль' });
    }
});

// Владелец 666 видит внутренние данные пользователей и историю продаж.
app.get('/api/admin/data', async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!requireDatabase(res)) return;

    const grantsResult = await pool.query('SELECT steam_id FROM admin_grants');
    const grantedAdmins = new Set(grantsResult.rows.map(row => String(row.steam_id)));

    const users = Object.values(userData)
        .map(record => ({
            publicId: Number(record.publicId),
            steamId: String(record.steamId || ''),
            username: record.username || 'Steam User',
            avatar: record.avatar || '',
            tradeUrl: record.tradeUrl || '',
            createdAt: record.createdAt || null,
            lastLoginAt: record.lastLoginAt || null,
            loginCount: Number(record.loginCount || 0),
            totalSold: Number(record.totalSold || 0),
            totalPayout: Number(record.totalPayout || 0),
            balance: Number(record.balance || 0),
            banned: record.banned === true,
            banReason: record.banReason || '',
            isAdmin: String(record.steamId || '') === OWNER_STEAM_ID || grantedAdmins.has(String(record.steamId || '')),
            sales: Array.isArray(record.sales) ? record.sales : []
        }))
        .sort((a, b) => a.publicId - b.publicId);

    const sales = users.flatMap(user => user.sales.map(sale => ({
        ...sale, publicId: user.publicId, username: user.username, steamId: user.steamId
    }))).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    res.json({ users, sales });
});

// Владелец 666 может выдавать и отзывать админ-доступ по публичному ID.
app.post('/api/admin/grants', async (req, res) => {
    if (!isOwner(req)) return res.status(403).json({ error: 'Только владелец 666 может управлять доступом' });
    if (!requireDatabase(res)) return;
    const publicId = Number(req.body.publicId);
    if (!Number.isInteger(publicId) || publicId <= 0) return res.status(400).json({ error: 'Введите корректный ID' });
    const target = Object.values(userData).find(item => Number(item?.publicId) === publicId);
    if (!target) return res.status(404).json({ error: 'Пользователь с таким ID не найден' });
    if (String(target.steamId) === OWNER_STEAM_ID) return res.status(400).json({ error: 'ID 666 уже является владельцем' });
    await pool.query('INSERT INTO admin_grants (steam_id, granted_by) VALUES ($1,$2) ON CONFLICT (steam_id) DO NOTHING', [String(target.steamId), OWNER_STEAM_ID]);
    res.json({ success: true, publicId });
});

app.delete('/api/admin/grants/:publicId', async (req, res) => {
    if (!isOwner(req)) return res.status(403).json({ error: 'Только владелец 666 может управлять доступом' });
    if (!requireDatabase(res)) return;
    const publicId = Number(req.params.publicId);
    const target = Object.values(userData).find(item => Number(item?.publicId) === publicId);
    if (!target) return res.status(404).json({ error: 'Пользователь с таким ID не найден' });
    if (String(target.steamId) === OWNER_STEAM_ID) return res.status(400).json({ error: 'Нельзя забрать доступ у владельца' });
    await pool.query('DELETE FROM admin_grants WHERE steam_id=$1', [String(target.steamId)]);
    res.json({ success: true, publicId });
});

// Создаём заявку на продажу. Окончательный статус устанавливает владелец в админке.
app.post('/api/record-sale', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Войдите через Steam' });

    if (!requireDatabase(res)) return;

    const steamId = String(req.user.id);
    const record = ensureUserRecord(req.user);
    const total = Number(req.body.total);
    const payout = Number(req.body.payout);
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(payout) || payout < 0) {
        return res.status(400).json({ error: 'Некорректная сумма продажи' });
    }

    const sale = {
        id: `sale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        total: Number(total.toFixed(2)),
        payout: Number(payout.toFixed(2)),
        paymentMethod: String(req.body.paymentMethod || '').slice(0, 30),
        items: items.slice(0, 100).map(item => String(item).slice(0, 200)),
        status: 'pending'
    };

    if (!Array.isArray(record.sales)) record.sales = [];
    record.sales.push(sale);
    record.lastSaleAt = sale.createdAt;
    // Суммы считаются только по подтверждённым владельцем продажам.
    record.totalSold = record.sales.filter(x => x.status === 'sold').reduce((sum, x) => sum + Number(x.total || 0), 0);
    record.totalPayout = record.sales.filter(x => x.status === 'sold').reduce((sum, x) => sum + Number(x.payout || 0), 0);
    userData[steamId] = record;

    try {
        await insertSaleToDb(steamId, sale);
        await upsertUserToDb(record);
        res.json({ success: true, saleId: sale.id });
    } catch (error) {
        console.error('Ошибка сохранения продажи:', error.message);
        return res.status(500).json({ error: 'Не удалось сохранить продажу' });
    }
});

// Владелец управляет пользователями: бан, баланс и публичный ID.
app.post('/api/admin/manage-user', async (req, res) => {
    if (!isOwner(req)) return res.status(403).json({ error: 'Только владелец 666 может управлять пользователями' });
    if (!requireDatabase(res)) return;

    const action = String(req.body.action || '');
    const publicId = Number(req.body.publicId);
    if (!Number.isInteger(publicId) || publicId <= 0) {
        return res.status(400).json({ error: 'Введите корректный ID пользователя' });
    }

    const target = Object.values(userData).find(item => Number(item?.publicId) === publicId);
    if (!target) return res.status(404).json({ error: 'Пользователь с таким ID не найден' });
    if (String(target.steamId) === OWNER_STEAM_ID && action !== 'balance_add') {
        return res.status(400).json({ error: 'Нельзя изменить доступ или ID владельца 666' });
    }

    try {
        if (action === 'ban') {
            target.banned = true;
            target.banReason = String(req.body.reason || 'Нарушение правил').slice(0, 200);
        } else if (action === 'unban') {
            target.banned = false;
            target.banReason = '';
        } else if (action === 'balance_add') {
            const amount = Number(req.body.amount);
            if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Введите ненулевую сумму' });
            const nextBalance = Number((Number(target.balance || 0) + amount).toFixed(2));
            if (nextBalance < 0) return res.status(400).json({ error: 'Баланс не может быть отрицательным' });
            target.balance = nextBalance;
        } else if (action === 'change_id') {
            const newId = Number(req.body.newPublicId);
            if (!Number.isInteger(newId) || newId < MIN_PUBLIC_ID || newId > MAX_PUBLIC_ID || newId === OWNER_PUBLIC_ID) {
                return res.status(400).json({ error: `Новый ID должен быть от ${MIN_PUBLIC_ID} до ${MAX_PUBLIC_ID}, кроме 666` });
            }
            const occupied = Object.values(userData).find(item => Number(item?.publicId) === newId && item !== target);
            if (occupied) return res.status(409).json({ error: 'Этот ID уже занят' });
            target.publicId = newId;
        } else {
            return res.status(400).json({ error: 'Неизвестное действие' });
        }

        await upsertUserToDb(target);
        res.json({ success: true, publicId: target.publicId, balance: Number(target.balance || 0), banned: target.banned === true });
    } catch (error) {
        console.error('Ошибка управления пользователем:', error.message);
        res.status(500).json({ error: 'Не удалось применить действие' });
    }
});

// Владелец меняет статус заявки: продажа остаётся в истории в любом случае.
app.post('/api/admin/sales/:saleId/status', async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Доступ запрещён' });
    const saleId = String(req.params.saleId);
    const status = req.body.status === 'sold' ? 'sold' : (req.body.status === 'not_sold' ? 'not_sold' : '');

    if (!status) return res.status(400).json({ error: 'Некорректный статус' });
    if (!requireDatabase(res)) return;

    try {
        const result = await pool.query(
            "UPDATE sales SET status=$1 WHERE id=$2 AND status='pending' RETURNING id, steam_id",
            [status, saleId]
        );
        if (!result.rowCount) {
            const exists = await pool.query('SELECT status FROM sales WHERE id=$1', [saleId]);
            if (!exists.rowCount) return res.status(404).json({ error: 'Продажа не найдена' });
            return res.status(409).json({ error: 'Статус этой продажи уже подтверждён и больше не изменяется' });
        }

        const steamId = result.rows[0].steam_id;
        const record = userData[steamId] || ensureUserRecord({ id: steamId });
        const salesResult = await pool.query(
            'SELECT total, payout, status, created_at FROM sales WHERE steam_id=$1 ORDER BY created_at',
            [steamId]
        );
        record.sales = salesResult.rows.map(row => {
            const existing = (record.sales || []).find(x => x.id === saleId && saleId);
            return existing;
        }).filter(Boolean);
        const soldRows = salesResult.rows.filter(row => row.status === 'sold');
        record.totalSold = Number(soldRows.reduce((sum, row) => sum + Number(row.total || 0), 0).toFixed(2));
        record.totalPayout = Number(soldRows.reduce((sum, row) => sum + Number(row.payout || 0), 0).toFixed(2));
        userData[steamId] = record;
        await upsertUserToDb(record);

        // Перезагрузим локальную копию продаж из БД, чтобы статус сразу был актуальным.
        const allSales = await pool.query('SELECT * FROM sales WHERE steam_id=$1 ORDER BY created_at', [steamId]);
        record.sales = allSales.rows.map(row => ({
            id: row.id, createdAt: new Date(row.created_at).toISOString(), total: Number(row.total),
            payout: Number(row.payout), paymentMethod: row.payment_method || '',
            items: Array.isArray(row.items) ? row.items : [], status: row.status === 'sold' ? 'sold' : (row.status === 'not_sold' ? 'not_sold' : 'pending')
        }));
        res.json({ success: true, saleId, status });
    } catch (error) {
        console.error('Ошибка изменения статуса продажи:', error.message);
        res.status(500).json({ error: 'Не удалось изменить статус продажи' });
    }
});

app.get('/admin', async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).send('Доступ запрещён');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/profile/:publicId', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/health', async (req, res) => {
    if (!pool) {
        return res.status(503).json({
            ok: false,
            database: false,
            dbReady,
            error: 'DATABASE_URL не найден в окружении Render'
        });
    }
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, database: true, dbReady });
    } catch (error) {
        console.error('❌ /api/health PostgreSQL:', error.message);
        res.status(503).json({
            ok: false,
            database: false,
            dbReady,
            error: error.message
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

initDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log('====================================');
            console.log('✅ EMERALD Market запущен');
            console.log(`🌐 PORT: ${PORT}`);
            console.log(`🌐 BASE_URL: ${BASE_URL}`);
            console.log('====================================');
        });
    })
    .catch(error => {
        console.error('❌ Не удалось запустить базу данных:', error.message);
        process.exit(1);
    });
