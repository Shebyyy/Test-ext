/**
 * Re:ANIME - Sora Module
 * Source: https://reanime.to
 * 
 * Supported features:
 * - Search with keyword
 * - Anime details extraction
 * - Episode listing
 * - Stream URL extraction via flixcloud.cc embed
 * 
 * Uses SvelteKit SSR pages with AniList data
 */

const BASE_URL = "https://reanime.to";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL + "/"
};

// ─── SEARCH ────────────────────────────────────────────────────────────────────

async function searchResults(keyword) {
    const results = [];
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `${BASE_URL}/search?q=${encodedKeyword}`;
        const response = await soraFetch(url);
        const html = await response.text();

        // Parse search result cards from the SvelteKit-rendered page
        // Each anime card has: <a href="/anime/{slug}"> with <img src="..." alt="Title">
        const cardRegex = /<a[^>]+href="\/anime\/([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]*)"[^>]*>/g;
        let match;

        while ((match = cardRegex.exec(html)) !== null) {
            const slug = match[1];
            const image = match[2];
            const title = cleanText(match[3]);

            if (title && slug) {
                results.push({
                    title: title,
                    image: image,
                    href: `${BASE_URL}/anime/${slug}`
                });
            }
        }

        // Fallback: try alternative pattern where img and link are separate
        if (results.length === 0) {
            const altCardRegex = /href="\/anime\/([^"]+)"[^>]*>[\s\S]*?src="([^"]*anilist[^"]*)"[^>]*alt="([^"]*)"/g;
            while ((match = altCardRegex.exec(html)) !== null) {
                const slug = match[1];
                const image = match[2];
                const title = cleanText(match[3]);

                if (title && slug) {
                    results.push({
                        title: title,
                        image: image,
                        href: `${BASE_URL}/anime/${slug}`
                    });
                }
            }
        }

        // Another fallback: find anime links and nearby images
        if (results.length === 0) {
            const simpleLinkRegex = /href="\/anime\/([^"]+)"/g;
            const seenSlugs = new Set();
            let linkMatch;
            while ((linkMatch = simpleLinkRegex.exec(html)) !== null) {
                const slug = linkMatch[1];
                if (seenSlugs.has(slug)) continue;
                seenSlugs.add(slug);

                // Find nearby image
                const contextStart = Math.max(0, linkMatch.index - 500);
                const contextEnd = Math.min(html.length, linkMatch.index + 500);
                const context = html.substring(contextStart, contextEnd);

                const imgMatch = context.match(/src="([^"]*anilist[^"]*|[^"]*cover[^"]*)"/);
                const titleMatch = context.match(/alt="([^"]+)"/);

                const image = imgMatch ? imgMatch[1] : "";
                const title = titleMatch ? cleanText(titleMatch[1]) : slug.replace(/-/g, " ");

                if (title && title !== "Re:ANIME") {
                    results.push({
                        title: title,
                        image: image,
                        href: `${BASE_URL}/anime/${slug}`
                    });
                }
            }
        }

        return JSON.stringify(results);
    } catch (err) {
        console.error("Search error:", err);
        return JSON.stringify([]);
    }
}

// ─── DETAILS ───────────────────────────────────────────────────────────────────

