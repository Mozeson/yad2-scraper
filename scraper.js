const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');

// ─── Helpers ────────────────────────────────────────────────
const buildFullLink = (href) =>
    href.startsWith('http') ? href : `https://www.yad2.co.il${href}`;

const extractItemIdFromHref = (href) => {
    const parts = href.split('/');
    return parts[parts.length - 1] || href;
};

// ─── Fetch ───────────────────────────────────────────────────
const getYad2Response = async (url) => {
    try {
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        return await res.text();
    } catch (err) {
        console.error('Fetch error:', err);
    }
};

// ─── Scrape ──────────────────────────────────────────────────
const scrapeItems = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) throw new Error('Could not get Yad2 response');

    const $ = cheerio.load(yad2Html);
    const titleText = $('title').first().text().trim();
    if (titleText === 'ShieldSquare Captcha') throw new Error('Bot detection');

    const items = [];

    $('a.private-item_box__Pff89').each((_, elm) => {
        try {
            const $item = $(elm);
            const title = $item
                .find('.feed-item-info-section_heading__Bp32t')
                .first().text().trim();
            const yearAndHand = $item
                .find('.feed-item-info-section_yearAndHandBox__H5oQ0')
                .first().text().trim();
            const price = $item
                .find('[data-testid="feed-item-price-box"] .price_price__xQt90')
                .first().text().trim();
            const image = $item.find('img').first().attr('src') || '';
            const href = $item.attr('href') || '';
            const link = buildFullLink(href);
            const id = extractItemIdFromHref(href);

            if (id && (title || price)) {
                items.push({ id, title, price, yearAndHand, image, link });
            }
        } catch (err) {
            console.warn('Failed to parse item:', err.message);
        }
    });

    if (items.length === 0) {
        throw new Error('No items found — possible bot detection or selector mismatch');
    }

    console.log(`Scraped ${items.length} items`);
    return items;
};

// ─── Save & Diff ─────────────────────────────────────────────
const checkIfHasNewItem = async (items, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedItems = [];

    try {
        savedItems = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        if (e.code === 'ENOENT') {
            fs.mkdirSync('data', { recursive: true });
            fs.writeFileSync(filePath, '[]');
        } else {
            throw new Error(`Could not read / create ${filePath}`);
        }
    }

    const getItemId = (item) =>
        item.id || item.link || `${item.title}|${item.price}|${item.yearAndHand}`;

    const savedIds = new Set(savedItems.map(getItemId));
    const newItems = items.filter((item) => !savedIds.has(getItemId(item)));

    fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
    return newItems;
};

// ─── Format message ──────────────────────────────────────────
const formatItem = (item) =>
    [`📌 ${item.title}`, `📅 ${item.yearAndHand}`, `💰 ${item.price}`, `🔗 ${item.link}`]
        .filter(Boolean)
        .join('\n');

// ─── Main flow ───────────────────────────────────────────────
const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({ apiToken });

    try {
        await telenode.sendTextMessage(`Starting scanning ${topic}:\n${url}`, chatId);

        const items = await scrapeItems(url);
        const newItems = await checkIfHasNewItem(items, topic);

        if (newItems.length > 0) {
            const msg = `🆕 ${newItems.length} new items:\n\n` +
                newItems.map(formatItem).join('\n----------\n');
            await telenode.sendTextMessage(msg, chatId);
        } else {
            await telenode.sendTextMessage('✅ No new items', chatId);
        }
    } catch (e) {
        const errMsg = e?.message ? `Error: ${e.message}` : '';
        await telenode.sendTextMessage(`Scan failed 😥\n${errMsg}`, chatId);
        throw e;
    }
};

const program = async () => {
    await Promise.all(
        config.projects
            .filter((project) => {
                if (project.disabled) console.log(`Skipping disabled: ${project.topic}`);
                return !project.disabled;
            })
            .map((project) => scrape(project.topic, project.url))
    );
};

program();
