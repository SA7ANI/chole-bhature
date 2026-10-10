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
        // Extract path without original API key to enable key rotation
        for (const key of TMDB_API_KEYS) {
            try {
                let targetUrl = rawUrl;
                if (rawUrl.includes('api_key=')) {
                    targetUrl = rawUrl.replace(/api_key=[^&]+/, `api_key=${key}`);
                } else {
                    targetUrl += (rawUrl.includes('?') ? '&' : '?') + `api_key=${key}`;
                }

                const res = await axios.get(targetUrl, {
                    timeout: 8000,
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
                // try next key
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
                if (key.includes(manifestUrl) || key.startsWith('local://')) {
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
            const ttl = isLocal ? 3000 : 3600000;
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
                            let activeContext = { config: {}, override: {} };

                            // Intercept fetch for TMDB and inject connection pooling & domain overrides
                            const customFetch = async (url, options = {}) => {
                                let urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
                                const override = activeContext.override || (activeContext.config?.scraperOverrides && activeContext.config.scraperOverrides[scraper.name]) || globalScraperOverrides[scraper.name];

                                if (urlStr.includes('themoviedb.org') || urlStr.includes('tmdb.org')) {
                                    const cached = await fetchTmdbWithFallback(urlStr);
                                    if (cached) {
                                        const RespClass = globalThis.Response || fetch.Response;
                                        return new RespClass(JSON.stringify(cached), {
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

                                const chosenAgent = urlStr.startsWith('http://') ? httpAgent : httpsAgent;
                                const mergedOptions = {
                                    agent: chosenAgent,
                                    timeout: 7000,
                                    ...options,
                                    headers: mergedHeaders
                                };

                                try {
                                    const res = await fetch(urlStr, mergedOptions);
                                    // Automatic fallback mirror retry on failure
                                    if (!res.ok && override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                        for (const mirror of override.fallbackMirrors) {
                                            try {
                                                const fallbackUrl = applyDomainOverride(urlStr, { domain: mirror });
                                                const fbRes = await fetch(fallbackUrl, mergedOptions);
                                                if (fbRes.ok) return fbRes;
                                            } catch (e) {}
                                        }
                                    }
                                    return res;
                                } catch (err) {
                                    if (override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                        for (const mirror of override.fallbackMirrors) {
                                            try {
                                                const fallbackUrl = applyDomainOverride(urlStr, { domain: mirror });
                                                return await fetch(fallbackUrl, mergedOptions);
                                            } catch (e) {}
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
                                    return await axiosInstance(config);
                                } catch (err) {
                                    if (override && Array.isArray(override.fallbackMirrors) && override.fallbackMirrors.length > 0) {
                                        for (const mirror of override.fallbackMirrors) {
                                            try {
                                                const fallbackUrl = applyDomainOverride(urlStr, { domain: mirror });
                                                return await axiosInstance({ ...config, url: fallbackUrl });
                                            } catch (e) {}
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
                                Headers: fetch.Headers || class {},
                                Request: fetch.Request || class {},
                                Response: fetch.Response || class {},
                                require: (moduleName) => {
                                    if (moduleName === 'axios') return customAxios;
                                    if (moduleName === 'crypto-js') return CryptoJS;
                                    if (moduleName === 'cheerio-without-node-native' || moduleName === 'cheerio') return Object.assign(cw, { default: cw, __esModule: false });
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
                                        const override = (userConfig.scraperOverrides && userConfig.scraperOverrides[scraper.name]) || globalScraperOverrides[scraper.name] || {};
                                        if (override.disabled || (userConfig.disabledProviders && userConfig.disabledProviders.includes(scraper.name))) {
                                            return [];
                                        }
                                        activeContext = { config: userConfig, override: override };
                                        try {
                                            return await originalGetStreams(id, type, season, episode, userConfig);
                                        } finally {
                                            activeContext = { config: {}, override: {} };
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
            const manifestsToTry = ['local'];
            if (manifestUrl && manifestUrl !== 'local') manifestsToTry.push(manifestUrl);
            const fallbackManifests = [
                'https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json',
                'https://raw.githubusercontent.com/phisher98/Nuvio-Providers/main/manifest.json',
                'https://cdn.jsdelivr.net/gh/D3adlyRocket/All-in-One-Nuvio@main/manifest.json'
            ];
            for (const fm of fallbackManifests) {
                if (fm && !manifestsToTry.includes(fm)) manifestsToTry.push(fm);
            }

            let targetProvider = null;
            for (const mUrl of manifestsToTry) {
                if (!mUrl) continue;
                try {
                    const providers = await this.loadProviders(mUrl);
                    targetProvider = providers.find(p => p.name.toLowerCase() === providerName.toLowerCase() || p.id === providerName);
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

            const testConfig = {
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

            // Smart benchmark fallback: anime scrapers cannot scrape live-action movies like Fight Club
            const isAnimeScraper = /ani|kurage|reanime/i.test(targetProvider.name || '') || /ani|kurage|reanime/i.test(providerName || '');
            if (isAnimeScraper && (testMediaId === 'tt0137523' || testMediaId === '550')) {
                testMediaId = '1429';
                testType = 'tv';
                defaultSeason = parsedSeason;
                defaultEpisode = parsedEpisode;
            }

            let streams = await targetProvider.getStreams(testMediaId, testType, defaultSeason, defaultEpisode, testConfig);
            // Fallback for movie providers if Fight Club (1999) has no seeds on newer indexes
            if ((!streams || streams.length === 0) && (testMediaId === 'tt0137523' || testMediaId === '550') && !isAnimeScraper) {
                try {
                    const oppenheimerStreams = await targetProvider.getStreams('872585', 'movie', null, null, testConfig);
                    if (Array.isArray(oppenheimerStreams) && oppenheimerStreams.length > 0) {
                        streams = oppenheimerStreams;
                    }
                } catch (_) {}
            }
            const latencyMs = Date.now() - startTime;
            const validStreams = Array.isArray(streams) ? streams : [];

            return {
                success: true,
                providerName: targetProvider.name,
                latencyMs,
                streamCount: validStreams.length,
                streams: validStreams.slice(0, 5),
                message: `Successfully tested ${targetProvider.name}: found ${validStreams.length} stream(s)`
            };
        } catch (err) {
            return {
                success: false,
                providerName,
                error: err.message || 'Scraper test execution error',
                latencyMs: Date.now() - startTime
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
                    const scraper = (manifest.scrapers || []).find(s => s.name.toLowerCase() === providerName.toLowerCase() || s.id === providerName);
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
