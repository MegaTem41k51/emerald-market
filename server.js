require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = 3000;

const API_KEY = process.env.MARKET_CSGO_API_KEY;

// Отдаём ваш HTML-файл (положите его в ту же папку и назовите index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Прокси для цен
app.get('/api/market-csgo/prices', async (req, res) => {
    try {
        const response = await axios.get('https://market.csgo.com/api/v2/prices/RUB.json', {
            params: { key: API_KEY }
        });
        res.json({ items: response.data.items });
    } catch (error) {
        console.error('Ошибка:', error.message);
        res.status(500).json({ error: 'Не удалось получить цены' });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});
