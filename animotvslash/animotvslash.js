// ANIMOTVSLASH — Anime Streaming Module
// WordPress-based anime site using AnimeStream theme
// Scrapes HTML pages for search, details, episodes, and stream URLs

const BASE_URL = 'https://animotvslash.org';

// ─── Helper: soraFetch ───────────────────────────────────────────────
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
  try {
    return await fetchv2(
      url,
      options.headers ?? {},
      options.method ?? 'GET',
      options.body ?? null,
      true,
      options.encoding ?? 'utf-8'
    );
  } catch (e) {
    try {
      return await fetch(url, options);
    } catch (error) {
      return null;
    }
  }
}

// ─── Helper: Decode base64 ───────────────────────────────────────────
function decodeBase64(str) {
  try {
    return atob(str);
  } catch (e) {
    return '';
  }
}

// ─── Helper: Strip HTML tags ─────────────────────────────────────────
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, function(m, code) { return String.fromCharCode(parseInt(code, 10)); }).trim();
}

// ─── Helper: Decode HTML entities in URLs ─────────────────────────────
function decodeHtmlEntities(str) {
  return str.replace(/&#(\d+);/g, function(m, code) { return String.fromCharCode(parseInt(code, 10)); }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// ─── SEARCH ──────────────────────────────────────────────────────────
async function searchResults(keyword) {
  try {
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(keyword)}`;
    const response = await soraFetch(searchUrl);
    if (!response) return JSON.stringify([]);
    const html = await response.text();

    const results = [];

    // AnimeStream theme uses .bsix/.bsx divs for search results
    // Pattern: <div class="bsix ..."> ... <a href=".../anime/.../"> ... <img src="..."> ... <h2>Title</h2>
    const itemRegex = /<div[^>]*class="[^"]*bsix[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*anime[^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const href = match[1];
      const image = match[2];
      const title = stripHtml(match[3]);

      if (title && href) {
        results.push({
          title: title,
          image: image,
          href: href
        });
      }
    }

    // Fallback: also try the .bsx pattern (alternate AnimeStream class)
    if (results.length === 0) {
      const altRegex = /<div[^>]*class="[^"]*bsx[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*anime[^"]*)"[^>]*>[\s\S]*?<img[^>]*(?:src|data-src)="([^"]*)"[^>]*>[\s\S]*?<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
      while ((match = altRegex.exec(html)) !== null) {
        const href = match[1];
        const image = match[2];
        const title = stripHtml(match[3]);

        if (title && href) {
          results.push({
            title: title,
            image: image,
            href: href
          });
        }
      }
    }

    return JSON.stringify(results);
  } catch (error) {
    console.log('Search error: ' + error);
    return JSON.stringify([]);
  }
}

// ─── DETAILS ─────────────────────────────────────────────────────────
async function extractDetails(url) {
  try {
    const response = await soraFetch(url);
    if (!response) return JSON.stringify([{ description: 'Error', aliases: 'Error', airdate: 'Error' }]);
    const html = await response.text();

    // Extract description — AnimeStream theme stores synopsis in <p> tags inside .bigcontent
    let description = 'N/A';
    // First try: <p> tags within the bigcontent area (actual synopsis)
    const bigcontentMatch = html.match(/<div[^>]*class="bigcontent[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (bigcontentMatch) {
      const pMatch = bigcontentMatch[1].match(/<p>([\s\S]*?)<\/p>/i);
      if (pMatch && pMatch[1].length > 30) {
        description = stripHtml(pMatch[1]);
      }
    }
    // Fallback: try .entry-content
    if (description === 'N/A' || description.length < 20) {
      const descMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (descMatch) {
        description = stripHtml(descMatch[1]);
      }
    }
    // Fallback: any <p> with substantial content
    if (description === 'N/A' || description.length < 20) {
      const allPs = html.match(/<p>([\s\S]*?)<\/p>/gi);
      if (allPs) {
        for (const p of allPs) {
          const clean = stripHtml(p);
          if (clean.length > 50 && !clean.toLowerCase().includes('watch full episodes') && !clean.toLowerCase().includes('download ')) {
            description = clean;
            break;
          }
        }
      }
    }

    // Extract alternative names from .alter span
    let aliases = 'N/A';
    const alterMatch = html.match(/<span[^>]*class="alter"[^>]*>([\s\S]*?)<\/span>/i);
    if (alterMatch) {
      aliases = stripHtml(alterMatch[1]);
    }

    // Extract metadata from .spe section
    let status = 'N/A';
    let released = 'N/A';
    let studio = 'N/A';
    let season = 'N/A';

    const speMatch = html.match(/<div[^>]*class="spe"[^>]*>([\s\S]*?)<\/div>/i);
    if (speMatch) {
      const speContent = speMatch[1];

      const statusMatch = speContent.match(/<b>Status:<\/b>([\s\S]*?)(?:<\/span>|$)/i);
      if (statusMatch) status = stripHtml(statusMatch[1]);

      const releasedMatch = speContent.match(/<b>Released:<\/b>([\s\S]*?)(?:<\/span>|$)/i);
      if (releasedMatch) released = stripHtml(releasedMatch[1]);

      const studioMatch = speContent.match(/<b>Studio:<\/b>([\s\S]*?)(?:<\/span>|$)/i);
      if (studioMatch) studio = stripHtml(studioMatch[1]);

      const seasonMatch = speContent.match(/<b>Season:<\/b>([\s\S]*?)(?:<\/span>|$)/i);
      if (seasonMatch) season = stripHtml(seasonMatch[1]);
    }

    // Extract rating — format: <strong>Rating 8.3</strong>
    let rating = 'N/A';
    const ratingStrong = html.match(/<strong>Rating\s+([\d.]+)<\/strong>/i);
    if (ratingStrong) {
      rating = ratingStrong[1];
    } else {
      const ratingGeneric = html.match(/Rating[:\s]+([\d.]+)/i);
      if (ratingGeneric && ratingGeneric[1].length > 1) {
        rating = ratingGeneric[1];
      }
    }

    const airdate = `Status: ${status} | Released: ${released} | Rating: ${rating} | Season: ${season}`;

    return JSON.stringify([{
      description: description,
      aliases: aliases,
      airdate: airdate
    }]);
  } catch (error) {
    console.log('Details error: ' + error);
    return JSON.stringify([{
      description: 'Error loading description',
      aliases: 'Error',
      airdate: 'Error'
    }]);
  }
}

// ─── EPISODES ────────────────────────────────────────────────────────
async function extractEpisodes(url) {
  try {
    const response = await soraFetch(url);
    if (!response) return JSON.stringify([]);
    const html = await response.text();

    const episodes = [];

    // AnimeStream theme: episodes are in <li> elements with episode links
    // Pattern: <a href="https://animotvslash.org/{slug}-episode-{number}/">
    // With <div class="epl-num">NUMBER</div> for episode number
    const epRegex = /<li[^>]*>[\s\S]*?<a[^>]*href="([^"]*-episode-\d+[^"]*)"[^>]*>[\s\S]*?(?:<div[^>]*class="epl-num"[^>]*>([\s\S]*?)<\/div>)?/gi;

    const seenHrefs = new Set();
    let match;

    while ((match = epRegex.exec(html)) !== null) {
      const href = match[1];
      let number = match[2] ? stripHtml(match[2]) : '';

      if (href && !seenHrefs.has(href)) {
        seenHrefs.add(href);

        // Try to extract episode number from the URL if not found in epl-num
        if (!number) {
          const numMatch = href.match(/-episode-(\d+)/i);
          number = numMatch ? numMatch[1] : '0';
        }

        episodes.push({
          href: href,
          number: parseInt(number, 10) || 0
        });
      }
    }

    // Sort episodes by number (ascending)
    episodes.sort((a, b) => a.number - b.number);

    return JSON.stringify(episodes);
  } catch (error) {
    console.log('Episodes error: ' + error);
    return JSON.stringify([]);
  }
}

// ─── STREAM URL ──────────────────────────────────────────────────────
async function extractStreamUrl(url) {
  try {
    const response = await soraFetch(url);
    if (!response) return JSON.stringify({ streams: [], subtitles: '' });
    const html = await response.text();

    const streams = [];

    // Find the <select> element with video server options
    // Each <option value="BASE64_ENCODED_IFRAME"> contains a base64-encoded iframe
    const selectMatch = html.match(/<select[^>]*>([\s\S]*?)<\/select>/i);
    if (selectMatch) {
      const selectContent = selectMatch[1];
      const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;

      let optMatch;
      while ((optMatch = optionRegex.exec(selectContent)) !== null) {
        const value = optMatch[1];
        const label = stripHtml(optMatch[2]);

        if (!value) continue; // Skip the "Select Video Server" default option

        // Decode base64 to get the iframe HTML
        const decoded = decodeBase64(value);
        if (!decoded) continue;

        // Extract the iframe src URL
        const srcMatch = decoded.match(/src="([^"]+)"/i);
        if (srcMatch) {
          const streamUrl = decodeHtmlEntities(srcMatch[1]);

          // Determine if it's SUB or DUB based on label
          const isSub = label.toLowerCase().includes('sub');
          const isDub = label.toLowerCase().includes('dub');

          let serverLabel = label.trim();
          if (!serverLabel) {
            serverLabel = 'Animo Server';
          }

          streams.push({
            title: serverLabel,
            streamUrl: streamUrl,
            headers: {
              'Referer': BASE_URL + '/',
              'Origin': BASE_URL
            }
          });
        }
      }
    }

    // If no select element found, try to find iframe directly
    if (streams.length === 0) {
      const iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
      if (iframeMatch) {
        streams.push({
          title: 'Animo',
          streamUrl: decodeHtmlEntities(iframeMatch[1]),
          headers: {
            'Referer': BASE_URL + '/',
            'Origin': BASE_URL
          }
        });
      }
    }

    return JSON.stringify({
      streams: streams,
      subtitles: ''
    });
  } catch (error) {
    console.log('Stream URL error: ' + error);
    return JSON.stringify({ streams: [], subtitles: '' });
  }
}
