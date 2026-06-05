// AsianC TV (asianctv.cc) - Sora Module
// Asian Drama, Movies & KShows with English Subtitles
// Stream extraction uses AES-256-CBC decryption for vidbasic.top player

const BASE_URL = "https://asianctv.cc";
const AES_KEY = "94588293375053432799222445521289";
const AES_IV = "5259228356829423";

// ==================== SEARCH ====================
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await soraFetch(`${BASE_URL}/search?keyword=${encodedKeyword}&type=movies`);
        const html = await responseText.text();

        const results = [];
        const liRegex = /<li>\s*<a\s+href="([^"]+)"[^>]*class="img"[^>]*title="([^"]*)"[^>]*>[\s\S]*?data-original="([^"]*)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
        let match;

        while ((match = liRegex.exec(html)) !== null) {
            const href = match[1];
            const image = match[3];
            const title = match[4].replace(/<[^>]*>/g, '').trim();

            if (href && title) {
                results.push({
                    title: title,
                    image: image.startsWith('//') ? 'https:' + image : image,
                    href: href.startsWith('http') ? href : BASE_URL + href
                });
            }
        }

        if (results.length === 0) {
            // Fallback: try parsing from the list-episode-item structure
            const fallbackRegex = /<a\s+href="(\/drama-detail\/[^"]+)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?data-original="([^"]*)"/g;
            while ((match = fallbackRegex.exec(html)) !== null) {
                results.push({
                    title: match[2].trim(),
                    image: match[3].startsWith('//') ? 'https:' + match[3] : match[3],
                    href: BASE_URL + match[1]
                });
            }
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log('Fetch error in searchResults:', error);
        return JSON.stringify([]);
    }
}

