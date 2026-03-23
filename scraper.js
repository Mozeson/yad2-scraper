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

    $('a.private-item_box__Pff89').each((_, elm) => {
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
            .trim();

        const image =
            $item.find('img').first().attr('src') || '';

        const href = $item.attr('href') || '';
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

    console.log('Scraped items count:', items.length);

    return items;
};
