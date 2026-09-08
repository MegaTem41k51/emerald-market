const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== КЛЮЧИ =====
const STEAM_API_KEY = process.env.STEAM_API_KEY || 'ВАШ_КЛЮЧ_ТУТ';

// ===== МИДЛВЭРЫ =====
app.use(express.json());
app.use(express.static('public'));
app.use(cors());

// ===== СУЩЕСТВУЮЩИЕ МАРШРУТЫ (ТВОИ) =====
app.get('/api/user', async (req, res) => {
    // ... твой существующий код
});

app.post('/api/get-inventory', async (req, res) => {
    // ... твой существующий код
});

app.post('/api/save-trade-url', async (req, res) => {
    // ... твой существующий код
});

app.get('/api/get-trade-url', async (req, res) => {
    // ... твой существующий код
});

// ===== НОВЫЙ МАРШРУТ (ДОБАВЬ ЭТО) =====
app.post('/api/get-inventory-by-id', async (req, res) => {
    const { steamId } = req.body;
    
    if (!steamId) {
        return res.status(400).json({ error: 'Steam ID не указан' });
    }
    
    try {
        let steamId64 = steamId;
        
        // Если передан кастомный URL
        if (steamId.startsWith('/id/') || steamId.startsWith('id/')) {
            const vanity = steamId.replace(/^\/id\//, '').replace(/^id\//, '');
            const vanityResponse = await fetch(
                `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${vanity}`
            );
            const vanityData = await vanityResponse.json();
            if (vanityData.response.success === 1) {
                steamId64 = vanityData.response.steamid;
            } else {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
        }
        
        // Получаем инвентарь CS2
        const inventoryResponse = await fetch(
            `https://api.steampowered.com/IEconItems_730/GetPlayerItems/v1/?steamid=${steamId64}&key=${STEAM_API_KEY}`
        );
        
        if (!inventoryResponse.ok) {
            return res.status(500).json({ error: 'Ошибка получения инвентаря' });
        }
        
        const inventoryData = await inventoryResponse.json();
        
        const items = (inventoryData.result?.items || []).map(item => ({
            id: item.id,
            name: item.market_hash_name || item.name,
            image: `https://steamcommunity-a.akamaihd.net/economy/image/${item.icon_url}`,
            tradable: item.tradable === 1,
            marketable: item.marketable === 1,
            rarity: item.rarity,
            quality: item.quality
        }));
        
        res.json({ items });
        
    } catch (error) {
        console.error('Ошибка загрузки инвентаря:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ===== ЗАПУСК =====
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});