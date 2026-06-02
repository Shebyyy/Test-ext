/**
 * Nyaa - Sora Module
 * Source: https://nyaa.si
 * 
 * Matches Aniyomi NyaaTorrent extension behavior:
 * - Search via HTML table scraping (same as Aniyomi)
 * - Details from view page (category, seeders, leechers, size, submitter)
 * - Episodes from .torrent file parsing (bencode decoder)
 * - Each video file = one episode with magnet &index= param
 * - Stream = magnet link directly
 */

const BASE_URL = "https://nyaa.si";

// Valid video extensions (same as Aniyomi)
const VALID_EXTENSIONS = new Set([
    "mp4", "mkv", "avi", "webm", "flv", "mov", "ts", "ogg",
    "mpeg", "mpg", "wmv", "vob", "mts"
]);

// ─── SEARCH ────────────────────────────────────────────────────────────────────
// Aniyomi scrapes HTML table: table.torrent-list tbody tr
// Each row: td:nth-child(1) = category icon, td:nth-child(2) = title link,
//           td:nth-child(3) = comments, td:nth-child(4) = links (dl + magnet),
//           td:nth-child(5) = size, td:nth-child(6) = date,
//           td:nth-child(7) = seeders, td:nth-child(8) = leechers,
//           td:nth-child(9) = downloads

