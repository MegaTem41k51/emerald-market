const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

app.post('/api/get-inventory', async (req, res) => {
    const { tradeUrl } = req.body;

    const partnerMatch = tradeUrl.match(/partner=(\d+)/);
    if (!partnerMatch) return res.status(400).json({ error: 'Неверный формат Trade URL' });

    const rawId = partnerMatch[1];
    // Конвертация в SteamID64
    const steamId = (BigInt(rawId) + 76561197960265728n).toString();

    try {
        const inventoryUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=1000`;
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
        res.status(500).json({ error: 'Не удалось получить инвентарь. Проверьте, открыт ли он.' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});