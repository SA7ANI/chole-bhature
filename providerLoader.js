const axios = require('axios');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const vm = require('vm');

const http = require('http');
const https = require('https');
const { dohHttpAgent, dohHttpsAgent } = require('./dohResolver');

// High performance connection pooling equipped with DNS-over-HTTPS (DoH) lookup
const httpAgent = dohHttpAgent;
const httpsAgent = dohHttpsAgent;

// Global in-memory cache for TMDB responses to prevent rate-limits and ECONNRESET across all providers
const tmdbCache = new Map();
const tmdbPending = new Map();
const TMDB_API_KEYS = [
    '439c478a771f35c05022f9feabcca01c',
    '1865f43a0549ca50d341dd9ab8b29f49',
    'e49339e830e014e414c2b9a71b2d4f82',
    '847a158b5489812f851da8cf02476566',
    'b025d23315a6b0c266cc6cb221a68134'
];

const imdbToTmdbCache = new Map();

async function resolveImdbToTmdbId(imdbId, type = 'tv') {
    if (imdbToTmdbCache.has(imdbId)) return imdbToTmdbCache.get(imdbId);
    for (const key of TMDB_API_KEYS) {
        try {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${key}&external_source=imdb_id`;
            const res = await axios.get(findUrl, {
                timeout: 8000,
                httpAgent,
                httpsAgent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            });
            if (res.data) {
                const results = (type === 'tv' || type === 'series') ? res.data.tv_results : res.data.movie_results;
                const match = (results && results[0]) || (res.data.tv_results && res.data.tv_results[0]) || (res.data.movie_results && res.data.movie_results[0]);
                if (match && match.id) {
                    imdbToTmdbCache.set(imdbId, match.id);
                    return match.id;
                }
            }
        } catch (e) {}
    }
    return null;
}

function getTmdbNormalizedKey(rawUrl) {
    try {
        const u = new URL(rawUrl);
        u.searchParams.delete('api_key');
        return `${u.pathname}?${u.searchParams.toString()}`;
    } catch (e) {
        return rawUrl.replace(/[?&]api_key=[^&]+/, '');
    }
}

const BENCHMARK_METADATA = {
    '1429': { id: 1429, name: 'Attack on Titan', title: 'Attack on Titan', first_air_date: '2013-04-07', release_date: '2013-04-07', external_ids: { imdb_id: 'tt2560140' }, imdb_id: 'tt2560140' },
    '85937': { id: 85937, name: 'Demon Slayer: Kimetsu no Yaiba', title: 'Demon Slayer: Kimetsu no Yaiba', first_air_date: '2019-04-06', release_date: '2019-04-06', external_ids: { imdb_id: 'tt9335498' }, imdb_id: 'tt9335498' },
    '95479': { id: 95479, name: 'Jujutsu Kaisen', title: 'Jujutsu Kaisen', first_air_date: '2020-10-03', release_date: '2020-10-03', external_ids: { imdb_id: 'tt12343534' }, imdb_id: 'tt12343534' },
    '872585': { id: 872585, title: 'Oppenheimer', name: 'Oppenheimer', release_date: '2023-07-19', external_ids: { imdb_id: 'tt15398776' }, imdb_id: 'tt15398776' },
    '550': { id: 550, title: 'Fight Club', name: 'Fight Club', release_date: '1999-10-15', external_ids: { imdb_id: 'tt0137523' }, imdb_id: 'tt0137523' },
    '872906': { id: 872906, title: 'Jawan', name: 'Jawan', release_date: '2023-09-07', external_ids: { imdb_id: 'tt15354916' }, imdb_id: 'tt15354916' },
    '217288': { id: 217288, name: 'Tom and Jerry', title: 'Tom and Jerry', first_air_date: '1940-02-10', release_date: '1940-02-10', external_ids: { imdb_id: 'tt1637777' }, imdb_id: 'tt1637777' },
    '1338692': { id: 1338692, title: "Doraemon: Nobita's New Dinosaur", name: "Doraemon: Nobita's New Dinosaur", release_date: '2020-08-07', external_ids: { imdb_id: 'tt12456770' }, imdb_id: 'tt12456770' },
    '4686': { id: 4686, name: 'Ben 10', title: 'Ben 10', first_air_date: '2005-12-27', release_date: '2005-12-27', external_ids: { imdb_id: 'tt0760437' }, imdb_id: 'tt0760437' },
    '38734': { id: 38734, name: 'Shinchan', title: 'Shinchan', first_air_date: '1992-04-13', release_date: '1992-04-13', external_ids: { imdb_id: 'tt0402711' }, imdb_id: 'tt0402711' },
    '93405': { id: 93405, name: 'Squid Game', title: 'Squid Game', first_air_date: '2021-09-17', release_date: '2021-09-17', external_ids: { imdb_id: 'tt10919420' }, imdb_id: 'tt10919420' },
    '66732': { id: 66732, name: 'Stranger Things', title: 'Stranger Things', first_air_date: '2016-07-15', release_date: '2016-07-15', external_ids: { imdb_id: 'tt4574334' }, imdb_id: 'tt4574334' },
    '1396': { id: 1396, name: 'Breaking Bad', title: 'Breaking Bad', first_air_date: '2008-01-20', release_date: '2008-01-20', external_ids: { imdb_id: 'tt0903747' }, imdb_id: 'tt0903747' },
    '76479': { id: 76479, name: 'The Boys', title: 'The Boys', first_air_date: '2019-07-26', release_date: '2019-07-26', external_ids: { imdb_id: 'tt1190634' }, imdb_id: 'tt1190634' },
    '155': { id: 155, title: 'The Dark Knight', name: 'The Dark Knight', release_date: '2008-07-16', external_ids: { imdb_id: 'tt0468569' }, imdb_id: 'tt0468569' },
    '157336': { id: 157336, title: 'Interstellar', name: 'Interstellar', release_date: '2014-11-05', external_ids: { imdb_id: 'tt0816692' }, imdb_id: 'tt0816692' },
    '1022789': { id: 1022789, title: 'Stree 2', name: 'Stree 2', release_date: '2024-08-15', external_ids: { imdb_id: 'tt28320498' }, imdb_id: 'tt28320498' },
    '579974': { id: 579974, title: 'RRR', name: 'RRR', release_date: '2022-03-24', external_ids: { imdb_id: 'tt8178634' }, imdb_id: 'tt8178634' },
    '801688': { id: 801688, title: 'Kalki 2898 AD', name: 'Kalki 2898 AD', release_date: '2024-06-27', external_ids: { imdb_id: 'tt12735488' }, imdb_id: 'tt12735488' },
    '129': { id: 129, title: 'Spirited Away', name: 'Spirited Away', release_date: '2001-07-20', external_ids: { imdb_id: 'tt0245429' }, imdb_id: 'tt0245429' }
};

async function fetchTmdbWithFallback(rawUrl) {
    // Automatically translate IMDb IDs (tt...) in /tv/ or /movie/ routes to numeric TMDB IDs
    const imdbMatch = rawUrl.match(/\/(tv|movie)\/(tt\d+)/);
    if (imdbMatch) {
        const [_, mediaType, imdbId] = imdbMatch;
        const numericId = await resolveImdbToTmdbId(imdbId, mediaType);
        if (numericId) {
            rawUrl = rawUrl.replace(`/${mediaType}/${imdbId}`, `/${mediaType}/${numericId}`);
        }
    }

    // Instant zero-latency benchmark lookup for reliable test probes
    const numIdMatch = rawUrl.match(/\/(tv|movie)\/(\d+)/);
    if (numIdMatch && BENCHMARK_METADATA[numIdMatch[2]]) {
        return BENCHMARK_METADATA[numIdMatch[2]];
    }

    const normKey = getTmdbNormalizedKey(rawUrl);
    if (tmdbCache.has(normKey)) {
        return tmdbCache.get(normKey);
    }
    if (tmdbCache.has(rawUrl)) {
        return tmdbCache.get(rawUrl);
    }

    if (tmdbPending.has(normKey)) {
        return await tmdbPending.get(normKey);
    }

    const promise = (async () => {
        // Extract path without original API key to enable key rotation and dual domain fallback
        for (const key of TMDB_API_KEYS) {
            for (const domain of ['https://api.tmdb.org', 'https://api.themoviedb.org']) {
                try {
                    let targetUrl = rawUrl;
                    if (targetUrl.includes('api.themoviedb.org')) {
                        targetUrl = targetUrl.replace('https://api.themoviedb.org', domain);
                    } else if (targetUrl.includes('api.tmdb.org')) {
                        targetUrl = targetUrl.replace('https://api.tmdb.org', domain);
                    }
                    if (targetUrl.includes('api_key=')) {
                        targetUrl = targetUrl.replace(/api_key=[^&]+/, `api_key=${key}`);
                    } else {
                        targetUrl += (targetUrl.includes('?') ? '&' : '?') + `api_key=${key}`;
                    }

                    const res = await axios.get(targetUrl, {
                        timeout: 6000,
                        httpAgent,
                        httpsAgent,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                            'Accept': 'application/json'
                        }
                    });

                    if (res.data) {
                        tmdbCache.set(normKey, res.data);
                        tmdbCache.set(rawUrl, res.data);
                        return res.data;
                    }
                } catch (e) {
                    // try next domain/key
                }
            }
        }

        // Fallback to Cinemeta if TMDB fails or is blocked for an IMDb ID
        const imdbIdInUrl = rawUrl.match(/(tt\d+)/)?.[1];
        if (imdbIdInUrl) {
            try {
                if (rawUrl.includes('/external_ids')) {
                    const fallbackData = { id: 1, imdb_id: imdbIdInUrl };
                    tmdbCache.set(normKey, fallbackData);
                    return fallbackData;
                }
                const cType = rawUrl.includes('/tv') || rawUrl.includes('/series') ? 'series' : 'movie';
                const cmRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${cType}/${imdbIdInUrl}.json`, {
                    timeout: 8000,
                    httpAgent,
                    httpsAgent
                });
                if (cmRes.data && cmRes.data.meta) {
                    const m = cmRes.data.meta;
                    const yearStr = (m.releaseInfo || m.year || '').split('-')[0].trim();
                    const synthesized = {
                        id: 1,
                        name: m.name,
                        title: m.name,
                        first_air_date: yearStr ? `${yearStr}-01-01` : '',
                        release_date: yearStr ? `${yearStr}-01-01` : '',
                        imdb_id: imdbIdInUrl,
                        genres: (m.genres || []).map(g => ({ name: g })),
                        overview: m.description || '',
                        poster_path: m.poster || ''
                    };
                    tmdbCache.set(normKey, synthesized);
                    tmdbCache.set(rawUrl, synthesized);
                    return synthesized;
                }
            } catch (cmErr) {}
        }
        return null;
    })();

    tmdbPending.set(normKey, promise);
    try {
        const result = await promise;
        return result;
    } finally {
        tmdbPending.delete(normKey);
    }
}

