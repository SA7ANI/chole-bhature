const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const path = require('path');
const providerLoader = require('./providerLoader');
const { sortAndTagStreams } = require('./streamTester');
const axios = require('axios');

const app = express();

// Serve the configuration page
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.redirect('/configure');
});

app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle Nuvio/Stremio gear icon clicks which append /configure or / to the addon base URL
app.get('/:configJSON/configure', (req, res) => {
    res.redirect('/configure');
});

app.get('/:configJSON', (req, res, next) => {
    // If it's literally just the base config URL, redirect to /configure
    // But don't intercept /api/analytics or other real routes
    if (req.params.configJSON !== 'api' && req.params.configJSON !== 'configure') {
        return res.redirect('/configure');
    }
    next();
});

const streamCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

// TMDB API KEY (borrowed from 4khdhub for converting IMDB to TMDB, or we can use TMDB public APIs)
// A better way is using Stremio's cinemeta or just TMDB API directly.
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // From Nuvio provider

async function getTmdbId(imdbId, type) {
    // If it's already a TMDB id (stremio tmdb addon)
    if (imdbId.startsWith('tmdb:')) {
        return imdbId.split(':')[1];
    }
    
    const id = imdbId.split(':')[0]; // remove season/episode parts if any
    
    // If it's a raw number, assume it's a TMDB ID from Nuvio
    if (/^\d+$/.test(id)) {
        return id;
    }
    
    // For IMDB ids (tt1234567), we can use TMDB's find endpoint
    if (id.startsWith('tt')) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await axios.get(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`, { timeout: 5000 });
                if (type === 'movie' && res.data.movie_results.length > 0) {
                    return res.data.movie_results[0].id.toString();
                } else if (type === 'series' && res.data.tv_results.length > 0) {
                    return res.data.tv_results[0].id.toString();
                }
                break; // Stop retrying if we got a successful response but no matches
            } catch (err) {
                console.error(`[TMDB] Failed to convert IMDB to TMDB (Attempt ${attempt}):`, err.message);
                if (attempt === 3) break;
                // Wait briefly before retrying
                await new Promise(r => setTimeout(r, 500));
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
        catalogs: [
            { type: 'movie', id: 'chole_bhature_trending_movies', name: 'Fastest Streams Today' },
            { type: 'series', id: 'chole_bhature_trending_series', name: 'Fastest Streams Today' }
        ],
        resources: ['stream', 'catalog'],
        types: ['movie', 'series', 'anime', 'tv', 'other'],
        idPrefixes: ['tt', 'tmdb:', 'kitsu:'],
        behaviorHints: { configurable: true, configurationRequired: true }
    });

    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[Stremio] Request for ${type} ${id} (Addon: ${addonName})`);
        
        const cacheKey = `${type}:${id}:${JSON.stringify(config)}`;
        const cached = streamCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            console.log(`[Stremio] Serving cached results for ${type} ${id}`);
            return { streams: cached.streams };
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

        // Execute all providers in parallel with a strict timeout of 10 seconds per provider
        const PROVIDER_TIMEOUT_MS = 10000;

        await Promise.all(allProviders.map(async (provider) => {
            try {
                const nuvioType = type === 'series' ? 'tv' : type;
                
                const scrapePromise = provider.getStreams(tmdbId, nuvioType, season, episode);
                
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
        const sortedAndTaggedStreams = await sortAndTagStreams(allStreams, {
            hideDead: config.hideDead,
            hideSlow: config.hideSlow,
            prioritizeQuality: config.prioritizeQuality
        }, providerAnalytics);

        // Save to cache
        streamCache.set(cacheKey, { timestamp: Date.now(), streams: sortedAndTaggedStreams });

        return { streams: sortedAndTaggedStreams };
    });

    builder.defineCatalogHandler(async ({ type, id }) => {
        console.log(`[Stremio] Catalog request for ${type} ${id}`);
        if (id.startsWith('chole_bhature_trending')) {
            try {
                // Fetch top trending from Stremio Cinemeta
                const cinemetaType = type === 'series' ? 'series' : 'movie';
                const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top/skip=0.json`;
                const response = await axios.get(cinemetaUrl, { timeout: 5000 });
                if (response.data && response.data.metas) {
                    return { metas: response.data.metas };
                }
            } catch (err) {
                console.error('[Catalog] Error fetching Cinemeta:', err.message);
            }
        }
        return { metas: [] };
    });

    return builder.getInterface();
}

const { getRouter } = require('stremio-addon-sdk');

app.use('/:configJSON', (req, res, next) => {
    // Only intercept Stremio API routes
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/')) {
        try {
            const config = JSON.parse(decodeURIComponent(req.params.configJSON));
            const addonInterface = createAddon(config);
            const router = getRouter(addonInterface);
            
            // Override req.url so the internal router matches /manifest.json or /stream/...
            // The router expects the URL to be just the path, but Express preserves the base.
            // Using getRouter on a sub-path is officially supported this way.
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
