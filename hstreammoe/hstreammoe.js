const BASE_URL = "https://hstream.moe";

// ─── Helper: fetch with fetchv2 fallback ───
async function soraFetch(url, options) {
    try {
        var method = (options && options.method) || "GET";
        var headers = (options && options.headers) || {};
        var body = (options && options.body) || null;
        var res = await fetchv2(url, headers, method, body);
        return res;
    } catch (e) {
        try {
            var res2 = await fetch(url, {
                method: (options && options.method) || "GET",
                headers: (options && options.headers) || {},
                body: (options && options.body) || undefined
            });
            return res2;
        } catch (err) {
            return null;
        }
    }
}

// ─── 1. Search Results ───
// HStream.moe uses Livewire, search results in HTML on /search?q= page
async function searchResults(keyword) {
    var results = [];
    try {
        var response = await soraFetch(BASE_URL + "/search?q=" + encodeURIComponent(keyword));
        if (!response) {
            return JSON.stringify([{ title: "Error", image: "Error", href: "Error" }]);
        }
        var html = await response.text();

        // Extract hentai links from homepage/search: /hentai/{slug}-{ep}
        // Group by base slug (series name) and pick episode 1
        var seen = {};
        var regex = /href="https:\/\/hstream\.moe\/hentai\/([^"]+)"/gi;
        var match;
        while ((match = regex.exec(html)) !== null) {
            var slugEp = match[1].trim();
            // Extract base slug (remove trailing -N episode number)
            var baseSlug = slugEp.replace(/-(\d+)$/, "");
            var epNum = slugEp.match(/-(\d+)$/);

            if (!seen[baseSlug] && baseSlug.length > 0) {
                seen[baseSlug] = true;
                // Use the first found episode URL
                results.push({
                    title: baseSlug.replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); }),
                    image: "",
                    href: slugEp
                });
            }
        }

        // Fallback: try any /hentai/ links
        if (results.length === 0) {
            var altRegex = /href="\/hentai\/([^"]+)"/gi;
            var altMatch;
            while ((altMatch = altRegex.exec(html)) !== null) {
                var slugEp2 = altMatch[1].trim();
                var baseSlug2 = slugEp2.replace(/-(\d+)$/, "");
                if (!seen[baseSlug2] && baseSlug2.length > 0) {
                    seen[baseSlug2] = true;
                    results.push({
                        title: baseSlug2.replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); }),
                        image: "",
                        href: slugEp2
                    });
                }
            }
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
        var pageUrl = BASE_URL + "/hentai/" + url.trim();
        var response = await soraFetch(pageUrl);
        if (!response) {
            return JSON.stringify([{ description: "Error", aliases: "Error", airdate: "Error" }]);
        }
        var html = await response.text();

        var description = "N/A";
        var descMatch = html.match(/
<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
        if (descMatch) {
            description = descMatch[1];
        }

        var aliases = "N/A";
        var airdate = "N/A";

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
        var slugEp = url.trim();
        // Extract base slug from the URL (e.g., "star-jewel-1" -> "star-jewel")
        var baseMatch = slugEp.match(/^(.+)-(\d+)$/);
        var baseSlug = baseMatch ? baseMatch[1] : slugEp;
        var firstEp = baseMatch ? parseInt(baseMatch[2], 10) : 1;

        // Fetch the first episode page to find episode navigation
        var pageUrl = BASE_URL + "/hentai/" + baseSlug + "-" + firstEp;
        var response = await soraFetch(pageUrl);
        if (!response) {
            return JSON.stringify([{ href: slugEp, number: firstEp }]);
        }
        var html = await response.text();

        // Look for episode navigation: select dropdown or numbered links
        var results = [];

        // Pattern 1: 
    <select> with episode options
        var selectRegex = /
        <select[^>]*(?:name|id)="episode"[^>]*>([\s\S]*?)<\/select>/i;
        var selectMatch = html.match(selectRegex);
        if (selectMatch) {
            var optRegex = /value="(\d+)"/gi;
            var optMatch;
            while ((optMatch = optRegex.exec(selectMatch[1])) !== null) {
                var num = parseInt(optMatch[1], 10);
                results.push({
                    href: baseSlug + "|" + num,
                    number: num
                });
            }
        }

        // Pattern 2: Look for episode links on page
        if (results.length === 0) {
            var linkRegex = new RegExp('href="https://hstream\\.moe/hentai/' + baseSlug.replace(/([\-\/\.])/g, "\\$1") + '-(\\d+)"', "gi");
            var linkMatch;
            var seen = {};
            while ((linkMatch = linkRegex.exec(html)) !== null) {
                var num2 = parseInt(linkMatch[1], 10);
                if (!seen[num2]) {
                    seen[num2] = true;
                    results.push({
                        href: baseSlug + "|" + num2,
                        number: num2
                    });
                }
            }
            results.sort(function(a, b) { return a.number - b.number; });
        }

        // Fallback: single episode
        if (results.length === 0) {
            results.push({
                href: baseSlug + "|" + firstEp,
                number: firstEp
            });
        }

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([{ href: "Error", number: "Error" }]);
    }
}

