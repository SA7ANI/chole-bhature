const axios = require('axios');
const { dohHttpsAgent } = require('../dohResolver');

const WP_AJAX_URL = 'https://pencarimovie.com/wp-admin/admin-ajax.php';
const DEFAULT_TIMEOUT_MS = 6000;

// In-memory cache for search queries and file listings (15 min TTL)
const pencariCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCache(key) {
    const item = pencariCache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > CACHE_TTL_MS) {
        pencariCache.delete(key);
        return null;
    }
    return item.data;
}

function setCache(key, data) {
    if (pencariCache.size > 500) {
        const oldest = pencariCache.keys().next().value;
        pencariCache.delete(oldest);
    }
    pencariCache.set(key, { timestamp: Date.now(), data });
}

function cleanTitle(title = '') {
    return String(title)
        .replace(/^\[[^\]]*\]\s*/g, '')
        .replace(/\s*-\s*by\s+[a-z0-9_.]+/gi, '')
        .replace(/\s*@\w+/g, '')
        .replace(/[._]/g, ' ')
        .replace(/\s*[•·]\s*(?:TvSeries|Movie|Series|Drama)\s*$/i, '')
        .trim();
}

function normalizeTitleForMatch(str = '') {
    return cleanTitle(str)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Searches PencariMovie database for a movie or TV show
 * @param {string} query 
 * @returns {Promise<Array>} List of post objects
 */
async function searchPosts(query) {
    if (!query) return [];
    const cacheKey = `search:${query.toLowerCase().trim()}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    try {
        const url = `${WP_AJAX_URL}?action=stream_search&search=${encodeURIComponent(query.trim())}&limit=15`;
        const res = await axios.get(url, {
            timeout: DEFAULT_TIMEOUT_MS,
            httpsAgent: dohHttpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const posts = res.data?.data?.posts || res.data?.data || res.data?.posts || [];
        const result = Array.isArray(posts) ? posts : [];
        setCache(cacheKey, result);
        return result;
    } catch (err) {
        console.warn(`[PencariMovie] Search error for "${query}":`, err.message);
        return [];
    }
}

/**
 * Retrieves attached files for a given post ID
 * @param {number|string} postId 
 * @returns {Promise<Array>} List of file objects
 */
async function getPostFiles(postId) {
    if (!postId) return [];
    const cacheKey = `files:${postId}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    try {
        const url = `${WP_AJAX_URL}?action=stream_post_files&post_id=${postId}&limit=100`;
        const res = await axios.get(url, {
            timeout: DEFAULT_TIMEOUT_MS,
            httpsAgent: dohHttpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const files = res.data?.data?.files || res.data?.files || [];
        const result = Array.isArray(files) ? files : [];
        setCache(cacheKey, result);
        return result;
    } catch (err) {
        console.warn(`[PencariMovie] Fetch files error for post ${postId}:`, err.message);
        return [];
    }
}

function extractSplitPartInfo(filename = '') {
    const f = String(filename).trim();
    let partNum = 0;
    let totalParts = 0;
    let matched = false;
    let cleanBase = f;

    const m = f.match(/[._\s-]part[._\s-]*0*(\d{1,4})(?:[._\s\/-]+(?:of[._\s-]+)?0*(\d{1,4}))?/i);
    if (m) {
        partNum = parseInt(m[1], 10);
        if (m[2]) totalParts = parseInt(m[2], 10);
        matched = true;
        cleanBase = f.replace(/[._\s-]part[._\s-]*0*\d{1,4}(?:[._\s\/-]+(?:of[._\s-]+)?0*\d{1,4})?/i, '');
    }

    return { isPart: matched, cleanBase, partNum, totalParts };
}

/**
 * Main scraper entry point: finds streams for a movie or series
 * @param {object} target { title, year, originalTitle, type, season, episode }
 * @param {object} config User configuration
 * @returns {Promise<Array>} Standardized Stremio stream objects
 */
async function searchPencariMovie(target = {}, config = {}) {
    const title = target.title || target.name || '';
    if (!title) return [];

    const isSeries = target.type === 'series' || target.type === 'tv' || Boolean(target.season);
    const targetSeason = target.season ? parseInt(target.season, 10) : null;
    const targetEpisode = target.episode ? parseInt(target.episode, 10) : null;
    const targetYear = target.year ? parseInt(target.year, 10) : null;

    // 1. Search by primary title
    let posts = await searchPosts(title);
    
    // If not found and original title is different, search by original title
    if (posts.length === 0 && target.originalTitle && target.originalTitle !== title) {
        posts = await searchPosts(target.originalTitle);
    }

    if (!posts || posts.length === 0) {
        return [];
    }

    // 2. Score and pick matching post(s)
    const normalizedTarget = normalizeTitleForMatch(title);
    const normalizedOrig = target.originalTitle ? normalizeTitleForMatch(target.originalTitle) : '';

    const matchedPosts = posts.filter(p => {
        const postTitle = p.title || '';
        const normPost = normalizeTitleForMatch(postTitle);
        
        const titleMatches = normPost.includes(normalizedTarget) || (normalizedOrig && normPost.includes(normalizedOrig));
        if (!titleMatches) return false;

        // If target year is known, check year in post title if present
        if (targetYear) {
            const yMatch = postTitle.match(/\b(19\d\d|20[0-3]\d)\b/);
            if (yMatch) {
                const postYear = parseInt(yMatch[1], 10);
                // Allow ±1 year variance for festival/theatrical release differences
                if (Math.abs(postYear - targetYear) > 1) {
                    return false;
                }
            }
        }

        // Check media type if labeled in post title
        if (isSeries && /\b(movie)\b/i.test(postTitle) && !/\b(series|season|drama)\b/i.test(postTitle)) {
            return false;
        }
        if (!isSeries && /\b(series|tvseries|drama)\b/i.test(postTitle) && !/\b(movie)\b/i.test(postTitle)) {
            return false;
        }

        return true;
    });

    if (matchedPosts.length === 0) {
        return [];
    }

    // 3. Fetch attached files for the best matching post(s) (up to top 2 matches)
    const selectedPosts = matchedPosts.slice(0, 2);
    let allFiles = [];

    for (const post of selectedPosts) {
        const files = await getPostFiles(post.id);
        allFiles = allFiles.concat(files);
    }

    if (allFiles.length === 0) {
        return [];
    }

    // 4. Filter by episode if series
    if (isSeries && targetEpisode !== null) {
        const epFiltered = allFiles.filter(f => {
            if (f.episode_num && f.episode_num === targetEpisode) return true;
            // Also check episode markers in title: E01, Ep 1, Episode 1
            const titleMatch = (f.title || '').match(/\b(?:e|ep|episode|\-)[\s._-]*0*(\d{1,3})\b/i);
            if (titleMatch && parseInt(titleMatch[1], 10) === targetEpisode) return true;
            return false;
        });
        if (epFiltered.length > 0) {
            allFiles = epFiltered;
        }
    }

    // 5. Construct Stremio stream candidates
    const bridgeUrl = (config.telegramBridgeUrl || 'http://127.0.0.1:8088').replace(/\/+$/, '');
    const protocol = config.addonProtocol || 'https';
    const addonHost = config.addonHost || '127.0.0.1:7000';

    const streams = allFiles.map(f => {
        const fileName = f.title || `${f.short_code}.mp4`;
        const mime = f.mime || (fileName.toLowerCase().endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4');
        const fileSize = f.file_size || 0;

        const payloadObj = {
            short_code: f.short_code,
            file_size: fileSize,
            file_name: fileName,
            mime: mime,
            bot_id: f.bot_id || null,
            bridge_url: bridgeUrl
        };
        const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

        const isVercel = typeof process !== 'undefined' && Boolean(process.env.VERCEL);
        const isLocalBridge = bridgeUrl.includes('127.0.0.1') || bridgeUrl.includes('localhost');
        const isRemoteNuvio = config.addonHost && !config.addonHost.includes('127.0.0.1') && !config.addonHost.includes('localhost') && !config.addonHost.startsWith('192.168.') && !config.addonHost.startsWith('10.');
        
        // Proxy through Nuvio to help LAN devices reach localhost IF Nuvio is also on the LAN.
        // DO NOT proxy if Nuvio is on Vercel (serverless limits), or if Nuvio is remote but trying to reach a local bridge.
        const shouldProxy = config.addonHost && !isVercel && !(isRemoteNuvio && isLocalBridge);

        const streamUrl = shouldProxy
            ? `${protocol}://${addonHost}/stream/telegram/${payloadB64}/${encodeURIComponent(fileName)}`
            : `${bridgeUrl}/api/download/${payloadB64}/${encodeURIComponent(fileName)}`;

        const sizeGb = fileSize ? (fileSize / (1024 * 1024 * 1024)).toFixed(2) : null;
        const sizeMb = fileSize ? (fileSize / (1024 * 1024)).toFixed(0) : null;
        const sizeStr = sizeGb && parseFloat(sizeGb) >= 1 ? `${sizeGb} GB` : (sizeMb ? `${sizeMb} MB` : '');

        const partInfo = extractSplitPartInfo(fileName);
        let partSuffix = '';
        if (partInfo.isPart) {
            partSuffix = ` [Part ${partInfo.partNum}${partInfo.totalParts ? '/' + partInfo.totalParts : ''}]`;
        }

        return {
            name: '⚡ Telegram',
            title: `${fileName}${partSuffix}`,
            url: streamUrl,
            originalProvider: 'Telegram',
            _provider: 'Telegram',
            providers: ['Telegram'],
            sizeBytes: fileSize,
            behaviorHints: {
                notWebReady: false,
                filename: fileName
            },
            _rawStream: {
                name: 'Telegram',
                title: fileName
            }
        };
    });

    return streams;
}

module.exports = {
    searchPencariMovie,
    searchPosts,
    getPostFiles
};