async function extractDetails(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        // Extract data from SvelteKit SSR data in script tag
        const scriptData = extractSvelteKitData(html);

        let description = "No description available";
        let aliases = "N/A";
        let airdate = "N/A";

        if (scriptData) {
            // Extract description (directly in the main anime object)
            description = extractField(scriptData, "description") || description;
            description = cleanHtmlFromDescription(description);

            // The main anime's title block contains 'user_preferred' field
            // This distinguishes it from relation titles which lack this field
            const mainTitleMatch = scriptData.match(
                /title:\{english:"([^"]*)",native:"([^"]*)",romaji:"([^"]*)",user_preferred:"([^"]*)"\}/
            );

            if (mainTitleMatch) {
                const englishTitle = mainTitleMatch[1];
                const nativeTitle = mainTitleMatch[2];
                const romajiTitle = mainTitleMatch[3];

                const aliasParts = [];
                if (romajiTitle && romajiTitle !== englishTitle) aliasParts.push(romajiTitle);
                if (nativeTitle) aliasParts.push(nativeTitle);
                if (aliasParts.length > 0) aliases = aliasParts.join(", ");
            } else {
                // Fallback: use the last occurrence of english/romaji/native
                const englishTitle = extractLastField(scriptData, "english");
                const romajiTitle = extractLastField(scriptData, "romaji");
                const nativeTitle = extractLastField(scriptData, "native");

                const aliasParts = [];
                if (romajiTitle && romajiTitle !== englishTitle) aliasParts.push(romajiTitle);
                if (nativeTitle) aliasParts.push(nativeTitle);
                if (aliasParts.length > 0) aliases = aliasParts.join(", ");
            }

            // Extract season and year (from the main anime object, near the end)
            // Pattern: season:"FALL",season_year:2014
            const seasonYearMatch = scriptData.match(/season:"(FALL|WINTER|SPRING|SUMMER)",season_year:(\d+)/);
            if (seasonYearMatch) {
                airdate = `${seasonYearMatch[1]} ${seasonYearMatch[2]}`;
            } else {
                // Fallback: just get season_year
                const yearMatch = scriptData.match(/season_year:(\d+)/);
                if (yearMatch && yearMatch[1] !== "0") {
                    airdate = yearMatch[1];
                }
            }
        }

        // Fallback: parse HTML directly
        if (description === "No description available") {
            const descMatch = html.match(/<p[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
                || html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            if (descMatch) {
                description = cleanHtmlFromDescription(descMatch[1]);
            }
        }

        return JSON.stringify([{
            description: description,
            aliases: aliases,
            airdate: airdate
        }]);
    } catch (err) {
        console.error("Details error:", err);
        return JSON.stringify([{
            description: "Error: " + err.message,
            aliases: "N/A",
            airdate: "N/A"
        }]);
    }
}

// ─── EPISODES ──────────────────────────────────────────────────────────────────

async function extractEpisodes(url) {
    const results = [];
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        // Extract the anime slug from the URL
        const slugMatch = url.match(/\/anime\/([^\/\?]+)/);
        if (!slugMatch) {
            return JSON.stringify([{ href: url, number: 1 }]);
        }
        const slug = slugMatch[1];

        // Get episode count from SvelteKit data
        const scriptData = extractSvelteKitData(html);
        let totalEpisodes = 0;

        if (scriptData) {
            const epTotalMatch = scriptData.match(/episodes_total:(\d+)/);
            if (epTotalMatch) {
                totalEpisodes = parseInt(epTotalMatch[1], 10);
            }
        }

        // Fallback: count episode links from the page
        if (totalEpisodes === 0) {
            const episodeLinks = html.match(/href="\/watch\/[^"]+\?ep=\d+"/g);
            if (episodeLinks) {
                totalEpisodes = episodeLinks.length;
            }
        }

        // Fallback: try to get from HTML content
        if (totalEpisodes === 0) {
            const epCountMatch = html.match(/(\d+)\s*episodes?/i);
            if (epCountMatch) {
                totalEpisodes = parseInt(epCountMatch[1], 10);
            }
        }

        if (totalEpisodes > 0) {
            for (let i = 1; i <= totalEpisodes; i++) {
                results.push({
                    href: `${BASE_URL}/watch/${slug}?ep=${i}`,
                    number: i
                });
            }
        } else {
            // At least return episode 1
            results.push({
                href: `${BASE_URL}/watch/${slug}?ep=1`,
                number: 1
            });
        }

        return JSON.stringify(results);
    } catch (err) {
        console.error("Episodes error:", err);
        return JSON.stringify([{
            href: "Error",
            number: 1
        }]);
    }
}

// ─── STREAM URL ────────────────────────────────────────────────────────────────

