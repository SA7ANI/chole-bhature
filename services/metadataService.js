const axios = require('axios');
const { dohHttpsAgent } = require('../dohResolver');

const TMDB_API_KEYS = [
    '439c478a771f35c05022f9feabcca01c',
    '1865f43a0549ca50d341dd9ab8b29f49',
    'e49339e830e014e414c2b9a71b2d4f82',
    '847a158b5489812f851da8cf02476566',
    'b025d23315a6b0c266cc6cb221a68134'
];

const tmdbDomains = ['https://api.tmdb.org', 'https://api.themoviedb.org'];
const metadataMemoryCache = new Map();

/**
 * Resolves media metadata (TMDB ID, title, original title, and year)
 * using TMDB find/search with fallback to Cinemeta.
 */
async function getMediaMetadata(rawInputId, type) {
    if (!rawInputId) return { tmdbId: null, title: null, originalTitle: null, year: null };
    const strId = String(rawInputId).trim();
    let cleanId = strId;
    let tmdbId = null;

    if (strId.startsWith('tmdb:')) {
        const parts = strId.split(':');
        tmdbId = parts[1] || null;
        cleanId = tmdbId ? `tmdb:${tmdbId}` : strId;
    } else if (strId.startsWith('tt')) {
        cleanId = strId.split(':')[0];
    } else if (/^\d+$/.test(strId)) {
        tmdbId = strId;
        cleanId = `tmdb:${tmdbId}`;
    } else if (strId.startsWith('kitsu:')) {
        cleanId = strId.split(':')[0] + ':' + strId.split(':')[1];
    } else if (strId.includes(':')) {
        cleanId = strId.split(':')[0];
    }

    const cacheKey = `${type || 'movie'}:${cleanId}`;
    const cached = metadataMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return cached.data;
    }

    let title = null;
    let originalTitle = null;
    let year = null;

    // 1. If TMDB ID is directly provided, fetch details from TMDB
    if (tmdbId) {
        const primaryType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
        const fallbackType = primaryType === 'tv' ? 'movie' : 'tv';
        const tryTypes = [primaryType, fallbackType];

        for (const tmdbType of tryTypes) {
            for (const domain of tmdbDomains) {
                for (const key of TMDB_API_KEYS) {
                    try {
                        const res = await axios.get(`${domain}/3/${tmdbType}/${tmdbId}?api_key=${key}`, {
                            timeout: 2500,
                            httpsAgent: dohHttpsAgent,
                            headers: { 'Accept': 'application/json' }
                        });
                        if (res.data) {
                            title = res.data.title || res.data.name;
                            originalTitle = res.data.original_title || res.data.original_name;
                            const dateStr = res.data.release_date || res.data.first_air_date;
                            year = dateStr ? dateStr.split('-')[0] : null;
                            const result = { tmdbId, title, originalTitle, year, type: tmdbType };
                            metadataMemoryCache.set(cacheKey, { timestamp: Date.now(), data: result });
                            return result;
                        }
                    } catch (err) {}
                }
            }
        }
    }

    // 2. If Kitsu ID (kitsu:1429), resolve via Kitsu API
    if (cleanId.startsWith('kitsu:')) {
        const kitsuId = cleanId.split(':')[1];
        if (kitsuId) {
            try {
                const kRes = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
                    timeout: 3000,
                    headers: { 'Accept': 'application/vnd.api+json' }
                });
                if (kRes.data && kRes.data.data && kRes.data.data.attributes) {
                    const attrs = kRes.data.data.attributes;
                    title = attrs.canonicalTitle || (attrs.titles && (attrs.titles.en || attrs.titles.en_jp));
                    originalTitle = attrs.titles ? attrs.titles.ja_jp : title;
                    year = attrs.startDate ? attrs.startDate.split('-')[0] : null;
                }
            } catch (_) {}
        }
    }

    // 3. If IMDb ID (tt...), search TMDB by external_source=imdb_id
    if (cleanId.startsWith('tt')) {
        for (const domain of tmdbDomains) {
            for (const key of TMDB_API_KEYS) {
                try {
                    const res = await axios.get(`${domain}/3/find/${cleanId}?api_key=${key}&external_source=imdb_id`, {
                        timeout: 2500,
                        httpsAgent: dohHttpsAgent,
                        headers: { 'Accept': 'application/json' }
                    });
                    if (type === 'movie' && res.data && res.data.movie_results && res.data.movie_results.length > 0) {
                        const m = res.data.movie_results[0];
                        const result = {
                            tmdbId: m.id.toString(),
                            title: m.title,
                            originalTitle: m.original_title,
                            year: m.release_date ? m.release_date.split('-')[0] : null
                        };
                        metadataMemoryCache.set(cacheKey, { timestamp: Date.now(), data: result });
                        return result;
                    } else if ((type === 'series' || type === 'tv') && res.data && res.data.tv_results && res.data.tv_results.length > 0) {
                        const t = res.data.tv_results[0];
                        const result = {
                            tmdbId: t.id.toString(),
                            title: t.name,
                            originalTitle: t.original_name,
                            year: t.first_air_date ? t.first_air_date.split('-')[0] : null
                        };
                        metadataMemoryCache.set(cacheKey, { timestamp: Date.now(), data: result });
                        return result;
                    }
                } catch (err) {}
            }
        }
    }

    // 3. Cinemeta Fallback (with automatic title-to-TMDB resolution)
    try {
        const cinemetaType = (type === 'tv' ? 'series' : type);
        const cRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${cinemetaType}/${cleanId}.json`, { timeout: 2500, httpsAgent: dohHttpsAgent });
        if (cRes.data && cRes.data.meta) {
            title = cRes.data.meta.name;
            originalTitle = cRes.data.meta.name;
            year = (cRes.data.meta.year || cRes.data.meta.releaseInfo) ? String(cRes.data.meta.year || cRes.data.meta.releaseInfo).split('–')[0].trim() : null;

            // Resolve TMDB ID from Title if find failed
            if (!tmdbId && title) {
                const searchType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
                for (const domain of tmdbDomains) {
                    for (const key of TMDB_API_KEYS) {
                        try {
                            const searchUrl = `${domain}/3/search/${searchType}?api_key=${key}&query=${encodeURIComponent(title)}${year ? `&first_air_date_year=${year}&year=${year}` : ''}`;
                            const sRes = await axios.get(searchUrl, { timeout: 2500, httpsAgent: dohHttpsAgent });
                            if (sRes.data && sRes.data.results && sRes.data.results.length > 0) {
                                tmdbId = sRes.data.results[0].id.toString();
                                break;
                            }
                        } catch (e) {}
                    }
                    if (tmdbId) break;
                }
            }

            const result = {
                tmdbId: tmdbId || null,
                title,
                originalTitle,
                year
            };
            metadataMemoryCache.set(cacheKey, { timestamp: Date.now(), data: result });
            return result;
        }
    } catch (e) {}

    const result = { tmdbId, title, originalTitle, year };
    if (tmdbId || title) {
        metadataMemoryCache.set(cacheKey, { timestamp: Date.now(), data: result });
    }
    return result;
}

async function getTmdbId(imdbId, type) {
    const meta = await getMediaMetadata(imdbId, type);
    return meta ? meta.tmdbId : null;
}

module.exports = {
    getMediaMetadata,
    getTmdbId,
    TMDB_API_KEYS
};
