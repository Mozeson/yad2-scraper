const { chromium } = require('playwright');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');

// ─── Helpers ────────────────────────────────────────────────
const buildFullLink = (href = '') =>
    href.startsWith('http') ? href : `https://www.yad2.co.il${href}`;

const extractItemIdFromHref = (href = '') => {
    const cleanHref = href.split('?')[0].replace(/\/$/, '');
    const parts = cleanHref.split('/');
    return parts[parts.length - 1] || href;
};

const cleanText = (text = '') => text.replace(/\s+/g, ' ').trim();

// ─── Scrape with Playwright ─────────────────────────────────
const scrapeItems = async (url) => {
    const browser = await chromium.launch({
        headless: true
    });

    const page = await browser.newPage({
        viewport: { width: 1440, height: 2600 },
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    try {
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 120000
        });

        await page.waitForTimeout(5000);

        const pageTitle = await page.title();
        if (pageTitle.includes('ShieldSquare Captcha')) {
            throw new Error('Bot detection / captcha page');
        }

        for (let i = 0; i < 5; i++) {
            await page.mouse.wheel(0, 2500);
            await page.waitForTimeout(1000);
        }

        await page.waitForSelector('.feed-item-info-section_heading__Bp32t', {
            timeout: 20000
        });

        const items = await page.evaluate(() => {
            const clean = (text = '') => text.replace(/\s+/g, ' ').trim();

            const cards = Array.from(
                document.querySelectorAll('a.private-item_box__Pff89')
            );

            return cards.map((card) => {
                const title = clean(
                    card.querySelector('.feed-item-info-section_heading__Bp32t')
                        ?.textContent || ''
                );

                const yearAndHand = clean(
                    card.querySelector('.feed-item-info-section_yearAndHandBox__H5oQ0')
                        ?.textContent || ''
                );

                const price = clean(
                    card.querySelector('[data-testid="feed-item-price-box"] .price_price__xQt90')
                        ?.textContent || ''
                );

                const image =
                    card.querySelector('img')?.getAttribute('src') ||
                    card.querySelector('img')?.getAttribute('data-src') ||
                    '';

                const href = card.getAttribute('href') || '';

                return {
                    title,
                    yearAndHand,
                    price,
                    image,
                    href
                };
            });
        });

        const parsedItems = items
            .map((item) => {
                const link = buildFullLink(item.href);
                const id = extractItemIdFromHref(item.href);

                return {
                    id,
                    title: cleanText(item.title),
                    price: cleanText(item.price),
                    yearAndHand: cleanText(item.yearAndHand),
                    image: item.image || '',
                    link
                };
            })
            .filter((item) => item.id && (item.title || item.price));

        if (parsedItems.length === 0) {
            throw new Error('No items found — possible bot detection or selector mismatch');
        }

        const deduped = [];
        const seen = new Set();

        for (const item of parsedItems) {
            const key = item.id || item.link || `${item.title}|${item.price}|${item.yearAndHand}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
        }

        console.log(`Scraped ${deduped.length} items`);
        return deduped;
    } finally {
        await browser.close();
    }
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
    [
        `📌 ${item.title}`,
        `📅 ${item.yearAndHand}`,
        `💰 ${item.price}`,
        `🔗 ${item.link}`
    ]
        .filter(Boolean)
        .join('\n');

const hasPrice = (item) => item.price && item.price !== 'לא צויין מחיר';

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
            const itemsWithPrice = newItems.filter(hasPrice);
            const itemsWithoutPrice = newItems.filter((item) => !hasPrice(item));

            const parts = [
                `🆕 ${newItems.length} new items:\n`,
                itemsWithPrice.map(formatItem).join('\n----------\n'),
                itemsWithoutPrice.length > 0
                    ? `\n📋 ישנם ${itemsWithoutPrice.length} רכבים שלא צויין לגביהם מחיר`
                    : ''
            ].filter(Boolean);

            await telenode.sendTextMessage(parts.join('\n'), chatId);
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