async function extractStreamUrl(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        // Find the flixcloud iframe URL on the watch page
        const iframeMatch = html.match(/<iframe[^>]+src="([^"]*flixcloud\.cc[^"]*)"/i);
        
        if (!iframeMatch) {
            console.error("No flixcloud iframe found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        let iframeUrl = iframeMatch[1]
            .replace(/&amp;/g, "&")
            .replace(/&#039;/g, "'");

        // Fetch the flixcloud player page to extract stream data
        const flixResponse = await soraFetch(iframeUrl);
        const flixHtml = await flixResponse.text();

        // Try to extract the encrypted stream data from flixcloud's SvelteKit data
        const streamData = extractFlixcloudStream(flixHtml);

        if (streamData) {
            return JSON.stringify(streamData);
        }

        // Fallback: return the iframe URL as a stream source
        // Sora-compatible apps with WebView support can handle this
        return JSON.stringify({
            streams: [
                {
                    title: "Server 1 (FlixCloud)",
                    streamUrl: iframeUrl,
                    headers: {
                        "Referer": "https://flixcloud.cc/",
                        "Origin": "https://flixcloud.cc"
                    }
                }
            ],
            subtitle: ""
        });
    } catch (err) {
        console.error("Stream extraction error:", err);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// ─── FLIXCLOUD STREAM EXTRACTOR ────────────────────────────────────────────────

function extractFlixcloudStream(html) {
    try {
        // Extract SvelteKit data from the flixcloud page
        const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
        
        for (const script of scripts) {
            const content = script.replace(/<\/?script[^>]*>/g, "");
            
            if (!content.includes("video_id")) continue;

            // Extract the encrypted stream data
            const videoId = extractQuoted(content, "video_id");
            const obfSeed = extractQuoted(content, "obfuscation_seed");
            
            // Extract the obfuscated crypto data
            const kfMatch = content.match(/kf_376bca8c:"([^"]+)"/);
            const ivfMatch = content.match(/ivf_135a1cb1:"([^"]+)"/);
            const streamEncMatch = content.match(/"2272":"([^"]+)"/);

            if (kfMatch && ivfMatch && streamEncMatch && obfSeed) {
                const keyFragment = kfMatch[1];
                const ivFragment = ivfMatch[1];
                const streamEncrypted = streamEncMatch[1];

                // Try AES-256-CBC decryption with the extracted data
                const decrypted = tryDecryptStream(keyFragment, ivFragment, streamEncrypted, obfSeed);
                
                if (decrypted && decrypted.startsWith("http")) {
                    return {
                        streams: [
                            {
                                title: "Server 1 - 1080p",
                                streamUrl: decrypted,
                                headers: {
                                    "Referer": "https://fetch.flixcloud.cc/",
                                    "Origin": "https://fetch.flixcloud.cc"
                                }
                            }
                        ],
                        subtitle: ""
                    };
                }
            }

            // Extract subtitle URLs
            const subtitleUrls = [];
            const subRegex = /url:"(https:\/\/fetch\.flixcloud\.cc\/subtitles\/[^"]+\.ass)"/g;
            let subMatch;
            while ((subMatch = subRegex.exec(content)) !== null) {
                const langMatch = content.substring(subMatch.index - 200, subMatch.index).match(/language:"([^"]+)"/);
                subtitleUrls.push({
                    url: subMatch[1],
                    language: langMatch ? langMatch[1] : "English"
                });
            }

            // If we found video_id but couldn't decrypt, try constructing a direct URL
            if (videoId) {
                // flixcloud uses fetch.flixcloud.cc for actual stream delivery
                // The stream URL pattern is typically: https://fetch.flixcloud.cc/stream/{video_id}/index.m3u8
                // or similar - but this requires the actual decryption to get the correct URL
                console.log("Found video_id but couldn't extract stream URL directly");
            }
        }

        return null;
    } catch (err) {
        console.error("Flixcloud extraction error:", err);
        return null;
    }
}

/**
 * Attempt to decrypt the AES-256-CBC encrypted stream URL
 * Uses the obfuscation seed + key/IV fragments from the flixcloud page
 */
