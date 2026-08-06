const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const path = require('path');
const providerLoader = require('./providerLoader');
const { sortAndTagStreams } = require('./streamTester');
const axios = require('axios');

const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Persistent User Configuration Store
const CONFIGS_FILE = path.join(__dirname, 'user_configs.json');
const userConfigs = new Map();

function loadUserConfigs() {
    try {
        if (fs.existsSync(CONFIGS_FILE)) {
            const raw = fs.readFileSync(CONFIGS_FILE, 'utf8');
            const data = JSON.parse(raw);
            for (const [k, v] of Object.entries(data)) {
                userConfigs.set(k, v);
            }
            console.log(`[Config] Loaded ${userConfigs.size} user configurations.`);
        }
    } catch (e) {
        console.error('[Config] Failed to load user_configs.json:', e.message);
    }
}

function saveUserConfig(configId, configData) {
    userConfigs.set(configId, configData);
    try {
        const obj = {};
        for (const [k, v] of userConfigs.entries()) {
            obj[k] = v;
        }
        fs.writeFileSync(CONFIGS_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        console.error('[Config] Failed to persist user_configs.json:', e.message);
    }
}
loadUserConfigs();

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.redirect('/configure');
});

app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve configure page on configId routes
app.get('/c/:configId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/c/:configId/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API to save configuration (Instant Sync)
app.post('/api/config/save', (req, res) => {
    try {
        let { configId, config } = req.body;
        if (!configId) {
            configId = crypto.randomBytes(4).toString('hex');
        }
        
        saveUserConfig(configId, config);
        
        // Invalidate stream cache for this configuration
        for (const key of streamCache.keys()) {
            if (key.includes(configId)) {
                streamCache.delete(key);
            }
        }
        
        console.log(`[Config] Configuration saved & synced for configId: ${configId}`);
        res.json({ success: true, configId, config });
    } catch (err) {
        console.error('[Config Error]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API to get configuration
app.get('/api/config/:configId', (req, res) => {
    const config = userConfigs.get(req.params.configId) || null;
    res.json({ config });
});

// Handle Nuvio/Stremio gear icon clicks which append /configure or / to the addon base URL
app.get('/:configJSON/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const streamCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Analytics tracker
const providerAnalytics = new Map();

app.get('/api/analytics', (req, res) => {
    const stats = {};
    for (const [provider, data] of providerAnalytics.entries()) {
        stats[provider] = data;
    }
    res.json(stats);
});

// Automated Vercel Cron Job to keep providers awake
app.get('/api/wakeup', async (req, res) => {
    try {
        // The user's main repository
        const repoUrl = 'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json';
        // Loading the providers automatically pings their external servers (Render/Koyeb) to keep them awake!
        await providerLoader.loadProviders(repoUrl);
        console.log('[Cron] Wakeup ping completed successfully.');
        res.status(200).send('Wakeup successful');
    } catch (err) {
        console.error('[Cron] Wakeup failed:', err.message);
        res.status(500).send('Wakeup failed');
    }
});

const TMDB_API_KEYS = [
    '439c478a771f35c05022f9feabcca01c',
    '1865f43a0549ca50d341dd9ab8b29f49',
    'e49339e830e014e414c2b9a71b2d4f82',
    '847a158b5489812f851da8cf02476566',
    'b025d23315a6b0c266cc6cb221a68134'
];

async function getTmdbId(imdbId, type) {
    if (imdbId.startsWith('tmdb:')) {
        return imdbId.split(':')[1];
    }
    
    const id = imdbId.split(':')[0];
    
    if (/^\d+$/.test(id)) {
        return id;
    }
    
    if (id.startsWith('tt')) {
        for (const key of TMDB_API_KEYS) {
            try {
                const res = await axios.get(`https://api.themoviedb.org/3/find/${id}?api_key=${key}&external_source=imdb_id`, { 
                    timeout: 4000,
                    headers: { 'Accept': 'application/json' }
                });
                if (type === 'movie' && res.data && res.data.movie_results && res.data.movie_results.length > 0) {
                    return res.data.movie_results[0].id.toString();
                } else if ((type === 'series' || type === 'tv') && res.data && res.data.tv_results && res.data.tv_results.length > 0) {
                    return res.data.tv_results[0].id.toString();
                }
            } catch (err) {
                // try next key
            }
        }
    }
    
    return null;
}

// Addon builder factory
function createAddon(config) {
    let addonId = 'org.nuvio.metasorter';
    let addonName = 'Chole Bhature';
    
    if (config.provider) {
        addonId = `org.nuvio.metasorter.${config.provider.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        addonName = `Chole Bhature | ${config.provider}`;
    } else if (config.repoName) {
        addonId = `org.nuvio.metasorter.repo.${config.repoName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        addonName = `Chole Bhature | ${config.repoName}`;
    }

    const builder = new addonBuilder({
        id: addonId,
        version: '2.0.0',
        name: addonName,
        description: 'Dynamically loads Nuvio providers, tests stream speed, and sorts them.',
        logo: 'https://em-content.zobj.net/source/twitter/376/shallow-pan-of-food_1f958.png',
        catalogs: [],
        resources: ['stream'],
        types: ['movie', 'series', 'anime', 'tv', 'other'],
        idPrefixes: ['tt', 'tmdb:', 'kitsu:'],
        behaviorHints: { configurable: true, configurationRequired: true }
    });

    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[Stremio] Request for ${type} ${id} (Addon: ${addonName})`);
        
        const cacheKey = `${type}:${id}:${JSON.stringify(config)}`;
        const cached = streamCache.get(cacheKey);
        
        // Helper to generate the force refresh stream
        const getForceRefreshStream = () => {
            if (!config.addonHost) return null;
            return {
                name: '🔄 FORCE REFRESH',
                title: 'Click here to clear the cache, then click Stremio Refresh!',
                externalUrl: `${config.addonProtocol}://${config.addonHost}/${encodeURIComponent(JSON.stringify(config))}/clear-cache/${type}/${id}`
            };
        };

        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            console.log(`[Stremio] Serving cached results for ${type} ${id}`);
            const frStream = getForceRefreshStream();
            return { streams: frStream ? [frStream, ...cached.streams] : cached.streams };
        }

        let imdbId = id;
        let season = null;
        let episode = null;

        if (type === 'series') {
            const parts = id.split(':');
            imdbId = parts[0];
            season = parts[1];
            episode = parts[2];
        }

        const tmdbId = await getTmdbId(imdbId, type);
        if (!tmdbId) {
            console.log('[Stremio] Could not resolve TMDB ID for', imdbId);
            return { streams: [] };
        }

        let manifestUrls = [];
        if (config.repoUrl) {
            manifestUrls = [config.repoUrl];
        } else if (config.urls && Array.isArray(config.urls)) {
            manifestUrls = config.urls;
        } else if (config.url) {
            manifestUrls = [config.url];
        }
        
        if (manifestUrls.length === 0) {
            return { streams: [] };
        }

        let allProviders = [];
        for (const url of manifestUrls) {
            try {
                const providers = await providerLoader.loadProviders(url);
                allProviders = allProviders.concat(providers);
            } catch (e) {
                console.error(`[ProviderLoader] Failed to load from ${url}:`, e.message);
            }
        }
        
        // Filter providers
        if (config.provider) {
            allProviders = allProviders.filter(p => p.name === config.provider);
        } else if (config.disabled && Array.isArray(config.disabled)) {
            allProviders = allProviders.filter(p => !config.disabled.includes(p.name));
        }

        let allStreams = [];

        // Execute all providers in parallel with a timeout of 14 seconds per provider
        const PROVIDER_TIMEOUT_MS = 14000;

        await Promise.all(allProviders.map(async (provider) => {
            try {
                let nuvioType = type;
                if (type === 'series' || type === 'tv') nuvioType = 'tv';
                else if (type === 'movie') nuvioType = 'movie';
                else if (type === 'anime') nuvioType = (season && episode) ? 'tv' : 'movie';
                
                const scrapePromise = provider.getStreams(tmdbId, nuvioType, season, episode, config);
                
                // Timeout promise
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Scrape Timeout')), PROVIDER_TIMEOUT_MS)
                );

                const streams = await Promise.race([scrapePromise, timeoutPromise]);
                
                if (Array.isArray(streams)) {
                    streams.forEach(s => s.name = s.name || provider.name);
                    allStreams = allStreams.concat(streams);
                }
            } catch (err) {
                console.error(`[Provider] ${provider.name} failed or timed out:`, err.message);
            }
        }));

        console.log(`[Stremio] Collected ${allStreams.length} total streams. Testing speeds...`);
        const hostUrl = config.addonHost ? `${config.addonProtocol || 'http'}://${config.addonHost}` : '';
        const sortedAndTaggedStreams = await sortAndTagStreams(allStreams, {
            hideDead: config.hideDead,
            hideSlow: config.hideSlow,
            sortBy: config.sortBy || (config.prioritizeQuality ? 'quality' : 'speed'),
            sortMode: config.sortMode || config.sortBy,
            prioritizeQuality: config.sortBy === 'quality' || config.prioritizeQuality,
            prioritizeHindi: config.prioritizeHindi,
            preferredLanguages: config.preferredLanguages || (config.prioritizeHindi ? ['Hindi', 'Dual-Audio'] : []),
            showSeeders: config.showSeeders !== false,
            enableProxy: config.enableProxy || config.antiBlockProxy
        }, providerAnalytics, hostUrl);

        // Save to cache
        streamCache.set(cacheKey, { timestamp: Date.now(), streams: sortedAndTaggedStreams });

        const frStream = getForceRefreshStream();
        return { streams: frStream ? [frStream, ...sortedAndTaggedStreams] : sortedAndTaggedStreams };
    });

    // No catalogs defined

    return builder.getInterface();
}

const { getRouter } = require('stremio-addon-sdk');

// --- Streaming Reverse Proxy (Anti-Block & Header Preservation) ---
app.get('/proxy/stream', async (req, res) => {
    const { payload, url: rawUrl } = req.query;
    let targetUrl = rawUrl;
    let targetHeaders = {};

    if (payload) {
        try {
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
            targetUrl = decoded.url;
            targetHeaders = decoded.headers || {};
        } catch (e) {
            try {
                const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
                targetUrl = decoded.url;
                targetHeaders = decoded.headers || {};
            } catch (e2) {
                return res.status(400).send('Invalid proxy payload');
            }
        }
    }

    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).send('Missing or invalid target URL');
    }

    try {
        const urlObj = new URL(targetUrl);
        const origin = urlObj.origin;

        const forwardHeaders = {
            'User-Agent': targetHeaders['User-Agent'] || targetHeaders['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': targetHeaders['Referer'] || targetHeaders['referer'] || origin,
            'Origin': targetHeaders['Origin'] || targetHeaders['origin'] || origin,
            'Accept': '*/*',
            'Accept-Encoding': 'identity;q=1, *;q=0'
        };

        // Forward Range header for player seeking (HTTP 206 Partial Content)
        if (req.headers.range) {
            forwardHeaders['Range'] = req.headers.range;
        }

        const axiosRes = await axios({
            method: 'GET',
            url: targetUrl,
            headers: forwardHeaders,
            responseType: 'stream',
            timeout: 15000,
            maxRedirects: 5,
            validateStatus: (status) => status < 500
        });

        res.status(axiosRes.status);

        const headersToForward = [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges',
            'last-modified',
            'etag'
        ];

        headersToForward.forEach(h => {
            if (axiosRes.headers[h]) {
                res.setHeader(h, axiosRes.headers[h]);
            }
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (!axiosRes.headers['accept-ranges']) {
            res.setHeader('Accept-Ranges', 'bytes');
        }

        axiosRes.data.pipe(res);

        req.on('close', () => {
            if (axiosRes.data && typeof axiosRes.data.destroy === 'function') {
                axiosRes.data.destroy();
            }
        });

    } catch (err) {
        console.error('[Proxy Stream Error]', err.message);
        if (!res.headersSent) {
            res.status(502).send(`Proxy streaming error: ${err.message}`);
        }
    }
});

app.get('/:configJSON/clear-cache/:type/:id', (req, res) => {
    const { configJSON, type, id } = req.params;
    try {
        const config = JSON.parse(decodeURIComponent(configJSON));
        config.addonHost = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        config.addonProtocol = protocol.split(',')[0].trim();
        
        const cacheKey = `${type}:${id}:${JSON.stringify(config)}`;
        streamCache.delete(cacheKey);
        console.log(`[Cache] Cleared via browser link for ${type} ${id}`);
        
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Cache Cleared</title>
            <style>
                body { background-color: #09090b; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                h1 { color: #4ade80; }
                p { color: #94a3b8; }
            </style>
        </head>
        <body>
            <h1>✅ Cache Cleared!</h1>
            <p>Closing automatically...</p>
            <script>
                setTimeout(() => {
                    window.close();
                }, 1500);
            </script>
        </body>
        </html>
        `;
        res.status(200).send(html);
    } catch (e) {
        res.status(500).send('Error clearing cache.');
    }
});

app.get('/c/:configId/clear-cache/:type/:id', (req, res) => {
    const { configId, type, id } = req.params;
    try {
        const config = userConfigs.get(configId) || {};
        config.addonHost = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        config.addonProtocol = protocol.split(',')[0].trim();
        config.configId = configId;
        
        const cacheKey = `${type}:${id}:${JSON.stringify(config)}`;
        streamCache.delete(cacheKey);
        for (const k of streamCache.keys()) {
            if (k.includes(configId)) streamCache.delete(k);
        }
        console.log(`[Cache] Cleared via browser link for ${type} ${id} (configId: ${configId})`);
        
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Cache Cleared</title>
            <style>
                body { background-color: #09090b; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                h1 { color: #4ade80; }
                p { color: #94a3b8; }
            </style>
        </head>
        <body>
            <h1>✅ Cache Cleared!</h1>
            <p>Closing automatically...</p>
            <script>
                setTimeout(() => {
                    window.close();
                }, 1500);
            </script>
        </body>
        </html>
        `;
        res.status(200).send(html);
    } catch (e) {
        res.status(500).send('Error clearing cache.');
    }
});

app.use('/c/:configId', (req, res, next) => {
    // Only intercept Stremio API routes
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/catalog/')) {
        try {
            const { configId } = req.params;
            let config = userConfigs.get(configId);
            if (!config) {
                config = { repoUrl: 'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json' };
            }
            config = JSON.parse(JSON.stringify(config)); // clone
            config.configId = configId;
            config.addonHost = req.headers.host;
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            config.addonProtocol = protocol.split(',')[0].trim();
            
            const addonInterface = createAddon(config);
            const router = getRouter(addonInterface);
            return router(req, res, next);
        } catch (err) {
            console.error('[Router Error /c/:configId]', err);
            return res.status(400).send('Invalid configuration');
        }
    }
    next();
});

app.use('/:configJSON', (req, res, next) => {
    // Only intercept Stremio API routes
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/catalog/')) {
        try {
            const config = JSON.parse(decodeURIComponent(req.params.configJSON));
            config.addonHost = req.headers.host;
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            config.addonProtocol = protocol.split(',')[0].trim();
            
            const addonInterface = createAddon(config);
            const router = getRouter(addonInterface);
            
            // Override req.url so the internal router matches /manifest.json or /stream/...
            return router(req, res, next);
        } catch (err) {
            console.error('[Router Error]', err);
            return res.status(400).send('Invalid configuration');
        }
    }
    next();
});

const PORT = process.env.PORT || 7000;
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Stremio Nuvio Meta-Sorter Addon running at http://localhost:${PORT}`);
        console.log(`Configure at http://localhost:${PORT}/configure`);
    });
}

// Export the app for Vercel Serverless Functions
module.exports = app;