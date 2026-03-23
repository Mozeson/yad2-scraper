const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');

const getYad2Response = async (url) => {
    const requestOptions = {
        method: 'GET',
        redirect: 'follow'
    };
    try {
        const res = await fetch(url, requestOptions)
        return await res.text()
    } catch (err) {
        console.log(err)
    }
}

const scrapeItemsAndExtractImgUrls = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) {
        throw new Error("Could not get Yad2 response");
    }
    const $ = cheerio.load(yad2Html);
    const title = $("title")
    const titleText = title.first().text();
    if (titleText === "ShieldSquare Captcha") {
        throw new Error("Bot detection");
    }
    const $feedItems = $(".feeditem").find(".pic");
    if (!$feedItems) {
        throw new Error("Could not find feed items");
    }
    const imageUrls = []
    $feedItems.each((_, elm) => {
        const imgSrc = $(elm).find("img").attr('src');
        if (imgSrc) {
            imageUrls.push(imgSrc)
        }
    })
    return imageUrls;
}

const checkIfHasNewItem = async (items, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedItems = [];

    try {
        savedItems = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
        if (e.code === "ENOENT") {
            fs.mkdirSync("data", { recursive: true });
            fs.writeFileSync(filePath, "[]");
        } else {
            throw new Error(`Could not read / create ${filePath}`);
        }
    }

    const getItemId = (item) =>
        item.id || item.link || `${item.title}|${item.price}|${item.yearAndHand}`;

    const savedIds = new Set(savedItems.map(getItemId));
    const newItems = items.filter(item => !savedIds.has(getItemId(item)));

    fs.writeFileSync(filePath, JSON.stringify(items, null, 2));

    return newItems;
};
const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({apiToken})
    try {
        await telenode.sendTextMessage(`Starting scanning ${topic} on link:\n${url}`, chatId)
        const scrapeImgResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeImgResults, topic);
        if (newItems.length > 0) {
            const newItemsJoined = newItems.join("\n----------\n");
            const msg = `${newItems.length} new items:\n${newItemsJoined}`
            await telenode.sendTextMessage(msg, chatId);
        } else {
            await telenode.sendTextMessage("No new items were added", chatId);
        }
    } catch (e) {
        let errMsg = e?.message || "";
        if (errMsg) {
            errMsg = `Error: ${errMsg}`
        }
        await telenode.sendTextMessage(`Scan workflow failed... 😥\n${errMsg}`, chatId)
        throw new Error(e)
    }
}

const program = async () => {
    await Promise.all(config.projects.filter(project => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
    }).map(async project => {
        await scrape(project.topic, project.url)
    }))
};

program();