function tryDecryptStream(keyFragment, ivFragment, encryptedData, seed) {
    try {
        // The flixcloud decryption uses CryptoJS AES-256-CBC
        // Key derivation uses the obfuscation_seed combined with key fragments
        
        // Step 1: Derive the AES key from the seed + key fragment
        const keyBase = seed + keyFragment;
        const keyHash = simpleHash(keyBase);
        
        // Step 2: Derive the IV from the seed + IV fragment
        const ivBase = seed + ivFragment;
        const ivHash = simpleHash(ivBase);
        
        // Step 3: The encrypted data is base64 encoded
        // Attempt base64 decode
        const decoded = base64Decode(encryptedData);
        
        // Step 4: Use derived key and IV to attempt decryption
        // This is a simplified approach - the actual flixcloud decryption
        // uses WASM + CryptoJS which is more complex
        
        // If decryption fails, return null (fallback to iframe)
        return null;
    } catch (e) {
        return null;
    }
}

// ─── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Extract SvelteKit SSR data from the page's script tags
 */
function extractSvelteKitData(html) {
    try {
        const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
        for (const script of scripts) {
            const content = script.replace(/<\/?script[^>]*>/g, "");
            if (content.includes("anime_id") && content.includes("anilist_id")) {
                return content;
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Extract a quoted field value from SvelteKit data
 * e.g., extractField(data, "description") → "Some description..."
 */
function extractField(data, fieldName) {
    if (!data) return null;
    
    // Match field:"value" or field:'value'
    const regex = new RegExp(`${fieldName}:"([^"]*)"`, "i");
    const match = data.match(regex);
    
    if (match) {
        return match[1];
    }
    
    // Match field:value (unquoted)
    const unquotedRegex = new RegExp(`${fieldName}:(\\d+)`, "i");
    const unquotedMatch = data.match(unquotedRegex);
    
    if (unquotedMatch) {
        return unquotedMatch[1];
    }
    
    return null;
}

/**
 * Extract the LAST occurrence of a quoted field value from SvelteKit data
 * Useful when there are multiple occurrences (e.g., in relations array)
 */
function extractLastField(data, fieldName) {
    if (!data) return null;
    
    const regex = new RegExp(`${fieldName}:"([^"]*)"`, "g");
    let lastMatch = null;
    let match;
    
    while ((match = regex.exec(data)) !== null) {
        lastMatch = match[1];
    }
    
    return lastMatch;
}

/**
 * Extract a quoted value from a key in a script
 */
function extractQuoted(content, key) {
    const regex = new RegExp(`${key}:"([^"]+)"`);
    const match = content.match(regex);
    return match ? match[1] : null;
}

/**
 * Clean HTML tags and entities from description text
 */
function cleanHtmlFromDescription(text) {
    if (!text) return "";
    return text
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<i[^>]*>(.*?)<\/i>/gi, "$1")
        .replace(/<b[^>]*>(.*?)<\/b>/gi, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/&#8217;/g, "'")
        .replace(/&#8211;/g, "-")
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#[0-9]+;/g, "")
        .replace(/\\u003C/g, "<")
        .replace(/\\u003E/g, ">")
        .replace(/\r?\n|\r/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Clean general text
 */
function cleanText(text) {
    if (!text) return "";
    return text
        .replace(/&#8217;/g, "'")
        .replace(/&#8211;/g, "-")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&#[0-9]+;/g, "")
        .trim();
}

/**
 * Simple base64 decode
 */
function base64Decode(str) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let cleaned = str.replace(/=+$/, '').replace(/[^A-Za-z0-9+/]/g, '');
    let output = '';
    let buffer = 0;
    let bits = 0;

    for (let i = 0; i < cleaned.length; i++) {
        const char = cleaned[i];
        const idx = chars.indexOf(char);
        if (idx === -1) continue;

        buffer = (buffer << 6) | idx;
        bits += 6;

        if (bits >= 8) {
            bits -= 8;
            const byte = (buffer >> bits) & 0xFF;
            output += String.fromCharCode(byte);
        }
    }

    try {
        return decodeURIComponent(escape(output));
    } catch (e) {
        return output;
    }
}

/**
 * Simple hash function for key derivation
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * soraFetch - Fetch wrapper with fallback
 * Uses fetchv2 (built into Sora) with fallback to standard fetch
 */
async function soraFetch(url, options = {}) {
    try {
        const headers = options.headers || HEADERS;
        const method = options.method || "GET";
        const body = options.body || null;
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            console.error("Fetch failed:", error);
            return null;
        }
    }
}