// ─── 4. Extract Stream URL ───
// HStream.moe: GET page -> extract e_id + _token -> POST /player/api
// Player uses DASH (.mpd) or MP4 fallback, NOT m3u8
async function extractStreamUrl(url) {
    try {
        var parts = url.trim().split("|");
        var baseSlug = parts[0];
        var epNum = parts[1] || "1";

        // Step 1: Fetch episode page to get CSRF token and episode ID
        var pageUrl = BASE_URL + "/hentai/" + baseSlug + "-" + epNum;
        var pageResponse = await soraFetch(pageUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (!pageResponse) {
            return JSON.stringify({ streams: [], subtitles: "" });
        }
        var html = await pageResponse.text();

        // Extract episode ID: 
            <input id="e_id" type="hidden" value="{id}" />
        var epIdMatch = html.match(/id="e_id"[^>]*value="(\d+)"/);
        if (!epIdMatch) {
            return JSON.stringify({ streams: [], subtitles: "" });
        }
        var episodeId = epIdMatch[1];

        // Extract CSRF token: form _token (the raw Laravel token)
        // This is different from data-csrf (Livewire's encrypted token)
        var tokenMatch = html.match(/name="_token"[^>]*value="([^"]+)"/);
        if (!tokenMatch) {
            tokenMatch = html.match(/data-csrf="([^"]+)"/);
        }
        if (!tokenMatch) {
            return JSON.stringify({ streams: [], subtitles: "" });
        }
        var csrfToken = tokenMatch[1];

        // Step 2: POST to /player/api
        // KEY: Send X-XSRF-TOKEN header with the RAW _token value (not encrypted cookie)
        // Session cookies from the GET request must be preserved (fetchv2 handles this)
        var formData = "episode_id=" + episodeId + "&_token=" + encodeURIComponent(csrfToken);
        var apiResponse = await soraFetch(BASE_URL + "/player/api", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": pageUrl,
                "X-Requested-With": "XMLHttpRequest",
                "X-XSRF-TOKEN": csrfToken,
                "Accept": "application/json"
            },
            body: formData
        });

        if (!apiResponse) {
            return JSON.stringify({ streams: [], subtitles: "" });
        }

        var apiData = await apiResponse.json();
        if (!apiData || !apiData.stream_url || !apiData.stream_domains) {
            return JSON.stringify({ streams: [], subtitles: "" });
        }

        // Step 3: Build stream URLs from actual player JS patterns
        // DASH: {domain}/{stream_url}/{quality}/manifest.mpd
        // MP4:  {domain}/{stream_url}/x264.720p.mp4
        var streams = [];
        var domains = apiData.stream_domains || [];
        var streamPath = apiData.stream_url;
        var domain = domains.length > 0 ? domains[0] : "";

        if (!domain) {
            return JSON.stringify({ streams: [], subtitles: "" });
        }

        // DASH streams (primary - better quality, multiple resolutions)
        var quality = apiData.interpolated_uhd == 1 ? "4K" : "1080p";

        // 4K UHD (if available)
        if (apiData.interpolated_uhd == 1) {
            streams.push({
                title: "4K (UHD Interpolated)",
                streamUrl: domain + "/" + streamPath + "/2160i/manifest.mpd",
                headers: { "Referer": BASE_URL + "/" }
            });
        }

        // 2160p
        streams.push({
            title: "2160p (DASH)",
            streamUrl: domain + "/" + streamPath + "/2160/manifest.mpd",
            headers: { "Referer": BASE_URL + "/" }
        });

        // 1080p
        streams.push({
            title: "1080p (DASH)",
            streamUrl: domain + "/" + streamPath + "/1080/manifest.mpd",
            headers: { "Referer": BASE_URL + "/" }
        });

        // 1080p interpolated
        if (apiData.interpolated == 1) {
            streams.push({
                title: "1080p Interpolated (DASH)",
                streamUrl: domain + "/" + streamPath + "/1080i/manifest.mpd",
                headers: { "Referer": BASE_URL + "/" }
            });
        }

        // 720p
        streams.push({
            title: "720p (DASH)",
            streamUrl: domain + "/" + streamPath + "/720/manifest.mpd",
            headers: { "Referer": BASE_URL + "/" }
        });

        // MP4 fallback
        streams.push({
            title: "720p (MP4)",
            streamUrl: domain + "/" + streamPath + "/x264.720p.mp4",
            headers: { "Referer": BASE_URL + "/" }
        });

        if (streams.length === 0) {
            return JSON.stringify({ streams: [], subtitles: "" });
        }

        return JSON.stringify({
            streams: streams,
            subtitles: ""
        });
    } catch (err) {
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}
