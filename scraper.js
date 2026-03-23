const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const getYad2Response = async (url) => {
    const requestOptions = {
        method: 'GET',
        redirect: 'follow',
        headers: {
            'User-Agent': 'Mozilla/5.0'
        }
    };

    try {
        const res = await fetch(url, requestOptions);
        return await res.text();
    } catch (err) {
        console.log(err);
    }
};

const normalizeTopicToFileName = (topic) => {
    return topic.replace(/[\\/:*?"<>|]/g, '_').trim();
};

const ensureDataDir = () => {
    fs.mkdirSync('data', { recursive: true });
};

const extractItemIdFromHref = (href = '') => {
    const match = href.match(/item\/([^?\/]+)/);
    return match ? match[1] : '';
};

const buildFullLink = (href = '') => {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    return `https://www.yad2.co.il/${href.replace(/^\/+/, '')}`;
};

const scrapeItems = async (url) => {
    const yad2Html = await getYad2Response(url);

    if (!yad2Html) {
        throw new Error('Could not get Yad2 response');
    }

    const $ = cheerio.load(yad2Html);

    const titleText = $('title').first().text().trim();
    if (titleText === 'ShieldSquare Captcha') {
        throw new Error('Bot detection');
    }

    const items = [];

    $('.feeditem').each((_, elm) => {
        const $item = $(elm);

        const title = $item
            .find('.feed-item-info-section_heading__Bp32t')
            .first()
            .text()
            .trim();

        const yearAndHand = $item
            .find('.feed-item-info-section_yearAndHandBox__H5oQ0')
            .first()
            .text()
            .trim();

        const price = $item
            .find('[data-testid="feed-item-price-box"] .price_price__xQt90')
            .first()
            .text()
            .trim() || $item
            .find('.price_price__xQt90')
            .first()
            .text()
            .trim();

        const image = $item.find('.pic img').attr('src') || $item.find('img').first().attr('src') || '';

        let href =
            $item.find('a.private-item_box__Pff89').first().attr('href') ||
            $item.find('a').first().attr('href') ||
            '';

        const link = buildFullLink(href);
        const id = extractItemIdFromHref(href);

        if (title || price || yearAndHand || link) {
            items.push({
                id,
                title,
                price,
                yearAndHand,
                image,
                href,
                link
            });
        }
    });

    return items;
};

const saveItemsToCsv = (items, topic) => {
    ensureDataDir();

    const safeTopic = normalizeTopicToFileName(topic);
    const filePath = path.join('data', `${safeTopic}.csv`);

    const header = 'id,title,price,yearAndHand,link,image\n';

    const rows = items.map((item) => {
        return [
            item.id || '',
            item.title || '',
            item.price || '',
            item.yearAndHand || '',
            item.link || '',
            item.image || ''
        ]
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
            .join(',');
    });

    fs.writeFileSync(filePath, header + rows.join('\n'), 'utf8');
};

const createPushFlagForWorkflow = () => {
    fs.writeFileSync('push_me', '');
};

const checkIfHasNewItem = async (items, topic) => {
    ensureDataDir();

    const safeTopic = normalizeTopicToFileName(topic);
    const filePath = path.join('data', `${safeTopic}.json`);

    let savedItems = [];

    try {
        savedItems = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        if (e.code === 'ENOENT') {
            fs.writeFileSync(filePath, '[]', 'utf8');
        } else {
            console.log(e);
            throw new Error(`Could not read / create ${filePath}`);
        }
    }

    const getItemId = (item) =>
        item.id || item.link || `${item.title}|${item.price}|${item.yearAndHand}`;

    const savedIds = new Set(savedItems.map(getItemId));
    const newItems = items.filter((item) => !savedIds.has(getItemId(item)));

    const oldJson = JSON.stringify(savedItems);
    const newJson = JSON.stringify(items);

    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');

    if (oldJson !== newJson) {
        await createPushFlagForWorkflow();
    }

    return newItems;
};

const formatItemsForTelegram = (items) => {
    return items
        .map((item, index) => {
            return [
                `${index + 1}. ${item.title || 'ללא שם'}`,
                `מחיר: ${item.price || 'לא צוין'}`,
                `שנה/יד: ${item.yearAndHand || 'לא צוין'}`,
                item.link ? `קישור: ${item.link}` : ''
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n----------\n');
};

const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({ apiToken });

    try {
        await telenode.sendTextMessage(`Starting scanning ${topic} on link:\n${url}`, chatId);

        const scrapeResults = await scrapeItems(url);
        console.log(`Found ${scrapeResults.length} total items for ${topic}`);

        saveItemsToCsv(scrapeResults, topic);

        const newItems = await checkIfHasNewItem(scrapeResults, topic);
        console.log(`Found ${newItems.length} new items for ${topic}`);

        if (newItems.length > 0) {
            const msg = `🔔 נמצאו ${newItems.length} מודעות חדשות עבור ${topic}:\n\n${formatItemsForTelegram(newItems)}`;
            await telenode.sendTextMessage(msg, chatId);
        } else {
            await telenode.sendTextMessage(`✅ אין מודעות חדשות עבור ${topic}`, chatId);
        }
    } catch (e) {
        let errMsg = e?.message || '';
        if (errMsg) {
            errMsg = `Error: ${errMsg}`;
        }

        try {
            await telenode.sendTextMessage(`Scan workflow failed... 😥\n${errMsg}`, chatId);
        } catch (telegramErr) {
            console.log('Failed sending Telegram error message:', telegramErr);
        }

        throw e;
    }
};

const program = async () => {
    const projects = (config.projects || []).filter((project) => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
    });

    await Promise.all(
        projects.map(async (project) => {
            await scrape(project.topic, project.url);
        })
    );
};

program();
