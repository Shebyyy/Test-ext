/**
 * Nyaa - Sora Module
 * Source: https://nyaa.si
 * 
 * Supported features:
 * - Search anime torrents via RSS feed
 * - Torrent file parsing (bencode decoder) to list video files as episodes
 * - Magnet link extraction with file index for multi-file torrents
 * - Multiple category filters (Sub/Dub/Raw)
 * - Sort by seeders, downloads, date
 * 
 * Uses Nyaa RSS API + bencode torrent parser
 */

const BASE_URL = "https://nyaa.si";
const RSS_BASE = "https://nyaa.si/?page=rss";

// Category mappings
const CATEGORIES = {
    all: "1_0",
    englishTranslated: "1_2",
    nonEnglishTranslated: "1_3",
    raw: "1_4"
};

// Valid video file extensions
const VALID_EXTENSIONS = new Set([
    "mp4", "mkv", "avi", "webm", "flv", "mov", "ts", "ogg",
    "mpeg", "mpg", "wmv", "vob", "mts"
]);

// Default trackers for magnet links
const TRACKERS = [
    "http://nyaa.tracker.wf:7777/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce"
];

// ─── SEARCH ────────────────────────────────────────────────────────────────────

async function searchResults(keyword) {
    const results = [];
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `${RSS_BASE}&c=${CATEGORIES.englishTranslated}&q=${encodedKeyword}&limit=30`;
        const response = await soraFetch(url);
        const xml = await response.text();

        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        let itemMatch;

        while ((itemMatch = itemRegex.exec(xml)) !== null) {
            const item = itemMatch[0];

            const title = extractXmlTag(item, "title");
            const link = extractXmlTag(item, "link");
            const infoHash = extractXmlCustom(item, "nyaa:infoHash");
            const seeders = extractXmlCustom(item, "nyaa:seeders");
            const leechers = extractXmlCustom(item, "nyaa:leechers");
            const size = extractXmlCustom(item, "nyaa:size");
            const downloads = extractXmlCustom(item, "nyaa:downloads");
            const category = extractXmlCustom(item, "nyaa:category");
            const trusted = extractXmlCustom(item, "nyaa:trusted");
            const remake = extractXmlCustom(item, "nyaa:remake");
            const torrentId = extractTorrentId(link);

            if (title) {
                results.push({
                    title: cleanText(title),
                    image: "",
                    href: `${BASE_URL}/view/${torrentId}`,
                    infoHash: infoHash || "",
                    seeders: seeders || "0",
                    leechers: leechers || "0",
                    size: size || "N/A",
                    downloads: downloads || "0",
                    category: category || "",
                    trusted: trusted === "Yes",
                    remake: remake === "Yes",
                    torrentUrl: link || ""
                });
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

        let seeders = "0";
        let leechers = "0";
        let size = "N/A";
        let date = "N/A";
        let infoHash = "";
        let category = "";
        let submitter = "";
        let trusted = false;

        // Extract info hash from magnet link
        const hashMatch = html.match(/magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/);
        if (hashMatch) infoHash = hashMatch[1];

        // Extract seeders/leechers from page
        const seederMatch = html.match(/(\d+)\s*seeders?/i);
        if (seederMatch) seeders = seederMatch[1];

        const leecherMatch = html.match(/(\d+)\s*leechers?/i);
        if (leecherMatch) leechers = leecherMatch[1];

        // Extract file size
        const sizeMatch = html.match(/(\d+\.?\d*\s*(?:TiB|GiB|MiB|KiB))/i);
        if (sizeMatch) size = sizeMatch[1];

        // Extract date
        const dateMatch = html.match(/<time[^>]*datetime="([^"]+)"/);
        if (dateMatch) date = dateMatch[1];

        // Extract category
        const catMatch = html.match(/category[^>]*>([^<]+)</i);
        if (catMatch) category = catMatch[1].trim();

        // Extract submitter
        const subMatch = html.match(/submitter[^>]*>([^<]+)</i) || html.match(/class="comment-username"[^>]*>([^<]+)</i);
        if (subMatch) submitter = subMatch[1].trim();

        trusted = html.includes("fa-check-circle") || html.includes("trusted");

        const description = `Category: ${category}\nSize: ${size}\nDate: ${date}\nSeeders: ${seeders}\nLeechers: ${leechers}\nSubmitter: ${submitter}${trusted ? "\n✓ Trusted" : ""}`;

        return JSON.stringify([{
            description: description,
            aliases: infoHash,
            airdate: date
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
    try {
        const torrentIdMatch = url.match(/\/view\/(\d+)/);
        if (!torrentIdMatch) {
            return JSON.stringify([{ href: url, number: 1 }]);
        }
        const torrentId = torrentIdMatch[1];

        // Fetch the torrent page to get magnet info
        const pageResponse = await soraFetch(url);
        const pageHtml = await pageResponse.text();

        // Extract info hash from magnet link
        const hashMatch = pageHtml.match(/urn:btih:([a-fA-F0-9]{40})/);
        const infoHash = hashMatch ? hashMatch[1] : "";

        // Try to download and parse the .torrent file to get file list
        const torrentUrl = `${BASE_URL}/download/${torrentId}.torrent`;
        
        try {
            const torrentResponse = await soraFetch(torrentUrl);
            const torrentBuffer = await torrentResponse.arrayBuffer();
            const torrentData = decodeBencode(new Uint8Array(torrentBuffer));

            if (torrentData && torrentData.info) {
                const files = getTorrentFiles(torrentData);
                const trackers = getTorrentTrackers(torrentData);
                const magnetBase = buildMagnetBase(infoHash, torrentData.info.name, trackers);

                // Filter to video files only
                const videoFiles = files.filter(f => {
                    const ext = f.path.split(".").pop().toLowerCase();
                    return VALID_EXTENSIONS.has(ext);
                });

                if (videoFiles.length > 0) {
                    const episodes = videoFiles.map((file, index) => ({
                        href: `${magnetBase}&index=${file.index}`,
                        number: index + 1,
                        name: file.path.split("/").pop(),
                        size: formatBytes(file.length)
                    }));
                    return JSON.stringify(episodes);
                }
            }
        } catch (torrentErr) {
            console.error("Torrent parse failed, falling back to single episode:", torrentErr);
        }

        // Fallback: single episode with magnet link
        if (infoHash) {
            const magnet = buildMagnetLink(infoHash, "");
            return JSON.stringify([{
                href: magnet,
                number: 1
            }]);
        }

        return JSON.stringify([{ href: url, number: 1 }]);
    } catch (err) {
        console.error("Episodes error:", err);
        return JSON.stringify([{ href: "Error", number: 1 }]);
    }
}

// ─── STREAM URL ────────────────────────────────────────────────────────────────

async function extractStreamUrl(url) {
    try {
        // If the URL is already a magnet link
        if (url.startsWith("magnet:")) {
            const hashMatch = url.match(/urn:btih:([a-fA-F0-9]{40})/);
            const infoHash = hashMatch ? hashMatch[1] : "";
            
            return JSON.stringify({
                streams: [
                    {
                        title: "Magnet Link",
                        streamUrl: url.replace(/&amp;/g, "&"),
                        headers: {}
                    }
                ],
                subtitle: "",
                infoHash: infoHash,
                magnet: url.replace(/&amp;/g, "&")
            });
        }

        // Otherwise fetch the page and extract magnet
        const response = await soraFetch(url);
        const html = await response.text();

        // Extract magnet link
        const magnetMatch = html.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);
        if (magnetMatch) {
            const magnetLink = magnetMatch[1].replace(/&amp;/g, "&");
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]{40})/);
            const infoHash = hashMatch ? hashMatch[1] : "";

            return JSON.stringify({
                streams: [
                    {
                        title: "Magnet Link",
                        streamUrl: magnetLink,
                        headers: {}
                    }
                ],
                subtitle: "",
                infoHash: infoHash,
                magnet: magnetLink
            });
        }

        // Fallback: construct magnet from info hash
        const hashOnly = html.match(/urn:btih:([a-fA-F0-9]{40})/);
        if (hashOnly) {
            const infoHash = hashOnly[1];
            const magnet = buildMagnetLink(infoHash, "");
            return JSON.stringify({
                streams: [
                    {
                        title: "Magnet Link",
                        streamUrl: magnet,
                        headers: {}
                    }
                ],
                subtitle: "",
                infoHash: infoHash,
                magnet: magnet
            });
        }

        // Last fallback: torrent file download
        const torrentMatch = html.match(/href="(\/download\/\d+\.torrent)"/);
        if (torrentMatch) {
            const torrentUrl = BASE_URL + torrentMatch[1];
            return JSON.stringify({
                streams: [
                    {
                        title: "Torrent Download",
                        streamUrl: torrentUrl,
                        headers: { "Referer": BASE_URL + "/" }
                    }
                ],
                subtitle: "",
                torrentUrl: torrentUrl
            });
        }

        return JSON.stringify({ streams: [], subtitle: "" });
    } catch (err) {
        console.error("Stream extraction error:", err);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// ─── BENCODE DECODER ───────────────────────────────────────────────────────────

/**
 * Decode bencode format (BitTorrent .torrent file format)
 * Supports: integers, byte strings, lists, dictionaries
 */
function decodeBencode(data) {
    let pos = 0;

    function decode() {
        if (pos >= data.length) return null;

        const char = String.fromCharCode(data[pos]);

        // Integer: i<number>e
        if (char === "i") {
            pos++; // skip 'i'
            const end = findChar(data, "e", pos);
            if (end === -1) return null;
            const numStr = bytesToString(data, pos, end);
            pos = end + 1;
            return parseInt(numStr, 10);
        }

        // List: l<items>e
        if (char === "l") {
            pos++; // skip 'l'
            const list = [];
            while (pos < data.length && String.fromCharCode(data[pos]) !== "e") {
                list.push(decode());
            }
            pos++; // skip 'e'
            return list;
        }

        // Dictionary: d<key><value>...e
        if (char === "d") {
            pos++; // skip 'd'
            const dict = {};
            while (pos < data.length && String.fromCharCode(data[pos]) !== "e") {
                const key = decode();
                const value = decode();
                if (key !== null) {
                    dict[key] = value;
                }
            }
            pos++; // skip 'e'
            return dict;
        }

        // Byte string: <length>:<bytes>
        if (char >= "0" && char <= "9") {
            const colonPos = findChar(data, ":", pos);
            if (colonPos === -1) return null;
            const lengthStr = bytesToString(data, pos, colonPos);
            const length = parseInt(lengthStr, 10);
            pos = colonPos + 1;

            // Try to decode as UTF-8 string for keys, keep as string
            const strBytes = data.slice(pos, pos + length);
            pos += length;

            try {
                return utf8Decode(strBytes);
            } catch (e) {
                // If not valid UTF-8, return hex representation
                return bytesToHex(strBytes);
            }
        }

        return null;
    }

    return decode();
}

/**
 * Find a character position in byte array
 */
function findChar(data, char, start) {
    const code = char.charCodeAt(0);
    for (let i = start; i < data.length; i++) {
        if (data[i] === code) return i;
    }
    return -1;
}

/**
 * Convert bytes to string
 */
function bytesToString(data, start, end) {
    let str = "";
    for (let i = start; i < end; i++) {
        str += String.fromCharCode(data[i]);
    }
    return str;
}

/**
 * Decode UTF-8 byte array to string
 */
function utf8Decode(bytes) {
    let str = "";
    let i = 0;
    while (i < bytes.length) {
        let byte1 = bytes[i++];
        if (byte1 < 0x80) {
            str += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0) {
            let byte2 = bytes[i++];
            str += String.fromCharCode(((byte1 & 0x1F) << 6) | (byte2 & 0x3F));
        } else if (byte1 >= 0xE0 && byte1 < 0xF0) {
            let byte2 = bytes[i++];
            let byte3 = bytes[i++];
            str += String.fromCharCode(((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F));
        } else if (byte1 >= 0xF0) {
            let byte2 = bytes[i++];
            let byte3 = bytes[i++];
            let byte4 = bytes[i++];
            let codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            // Surrogate pair for code points > 0xFFFF
            codePoint -= 0x10000;
            str += String.fromCharCode(0xD800 + (codePoint >> 10), 0xDC00 + (codePoint & 0x3FF));
        }
    }
    return str;
}

/**
 * Convert bytes to hex string (for binary data like hashes)
 */
function bytesToHex(bytes) {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
}

// ─── TORRECT FILE PARSER ──────────────────────────────────────────────────────

/**
 * Extract file list from parsed torrent data
 * Returns array of { path, length, index }
 */
function getTorrentFiles(torrentData) {
    const info = torrentData.info;
    if (!info) return [];

    const files = [];

    if (info.files && Array.isArray(info.files)) {
        // Multi-file torrent
        let fileIndex = 0;
        for (const file of info.files) {
            let path = "";
            if (file.path && Array.isArray(file.path)) {
                path = file.path.join("/");
            } else if (typeof file.path === "string") {
                path = file.path;
            }
            
            files.push({
                path: path,
                length: file.length || 0,
                index: fileIndex
            });
            fileIndex++;
        }
    } else {
        // Single-file torrent
        files.push({
            path: info.name || "unknown",
            length: info.length || 0,
            index: 0
        });
    }

    return files;
}

/**
 * Extract tracker list from parsed torrent data
 */
function getTorrentTrackers(torrentData) {
    const trackers = [];

    // Primary announce URL
    if (torrentData.announce) {
        trackers.push(torrentData.announce);
    }

    // Announce list (nested arrays)
    if (torrentData["announce-list"] && Array.isArray(torrentData["announce-list"])) {
        for (const tier of torrentData["announce-list"]) {
            if (Array.isArray(tier)) {
                for (const tracker of tier) {
                    if (typeof tracker === "string" && tracker.trim() && !trackers.includes(tracker)) {
                        trackers.push(tracker);
                    }
                }
            } else if (typeof tier === "string" && tier.trim()) {
                if (!trackers.includes(tier)) trackers.push(tier);
            }
        }
    }

    return trackers;
}

// ─── MAGNET LINK BUILDERS ──────────────────────────────────────────────────────

/**
 * Build base magnet link with hash, name, and trackers (no index)
 */
function buildMagnetBase(infoHash, name, trackers) {
    let magnet = `magnet:?xt=urn:btih:${infoHash}`;

    if (name) {
        magnet += `&dn=${encodeURIComponent(name)}`;
    }

    // Use provided trackers, or fall back to defaults
    const trackerList = trackers.length > 0 ? trackers : TRACKERS;

    for (const tracker of trackerList) {
        if (tracker && tracker.trim()) {
            magnet += `&tr=${encodeURIComponent(tracker.trim())}`;
        }
    }

    return magnet;
}

/**
 * Build a complete magnet link from info hash and display name
 */
function buildMagnetLink(infoHash, displayName) {
    return buildMagnetBase(infoHash, displayName, TRACKERS);
}

// ─── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

/**
 * Extract text content from an XML tag
 */
function extractXmlTag(xml, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = xml.match(regex);
    return match ? match[1].trim() : "";
}

/**
 * Extract text content from a custom namespaced XML tag
 */
function extractXmlCustom(xml, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = xml.match(regex);
    return match ? match[1].trim() : "";
}

/**
 * Extract torrent ID from a download URL
 */
function extractTorrentId(url) {
    if (!url) return "";
    const match = url.match(/\/download\/(\d+)\.torrent/);
    return match ? match[1] : "";
}

/**
 * Clean HTML entities and whitespace from text
 */
function cleanText(text) {
    if (!text) return "";
    return text
        .replace(/&#8217;/g, "'")
        .replace(/&#8211;/g, "-")
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#[0-9]+;/g, "")
        .trim();
}

/**
 * soraFetch - Fetch wrapper with fallback
 */
async function soraFetch(url, options = {}) {
    try {
        const headers = options.headers || {};
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
