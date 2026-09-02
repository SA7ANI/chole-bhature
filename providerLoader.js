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
        return url
            .replace('https://raw.githubusercontent.com/', 'https://cdn.jsdelivr.net/gh/')
            .replace('/refs/heads/', '@')
            .replace(/\/([^\/]+)\/([^\/]+)\/([^\/]+)\//, '/$1/$2@$3/');
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

    async loadProviders(manifestUrl) {
        if (this.providerCache.has(manifestUrl)) {
            const cached = this.providerCache.get(manifestUrl);
            if (Date.now() - cached.timestamp < 3600000 && Array.isArray(cached.providers) && cached.providers.length > 0) {
                return cached.providers;
            }
        }

        if (this.inFlightManifests.has(manifestUrl)) {
            return await this.inFlightManifests.get(manifestUrl);
        }

        const fetchPromise = (async () => {
            console.log(`[ProviderLoader] Fetching manifest from ${manifestUrl}`);
            try {
                const manifestRes = await fetchWithRetry(manifestUrl, {
                    timeout: 8000,
                    httpAgent,
                    httpsAgent
                });
                const manifest = manifestRes.data;
                const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));

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

                const scraperTasks = (manifest.scrapers || [])
                    .filter(scraper => scraper && scraper.enabled)
                    .map((scraper) => async () => {
                        const scriptUrl = `${baseUrl}/${scraper.filename}`;
                        try {
                            let scriptCode = null;
                            if (this.scriptCache.has(scriptUrl)) {
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
                                        return new fetch.Response(JSON.stringify(cached), {
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

                            vm.createContext(sandbox);
                            vm.runInContext(scriptCode, sandbox);
                            
                            const providerModule = sandbox.module.exports;
                            if (typeof providerModule.getStreams === 'function') {
                                const originalGetStreams = providerModule.getStreams;
                                return {
                                    id: scraper.id,
                                    name: scraper.name,
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
    async testScraper(manifestUrl, providerName, overrides = {}, mediaId = 'tt0137523', type = 'movie') {
        const startTime = Date.now();
        try {
            const providers = await this.loadProviders(manifestUrl);
            const targetProvider = providers.find(p => p.name.toLowerCase() === providerName.toLowerCase() || p.id === providerName);
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

            const streams = await targetProvider.getStreams(mediaId, type, null, null, testConfig);
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
        try {
            const manifestRes = await fetchWithRetry(manifestUrl, { timeout: 8000, httpAgent, httpsAgent });
            const manifest = manifestRes.data;
            const scraper = (manifest.scrapers || []).find(s => s.name.toLowerCase() === providerName.toLowerCase() || s.id === providerName);
            if (!scraper) return { defaultDomain: '', detectedMirrors: [] };

            const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));
            const scriptUrl = `${baseUrl}/${scraper.filename}`;
            let scriptCode = this.scriptCache.get(scriptUrl);
            if (!scriptCode) {
                const scriptRes = await fetchWithRetry(scriptUrl, { timeout: 8000, httpAgent, httpsAgent });
                scriptCode = scriptRes.data;
                this.scriptCache.set(scriptUrl, scriptCode);
            }

            const rawMatches = (scriptCode.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [])
                .filter(u => !u.includes('themoviedb.org') && !u.includes('tmdb.org') && !u.includes('postimg.cc') && !u.includes('github.com') && !u.includes('jsdelivr.net') && !u.includes('graphql.anilist.co') && !u.includes('cinemeta.strem.io') && !u.includes('strem.io') && !u.includes('w3.org'));

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
                'dvdplay': 'https://dvdplay.top'
            };

            const cleanKey = providerName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const fallbackKnown = KNOWN_DEFAULT_DOMAINS[cleanKey] || '';

            const unique = [...new Set(rawMatches)];
            const chosenDomain = unique[0] || fallbackKnown || '';

            return {
                name: scraper.name,
                defaultDomain: chosenDomain,
                detectedMirrors: unique.length > 0 ? unique : (fallbackKnown ? [fallbackKnown] : [])
            };
        } catch (e) {
            return { defaultDomain: '', detectedMirrors: [] };
        }
    }
}

const providerLoaderInstance = new ProviderLoader();
providerLoaderInstance.setGlobalScraperOverrides = setGlobalScraperOverrides;
providerLoaderInstance.getGlobalScraperOverrides = getGlobalScraperOverrides;
providerLoaderInstance.normalizeDomainUrl = normalizeDomainUrl;
providerLoaderInstance.applyDomainOverride = applyDomainOverride;

module.exports = providerLoaderInstance;
