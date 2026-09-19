// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// Ваш API-ключ из файла .env
const API_KEY = process.env.MARKET_CSGO_API_KEY;

app.get('/api/market-csgo/prices', async (req, res) => {
    try {
        // Запрос к API market.csgo.com для получения списка цен в рублях
        // В документации это метод 'prices' [citation:1]
        const response = await axios.get('https://market.csgo.com/api/v2/prices/RUB.json', {
            params: {
                key: API_KEY
            }
        });

        // Проверяем успешность ответа
        if (!response.data || !response.data.items) {
            return res.status(500).json({ error: 'Неверный формат ответа от API' });
        }

        // Преобразуем данные в формат, который ожидает ваш фронтенд
        // Фронтенд ожидает объект с полем 'items', где ключ - это имя предмета
        const formattedItems = {};
        const rawItems = response.data.items;

        // API market.csgo.com возвращает данные в специфичном формате (список массивов).
        // Вам нужно будет адаптировать этот парсинг под реальную структуру.
        // Примерная логика:
        for (const item of rawItems) {
            // Здесь нужно извлечь 'market_hash_name' и 'price' из item
            // и создать запись в formattedItems.
            // Пример (требует уточнения по документации):
            // formattedItems[item.market_hash_name] = { price: item.price / 100 }; // Цены часто в копейках
        }

        // ВРЕМЕННО отправляем сырые данные, чтобы вы могли посмотреть структуру в консоли браузера
        // В дальнейшем раскомментируйте парсинг выше.
        res.json({ items: response.data.items });

    } catch (error) {
        console.error('Ошибка при запросе к market.csgo.com:', error.message);
        res.status(500).json({ error: 'Не удалось получить цены с market.csgo.com' });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