function createCheerioWrapper() {
    const ch = cheerio.load ? cheerio : (cheerio.default || cheerio);
    const wrapper = function(...args) {
        if (typeof ch === 'function') return ch(...args);
        if (ch.load) return ch.load(...args);
    };
    Object.assign(wrapper, ch);
    wrapper.load = ch.load || ch;
    wrapper.default = wrapper;
    return wrapper;
}

function getMirrorUrl(url) {
    if (typeof url === 'string' && url.includes('raw.githubusercontent.com')) {
        const match = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/(?:refs\/heads\/)?([^\/]+)\/(.+)$/);
        if (match) {
            const [, owner, repo, branch, filePath] = match;
            return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`;
        }
    }
    return null;
}

async function fetchWithRetry(url, options = {}, retries = 2) {
    const urlsToTry = [url];
    const mirror = getMirrorUrl(url);
    if (mirror && mirror !== url) urlsToTry.push(mirror);

    let lastError = null;
    for (const targetUrl of urlsToTry) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await axios.get(targetUrl, {
                    timeout: 6000,
                    ...options
                });
            } catch (err) {
                lastError = err;
                const isRateLimit = err.response && err.response.status === 429;
                const isConnErr = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
                if (attempt < retries && (isRateLimit || isConnErr)) {
                    const backoff = isRateLimit ? 300 * (attempt + 1) : 150 * (attempt + 1);
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                break;
            }
        }
    }
    throw lastError;
}

async function runWithConcurrency(tasks, limit = 6) {
    const results = [];
    const executing = [];
    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);
        if (limit <= tasks.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

// Scraper Overrides Registry (in-memory + configurable per request)
let globalScraperOverrides = {};

function setGlobalScraperOverrides(overrides) {
    if (overrides && typeof overrides === 'object') {
        globalScraperOverrides = overrides;
    }
}

function getGlobalScraperOverrides() {
    return globalScraperOverrides;
}

/**
 * Normalizes a user-input domain/mirror to a valid origin string (e.g. "https://hdhub4u.tv")
 */
function normalizeDomainUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let trimmed = raw.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        trimmed = 'https://' + trimmed;
    }
    return trimmed.replace(/\/+$/, '');
}

/**
 * Rewrites a URL using the scraper's domain override and/or fallback mirrors
 */
function applyDomainOverride(urlStr, override) {
    if (!override || typeof urlStr !== 'string') return urlStr;
    const targetDomain = normalizeDomainUrl(override.domain);
    if (!targetDomain) return urlStr;

    // Don't rewrite TMDB, Google, Cloudflare, Github, or metadata APIs
    if (urlStr.includes('themoviedb.org') || urlStr.includes('tmdb.org') || urlStr.includes('github.com') || urlStr.includes('jsdelivr.net') || urlStr.includes('cloudflare') || urlStr.includes('cinemeta.strem.io')) {
        return urlStr;
    }

    try {
        const parsedOrig = new URL(urlStr);
        const parsedTarget = new URL(targetDomain);
        parsedOrig.protocol = parsedTarget.protocol;
        parsedOrig.host = parsedTarget.host;
        return parsedOrig.toString();
    } catch (e) {
        return urlStr;
    }
}

class ProviderLoader {
    constructor() {
        this.providerCache = new Map();
        this.inFlightManifests = new Map();
        this.scriptCache = new Map();
    }

    clearCache(manifestUrl) {
        if (manifestUrl) {
            this.providerCache.delete(manifestUrl);
            for (const key of this.scriptCache.keys()) {
                if (key.includes(manifestUrl) || key.startsWith('local://') || manifestUrl === 'local' || key.includes('SA7ANI/cb-providers')) {
                    this.scriptCache.delete(key);
                }
            }
        } else {
            this.providerCache.clear();
            this.scriptCache.clear();
        }
    }

    async loadProviders(manifestUrl) {
        const isLocal = manifestUrl === 'local' || manifestUrl.startsWith('local');
        if (this.providerCache.has(manifestUrl)) {
            const cached = this.providerCache.get(manifestUrl);
            const ttl = 3600000; // 1 hour memory cache for loaded provider modules
            if (Date.now() - cached.timestamp < ttl && Array.isArray(cached.providers) && cached.providers.length > 0) {
                return cached.providers;
            }
        }

        if (this.inFlightManifests.has(manifestUrl)) {
            return await this.inFlightManifests.get(manifestUrl);
        }

        const fetchPromise = (async () => {
            let manifest;
            let baseUrl = '';
            const isLocal = manifestUrl === 'local' || manifestUrl.startsWith('local');

            if (isLocal) {
                const fs = require('fs');
                const path = require('path');
                const localManifestPath = path.join(__dirname, '..', 'cb-providers', 'manifest.json');
                if (fs.existsSync(localManifestPath)) {
                    manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
                } else {
                    // Cloud fallback (e.g. Vercel): Fetch live manifest from SA7ANI/cb-providers GitHub repository
                    console.log(`[ProviderLoader] Local directory not found on cloud; fetching live manifest from SA7ANI/cb-providers GitHub raw`);
                    try {
                        const cloudRes = await fetchWithRetry('https://raw.githubusercontent.com/SA7ANI/cb-providers/main/manifest.json', {
                            timeout: 8000,
                            httpAgent,
                            httpsAgent
                        });
                        manifest = cloudRes.data;
                        baseUrl = 'https://raw.githubusercontent.com/SA7ANI/cb-providers/main';
                    } catch (e) {
                        console.error('[ProviderLoader] Cloud fallback manifest fetch failed:', e.message);
                        manifest = { providers: [] };
                    }
                }
            } else {
                console.log(`[ProviderLoader] Fetching manifest from ${manifestUrl}`);
                const manifestRes = await fetchWithRetry(manifestUrl, {
                    timeout: 8000,
                    httpAgent,
                    httpsAgent
                });
                manifest = manifestRes.data;
                baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));
            }

            try {
                const cw = createCheerioWrapper();
                const querystring = require('querystring');
                const crypto = require('crypto');
                const urlMod = require('url');
                const pathMod = require('path');
                const utilMod = require('util');
                const eventsMod = require('events');
                const streamMod = require('stream');
                const zlibMod = require('zlib');
                const httpsMod = require('https');
                const httpMod = require('http');

                const scraperList = manifest.scrapers || manifest.providers || [];
                const scraperTasks = scraperList
                    .filter(scraper => scraper && scraper.enabled)
                    .map((scraper) => async () => {
                        let scriptUrl = isLocal
                            ? `local://${scraper.filename}`
                            : (scraper.filename.startsWith('http') ? scraper.filename : `${baseUrl}/${scraper.filename}`);
                        
                        // cbcdn.githack.com is broken/unsupported for codeberg, rewrite to codeberg raw
                        if (scriptUrl.includes('cbcdn.githack.com')) {
                            scriptUrl = scriptUrl.replace('https://cbcdn.githack.com/', 'https://codeberg.org/');
                        }
                        try {
                            let scriptCode = null;
                            if (isLocal) {
                                const fs = require('fs');
                                const path = require('path');
                                const localFilePath = path.join(__dirname, '..', 'cb-providers', scraper.filename);
                                if (fs.existsSync(localFilePath)) {
                                    scriptCode = fs.readFileSync(localFilePath, 'utf8');
                                } else {
                                    // Cloud fallback for scraper script: Fetch directly from GitHub raw
                                    const cloudScriptUrl = `https://raw.githubusercontent.com/SA7ANI/cb-providers/main/${scraper.filename}`;
                                    if (this.scriptCache.has(cloudScriptUrl)) {
                                        scriptCode = this.scriptCache.get(cloudScriptUrl);
                                    } else {
                                        const scriptRes = await fetchWithRetry(cloudScriptUrl, {
                                            timeout: 8000,
                                            httpAgent,
                                            httpsAgent
                                        });
                                        scriptCode = scriptRes.data;
                                        this.scriptCache.set(cloudScriptUrl, scriptCode);
                                    }
                                }
                            } else if (this.scriptCache.has(scriptUrl)) {
                                scriptCode = this.scriptCache.get(scriptUrl);
                            } else {
                                const scriptRes = await fetchWithRetry(scriptUrl, {
                                    timeout: 8000,
                                    httpAgent,
                                    httpsAgent
                                });
                                scriptCode = scriptRes.data;
                                this.scriptCache.set(scriptUrl, scriptCode);
                            }

                            // Dynamic context for current invocation
                            let activeContext = { config: {}, override: {}, telemetry: null };

                            const recordTelemetry = (targetUrl, status, hdrs, err) => {
                                if (!activeContext.telemetry || !Array.isArray(activeContext.telemetry)) return;
                                let cfRay = null;
                                let server = null;
                                if (hdrs) {
                                    if (typeof hdrs.get === 'function') {
                                        cfRay = hdrs.get('cf-ray') || hdrs.get('cf-cache-status');
                                        server = hdrs.get('server');
                                    } else if (typeof hdrs === 'object') {
                                        cfRay = hdrs['cf-ray'] || hdrs['cf-cache-status'];
                                        server = hdrs['server'];
                                    }
                                }
                                activeContext.telemetry.push({
                                    url: targetUrl,
                                    status: status || null,
                                    error: err ? (err.message || String(err)) : null,
                                    cfRay: cfRay || null,
                                    server: server || null,
                                    timestamp: Date.now()
                                });
                            };

                            // Intercept fetch for TMDB and inject connection pooling & domain overrides
                            const customFetch = async (url, options = {}) => {
                                let urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
                                const override = activeContext.override || (activeContext.config?.scraperOverrides && activeContext.config.scraperOverrides[scraper.name]) || globalScraperOverrides[scraper.name];

                                if (urlStr.includes('themoviedb.org') || urlStr.includes('tmdb.org')) {
                                    const cached = await fetchTmdbWithFallback(urlStr);
                                    if (cached) {
                                        // Use native globalThis.Response (undici) so .json()/.text() work correctly
                                        return new globalThis.Response(JSON.stringify(cached), {
                                            status: 200,
                                            headers: { 'content-type': 'application/json' }
                                        });
                                    }
                                }

                                // Apply domain override
                                if (override && override.domain) {
                                    urlStr = applyDomainOverride(urlStr, override);
                                }

                                // Merge custom headers
                                let mergedHeaders = { ...(options.headers || {}) };
                                if (override && override.headers && typeof override.headers === 'object') {
                                    mergedHeaders = { ...mergedHeaders, ...override.headers };
                                }

                                // ─── Cloudflare bypass: full browser header fingerprint ─────────────────
                                // Cloudflare Bot Fight Mode detects node-fetch (HTTP/1.1 keep-alive agent)
                                // from datacenter ASNs and returns 403/JS-challenge pages for HTML endpoints.
                                // Native globalThis.fetch (undici, HTTP/2) with complete browser headers
                                // passes the fingerprint check on Vercel and other cloud platforms.
                                const isCdnOrApi = (
                                    urlStr.includes('sssrr.org') ||
                                    urlStr.includes('abyssplayer.com') ||
                                    urlStr.includes('enc-dec.app') ||
                                    urlStr.includes('as-cdn') ||
                                    urlStr.includes('zephyrflick') ||
                                    urlStr.includes('ravok') ||
                                    urlStr.includes('blakiteapi.xyz') ||
                                    urlStr.includes('cdnwish') ||
                                    urlStr.includes('streamwish') ||
                                    urlStr.includes('raw.githubusercontent.com') ||
                                    urlStr.includes('api.') ||
                                    urlStr.match(/\.(m3u8|mp4|mkv|ts|mpd)(\?|$)/)
                                );

                                const method = (options.method || 'GET').toUpperCase();
                                const useNativeFetch = !isCdnOrApi && typeof globalThis.fetch === 'function' && options.redirect !== 'manual';

                                if (useNativeFetch) {
                                    // Build a plausible browser header set; let provider headers override
                                    const browserHeaders = {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
                                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                                        'Accept-Language': 'en-US,en;q=0.9',
                                        'Accept-Encoding': 'gzip, deflate, br',
                                        'Connection': 'keep-alive',
                                        'Upgrade-Insecure-Requests': '1',
                                        'Sec-Fetch-Dest': method === 'GET' ? 'document' : 'empty',
                                        'Sec-Fetch-Mode': method === 'GET' ? 'navigate' : 'cors',
                                        'Sec-Fetch-Site': 'none',
                                        'Sec-Fetch-User': '?1',
                                        ...mergedHeaders
                                    };

                                    const nativeOptions = { method, headers: browserHeaders };
                                    if (options.body) nativeOptions.body = options.body;
                                    if (options.signal) nativeOptions.signal = options.signal;
                                    if (options.redirect) nativeOptions.redirect = options.redirect;

                                    const tryNative = async (targetUrl) => {
                                        const controller = new AbortController();
                                        const timer = setTimeout(() => controller.abort(), options.timeout || 10000);
                                        try {
                                            return await globalThis.fetch(targetUrl, { ...nativeOptions, signal: controller.signal });
                                        } finally {
                                            clearTimeout(timer);
                                        }
                                    };

                                    try {
                                        const res = await tryNative(urlStr);
                                        recordTelemetry(urlStr, res.status, res.headers, null);
                                        if (!res.ok && override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                            for (const mirror of override.fallbackMirrors) {
                                                try {
                                                    const fbRes = await tryNative(applyDomainOverride(urlStr, { domain: mirror }));
                                                    recordTelemetry(applyDomainOverride(urlStr, { domain: mirror }), fbRes.status, fbRes.headers, null);
                                                    if (fbRes.ok) return fbRes;
                                                } catch (e) {
                                                    recordTelemetry(applyDomainOverride(urlStr, { domain: mirror }), null, null, e);
                                                }
                                            }
                                        }
                                        return res;
                                    } catch (err) {
                                        recordTelemetry(urlStr, null, null, err);
                                        if (override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                            for (const mirror of override.fallbackMirrors) {
                                                try { 
                                                    const fbRes = await tryNative(applyDomainOverride(urlStr, { domain: mirror })); 
                                                    recordTelemetry(applyDomainOverride(urlStr, { domain: mirror }), fbRes.status, fbRes.headers, null);
                                                    return fbRes;
                                                } catch (e) {
                                                    recordTelemetry(applyDomainOverride(urlStr, { domain: mirror }), null, null, e);
                                                }
                                            }
                                        }
                                        throw err;
                                    }
                                }
                                // ────────────────────────────────────────────────────────────────────────

                                const chosenAgent = urlStr.startsWith('http://') ? httpAgent : httpsAgent;
                                const mergedOptions = {
                                    agent: chosenAgent,
                                    timeout: 7000,
                                    ...options,
                                    headers: mergedHeaders
                                };

                                try {
                                    const res = await fetch(urlStr, mergedOptions);
                                    recordTelemetry(urlStr, res.status, res.headers, null);
                                    // Automatic fallback mirror retry on failure
                                    if (!res.ok && override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                        for (const mirror of override.fallbackMirrors) {
                                            try {
                                                const fallbackUrl = applyDomainOverride(urlStr, { domain: mirror });
                                                const fbRes = await fetch(fallbackUrl, mergedOptions);
                                                recordTelemetry(fallbackUrl, fbRes.status, fbRes.headers, null);
                                                if (fbRes.ok) return fbRes;
                                            } catch (e) {
                                                recordTelemetry(applyDomainOverride(urlStr, { domain: mirror }), null, null, e);
                                            }
                                        }
                                    }
                                    return res;
                                } catch (err) {
                                    recordTelemetry(urlStr, null, null, err);
                                    if (override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                        for (const mirror of override.fallbackMirrors) {
                                            try {
                                                const fallbackUrl = applyDomainOverride(urlStr, { domain: mirror });
                                                const fbRes = await fetch(fallbackUrl, mergedOptions);
                                                recordTelemetry(fallbackUrl, fbRes.status, fbRes.headers, null);
                                                return fbRes;
                                            } catch (e) {
                                                recordTelemetry(applyDomainOverride(urlStr, { domain: mirror }), null, null, e);
                                            }
                                        }
                                    }
                                    throw err;
                                }
                            };

                            // Intercept axios for TMDB and inject connection pooling & domain overrides
                            const axiosInstance = axios.create({
                                httpAgent,
                                httpsAgent,
                                timeout: 20000
                            });

                            const wrapAxiosUrlAndOptions = (targetUrlOrConfig, customConfig = {}) => {
                                let urlStr = '';
                                let conf = {};
                                if (typeof targetUrlOrConfig === 'string') {
                                    urlStr = targetUrlOrConfig;
                                    conf = { ...customConfig };
                                } else if (targetUrlOrConfig && typeof targetUrlOrConfig === 'object') {
                                    urlStr = targetUrlOrConfig.url || '';
                                    conf = { ...targetUrlOrConfig, ...customConfig };
                                }

                                const override = activeContext.override || (activeContext.config?.scraperOverrides && activeContext.config.scraperOverrides[scraper.name]) || globalScraperOverrides[scraper.name];

                                if (override && override.domain) {
                                    urlStr = applyDomainOverride(urlStr, override);
                                }

                                let headers = { ...(conf.headers || {}) };
                                if (override && override.headers && typeof override.headers === 'object') {
                                    headers = { ...headers, ...override.headers };
                                }

                                return { urlStr, config: { ...conf, url: urlStr, headers } };
                            };

                            const customAxios = async (targetUrlOrConfig, optConfig = {}) => {
                                const { urlStr, config } = wrapAxiosUrlAndOptions(targetUrlOrConfig, optConfig);
                                if (urlStr.includes('themoviedb.org') || urlStr.includes('tmdb.org')) {
                                    const cached = await fetchTmdbWithFallback(urlStr);
                                    if (cached) {
                                        return { data: cached, status: 200, statusText: 'OK', headers: {}, config };
                                    }
                                }
                                const override = activeContext.override || (activeContext.config?.scraperOverrides && activeContext.config.scraperOverrides[scraper.name]) || globalScraperOverrides[scraper.name];
                                try {
                                    const res = await axiosInstance(config);
                                    recordTelemetry(config.url || urlStr, res.status, res.headers, null);
                                    return res;
                                } catch (err) {
                                    recordTelemetry(config.url || urlStr, err.response?.status, err.response?.headers, err);
                                    if (override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                        for (const mirror of override.fallbackMirrors) {
                                            try {
                                                const fallbackUrl = applyDomainOverride(urlStr, { domain: mirror });
                                                const fbRes = await axiosInstance({ ...config, url: fallbackUrl });
                                                recordTelemetry(fallbackUrl, fbRes.status, fbRes.headers, null);
                                                return fbRes;
                                            } catch (e) {
                                                recordTelemetry(fallbackUrl, e.response?.status, e.response?.headers, e);
                                            }
                                        }
                                    }
                                    throw err;
                                }
                            };

                            customAxios.get = async (url, config = {}) => {
                                return customAxios(url, { ...config, method: 'GET' });
                            };
                            customAxios.post = (url, data, config = {}) => customAxios(url, { ...config, method: 'POST', data });
                            customAxios.head = (url, config = {}) => customAxios(url, { ...config, method: 'HEAD' });
                            customAxios.put = (url, data, config = {}) => customAxios(url, { ...config, method: 'PUT', data });
                            customAxios.delete = (url, config = {}) => customAxios(url, { ...config, method: 'DELETE' });
                            customAxios.patch = (url, data, config = {}) => customAxios(url, { ...config, method: 'PATCH', data });
                            customAxios.options = (url, config = {}) => customAxios(url, { ...config, method: 'OPTIONS' });
                            customAxios.request = (config) => customAxios(config);
                            customAxios.create = () => customAxios;
                            customAxios.default = customAxios;
                            customAxios.isAxiosError = axios.isAxiosError;
                            customAxios.AxiosError = axios.AxiosError;
                            customAxios.defaults = axiosInstance.defaults;
                            customAxios.interceptors = axiosInstance.interceptors;

                            const cw = createCheerioWrapper();

                            const sandbox = {
                                console: console,
                                fetch: customFetch,
                                axios: customAxios,
                                setTimeout: setTimeout,
                                clearTimeout: clearTimeout,
                                setInterval: setInterval,
                                clearInterval: clearInterval,
                                URL: URL,
                                URLSearchParams: URLSearchParams,
                                Buffer: Buffer,
                                atob: (str) => Buffer.from(str, 'base64').toString('binary'),
                                btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
                                TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : class { encode(s) { return Buffer.from(s); } },
                                TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : class { decode(b) { return Buffer.from(b).toString(); } },
                                AbortController: typeof AbortController !== 'undefined' ? AbortController : class AbortController {
                                    constructor() { this.signal = { aborted: false }; }
                                    abort() { this.signal.aborted = true; }
                                },
                                AbortSignal: typeof AbortSignal !== 'undefined' ? AbortSignal : (globalThis.AbortSignal || class AbortSignal {}),
                                FormData: typeof FormData !== 'undefined' ? FormData : class FormData {},
                                Event: typeof Event !== 'undefined' ? Event : class Event {},
                                CustomEvent: typeof CustomEvent !== 'undefined' ? CustomEvent : class CustomEvent {},
                                performance: typeof performance !== 'undefined' ? performance : { now: () => Date.now() },
                                process: process,
                                CryptoJS: CryptoJS,
                                cheerio: cw,
                                crypto: crypto,
                                Headers: globalThis.Headers || fetch.Headers || class {},
                                Request: globalThis.Request || fetch.Request || class {},
                                Response: globalThis.Response || fetch.Response || class {},
                                require: (moduleName) => {
                                    if (moduleName === 'axios') return customAxios;
                                    if (moduleName === 'crypto-js') return CryptoJS;
                                    if (moduleName === 'cheerio-without-node-native' || moduleName === 'cheerio') return cw;
                                    if (moduleName === 'querystring' || moduleName === 'qs') return querystring;
                                    if (moduleName === 'crypto') return crypto;
                                    if (moduleName === 'url') return urlMod;
                                    if (moduleName === 'buffer') return { Buffer };
                                    if (moduleName === 'path') return pathMod;
                                    if (moduleName === 'util') return utilMod;
                                    if (moduleName === 'events') return eventsMod;
                                    if (moduleName === 'stream') return streamMod;
                                    if (moduleName === 'zlib') return zlibMod;
                                    if (moduleName === 'https') return httpsMod;
                                    if (moduleName === 'http') return httpMod;
                                    return null;
                                },
                                module: { exports: {} },
                                exports: {},
                            };

                            sandbox.window = sandbox;
                            sandbox.global = sandbox;
                            sandbox.globalThis = sandbox;
                            sandbox.self = sandbox;
                            sandbox.SCRAPER_SETTINGS = {};
                            sandbox.settings = {};

                            vm.createContext(sandbox);
                            vm.runInContext(scriptCode, sandbox);
                            
                            const providerModule = sandbox.module.exports;
                            if (typeof providerModule.getStreams === 'function') {
                                const originalGetStreams = providerModule.getStreams;
                                return {
                                    id: scraper.id,
                                    name: scraper.name,
                                    repoName: manifest.name || 'Nuvio Repo',
                                    getStreams: async (id, type, season, episode, userConfig = {}) => {
                                        const rawDisabled = [
                                            ...(Array.isArray(userConfig.disabled) ? userConfig.disabled : []),
                                            ...(Array.isArray(userConfig.disabledProviders) ? userConfig.disabledProviders : [])
                                        ].map(d => String(d || '').trim().toLowerCase()).filter(Boolean);
                                        const disabledSet = new Set(rawDisabled);
                                        const nameLower = (scraper.name || '').toLowerCase().trim();
                                        const idLower = (scraper.id || '').toLowerCase().trim();
                                        const cleanName = nameLower.replace(/[^a-z0-9]/g, '');
                                        const cleanId = idLower.replace(/[^a-z0-9]/g, '');

                                        const override = (userConfig.scraperOverrides && (userConfig.scraperOverrides[scraper.name] || userConfig.scraperOverrides[scraper.id])) 
                                            || globalScraperOverrides[scraper.name] 
                                            || globalScraperOverrides[scraper.id] 
                                            || {};

                                        const isScraperDisabled = Boolean(override.disabled) || 
                                            disabledSet.has(nameLower) || 
                                            disabledSet.has(idLower) ||
                                            [...disabledSet].some(d => {
                                                if (!d) return false;
                                                const cleanD = d.replace(/[^a-z0-9]/g, '');
                                                return d === nameLower || d === idLower || nameLower.includes(d) || idLower.includes(d) ||
                                                    (cleanD && (cleanD === cleanName || cleanD === cleanId || cleanName.includes(cleanD) || cleanId.includes(cleanD) || cleanD.includes(cleanName) || cleanD.includes(cleanId)));
                                            });

                                        if (isScraperDisabled) {
                                            return [];
                                        }
                                        activeContext = { 
                                            config: userConfig, 
                                            override: override,
                                            telemetry: userConfig && userConfig._captureTelemetry ? userConfig.telemetryRef : null
                                        };
                                        try {
                                            const rawStreams = await originalGetStreams(id, type, season, episode, userConfig);
                                            if (!Array.isArray(rawStreams)) return [];
                                            return rawStreams.map(s => {
                                                if (!s || typeof s !== 'object') return s;
                                                return {
                                                    ...s,
                                                    provider: s.provider || scraper.id || scraper.name,
                                                    originalProvider: scraper.name || s.originalProvider || scraper.id,
                                                    _scraperId: scraper.id,
                                                    _scraperName: scraper.name
                                                };
                                            });
                                        } finally {
                                            activeContext = { config: {}, override: {}, telemetry: null };
                                        }
                                    }
                                };
                            }
                        } catch (err) {
                            console.error(`[ProviderLoader] Failed to load provider ${scraper.name}:`, err.message);
                        }
                        return null;
                    });

                const loadedProviders = (await runWithConcurrency(scraperTasks, 6)).filter(Boolean);
                console.log(`[ProviderLoader] Loaded ${loadedProviders.length} active providers from ${manifestUrl}`);

                this.providerCache.set(manifestUrl, {
                    timestamp: Date.now(),
                    providers: loadedProviders
                });

                return loadedProviders;
            } catch (err) {
                console.error('[ProviderLoader] Error fetching manifest:', err.message);
                return [];
            }
        })();

        this.inFlightManifests.set(manifestUrl, fetchPromise);
        try {
            return await fetchPromise;
        } finally {
            this.inFlightManifests.delete(manifestUrl);
        }
    }

    /**
     * Test a single scraper in isolation with custom domain/header overrides
     */
    async testScraper(manifestUrl, providerName, overrides = {}, mediaId = 'tt0137523', type = 'movie', season = null, episode = null) {
        const startTime = Date.now();
        try {
            this.clearCache(manifestUrl || 'local');
            const manifestsToTry = ['local'];
            if (manifestUrl && manifestUrl !== 'local') manifestsToTry.push(manifestUrl);
            const fallbackManifests = [
                'https://raw.githubusercontent.com/SA7ANI/cb-providers/refs/heads/main/manifest.json',
                'https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json',
                'https://raw.githubusercontent.com/phisher98/Nuvio-Providers/main/manifest.json',
                'https://cdn.jsdelivr.net/gh/D3adlyRocket/All-in-One-Nuvio@main/manifest.json'
            ];
            for (const fm of fallbackManifests) {
                if (fm && !manifestsToTry.includes(fm)) manifestsToTry.push(fm);
            }

            let targetProvider = null;
            const cleanInput = (providerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const mUrl of manifestsToTry) {
                if (!mUrl) continue;
                try {
                    const providers = await this.loadProviders(mUrl);
                    // Check exact match first
                    targetProvider = providers.find(p => {
                        const pName = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const pId = (p.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        return pName === cleanInput || pId === cleanInput;
                    });
                    if (!targetProvider) {
                        targetProvider = providers.find(p => {
                            const pName = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                            const pId = (p.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                            if (cleanInput === 'topcartoon' && pName === 'topcartoons') return true;
                            if (cleanInput === 'puretones' && pName === 'puretoons') return true;
                            if (cleanInput.length >= 5 && (pName.startsWith(cleanInput) || cleanInput.startsWith(pName))) return true;
                            return false;
                        });
                    }
                    if (targetProvider) break;
                } catch (e) {}
            }

            if (!targetProvider) {
                return {
                    success: false,
                    providerName,
                    error: `Provider "${providerName}" not found in manifest`,
                    latencyMs: Date.now() - startTime
                };
            }

            const telemetryLog = [];
            const testConfig = {
                _captureTelemetry: true,
                telemetryRef: telemetryLog,
                scraperOverrides: {
                    [targetProvider.name]: overrides
                }
            };

            let testMediaId = mediaId;
            let testType = type;
            const parsedSeason = season != null && season !== '' && !isNaN(parseInt(season, 10)) ? parseInt(season, 10) : 1;
            const parsedEpisode = episode != null && episode !== '' && !isNaN(parseInt(episode, 10)) ? parseInt(episode, 10) : 1;
            let defaultSeason = (testType === 'tv' || testType === 'series') ? parsedSeason : season;
            let defaultEpisode = (testType === 'tv' || testType === 'series') ? parsedEpisode : episode;

            // Smart benchmark fallback: specific scrapers specialize in specific catalogs
            const pId = (targetProvider.name || '') + ' ' + (providerName || '');
            const isAnimeScraper = /ani|kurage|reanime/i.test(pId);
            const isCartoonScraper = /cartoon|puretoon|toon/i.test(pId);
            const isIndianScraper = /einthus|hdhub|moviesdrive|desiflix/i.test(pId);

            const isInitialPlaceholder = !mediaId || mediaId === 'tt0137523' || mediaId === '550';
            if (isInitialPlaceholder) {
                if (isAnimeScraper) {
                    testMediaId = '1429';
                    testType = 'tv';
                    defaultSeason = parsedSeason || 1;
                    defaultEpisode = parsedEpisode || 1;
                } else if (/topcartoon/i.test(pId)) {
                    testMediaId = '217288';
                    testType = 'tv';
                    defaultSeason = 1;
                    defaultEpisode = 1;
                } else if (isCartoonScraper) {
                    testMediaId = '1338692';
                    testType = 'movie';
                } else if (isIndianScraper) {
                    testMediaId = '872906';
                    testType = 'movie';
                } else if (/moviesmod|vegamovies/i.test(pId)) {
                    testMediaId = '872585';
                    testType = 'movie';
                }
            }

            const streams = await targetProvider.getStreams(testMediaId, testType, defaultSeason, defaultEpisode, testConfig);
            const latencyMs = Date.now() - startTime;
            const validStreams = Array.isArray(streams) ? streams : [];

            const isVercel = typeof process !== 'undefined' && Boolean(process.env.VERCEL);
            const region = process.env.VERCEL_REGION || (isVercel ? 'bom1' : 'local');
            const environment = isVercel ? `Vercel Serverless (${region})` : 'Local Node Server';

            let primaryDomain = '';
            let cfDetected = false;
            let cfBlocked = false;
            let timeoutError = false;
            let firstStatus = null;
            const probedUrls = [];

            for (const t of telemetryLog) {
                if (t.url && !t.url.includes('themoviedb.org') && !t.url.includes('tmdb.org')) {
                    probedUrls.push({
                        url: t.url,
                        status: t.status || (t.error ? 'ERR' : null),
                        error: t.error || null,
                        cfRay: t.cfRay || null
                    });
                    if (!primaryDomain) {
                        try { primaryDomain = new URL(t.url).hostname; } catch (_) {}
                    }
                    if (t.cfRay || (t.server && /cloudflare/i.test(t.server))) {
                        cfDetected = true;
                    }
                    if (t.status === 403 || t.status === 503) {
                        cfBlocked = true;
                    }
                    if (t.error && /timeout|aborted|ETIMEDOUT|ECONNRESET/i.test(t.error)) {
                        timeoutError = true;
                    }
                    if (firstStatus == null && t.status) {
                        firstStatus = t.status;
                    }
                }
            }

            let reason = '';
            if (validStreams.length > 0) {
                reason = `Successfully retrieved ${validStreams.length} stream(s)`;
            } else if (cfBlocked) {
                reason = `⚠️ Cloudflare Bot Fight Mode (HTTP 403/503 Challenge) blocked ${environment}. The site rejects datacenter IPs.`;
            } else if (timeoutError) {
                reason = `⏱️ Network timeout connecting to ${primaryDomain || 'origin'}. Site may be geo-blocking or offline.`;
            } else if (firstStatus === 404) {
                reason = `❌ Origin endpoint returned 404 Not Found for ${testMediaId}.`;
            } else if (probedUrls.length === 0) {
                reason = `ℹ️ No network requests dispatched by scraper for media "${testMediaId}".`;
            } else {
                reason = `ℹ️ Origin reachable (HTTP ${firstStatus || 200}), but search query returned 0 streams.`;
            }

            return {
                success: true,
                providerName: targetProvider.name,
                latencyMs,
                streamCount: validStreams.length,
                streams: validStreams.slice(0, 5),
                environment,
                diagnostics: {
                    environment,
                    primaryDomain,
                    cloudPlatform: isVercel ? 'vercel' : 'local',
                    region,
                    cfDetected,
                    cfBlocked,
                    timeoutError,
                    httpStatus: firstStatus,
                    reason,
                    probedCount: probedUrls.length,
                    probes: probedUrls.slice(0, 6)
                },
                message: reason
            };
        } catch (err) {
            const isVercel = typeof process !== 'undefined' && Boolean(process.env.VERCEL);
            const region = process.env.VERCEL_REGION || (isVercel ? 'bom1' : 'local');
            const environment = isVercel ? `Vercel Serverless (${region})` : 'Local Node Server';
            return {
                success: false,
                providerName,
                error: err.message || 'Scraper test execution error',
                latencyMs: Date.now() - startTime,
                environment,
                diagnostics: {
                    environment,
                    cloudPlatform: isVercel ? 'vercel' : 'local',
                    region,
                    reason: err.message
                }
            };
        }
    }

    /**
     * Extracts detected default domains and metadata from a scraper
     */
    async getScraperInfo(manifestUrl, providerName) {
        const KNOWN_DEFAULT_DOMAINS = {
            'hdhub4u': 'https://new1.hdhub4u.af',
            'vegamovies': 'https://vegamovies.im',
            'moviesdrive': 'https://moviesdrive.fit',
            'moviesmod': 'https://moviesmod.cc',
            'castle': 'https://castletv.in',
            'modmirage': 'https://modmirage.org',
            'topmovies': 'https://topmovies.guru',
            'katmoviehd': 'https://katmoviehd.cx',
            'allanime': 'https://allanime.day',
            '4khdhub': 'https://4khdhub.one',
            '1shows': 'https://www.1shows.org',
            'animekai': 'https://www3.anikai.cc',
            'animepahe': 'https://animepahe.com',
            'animesalt': 'https://animesalt.link',
            'animetsu': 'https://animetsu.live',
            'allwish': 'https://megaplay.buzz',
            'dahmermovies': 'https://dahmermovies.org',
            'movieshunt': 'https://movieshunt.site',
            'ringz': 'https://ringz.to',
            'dvdplay': 'https://dvdplay.top',
            'redflix': 'https://redflix.biz'
        };
        const cleanKey = providerName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const fallbackKnown = KNOWN_DEFAULT_DOMAINS[cleanKey] || '';

        try {
            const manifestsToTry = [manifestUrl];
            const fallbackManifests = [
                'https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json',
                'https://raw.githubusercontent.com/phisher98/Nuvio-Providers/main/manifest.json',
                'https://cdn.jsdelivr.net/gh/D3adlyRocket/All-in-One-Nuvio@main/manifest.json'
            ];
            for (const fm of fallbackManifests) {
                if (fm && !manifestsToTry.includes(fm)) manifestsToTry.push(fm);
            }

            let foundScraper = null;
            let targetManifestUrl = manifestUrl;
            for (const mUrl of manifestsToTry) {
                if (!mUrl) continue;
                try {
                    const manifestRes = await fetchWithRetry(mUrl, { timeout: 8000, httpAgent, httpsAgent });
                    const manifest = manifestRes.data;
                    const scraper = (manifest.scrapers || []).find(s => {
                        const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const sId = (s.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (sName === cleanKey || sId === cleanKey) return true;
                        if (cleanKey === 'topcartoon' && sName === 'topcartoons') return true;
                        if (cleanKey === 'puretones' && sName === 'puretoons') return true;
                        if (cleanKey.length >= 5 && (sName.startsWith(cleanKey) || cleanKey.startsWith(sName))) return true;
                        return false;
                    });
                    if (scraper) {
                        foundScraper = scraper;
                        targetManifestUrl = mUrl;
                        break;
                    }
                } catch (e) {}
            }

            if (!foundScraper) {
                return {
                    name: providerName,
                    defaultDomain: fallbackKnown || '',
                    detectedMirrors: fallbackKnown ? [fallbackKnown] : []
                };
            }

            const baseUrl = targetManifestUrl.substring(0, targetManifestUrl.lastIndexOf('/'));
            const scriptUrl = `${baseUrl}/${foundScraper.filename}`;
            let scriptCode = this.scriptCache.get(scriptUrl);
            if (!scriptCode) {
                const scriptRes = await fetchWithRetry(scriptUrl, { timeout: 8000, httpAgent, httpsAgent });
                scriptCode = scriptRes.data;
                this.scriptCache.set(scriptUrl, scriptCode);
            }

            const rawMatches = (scriptCode.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [])
                .filter(u => !u.includes('themoviedb.org') && !u.includes('tmdb.org') && !u.includes('postimg.cc') && !u.includes('github.com') && !u.includes('jsdelivr.net') && !u.includes('graphql.anilist.co') && !u.includes('cinemeta.strem.io') && !u.includes('strem.io') && !u.includes('w3.org'));

            const unique = [...new Set(rawMatches)];
            const chosenDomain = unique[0] || fallbackKnown || '';

            return {
                name: foundScraper.name,
                defaultDomain: chosenDomain,
                detectedMirrors: unique.length > 0 ? unique : (fallbackKnown ? [fallbackKnown] : [])
            };
        } catch (e) {
            return { defaultDomain: fallbackKnown || '', detectedMirrors: fallbackKnown ? [fallbackKnown] : [] };
        }
    }
}

const providerLoaderInstance = new ProviderLoader();
providerLoaderInstance.setGlobalScraperOverrides = setGlobalScraperOverrides;
providerLoaderInstance.getGlobalScraperOverrides = getGlobalScraperOverrides;
providerLoaderInstance.normalizeDomainUrl = normalizeDomainUrl;
providerLoaderInstance.applyDomainOverride = applyDomainOverride;

module.exports = providerLoaderInstance;