// ==================== DETAILS ====================
async function extractDetails(url) {
    try {
        const responseText = await soraFetch(url);
        const html = await responseText.text();

        // Extract description
        let description = 'No description available';
        const descMatch = html.match(/<span>Description:\s*<\/span><\/p>\s*<p>([\s\S]*?)<\/p>/i);
        if (descMatch) {
            description = descMatch[1].replace(/<[^>]*>/g, '').trim();
        }

        // Extract aliases (other names)
        let aliases = '';
        const aliasMatch = html.match(/<p\s+class="other_name">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        if (aliasMatch) {
            aliases = aliasMatch[1].replace(/<[^>]*>/g, '').trim();
        }

        // Extract airdate / released year
        let airdate = '';
        const releasedMatch = html.match(/<span>Released:\s*<\/span>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        if (releasedMatch) {
            airdate = 'Released: ' + releasedMatch[1].replace(/<[^>]*>/g, '').trim();
        }

        // Extract status
        const statusMatch = html.match(/<span>Status:\s*<\/span>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        if (statusMatch) {
            airdate += ' | Status: ' + statusMatch[1].replace(/<[^>]*>/g, '').trim();
        }

        const details = [{
            description: description,
            aliases: aliases,
            airdate: airdate
        }];

        return JSON.stringify(details);
    } catch (error) {
        console.log('Details error:', error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: '',
            airdate: 'Unknown'
        }]);
    }
}

// ==================== EPISODES ====================
async function extractEpisodes(url) {
    try {
        const responseText = await soraFetch(url);
        const html = await responseText.text();

        const episodes = [];
        const epRegex = /<a\s+href="(\/[^"]*-episode-[^"]+\.html)"[^>]*>[\s\S]*?Episode\s+(\d+(?:\.\d+)?)/gi;
        let match;

        while ((match = epRegex.exec(html)) !== null) {
            const href = match[1];
            const epNum = parseFloat(match[2]);

            if (!isNaN(epNum)) {
                episodes.push({
                    href: href.startsWith('http') ? href : BASE_URL + href,
                    number: epNum
                });
            }
        }

        // Reverse so episodes are in ascending order (oldest first)
        episodes.reverse();

        // Deduplicate by episode number (keep first occurrence)
        const seen = new Set();
        const uniqueEpisodes = [];
        for (const ep of episodes) {
            if (!seen.has(ep.number)) {
                seen.add(ep.number);
                uniqueEpisodes.push(ep);
            }
        }

        return JSON.stringify(uniqueEpisodes);
    } catch (error) {
        console.log('Fetch error in extractEpisodes:', error);
        return JSON.stringify([]);
    }
}

// ==================== STREAM URL ====================
async function extractStreamUrl(url) {
    try {
        // Step 1: Fetch the episode page to get streaming.php iframe URLs
        const episodeResponse = await soraFetch(url);
        const episodeHtml = await episodeResponse.text();

        // Extract all server URLs from data-video attributes
        const serverUrls = [];
        const videoAttrRegex = /data-video="([^"]+)"/g;
        let videoMatch;
        while ((videoMatch = videoAttrRegex.exec(episodeHtml)) !== null) {
            let serverUrl = videoMatch[1];
            if (serverUrl.startsWith('//')) serverUrl = 'https:' + serverUrl;
            if (!serverUrls.includes(serverUrl)) {
                serverUrls.push(serverUrl);
            }
        }

        // Fallback: extract from iframe src
        if (serverUrls.length === 0) {
            const iframeRegex = /<iframe[^>]+src="([^"]*streaming\.php[^"]*)"/i;
            const iframeMatch = episodeHtml.match(iframeRegex);
            if (iframeMatch) {
                let iframeUrl = iframeMatch[1];
                if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
                serverUrls.push(iframeUrl);
            }
        }

        if (serverUrls.length === 0) {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const allStreams = [];

        for (let i = 0; i < serverUrls.length; i++) {
            const serverUrl = serverUrls[i];
            const serverName = serverUrls.length > 1 ? `Server ${i + 1}` : "Standard Server";

            try {
                // Step 2: Fetch streaming.php page to get vidbasic iframe URL
                const streamResponse = await soraFetch(serverUrl, {
                    headers: { "Referer": url }
                });
                const streamHtml = await streamResponse.text();

                // Extract vidbasic iframe URL
                const vidbasicMatch = streamHtml.match(/src="(https?:\/\/[^"]*vidbasic[^"]*\.top[^"]*)"/i);
                if (!vidbasicMatch) {
                    // Try other iframe patterns
                    const anyIframeMatch = streamHtml.match(/src="(https?:\/\/[^"]*(?:player|stream|video)[^"]*)"/i);
                    if (!anyIframeMatch) continue;

                    const iframeUrl = anyIframeMatch[1];
                    allStreams.push({
                        title: serverName,
                        streamUrl: iframeUrl,
                        headers: { "Referer": serverUrl }
                    });
                    continue;
                }

                const vidbasicUrl = vidbasicMatch[1];

                // Step 3: Extract encrypted data from the vidbasic URL's key parameter
                const keyParamMatch = vidbasicUrl.match(/[?&]key=([^&]+)/i);
                if (!keyParamMatch) continue;

                const encryptedData = decodeURIComponent(keyParamMatch[1]);

                // Step 4: Decrypt using AES-256-CBC
                const decryptedUrl = aesDecrypt(encryptedData, AES_KEY, AES_IV);

                if (decryptedUrl && decryptedUrl.startsWith('http')) {
                    allStreams.push({
                        title: serverName,
                        streamUrl: decryptedUrl,
                        headers: {
                            "Referer": "https://vidbasic.top/",
                            "Origin": "https://vidbasic.top"
                        }
                    });
                }
            } catch (serverError) {
                console.log(`Error with ${serverName}:`, serverError);
            }
        }

        if (allStreams.length > 0) {
            return JSON.stringify({
                streams: allStreams,
                subtitle: ""
            });
        }

        return JSON.stringify({ streams: [], subtitle: "" });
    } catch (error) {
        console.log('Fetch error in extractStreamUrl:', error);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// ==================== AES-256-CBC DECRYPTION ====================
// Minimal AES implementation for stream URL decryption
// Based on AES specification (FIPS 197)

function aesDecrypt(ciphertextBase64, keyStr, ivStr) {
    try {
        const ciphertext = base64ToBytes(ciphertextBase64);
        const key = utf8ToBytes(keyStr);
        const iv = utf8ToBytes(ivStr);

        // AES-256-CBC decryption
        const blockSize = 16;
        const aes = new AES(key);

        let plaintext = [];
        let prevBlock = iv;

        for (let i = 0; i < ciphertext.length; i += blockSize) {
            const block = ciphertext.slice(i, i + blockSize);
            const decrypted = aes.decrypt(block);
            const xored = xorBytes(decrypted, prevBlock);
            plaintext = plaintext.concat(xored);
            prevBlock = block;
        }

        // Remove PKCS7 padding
        const padLen = plaintext[plaintext.length - 1];
        if (padLen > 0 && padLen <= blockSize) {
            let validPad = true;
            for (let i = plaintext.length - padLen; i < plaintext.length; i++) {
                if (plaintext[i] !== padLen) {
                    validPad = false;
                    break;
                }
            }
            if (validPad) {
                plaintext = plaintext.slice(0, plaintext.length - padLen);
            }
        }

        return bytesToUtf8(plaintext);
    } catch (e) {
        console.log('AES decryption error:', e);
        return null;
    }
}

// ==================== AES CORE ====================
function AES(key) {
    this.key = key;
    this.keySchedule = this._keyExpansion(key);
}

AES.prototype.decrypt = function(ciphertext) {
    const state = ciphertext.slice();
    const w = this.keySchedule;
    const Nb = 4;
    const Nr = this.key.length === 32 ? 14 : (this.key.length === 24 ? 12 : 10);

    // AddRoundKey (last round key)
    this._addRoundKey(state, w, Nr * Nb);

    for (let round = Nr - 1; round >= 1; round--) {
        // InvShiftRows
        this._invShiftRows(state);
        // InvSubBytes
        this._invSubBytes(state);
        // AddRoundKey
        this._addRoundKey(state, w, round * Nb);
        // InvMixColumns
        this._invMixColumns(state);
    }

    // InvShiftRows
    this._invShiftRows(state);
    // InvSubBytes
    this._invSubBytes(state);
    // AddRoundKey
    this._addRoundKey(state, w, 0);

    return state;
};

AES.prototype._addRoundKey = function(state, w, offset) {
    for (let i = 0; i < 16; i++) {
        state[i] ^= w[offset * 4 + i];
    }
};

AES.prototype._invSubBytes = function(state) {
    for (let i = 0; i < 16; i++) {
        state[i] = INVSBOX[state[i]];
    }
};

AES.prototype._invShiftRows = function(state) {
    // Row 1: shift right by 1
    let t = state[13]; state[13] = state[9]; state[9] = state[5]; state[5] = state[1]; state[1] = t;
    // Row 2: shift right by 2
    t = state[10]; state[10] = state[2]; state[2] = t;
    t = state[14]; state[14] = state[6]; state[6] = t;
    // Row 3: shift right by 3
    t = state[3]; state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t;
};

AES.prototype._invMixColumns = function(state) {
    for (let c = 0; c < 4; c++) {
        const i = c * 4;
        const s0 = state[i], s1 = state[i+1], s2 = state[i+2], s3 = state[i+3];
        state[i]   = gmul(0x0e, s0) ^ gmul(0x0b, s1) ^ gmul(0x0d, s2) ^ gmul(0x09, s3);
        state[i+1] = gmul(0x09, s0) ^ gmul(0x0e, s1) ^ gmul(0x0b, s2) ^ gmul(0x0d, s3);
        state[i+2] = gmul(0x0d, s0) ^ gmul(0x09, s1) ^ gmul(0x0e, s2) ^ gmul(0x0b, s3);
        state[i+3] = gmul(0x0b, s0) ^ gmul(0x0d, s1) ^ gmul(0x09, s2) ^ gmul(0x0e, s3);
    }
};

AES.prototype._keyExpansion = function(key) {
    const Nk = key.length / 4;
    const Nr = Nk + 6;
    const Nb = 4;
    const w = new Array(Nb * (Nr + 1));

    for (let i = 0; i < Nk; i++) {
        w[i] = [key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]];
    }

    for (let i = Nk; i < Nb * (Nr + 1); i++) {
        let temp = w[i-1].slice();
        if (i % Nk === 0) {
            // RotWord
            temp = [temp[1], temp[2], temp[3], temp[0]];
            // SubWord
            temp = [SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]];
            // XOR with Rcon
            temp[0] ^= RCON[i / Nk - 1];
        } else if (Nk > 6 && i % Nk === 4) {
            temp = [SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]];
        }
        w[i] = xorBytes4(w[i - Nk], temp);
    }

    // Flatten to 1D array (column-major for AES state)
    const flat = new Array(Nb * (Nr + 1) * 4);
    for (let i = 0; i < Nb * (Nr + 1); i++) {
        for (let j = 0; j < 4; j++) {
            flat[i * 4 + j] = w[i][j];
        }
    }
    return flat;
};

