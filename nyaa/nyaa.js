/**
 * Nyaa - Sora Module
 * Source: https://nyaa.si
 * 
 * Matches Aniyomi NyaaTorrent extension behavior:
 * - Search via HTML table scraping
 * - Details from view page (category, seeders, leechers, size, submitter)
 * - Episodes from file list on view page (div.torrent-file-list)
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
// Columns: Category | Name(colspan=2) | Links | Size | Date | Seeders | Leechers | Downloads

async function searchResults(keyword) {
    const results = [];
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `${BASE_URL}/?f=0&c=1_2&s=seeders&o=desc&q=${encodedKeyword}&p=1`;
        const response = await soraFetch(url);
        const html = await response.text();

        // Parse table rows
        const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/g;
        let rowMatch;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
            const row = rowMatch[0];
            if (row.includes("hdr-category")) continue;

            // Extract title and href
            const titleMatch = row.match(/<td[^>]*colspan="2"[^>]*>[\s\S]*?<a[^>]+href="\/view\/(\d+)"[^>]+title="([^"]*)"/)
                || row.match(/<a[^>]+href="\/view\/(\d+)"[^>]+title="([^"]*)"/);
            if (!titleMatch) continue;

            const torrentId = titleMatch[1];
            const title = titleMatch[2];

            // Extract magnet link and info hash
            const magnetMatch = row.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);
            const infoHash = magnetMatch ? magnetMatch[1].match(/urn:btih:([a-fA-F0-9]{40})/)?.[1] || "" : "";

            // Extract size
            const sizeMatch = row.match(/<td class="text-center">([\d.]+\s*(?:TiB|GiB|MiB|KiB))<\/td>/);

            // Extract seeders, leechers, downloads from last 3 text-center tds
            const tds = row.match(/<td class="text-center">[\s\S]*?<\/td>/g) || [];
            let seeders = "0", leechers = "0", downloads = "0";
            if (tds.length >= 3) {
                seeders = tds[tds.length - 3].replace(/<[^>]+>/g, "").trim();
                leechers = tds[tds.length - 2].replace(/<[^>]+>/g, "").trim();
                downloads = tds[tds.length - 1].replace(/<[^>]+>/g, "").trim();
            }

            // Row class indicates trusted/danger
            const isTrusted = row.includes('class="success"');
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

        // Extract key-value pairs from panel-body
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

        // Extract description from #torrent-description
        let description = "";
        const descMatch = html.match(/id="torrent-description"[^>]*>([\s\S]*?)<\/div>/);
        if (descMatch) {
            description = cleanHtmlFromDescription(descMatch[1]);
        }

        // Extract info hash
        const hashMatch = html.match(/magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/);
        const infoHash = hashMatch ? hashMatch[1] : "";

        // Try to extract thumbnail from description (same as Aniyomi)
        const imageRegex = /\b(https?:\S+(?:jpg|png|gif|bmp|webp|tiff|jpeg))(?!\.html)\b/i;
        const imageMatch = description.match(imageRegex);
        const thumbnail = imageMatch ? imageMatch[1] : "";

        // Build genre string (same as Aniyomi)
        const genre = `Category: ${category}, Seeders: ${seeders}, Leechers: ${leechers}, File Size: ${filesize}`;

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
// Aniyomi: parses .torrent file with TorrentUtils, lists each video file as episode
// Our approach: parse the file list from the nyaa view page HTML
// The page shows: <li><i class="fa fa-file"></i>filename<span class="file-size">(size)</span></li>
// Files appear in the same order as the torrent's info.files array
// So the list index = torrent file index for the &index= param

async function extractEpisodes(url) {
    try {
        const torrentIdMatch = url.match(/\/view\/(\d+)/);
        if (!torrentIdMatch) {
            return JSON.stringify([{ href: url, number: 1 }]);
        }
        const torrentId = torrentIdMatch[1];

        // Fetch the view page
        const response = await soraFetch(url);
        const html = await response.text();

        // Extract info hash from magnet link on page
        const hashMatch = html.match(/urn:btih:([a-fA-F0-9]{40})/);
        const infoHash = hashMatch ? hashMatch[1] : "";

        // Extract trackers from the magnet link on page
        const magnetLinkMatch = html.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);
        let trackersPart = "";
        if (magnetLinkMatch) {
            const fullMagnet = magnetLinkMatch[1].replace(/&amp;/g, "&");
            // Extract &tr= params from the existing magnet
            const trMatches = fullMagnet.match(/&tr=[^&]+/g);
            if (trMatches) {
                trackersPart = trMatches.join("");
            }
        }

        // Build base magnet with hash + trackers from page
        let magnetBase = `magnet:?xt=urn:btih:${infoHash}&dn=${infoHash}${trackersPart}`;

        // Parse file list from the page's torrent-file-list section
        // Pattern: <li><i class="fa fa-file"></i>filename<span class="file-size">(size)</span></li>
        const fileRegex = /<li><i class="fa fa-file"><\/i>([^<]+)<span class="file-size">\(([^)]+)\)<\/span><\/li>/g;
        const allFiles = [];
        let fileMatch;
        while ((fileMatch = fileRegex.exec(html)) !== null) {
            allFiles.push({
                name: cleanText(fileMatch[1].trim()),
                size: fileMatch[2].trim(),
                index: allFiles.length  // index = position in the list = torrent file index
            });
        }

        // Filter to video files only (same as Aniyomi's validExtensions)
        const videoFiles = allFiles.filter(f => {
            const ext = f.name.split(".").pop().toLowerCase();
            return VALID_EXTENSIONS.has(ext);
        });

        if (videoFiles.length > 1) {
            // Multi-file torrent: each video file = one episode (same as Aniyomi)
            let episodeNumber = 1;
            const episodes = videoFiles.map(file => {
                const fileName = file.name.split("/").pop();
                const displayName = file.name
                    .replace(/\[/g, "(")
                    .replace(/\]/g, ")")
                    .replace(/\//g, "📂 ");

                const ep = {
                    href: `${magnetBase}&index=${file.index}`,
                    number: episodeNumber++,
                    name: fileName,
                    size: file.size
                };
                return ep;
            });

            // Reverse so ep1 is at top (same as Aniyomi: .reversed())
            episodes.reverse();
            return JSON.stringify(episodes);
        }

        // Single file torrent: just return 1 episode with the magnet
        if (infoHash) {
            const pageMagnet = magnetLinkMatch ? magnetLinkMatch[1].replace(/&amp;/g, "&") : buildMagnetLink(infoHash, "");
            return JSON.stringify([{
                href: pageMagnet,
                number: 1,
                name: videoFiles.length > 0 ? videoFiles[0].name : "Magnet Link",
                size: videoFiles.length > 0 ? videoFiles[0].size : ""
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

function cleanText(text) {
    if (!text) return "";
    return text
        .replace(/&#39;/g, "'")
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
        .replace(/&#39;/g, "'")
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