async function searchResults(keyword) {
    const results = [];
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        // Same URL format as Aniyomi: ?f=0&c=1_2&s=seeders&o=desc&q=...
        const url = `${BASE_URL}/?f=0&c=1_2&s=seeders&o=desc&q=${encodedKeyword}&p=1`;
        const response = await soraFetch(url);
        const html = await response.text();

        // Parse table rows - match all <tr> inside tbody
        const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/g;
        let rowMatch;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
            const row = rowMatch[0];

            // Skip header row
            if (row.includes("hdr-category")) continue;

            // Extract title and href from td:nth-child(2) a
            // Aniyomi: element.select("td:nth-child(2) a:not(.comments)").attr("title")
            const titleMatch = row.match(/<td[^>]*colspan="2"[^>]*>[\s\S]*?<a[^>]+href="\/view\/(\d+)"[^>]+title="([^"]*)"/);
            if (!titleMatch) {
                // Try without colspan
                const altTitle = row.match(/<td[^>]*>[\s\S]*?<a[^>]+href="\/view\/(\d+)"[^>]+title="([^"]*)"/);
                if (!altTitle) continue;
                var torrentId = altTitle[1];
                var title = altTitle[2];
            } else {
                var torrentId = titleMatch[1];
                var title = titleMatch[2];
            }

            // Extract magnet link from the links column
            const magnetMatch = row.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);
            const infoHash = magnetMatch ? magnetMatch[1].match(/urn:btih:([a-fA-F0-9]{40})/)?.[1] || "" : "";

            // Extract size
            const sizeMatch = row.match(/<td class="text-center">([\d.]+\s*(?:TiB|GiB|MiB|KiB))<\/td>/);

            // Extract seeders, leechers, downloads
            const tds = row.match(/<td class="text-center">[\s\S]*?<\/td>/g) || [];
            let seeders = "0", leechers = "0", downloads = "0";
            
            // Last 3 tds are seeders, leechers, downloads
            if (tds.length >= 3) {
                seeders = tds[tds.length - 3].replace(/<[^>]+>/g, "").trim();
                leechers = tds[tds.length - 2].replace(/<[^>]+>/g, "").trim();
                downloads = tds[tds.length - 1].replace(/<[^>]+>/g, "").trim();
            }

            // Extract date
            const dateMatch = row.match(/data-timestamp="(\d+)"/);
            const date = dateMatch ? new Date(parseInt(dateMatch[1]) * 1000).toISOString() : "";

            // Check trusted/remake from row class
            const isTrusted = row.includes('class="success"') || row.includes('class="danger"');
            const isRemake = row.includes('class="danger"');

            if (title && torrentId) {
                results.push({
                    title: cleanText(title),
                    image: "",
                    href: `${BASE_URL}/view/${torrentId}`,
                    seeders: seeders,
                    leechers: leechers,
                    size: sizeMatch ? sizeMatch[1] : "N/A",
                    downloads: downloads,
                    date: date,
                    infoHash: infoHash,
                    trusted: isTrusted,
                    remake: isRemake
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
// Aniyomi extracts: category, seeders, leechers, filesize, description, submitter, thumbnail

async function extractDetails(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        // Extract key-value pairs from panel-body (same selectors as Aniyomi)
        // div.panel-body contains rows of: <div class="col-md-1">Label:</div><div class="col-md-5">Value</div>
        const fieldRegex = /<div class="col-md-1">([^<]+):<\/div>\s*<div class="col-md-[57]">([\s\S]*?)<\/div>/g;
        const fields = {};
        let fieldMatch;
        while ((fieldMatch = fieldRegex.exec(html)) !== null) {
            const label = fieldMatch[1].trim();
            const value = fieldMatch[2].replace(/<[^>]+>/g, "").trim();
            fields[label] = value;
        }

        const category = fields["Category"] || "N/A";
        const seeders = fields["Seeders"] || "0";
        const leechers = fields["Leechers"] || "0";
        const filesize = fields["File size"] || "N/A";
        const submitter = fields["Submitter"] || "N/A";
        const date = fields["Date"] || "N/A";

        // Extract description from #torrent-description (same as Aniyomi)
        let description = "";
        const descMatch = html.match(/id="torrent-description"[^>]*>([\s\S]*?)<\/div>/);
        if (descMatch) {
            description = cleanHtmlFromDescription(descMatch[1]);
        }

        // Extract info hash
        const hashMatch = html.match(/magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/);
        const infoHash = hashMatch ? hashMatch[1] : "";

        // Try to extract thumbnail from description (same as Aniyomi regex)
        const imageRegex = /\b(https?:\S+(?:jpg|png|gif|bmp|webp|tiff|jpeg))(?!\.html)\b/i;
        const imageMatch = description.match(imageRegex);
        const thumbnail = imageMatch ? imageMatch[1] : "";

        // Build genre string (same as Aniyomi: Category, Seeders, Leechers, File Size)
        const genre = `Category: ${category}, Seeders: ${seeders}, Leechers: ${leechers}, File Size: ${filesize}`;

        // Combine description with genre info
        const fullDescription = `${genre}\n\n${description}`;

        return JSON.stringify([{
            description: fullDescription,
            aliases: infoHash,
            airdate: date,
            image: thumbnail
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
// Aniyomi: downloads .torrent file, parses it with TorrentUtils,
// lists each video file as an episode with magnet &index= param,
// episodes are reversed so ep1 is at top

async function extractEpisodes(url) {
    try {
        const torrentIdMatch = url.match(/\/view\/(\d+)/);
        if (!torrentIdMatch) {
            return JSON.stringify([{ href: url, number: 1 }]);
        }
        const torrentId = torrentIdMatch[1];

        // Fetch the view page first to get magnet/hash
        const pageResponse = await soraFetch(url);
        const pageHtml = await pageResponse.text();

        // Extract info hash from page
        const hashMatch = pageHtml.match(/urn:btih:([a-fA-F0-9]{40})/);
        const infoHash = hashMatch ? hashMatch[1] : "";

        // Extract date from page (for episode date)
        const dateMatch = pageHtml.match(/data-timestamp="(\d+)"/);
        const torrentDate = dateMatch ? parseInt(dateMatch[1]) * 1000 : 0;

        // Download and parse the .torrent file (same as Aniyomi's TorrentUtils)
        const torrentUrl = `${BASE_URL}/download/${torrentId}.torrent`;

        try {
            const torrentResponse = await soraFetch(torrentUrl);
            const torrentBuffer = await torrentResponse.arrayBuffer();
            const torrentData = decodeBencode(new Uint8Array(torrentBuffer));

            if (torrentData && torrentData.info) {
                const files = getTorrentFiles(torrentData);
                const trackers = getTorrentTrackers(torrentData);
                const torrentHash = computeInfoHash(torrentData.info_raw) || infoHash;
                
                // Build base magnet (same as Aniyomi: magnet:?xt=urn:btih:{hash}&dn={hash}&tr=...)
                let magnetBase = `magnet:?xt=urn:btih:${torrentHash}&dn=${torrentHash}`;
                for (const tracker of trackers) {
                    if (tracker && tracker.trim()) {
                        magnetBase += `&tr=${encodeURIComponent(tracker.trim())}`;
                    }
                }

                // Filter to video files only (same as Aniyomi's validExtensions)
                const videoFiles = files.filter(f => {
                    const ext = f.path.split(".").pop().toLowerCase();
                    return VALID_EXTENSIONS.has(ext);
                });

                if (videoFiles.length > 0) {
                    // Map each video file to an episode (same as Aniyomi)
                    let episodeNumber = 1;
                    const episodes = videoFiles.map(file => {
                        const fileName = file.path.split("/").pop();
                        const displayName = file.path
                            .replace(/\[/g, "(")
                            .replace(/\]/g, ")")
                            .replace(/\//g, "📂 ");
                        
                        const ep = {
                            href: `${magnetBase}&index=${file.index}`,
                            number: episodeNumber++,
                            name: fileName,  // filename only (cleaner display)
                            path: displayName, // full path with folder icons
                            size: formatBytes(file.length)
                        };
                        return ep;
                    });

                    // Reverse so ep1 is at top (same as Aniyomi: .reversed())
                    episodes.reverse();

                    return JSON.stringify(episodes);
                }
            }
        } catch (torrentErr) {
            console.error("Torrent parse failed, falling back to single magnet:", torrentErr);
        }

        // Fallback: if torrent parse fails, return single episode with magnet
        if (infoHash) {
            // Try to extract existing magnet from page with trackers
            const pageMagnet = pageHtml.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);
            const magnetLink = pageMagnet ? pageMagnet[1].replace(/&amp;/g, "&") : buildMagnetLink(infoHash, "");
            
            return JSON.stringify([{
                href: magnetLink,
                number: 1,
                name: "Magnet Link",
                size: ""
            }]);
        }

        return JSON.stringify([{ href: url, number: 1 }]);
    } catch (err) {
        console.error("Episodes error:", err);
        return JSON.stringify([{ href: "Error", number: 1 }]);
    }
}

// ─── STREAM URL ────────────────────────────────────────────────────────────────
// Aniyomi: simply returns the magnet URL as the video URL
// Video(episode.url, episode.name, episode.url)

async function extractStreamUrl(url) {
    try {
        // The URL is already a magnet link from extractEpisodes
        if (url.startsWith("magnet:")) {
            const magnetLink = url.replace(/&amp;/g, "&");
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]{40})/);
            const infoHash = hashMatch ? hashMatch[1] : "";

            return JSON.stringify({
                streams: [
                    {
                        title: "Magnet",
                        streamUrl: magnetLink,
                        headers: {}
                    }
                ],
                subtitle: "",
                infoHash: infoHash,
                magnet: magnetLink
            });
        }

        // If it's a nyaa view page URL, extract magnet from page
        const response = await soraFetch(url);
        const html = await response.text();

        const magnetMatch = html.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);
        if (magnetMatch) {
            const magnetLink = magnetMatch[1].replace(/&amp;/g, "&");
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]{40})/);
            const infoHash = hashMatch ? hashMatch[1] : "";

            return JSON.stringify({
                streams: [
                    {
                        title: "Magnet",
                        streamUrl: magnetLink,
                        headers: {}
                    }
                ],
                subtitle: "",
                infoHash: infoHash,
                magnet: magnetLink
            });
        }

        return JSON.stringify({ streams: [], subtitle: "" });
    } catch (err) {
        console.error("Stream extraction error:", err);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BENCODE DECODER - Parses .torrent files (replaces Aniyomi's TorrentUtils)
// ═══════════════════════════════════════════════════════════════════════════════

function decodeBencode(data) {
    let pos = 0;

    function decode() {
        if (pos >= data.length) return null;
        const char = String.fromCharCode(data[pos]);

        // Integer: i<number>e
        if (char === "i") {
            pos++;
            const end = findChar(data, "e", pos);
            if (end === -1) return null;
            const numStr = bytesToString(data, pos, end);
            pos = end + 1;
            return parseInt(numStr, 10);
        }

        // List: l<items>e
        if (char === "l") {
            pos++;
            const list = [];
            while (pos < data.length && String.fromCharCode(data[pos]) !== "e") {
                list.push(decode());
            }
            pos++;
            return list;
        }

        // Dictionary: d<key><value>...e
        if (char === "d") {
            pos++;
            const dict = {};
            while (pos < data.length && String.fromCharCode(data[pos]) !== "e") {
                const key = decode();
                const value = decode();
                if (key !== null) dict[key] = value;
            }
            pos++;
            return dict;
        }

        // Byte string: <length>:<bytes>
        if (char >= "0" && char <= "9") {
            const colonPos = findChar(data, ":", pos);
            if (colonPos === -1) return null;
            const length = parseInt(bytesToString(data, pos, colonPos), 10);
            pos = colonPos + 1;
            const strBytes = data.slice(pos, pos + length);
            pos += length;
            try {
                return utf8Decode(strBytes);
            } catch (e) {
                return bytesToHex(strBytes);
            }
        }

        return null;
    }

    return decode();
}

function findChar(data, char, start) {
    const code = char.charCodeAt(0);
    for (let i = start; i < data.length; i++) {
        if (data[i] === code) return i;
    }
    return -1;
}

function bytesToString(data, start, end) {
    let str = "";
    for (let i = start; i < end; i++) str += String.fromCharCode(data[i]);
    return str;
}

function utf8Decode(bytes) {
    let str = "";
    let i = 0;
    while (i < bytes.length) {
        let b1 = bytes[i++];
        if (b1 < 0x80) {
            str += String.fromCharCode(b1);
        } else if (b1 >= 0xC0 && b1 < 0xE0) {
            let b2 = bytes[i++];
            str += String.fromCharCode(((b1 & 0x1F) << 6) | (b2 & 0x3F));
        } else if (b1 >= 0xE0 && b1 < 0xF0) {
            let b2 = bytes[i++], b3 = bytes[i++];
            str += String.fromCharCode(((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
        } else if (b1 >= 0xF0) {
            let b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++];
            let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
            cp -= 0x10000;
            str += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        }
    }
    return str;
}

function bytesToHex(bytes) {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TORRENT FILE HELPERS (same logic as Aniyomi's TorrentUtils)
// ═══════════════════════════════════════════════════════════════════════════════

function getTorrentFiles(torrentData) {
    const info = torrentData.info;
    if (!info) return [];

    const files = [];

    if (info.files && Array.isArray(info.files)) {
        // Multi-file torrent: info.files = [{path: [...], length: N}, ...]
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

function getTorrentTrackers(torrentData) {
    const trackers = [];
    if (torrentData.announce) trackers.push(torrentData.announce);
    if (torrentData["announce-list"] && Array.isArray(torrentData["announce-list"])) {
        for (const tier of torrentData["announce-list"]) {
            if (Array.isArray(tier)) {
                for (const t of tier) {
                    if (typeof t === "string" && t.trim() && !trackers.includes(t)) trackers.push(t);
                }
            }
        }
    }
    return trackers;
}

function computeInfoHash(infoRaw) {
    // Can't compute SHA1 in pure JS easily, return empty and use hash from page
    return "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function buildMagnetLink(infoHash, displayName) {
    let magnet = `magnet:?xt=urn:btih:${infoHash}`;
    if (displayName) magnet += `&dn=${encodeURIComponent(displayName)}`;
    const defaultTrackers = [
        "http://nyaa.tracker.wf:7777/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://tracker.torrent.eu.org:451/announce"
    ];
    for (const t of defaultTrackers) magnet += `&tr=${encodeURIComponent(t)}`;
    return magnet;
}

function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const kb = bytes / 1024.0;
    const mb = kb / 1024.0;
    const gb = mb / 1024.0;
    if (gb >= 1) return gb.toFixed(2) + " GB";
    if (mb >= 1) return mb.toFixed(2) + " MB";
    return kb.toFixed(2) + " KB";
}

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

function cleanHtmlFromDescription(text) {
    if (!text) return "";
    return text
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
        .replace(/<i[^>]*>(.*?)<\/i>/gi, "$1")
        .replace(/<b[^>]*>(.*?)<\/b>/gi, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/&#10;/g, "\n")
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

async function soraFetch(url, options = {}) {
    try {
        const headers = options.headers || { "Referer": BASE_URL + "/" };
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
