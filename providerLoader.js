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

class ProviderLoader {
    constructor() {
        this.providerCache = new Map();
    }

    async loadProviders(manifestUrl) {
        if (this.providerCache.has(manifestUrl)) {
            const cached = this.providerCache.get(manifestUrl);
            if (Date.now() - cached.timestamp < 3600000) {
                return cached.providers;
            }
        }

        console.log(`[ProviderLoader] Fetching manifest from ${manifestUrl}`);
        try {
            const manifestRes = await axios.get(manifestUrl);
            const manifest = manifestRes.data;
            const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));

            const providers = [];
            const cw = createCheerioWrapper();
            const querystring = require('querystring');
            const crypto = require('crypto');
            const urlMod = require('url');

            for (const scraper of manifest.scrapers || []) {
                if (!scraper.enabled) continue;
                
                const scriptUrl = `${baseUrl}/${scraper.filename}`;
                console.log(`[ProviderLoader] Loading script for ${scraper.name}: ${scriptUrl}`);
                
                try {
                    const scriptRes = await axios.get(scriptUrl);
                    const scriptCode = scriptRes.data;
                    
                    // Intercept fetch for TMDB and inject connection pooling
                    const customFetch = async (url, options = {}) => {
                        const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
                        if (urlStr.includes('themoviedb.org') || urlStr.includes('tmdb.org')) {
                            const cached = await fetchTmdbWithFallback(urlStr);
                            if (cached) {
                                return new fetch.Response(JSON.stringify(cached), {
                                    status: 200,
                                    headers: { 'content-type': 'application/json' }
                                });
                            }
                        }
                        const mergedOptions = {
                            agent: (_parsedUrl) => (_parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent),
                            ...options
                        };
                        return fetch(url, mergedOptions);
                    };

                    // Intercept axios for TMDB and inject connection pooling
                    const axiosInstance = axios.create({
                        httpAgent,
                        httpsAgent,
                        timeout: 20000
                    });

                    const customAxios = async (config) => {
                        const urlStr = typeof config === 'string' ? config : (config && config.url ? config.url : '');
                        if (urlStr.includes('themoviedb.org') || urlStr.includes('tmdb.org')) {
                            const cached = await fetchTmdbWithFallback(urlStr);
                            if (cached) {
                                return { data: cached, status: 200, statusText: 'OK', headers: {}, config };
                            }
                        }
                        return axiosInstance(config);
                    };
                    customAxios.get = async (url, config = {}) => {
                        if (typeof url === 'string' && (url.includes('themoviedb.org') || url.includes('tmdb.org'))) {
                            const cached = await fetchTmdbWithFallback(url);
                            if (cached) {
                                return { data: cached, status: 200, statusText: 'OK', headers: {}, config };
                            }
                        }
                        return axiosInstance.get(url, config);
                    };
                    customAxios.post = (url, data, config) => axiosInstance.post(url, data, config);
                    customAxios.head = (url, config) => axiosInstance.head(url, config);
                    customAxios.put = (url, data, config) => axiosInstance.put(url, data, config);
                    customAxios.delete = (url, config) => axiosInstance.delete(url, config);
                    customAxios.patch = (url, data, config) => axiosInstance.patch(url, data, config);
                    customAxios.options = (url, config) => axiosInstance.options(url, config);
                    customAxios.request = (config) => customAxios(config);
                    customAxios.create = () => customAxios;
                    customAxios.default = customAxios;
                    customAxios.isAxiosError = axios.isAxiosError;
                    customAxios.AxiosError = axios.AxiosError;
                    customAxios.defaults = axiosInstance.defaults;
                    customAxios.interceptors = axiosInstance.interceptors;

                    const pathMod = require('path');
                    const utilMod = require('util');
                    const eventsMod = require('events');
                    const streamMod = require('stream');
                    const zlibMod = require('zlib');
                    const httpsMod = require('https');
                    const httpMod = require('http');

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
                        FormData: typeof FormData !== 'undefined' ? FormData : class FormData {},
                        Event: typeof Event !== 'undefined' ? Event : class Event {},
                        CustomEvent: typeof CustomEvent !== 'undefined' ? CustomEvent : class CustomEvent {},
                        performance: typeof performance !== 'undefined' ? performance : { now: () => Date.now() },
                        process: process,
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
                        providers.push({
                            id: scraper.id,
                            name: scraper.name,
                            getStreams: providerModule.getStreams
                        });
                        console.log(`[ProviderLoader] Successfully loaded ${scraper.name}`);
                    } else {
                        console.log(`[ProviderLoader] ${scraper.name} has no getStreams function exported.`);
                    }
                } catch (err) {
                    console.error(`[ProviderLoader] Failed to load provider ${scraper.name}:`, err.message);
                }
            }

            this.providerCache.set(manifestUrl, {
                timestamp: Date.now(),
                providers: providers
            });

            return providers;
        } catch (err) {
            console.error('[ProviderLoader] Error fetching manifest:', err.message);
            return [];
        }
    }
}

module.exports = new ProviderLoader();
