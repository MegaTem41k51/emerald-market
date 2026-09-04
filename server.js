// Эндпоинт получения инвентаря Steam
app.post('/api/get-inventory', async (req, res) => {
    const { tradeUrl } = req.body;

    const partnerMatch = tradeUrl.match(/partner=(\d+)/);
    if (!partnerMatch) return res.status(400).json({ error: 'Неверный формат Trade URL' });

    const rawId = partnerMatch[1];
    const steamId = convertToSteamId64(rawId);

    if (!steamId) return res.status(400).json({ error: 'Некорректный Steam ID' });

    try {
        // 1. Проверяем, что аккаунт существует
        const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`;
        const profileResponse = await axios.get(profileUrl);
        if (!profileResponse.data.response.players[0]) {
            return res.status(404).json({ error: 'Профиль не найден' });
        }

        // 2. ДОБАВЛЯЕМ ЗАДЕРЖКУ (1.5 секунды), чтобы Steam не посчитал нас ботом
        await new Promise(r => setTimeout(r, 1500));

        // 3. Получаем ВСЕ предметы из инвентаря (CS2 appid=730, contextid=2)
        const inventoryUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=300`;
        
        // 4. ОТПРАВЛЯЕМ ЗАПРОС С USER-AGENT (обязательно)
        const inventoryResponse = await axios.get(inventoryUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        const inventory = inventoryResponse.data;
        
        if (!inventory.assets || inventory.assets.length === 0) {
            return res.status(200).json({ success: true, items: [] });
        }

        // 5. Объединяем данные (assets и descriptions), чтобы получить имена и картинки
        const items = [];
        const descriptions = {};

        inventory.descriptions.forEach(desc => {
            descriptions[`${desc.classid}_${desc.instanceid}`] = desc;
        });

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
        console.error(error);
        res.status(500).json({ error: 'Не удалось получить инвентарь. Слишком много запросов! Перезапусти сервер и подожди 10 минут.' });
    }
});