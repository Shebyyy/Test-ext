// Cineby source module - Based on cineby.sc (uses videasy.net backend)
// Thanks ibro for the TMDB search!

async function searchResults(keyword) {
    try {
        let transformedResults = [];

        const keywordGroups = {
            trending: ["!trending", "!hot", "!tr", "!!"],
            topRatedMovie: ["!top-rated-movie", "!topmovie", "!tm", "??"],
            topRatedTV: ["!top-rated-tv", "!toptv", "!tt", "::"],
            popularMovie: ["!popular-movie", "!popmovie", "!pm", ";;"],
            popularTV: ["!popular-tv", "!poptv", "!pt", "++"],
        };

        const skipTitleFilter = Object.values(keywordGroups).flat();
        const shouldFilter = !matchesKeyword(keyword, skipTitleFilter);

        // --- TMDB Section ---
        const encodedKeyword = encodeURIComponent(keyword);
        let baseUrlTemplate = null;

        if (matchesKeyword(keyword, keywordGroups.trending)) {
            baseUrlTemplate = (page) => `https://db.videasy.net/3/trending/all/week?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.topRatedMovie)) {
            baseUrlTemplate = (page) => `https://db.videasy.net/3/movie/top_rated?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.topRatedTV)) {
            baseUrlTemplate = (page) => `https://db.videasy.net/3/tv/top_rated?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.popularMovie)) {
            baseUrlTemplate = (page) => `https://db.videasy.net/3/movie/popular?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.popularTV)) {
            baseUrlTemplate = (page) => `https://db.videasy.net/3/tv/popular?language=en&page=${page}`;
        } else {
            baseUrlTemplate = (page) => `https://db.videasy.net/3/search/multi?language=en&page=${page}&query=${encodedKeyword}`;
        }

        let dataResults = [];

        if (baseUrlTemplate) {
            const pagePromises = Array.from({ length: 5 }, (_, i) =>
                soraFetch(baseUrlTemplate(i + 1)).then(r => r.json())
            );
            const pages = await Promise.all(pagePromises);
            dataResults = pages.flatMap(p => p.results || []);
        }

        if (dataResults.length > 0) {
            transformedResults = transformedResults.concat(
                dataResults
                    .map(result => {
                        if (result.media_type === "movie" || result.title) {
                            return {
                                title: result.title || result.name || result.original_title || result.original_name || "Untitled",
                                image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : "",
                                href: `movie/${result.id}`,
                            };
                        } else if (result.media_type === "tv" || result.name) {
                            return {
                                title: result.name || result.title || result.original_name || result.original_title || "Untitled",
                                image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : "",
                                href: `tv/${result.id}/1/1`,
                            };
                        }
                    })
                    .filter(Boolean)
                    .filter(result => result.title !== "Overflow")
                    .filter(result => result.title !== "My Marriage Partner Is My Student, a Cocky Troublemaker")
                    .filter(r => !shouldFilter || r.title.toLowerCase().includes(keyword.toLowerCase()))
            );
        }

        console.log("Transformed Results: " + JSON.stringify(transformedResults));
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("Fetch error in searchResults: " + error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

function matchesKeyword(keyword, commands) {
    const lower = keyword.toLowerCase();
    return commands.some(cmd => lower.startsWith(cmd.toLowerCase()));
}

async function extractDetails(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await soraFetch(`https://db.videasy.net/3/movie/${movieId}?append_to_response=external_ids&language=en`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.runtime ? data.runtime + " minutes" : 'Unknown'}`,
                airdate: `Released: ${data.release_date ? data.release_date : 'Unknown'}`
            }];

            return JSON.stringify(transformedResults);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await soraFetch(`https://db.videasy.net/3/tv/${showId}?append_to_response=external_ids&language=en`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.episode_run_time && data.episode_run_time.length ? data.episode_run_time.join(', ') + " minutes" : 'Unknown'}`,
                airdate: `Aired: ${data.first_air_date ? data.first_air_date : 'Unknown'}`
            }];

            console.log(JSON.stringify(transformedResults));
            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);

            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];

            const movie = [
                { href: `/movie/${movieId}`, number: 1, title: "Full Movie" }
            ];

            console.log(movie);
            return JSON.stringify(movie);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)\/([^\/]+)\/([^\/]+)/);

            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];

            const showResponseText = await soraFetch(`https://db.videasy.net/3/tv/${showId}?language=en`);
            const showData = await showResponseText.json();

            let allEpisodes = [];
            for (const season of showData.seasons) {
                const seasonNumber = season.season_number;

                if (seasonNumber === 0) continue;

                const seasonResponseText = await soraFetch(`https://db.videasy.net/3/tv/${showId}/season/${seasonNumber}?language=en`);
                const seasonData = await seasonResponseText.json();

                if (seasonData.episodes && seasonData.episodes.length) {
                    const episodes = seasonData.episodes.map(episode => ({
                        href: `/tv/${showId}/${seasonNumber}/${episode.episode_number}`,
                        number: episode.episode_number,
                        title: episode.name || ""
                    }));
                    allEpisodes = allEpisodes.concat(episodes);
                }
            }

            console.log(allEpisodes);
            return JSON.stringify(allEpisodes);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Fetch error in extractEpisodes: ' + error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(ID) {
    if (ID.includes('movie')) {
        const tmdbID = ID.replace('/movie/', '');
        const cinebyResponse = await soraFetch(`https://db.videasy.net/3/movie/${tmdbID}?append_to_response=external_ids&language=en`);
        const cinebyData = await cinebyResponse.json();

        const title = encodeURIComponent(cinebyData.title);
        const year = new Date(cinebyData.release_date).getFullYear();
        const imdbId = cinebyData.external_ids?.imdb_id || '';
        const tmdbId = cinebyData.id;

        const fullUrl = `https://api.videasy.net/cdn/sources-with-title?title=${title}&mediaType=movie&year=${year}&episodeId=1&seasonId=1&tmdbId=${tmdbId}&imdbId=${imdbId}`;

        console.log('Full URL:' + fullUrl);

        const responseTwo = await soraFetch(fullUrl);
        const encrypted = await responseTwo.text();

        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
        };

        const postData = JSON.stringify({
            text: encrypted,
            id: String(tmdbID).split('-')[0]
        });
        console.log('Post Data:' + postData);
        const decryptedResponse = await fetchv2("https://enc-dec.app/api/dec-videasy", headers, "POST", postData);
        const decryptedData = await decryptedResponse.json();
        console.log('Decrypted Data:' + JSON.stringify(decryptedData));

        const result = decryptedData.result || {};
        const sources = result.sources || [];
        const subtitles = result.subtitles || [];

        const nonHDRSources = sources.filter(s => !s.quality.includes("HDR"));

        const streamObjects = nonHDRSources.map(src => ({
            title: src.quality,
            streamUrl: src.url,
            headers: {
                "Origin": "https://www.cineby.sc",
                "Referer": "https://www.cineby.sc/"
            }
        }));

        const englishSubtitle = subtitles.find(sub => (sub.language || sub.lang)?.toLowerCase() === 'english');
        let subtitleUrl = englishSubtitle ? englishSubtitle.url : "";

        if (subtitleUrl) {
            subtitleUrl = `https://passthrough-worker.simplepostrequest.workers.dev/?url=${encodeURIComponent(subtitleUrl)}&type=vtt&referer=https%3A%2F%2Fwww.cineby.sc%2F`;
        }

        return JSON.stringify({
            streams: streamObjects,
            subtitles: subtitleUrl
        });
    } else if (ID.includes('tv')) {
        const parts = ID.split('/');
        const tmdbID = parts[2];
        const seasonNumber = parts[3];
        const episodeNumber = parts[4];

        const cinebyResponse = await soraFetch(`https://db.videasy.net/3/tv/${tmdbID}?append_to_response=external_ids&language=en`);
        const cinebyData = await cinebyResponse.json();

        const title = encodeURIComponent(cinebyData.name);
        const year = new Date(cinebyData.first_air_date).getFullYear();
        const imdbId = cinebyData.external_ids?.imdb_id || '';
        const tmdbId = cinebyData.id;

        const fullUrl = `https://api.videasy.net/cdn/sources-with-title?title=${title}&mediaType=tv&year=${year}&episodeId=${episodeNumber}&seasonId=${seasonNumber}&tmdbId=${tmdbId}&imdbId=${imdbId}`;

        console.log('Full URL:' + fullUrl);

        const responseTwo = await soraFetch(fullUrl);
        const encrypted = await responseTwo.text();

        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
        };

        const postData = JSON.stringify({
            text: encrypted,
            id: String(tmdbID).split('-')[0]
        });

        const decryptedResponse = await fetchv2("https://enc-dec.app/api/dec-videasy", headers, "POST", postData);
        const decryptedData = await decryptedResponse.json();
        console.log('Decrypted Data:' + JSON.stringify(decryptedData));

        const result = decryptedData.result || {};
        const sources = result.sources || [];
        const subtitles = result.subtitles || [];

        const nonHDRSources = sources.filter(s => !s.quality.includes("HDR"));

        const streamObjects = nonHDRSources.map(src => ({
            title: src.quality,
            streamUrl: src.url,
            headers: {
                "Origin": "https://www.cineby.sc",
                "Referer": "https://www.cineby.sc/"
            }
        }));

        const englishSubtitle = subtitles.find(sub => (sub.language || sub.lang)?.toLowerCase() === 'english');
        let subtitleUrl = englishSubtitle ? englishSubtitle.url : "";

        if (subtitleUrl) {
            subtitleUrl = `https://passthrough-worker.simplepostrequest.workers.dev/?url=${encodeURIComponent(subtitleUrl)}&type=vtt&referer=https%3A%2F%2Fwww.cineby.sc%2F`;
        }

        return JSON.stringify({
            streams: streamObjects,
            subtitles: subtitleUrl
        });
    }
}

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