// Galois Field multiplication
function gmul(a, b) {
    let p = 0;
    for (let i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        const hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return p;
}

function xorBytes(a, b) {
    const result = [];
    for (let i = 0; i < a.length; i++) {
        result.push(a[i] ^ b[i]);
    }
    return result;
}

function xorBytes4(a, b) {
    return [a[0] ^ b[0], a[1] ^ b[1], a[2] ^ b[2], a[3] ^ b[3]];
}

// ==================== HELPERS ====================
function base64ToBytes(base64) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const str = base64.replace(/[^A-Za-z0-9\+\/\=]/g, '');
    const bytes = [];
    let buffer = 0, bits = 0;

    for (let i = 0; i < str.length; i++) {
        const idx = chars.indexOf(str.charAt(i));
        if (idx === -1 || idx === 64) continue;
        buffer = (buffer << 6) | idx;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
            buffer &= (1 << bits) - 1;
        }
    }
    return bytes;
}

function utf8ToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return bytes;
}

function bytesToUtf8(bytes) {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte < 0x80) {
            str += String.fromCharCode(byte);
        } else if (byte >= 0xc0 && byte < 0xe0) {
            str += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[++i] & 0x3f));
        } else if (byte >= 0xe0 && byte < 0xf0) {
            str += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
        }
    }
    return str;
}

// ==================== AES LOOKUP TABLES ====================
const SBOX = [
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];

const INVSBOX = [
    0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
    0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
    0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
    0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,
    0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,
    0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,
    0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,
    0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,
    0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,
    0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,
    0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,
    0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,
    0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,
    0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,
    0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,
    0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d
];

const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

// ==================== FETCH HELPER ====================
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
