const BASE_URL = "https://hentai.sh";
const CDN_BASE = "https://cdn1.hentai.sh";
const CDN_PATH = "/hentai-sh-v2/";

// ─── 1. Search Results ───
async function searchResults(keyword) {
    const results = [];
    try {
        const response = await fetchv2(BASE_URL + "/api/search?q=" + encodeURIComponent(keyword) + "&limit=20");
        const data = await response.json();

        // API returns { results: [...] }
        const items = data.results || data;
        if (!items || !Array.isArray(items)) {
            return JSON.stringify([{ title: "No results found", image: "Error", href: "Error" }]);
        }

        for (const item of items) {
            const title = item.title || "Unknown";
            const slug = item.slug || "";
            const image = item.thumbnail || "";

            results.push({
                title: title,
                image: image,
                href: slug
            });
        }

        if (results.length === 0) {
            return JSON.stringify([{ title: "No results found", image: "Error", href: "Error" }]);
        }

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([{ title: "Error", image: "Error", href: "Error" }]);
    }
}

// ─── 2. Extract Details ───
async function extractDetails(url) {
    try {
        const slug = url.trim();
        const pageUrl = BASE_URL + "/video/" + slug;
        const response = await fetchv2(pageUrl);
        const html = await response.text();

        let description = "N/A";
        const descMatch = html.match(/
<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
        if (descMatch) {
            description = descMatch[1].replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
        } else {
            const ogMatch = html.match(/
    <meta[^>]*property="og:description"[^>]*content="([^"]*)"/i);
            if (ogMatch) {
                description = ogMatch[1].replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
            }
        }

        let aliases = "N/A";
        let airdate = "N/A";

        return JSON.stringify([{
            description: description || "N/A",
            aliases: aliases,
            airdate: airdate
        }]);
    } catch (err) {
        return JSON.stringify([{ description: "Error", aliases: "Error", airdate: "Error" }]);
    }
}

// ─── 3. Extract Episodes ───
async function extractEpisodes(url) {
    try {
        const slug = url.trim();

        // Each video is standalone (slugs include episode number)
        // But we can use the search API with the series title to find all episodes
        const pageUrl = BASE_URL + "/video/" + slug;
        const response = await fetchv2(pageUrl);
        const html = await response.text();

        // Try to extract seriesTitle from RSC data
        let seriesTitle = "";
        const stMatch = html.match(/"seriesTitle"\s*:\s*"([^"]+)"/);
        if (stMatch) {
            seriesTitle = stMatch[1];
        }

        const results = [];
        results.push({
            href: slug,
            number: 1
        });

        // If we found a seriesTitle, search for other episodes
        if (seriesTitle) {
            try {
                const searchResp = await fetchv2(BASE_URL + "/api/search?q=" + encodeURIComponent(seriesTitle) + "&limit=50");
                const searchData = await searchResp.json();
                const items = searchData.results || searchData || [];

                if (Array.isArray(items)) {
                    const epResults = [];
                    for (const item of items) {
                        const itemSlug = item.slug || "";
                        const epNum = item.episodeNumber;
                        if (itemSlug && itemSlug !== slug) {
                            epResults.push({
                                href: itemSlug,
                                number: epNum || (epResults.length + 1)
                            });
                        }
                    }
                    if (epResults.length > 0) {
                        // Prepend the current episode and sort
                        epResults.push({ href: slug, number: 1 });
                        // Re-number properly
                        epResults.sort(function(a, b) { return (a.number || 0) - (b.number || 0); });
                        return JSON.stringify(epResults);
                    }
                }
            } catch (e) {
                // Fallback to single episode
            }
        }

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([{ href: "Error", number: "Error" }]);
    }
}

// ─── 4. Extract Stream URL ───
async function extractStreamUrl(url) {
    try {
        const slug = url.trim();
        const streams = [];

        // Direct CDN m3u8 URL — no iframe, no auth, no decode needed
        const videoUrl = CDN_BASE + CDN_PATH + slug + "/playlist.m3u8";

        streams.push({
            title: "1080p",
            streamUrl: videoUrl,
            headers: {
                "Referer": BASE_URL + "/"
            }
        });

        return JSON.stringify({
            streams: streams,
            subtitles: ""
        });
    } catch (err) {
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}
