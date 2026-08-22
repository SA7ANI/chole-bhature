const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const path = require('path');
const providerLoader = require('./providerLoader');
const { sortAndTagStreams } = require('./streamTester');
const { setDohEnabled, setDohProvider, getDohConfig } = require('./dohResolver');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

// Live Analytics and Quarantine Registries
const providerAnalytics = new Map();
const quarantineRegistry = new Map();

// Core configuration dependency check
if (!fs.existsSync(path.join(__dirname, '.secret'))) {
    console.error("Critical Error: Missing environment dependencies. Ensure all configuration modules are present.");
    process.exit(1);
}

const app = express();
app.use(express.json());

// Anti-Leech & Author Attribution Headers (GNU AGPL-3.0)
app.use((req, res, next) => {
    res.setHeader('X-Powered-By', 'Chole-Bhature (https://github.com/SA7ANI/chole-bhature)');
    res.setHeader('X-Addon-Author', 'SA7ANI (https://github.com/SA7ANI/chole-bhature)');
    res.setHeader('X-Repository', 'https://github.com/SA7ANI/chole-bhature');
    res.setHeader('X-License', 'GNU AGPL-3.0');
    next();
});

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

// PWA Core Endpoints with explicit headers & CORS for WebAPK minting
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get(['/favicon.ico', '/favicon.png'], (req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'public', 'icon-192.png'));
});

['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'logo.png'].forEach((iconFile) => {
    app.get(`/${iconFile}`, (req, res) => {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(path.join(__dirname, 'public', iconFile));
    });
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

app.get(['/', '/configure', '/index.html'], (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
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

// Analytics tracker (already declared at top)

app.get('/api/analytics', (req, res) => {
    const stats = {};
    for (const [provider, data] of providerAnalytics.entries()) {
        stats[provider] = data;
    }
    res.json(stats);
});

// DoH Resolver Status
app.get('/api/doh/status', (req, res) => {
    res.json(getDohConfig());
});

// Proxy endpoint to bypass CORS for frontend manifest loading
app.get('/api/proxy', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).send('Missing url');
        const response = await axios.get(url, { timeout: 8000 });
        res.json(response.data);
    } catch (err) {
        console.error('[Proxy Error]', err.message);
        res.status(500).json({ error: 'Failed to fetch: ' + err.message });
    }
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

// Debrid Resolver Endpoint
app.get('/debrid/:service/:apiKey/:hash', async (req, res) => {
    const { service, apiKey, hash } = req.params;
    
    try {
        if (service === 'realdebrid') {
            // 1. Add Magnet
            const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', `magnet=magnet:?xt=urn:btih:${hash}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const torrentId = addRes.data.id;
            
            // 2. Select Files (All)
            await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 'files=all', {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            // 3. Get Info and grab the first download link
            const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            
            if (infoRes.data && infoRes.data.links && infoRes.data.links.length > 0) {
                // 4. Unrestrict link
                const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${infoRes.data.links[0]}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }
                });
                
                if (unrestrictRes.data && unrestrictRes.data.download) {
                    return res.redirect(302, unrestrictRes.data.download);
                }
            }
        } else if (service === 'alldebrid') {
            // 1. Add Magnet
            const addRes = await axios.get(`https://api.alldebrid.com/v4/magnet/upload?agent=nuvio&apikey=${apiKey}&magnets[]=magnet:?xt=urn:btih:${hash}`);
            const magnetData = addRes.data?.data?.magnets?.[0];
            
            if (magnetData && magnetData.id) {
                // 2. Wait a moment for processing (in a real app we should poll, but here we do a quick timeout)
                await new Promise(r => setTimeout(r, 1000));
                
                const statusRes = await axios.get(`https://api.alldebrid.com/v4/magnet/status?agent=nuvio&apikey=${apiKey}&id=${magnetData.id}`);
                const links = statusRes.data?.data?.magnets?.[0]?.links;
                
                if (links && links.length > 0) {
                    // 3. Unrestrict
                    const unrestrictRes = await axios.get(`https://api.alldebrid.com/v4/link/unlock?agent=nuvio&apikey=${apiKey}&link=${links[0].link}`);
                    if (unrestrictRes.data && unrestrictRes.data.data && unrestrictRes.data.data.link) {
                        return res.redirect(302, unrestrictRes.data.data.link);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Debrid Error]', err.response?.data || err.message);
    }
    
    // Fallback: If debrid fails, redirect to a generic error video or just fail
    res.status(500).send('Debrid resolution failed.');
});

// Addon builder factory
function createAddon(config) {
    if (config && config.enableDoh !== undefined) setDohEnabled(config.enableDoh !== false);
    if (config && config.dohProvider) setDohProvider(config.dohProvider);

    let addonId = 'org.nuvio.metasorter';
    let addonName = 'Chole Bhature';
    
    if (config.provider) {
        addonId = `org.nuvio.metasorter.${config.provider.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        addonName = `Chole Bhature | ${config.provider}`;
    } else if (config.repoName) {
        addonId = `org.nuvio.metasorter.repo.${config.repoName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        addonName = `Chole Bhature | ${config.repoName}`;
    }

    const addonLogo = config.addonHost 
        ? `${config.addonProtocol || 'http'}://${config.addonHost}/icon-512.png?v=3` 
        : 'https://raw.githubusercontent.com/yoruix/nuvio-providers/main/public/icon-512.png?v=3';

    const builder = new addonBuilder({
        id: addonId,
        version: '4.0.0',
        name: addonName,
        description: 'High-Performance Stream Meta-Sorter & Priority Engine for Nuvio & Stremio. Scrapes, verifies, filters dead links, and organizes streams by speed, quality, and language.',
        logo: addonLogo,
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

        const FRESH_TTL_MS = 15 * 60 * 1000; // 15 minutes
        const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

        const fetchAndCacheStreams = async () => {
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
                return [];
            }

            let manifestUrls = [];
            if (config.repoUrl) {
                manifestUrls = [config.repoUrl];
            } else if (config.urls && Array.isArray(config.urls)) {
                manifestUrls = config.urls;
            } else if (config.repos && Array.isArray(config.repos)) {
                manifestUrls = config.repos;
            } else if (config.url) {
                manifestUrls = [config.url];
            }
            
            if (manifestUrls.length === 0) {
                console.log('[Stremio] No repository URLs configured');
                return [];
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

            // Execute all providers in parallel with an increased timeout of 26 seconds per provider
            const PROVIDER_TIMEOUT_MS = 26000;

            await Promise.all(allProviders.map(async (provider) => {
                try {
                    if (config.enableQuarantine !== false) {
                        const qRecord = quarantineRegistry.get(provider.name);
                        if (qRecord && qRecord.quarantineUntil > Date.now()) {
                            console.log(`[Quarantine] Skipping provider ${provider.name} (Quarantined)`);
                            return;
                        }
                    }

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
                    
                    if (config.enableQuarantine !== false) {
                        quarantineRegistry.delete(provider.name);
                    }
                    
                    if (Array.isArray(streams)) {
                        streams.forEach(s => s.name = s.name || provider.name);
                        allStreams = allStreams.concat(streams);
                    }
                } catch (err) {
                    if (config.enableQuarantine !== false) {
                        const qRecord = quarantineRegistry.get(provider.name) || { strikes: 0, quarantineUntil: 0 };
                        qRecord.strikes++;
                        if (qRecord.strikes >= 3) {
                            qRecord.quarantineUntil = Date.now() + (30 * 60 * 1000); // 30 minutes
                            console.error(`[Quarantine] ${provider.name} failed 3 times. Quarantined for 30m.`);
                        }
                        quarantineRegistry.set(provider.name, qRecord);
                    }
                    console.error(`[Provider] ${provider.name} failed or timed out:`, err.message);
                }
            }));

            console.log(`[Stremio] Collected ${allStreams.length} total streams. Testing speeds...`);
            const sortedAndTaggedStreams = await sortAndTagStreams(allStreams, {
                hideDead: config.hideDead,
                hideSlow: config.hideSlow,
                hideCam: config.hideCam || config.blockCam,
                sortBy: config.sortBy || (config.prioritizeQuality ? 'quality' : 'speed'),
                sortMode: config.sortMode || config.sortBy,
                prioritizeQuality: config.sortBy === 'quality' || config.prioritizeQuality,
                prioritizeHindi: config.prioritizeHindi,
                preferredLanguages: config.preferredLanguages || (config.prioritizeHindi ? ['Hindi', 'Dual-Audio'] : []),
                showSeeders: config.showSeeders !== false,
                deduplicateStreams: config.deduplicateStreams !== false,
                debridProvider: config.debridProvider,
                debridApiKey: config.debridApiKey,
                addonHost: config.addonHost,
                addonProtocol: config.addonProtocol
            }, providerAnalytics);

            // Save to cache
            streamCache.set(cacheKey, { timestamp: Date.now(), streams: sortedAndTaggedStreams });
            return sortedAndTaggedStreams;
        };

        if (cached && Date.now() - cached.timestamp < STALE_TTL_MS) {
            console.log(`[Stremio] Serving cached results for ${type} ${id}`);
            
            // Stale-While-Revalidate
            if (Date.now() - cached.timestamp > FRESH_TTL_MS) {
                console.log(`[Stremio] Cache is stale, revalidating in background for ${type} ${id}`);
                fetchAndCacheStreams().catch(e => console.error('[Background Fetch Error]', e));
            }
            
            const frStream = getForceRefreshStream();
            return { streams: frStream ? [frStream, ...cached.streams] : cached.streams };
        }

        const sortedAndTaggedStreams = await fetchAndCacheStreams();
        const frStream = getForceRefreshStream();
        return { streams: frStream ? [frStream, ...sortedAndTaggedStreams] : sortedAndTaggedStreams };
    });

    // No catalogs defined

    return builder.getInterface();
}

const { getRouter } = require('stremio-addon-sdk');

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
        console.log(`
========================================================================
  🌶️  CHOLE BHATURE • Meta-Sorter & Priority Engine v4.0.0
  ⚡  Created by SA7ANI | https://github.com/SA7ANI/chole-bhature
  🛡️  Licensed under GNU AGPL-3.0 • Attribution Required
========================================================================
  🚀 Local Sorter Server: http://localhost:${PORT}
  ⚙️  Configuration UI:    http://localhost:${PORT}/configure
========================================================================
        `);
    });
}

// Export the app for Vercel Serverless Functions
module.exports = app;

