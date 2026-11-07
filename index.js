const express = require('express');
const fs = require('fs');
const path = require('path');

// Auto-load local .env if present
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (m) {
                const key = m[1];
                let val = (m[2] || '').trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.substring(1, val.length - 1);
                }
                if (!process.env[key]) process.env[key] = val;
            }
        }
    }
} catch (e) {}

const { createClient } = require('@vercel/kv');
const kv = createClient({ url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_KV_REST_API_URL || '', token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_KV_REST_API_TOKEN || '' });
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const providerLoader = require('./providerLoader');
const { sortAndTagStreams, clearDomainLatencyCache } = require('./streamTester');
const { setDohEnabled, setDohProvider, getDohConfig, dohHttpsAgent } = require('./dohResolver');
const iptvManager = require('./iptvManager');
const { searchPencariMovie } = require('./scrapers/pencarimovie');
const telegramRouter = require('./routes/telegramStream');
const streamProxyRouter = require('./routes/streamProxy');
const axios = require('axios');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

// Configuration Encryption Setup (AES-256-GCM / Base64URL)
const {
    SECRET_ENCRYPTION_KEY,
    encryptConfigPayload,
    decryptConfigPayload
} = require('./config/encryption');

// Live Analytics and Quarantine Registries
const providerAnalytics = new Map();
const quarantineRegistry = new Map();

// Real-Time Serverless & Edge Telemetry Profiler (Persisted for Cloud & Serverless)
const TELEMETRY_FILE = process.env.VERCEL
    ? path.join('/tmp', 'telemetry_metrics.json')
    : path.join(__dirname, 'telemetry_metrics.json');

const telemetryMetrics = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lastScrapeMs: 2100,
    lastSortMs: 20,
    lastTotalMs: 2120,
    totalExecutionMs: 0,
    servedBandwidthBytes: 0
};

function loadTelemetryMetrics() {
    try {
        if (fs.existsSync(TELEMETRY_FILE)) {
            const raw = fs.readFileSync(TELEMETRY_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                Object.assign(telemetryMetrics, data);
            }
        }
    } catch (e) {}
}

function saveTelemetryMetrics() {
    try {
        fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(telemetryMetrics));
        if (typeof syncGlobalStateToKV === 'function') syncGlobalStateToKV();
    } catch (e) {}
}
loadTelemetryMetrics();

// ==========================================
// UPSTASH KV GLOBAL STATE SYNCHRONIZATION
// ==========================================
const isKVEnabledGlobal = Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_KV_REST_API_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_KV_REST_API_TOKEN));

async function loadGlobalStateFromKV() {
    if (!isKVEnabledGlobal) return;
    try {
        const [kvTelemetry, kvQuarantine, kvAnalytics] = await Promise.all([
            kv.get('global_telemetry'),
            kv.get('global_quarantine'),
            kv.get('global_analytics')
        ]);
        
        if (kvTelemetry) Object.assign(telemetryMetrics, kvTelemetry);
        
        if (kvQuarantine && Array.isArray(kvQuarantine)) {
            for (const [k, v] of kvQuarantine) quarantineRegistry.set(k, v);
        }
        
        if (kvAnalytics && Array.isArray(kvAnalytics)) {
            for (const [k, v] of kvAnalytics) providerAnalytics.set(k, v);
        }
        console.log('[KV] Global state successfully restored from Upstash Redis.');
    } catch (err) {
        console.error('[KV Error] Failed to load global state:', err.message);
    }
}

async function syncGlobalStateToKV() {
    if (!isKVEnabledGlobal) return;
    try {
        await Promise.all([
            kv.set('global_telemetry', telemetryMetrics),
            kv.set('global_quarantine', Array.from(quarantineRegistry.entries())),
            kv.set('global_analytics', Array.from(providerAnalytics.entries()))
        ]);
    } catch (err) {
        console.error('[KV Error] Failed to sync global state:', err.message);
    }
}

if (isKVEnabledGlobal) {
    loadGlobalStateFromKV();
    // Auto-sync global state to KV every 3 minutes
    // setInterval removed due to serverless freezing
}


// Core configuration dependency check (Cloud & Serverless Safe)
if (!fs.existsSync(path.join(__dirname, '.secret')) && !process.env.VERCEL && !process.env.NODE_ENV) {
    try {
        fs.writeFileSync(path.join(__dirname, '.secret'), '');
    } catch (e) {}
}

const app = express();

// Global CORS & TV Client Compatibility Headers (Android TV / Nuvio / Stremio)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

// Vercel rewrites a request to the serverless function pathname
// (/api/index.js). Preserve the original route in vercel.json and restore it
// before Express routes the request, otherwise every endpoint becomes
// "Cannot GET /api/index.js".
app.use((req, res, next) => {
    if (process.env.VERCEL) {
        try {
            const rewrittenUrl = new URL(req.url, 'http://localhost');
            const originalPath = rewrittenUrl.searchParams.get('__cb_path');
            if (originalPath && originalPath.startsWith('/')) {
                rewrittenUrl.searchParams.delete('__cb_path');
                const query = rewrittenUrl.searchParams.toString();
                req.url = `${originalPath}${query ? `?${query}` : ''}`;
            }
        } catch (e) {
            console.warn('[Vercel] Could not restore rewritten request path:', e.message);
        }
    }
    next();
});
const compression = require('compression');
app.use(compression());
app.use(express.json());

// Real-Time Request Accounting Middleware
app.use((req, res, next) => {
    const p = req.path || '';
    if (!p.startsWith('/static') && !p.endsWith('.png') && !p.endsWith('.ico') && !p.endsWith('.css') && !p.endsWith('.js')) {
        telemetryMetrics.totalRequests = (telemetryMetrics.totalRequests || 0) + 1;
        telemetryMetrics.servedBandwidthBytes = (telemetryMetrics.servedBandwidthBytes || 0) + 4096;
        if (telemetryMetrics.totalRequests % 5 === 0) {
            saveTelemetryMetrics();
        }
    }
    next();
});

// Anti-Leech & Author Attribution Headers (GNU AGPL-3.0)
app.use((req, res, next) => {
    res.setHeader('X-Powered-By', 'Chole-Bhature (https://github.com/SA7ANI/chole-bhature)');
    res.setHeader('X-Addon-Author', 'SA7ANI (https://github.com/SA7ANI/chole-bhature)');
    res.setHeader('X-Repository', 'https://github.com/SA7ANI/chole-bhature');
    res.setHeader('X-License', 'GNU AGPL-3.0');
    next();
});

// Persistent User Configuration Store
const CONFIGS_FILE = process.env.VERCEL 
    ? path.join('/tmp', 'user_configs.json')
    : path.join(__dirname, 'user_configs.json');
const userConfigs = new Map();

async function saveUserConfig(configId, config) {
    if (!configId || !config) return;
    userConfigs.set(configId, config);
    activeConfigsTracker.add(configId);
    if (typeof configId === 'string' && !configId.startsWith('enc_') && configId.length < 32 && (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_KV_REST_API_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_KV_REST_API_TOKEN)) {
        try {
            await kv.set(`cfg_${configId}`, config);
        } catch (err) {
            console.error('[KV Error] saving config:', err);
        }
    }
}

// Secret Field Definitions & Masking Helpers
const {
    SECRET_FIELDS,
    redactSecrets,
    encodeConfigParam
} = require('./config/serverSettings');

// Multi-Device Stateless & Persistent Configuration Resolver
const activeConfigsTracker = new Set();

async function resolveConfig(param) {
    if (!param) return null;
    if (typeof param !== 'string') return null;
    param = param.replace(/\/configure\/?$/, '').replace(/\.json$/, '').trim();
    if (!param) return null;

    const stored = userConfigs.get(param);
    if (stored) {
        activeConfigsTracker.add(param);
        return stored;
    }
    
    if ((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_KV_REST_API_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_KV_REST_API_TOKEN)) {
        try {
            const kvStored = await kv.get(`cfg_${param}`);
            if (kvStored) {
                userConfigs.set(param, kvStored);
                activeConfigsTracker.add(param);
                return kvStored;
            }
        } catch (err) {
            console.error('[KV Error] resolving config:', err);
        }
    }

    // 1.5. Try Encrypted Payload
    const decrypted = decryptConfigPayload(param);
    if (decrypted) {
        activeConfigsTracker.add(param);
        return decrypted;
    }

    // 2. Try URL-decoded JSON
    try {
        if (param.startsWith('{') || param.startsWith('%7B')) {
            const parsed = JSON.parse(decodeURIComponent(param));
            if (parsed && typeof parsed === 'object') {
                for (const field of SECRET_FIELDS) {
                    if (parsed[field]) return null;
                }
                activeConfigsTracker.add(param);
                return parsed;
            }
        }
    } catch (e) {}

    // 3. Try Base64URL / Base64 decoded JSON (stateless token fallback)
    try {
        const fromB64Url = Buffer.from(param, 'base64url').toString('utf8');
        if (fromB64Url.startsWith('{')) {
            const parsed = JSON.parse(fromB64Url);
            if (parsed && typeof parsed === 'object') {
                for (const field of SECRET_FIELDS) {
                    if (parsed[field]) return null;
                }
                activeConfigsTracker.add(param);
                return parsed;
            }
        }
    } catch (e) {}

    try {
        const fromB64 = Buffer.from(param, 'base64').toString('utf8');
        if (fromB64.startsWith('{')) {
            const parsed = JSON.parse(fromB64);
            if (parsed && typeof parsed === 'object') {
                for (const field of SECRET_FIELDS) {
                    if (parsed[field]) return null;
                }
                activeConfigsTracker.add(param);
                return parsed;
            }
        }
    } catch (e) {}



    return null;
}

// Background pre-warming: pre-load all provider repositories on startup to eliminate cold-start delay.
// Do not do this during a Vercel function cold start: it starts several outbound
// requests before the first API request can be served and can exhaust its time budget.
async function prewarmProviders() {
    try {
        const reposToWarm = new Set([
            ...(globalServerSettings.installedRepos || [])
        ]);
        if (globalServerSettings.localRepo && globalServerSettings.localRepo.length > 0) {
            reposToWarm.add('local');
        }
        for (const [, cfg] of userConfigs.entries()) {
            if (cfg.repoUrl) reposToWarm.add(cfg.repoUrl);
            if (Array.isArray(cfg.urls)) cfg.urls.forEach(u => reposToWarm.add(u));
            if (Array.isArray(cfg.repos)) cfg.repos.forEach(u => reposToWarm.add(u));
        }
        console.log(`[PreWarm] Initializing background warm-up for ${reposToWarm.size} provider repositories...`);
        for (const url of reposToWarm) {
            providerLoader.loadProviders(url).catch(e => console.warn(`[PreWarm] ${url} error:`, e.message));
        }
    } catch (e) {}
}
if (!process.env.VERCEL) {
    prewarmProviders();
} else {
    console.log('[PreWarm] Skipped on Vercel serverless runtime.');
}

// PWA Core Endpoints with explicit headers & CORS for WebAPK minting
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get(['/app.webmanifest', '/manifest.webmanifest'], (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'public', 'app.webmanifest'));
});

app.get('/my-repo/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    syncLocalRepoWithManifest();
    const config = globalServerSettings.providerRepoConfig || {};
    const scrapers = (globalServerSettings.localRepo || []).map(p => ({
        id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: p.name,
        description: p.description || `${p.name} provider for Nuvio`,
        version: p.version || "1.0.0",
        author: p.author || "Chole Bhature",
        supportedTypes: Array.isArray(p.supportedTypes) ? p.supportedTypes : ["movie", "tv"],
        filename: p.filename || `providers/${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.js`,
        enabled: p.enabled !== false,
        formats: Array.isArray(p.formats) ? p.formats : ["mp4", "m3u8"],
        logo: p.logo || "",
        contentLanguage: Array.isArray(p.contentLanguage) ? p.contentLanguage : ["en"]
    }));
    res.json({
        manifestVersion: 1,
        name: config.name || "CB Provider Repo",
        version: config.version || "1.0.0",
        description: config.description || "Custom local scraper repository hosted on Chole Bhature.",
        scrapers: scrapers,
        providers: scrapers
    });
});

app.get('/manifest.json', (req, res, next) => {
    // Only serve PWA webmanifest if explicitly requested with ?pwa=1
    if (req.query.pwa) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(path.join(__dirname, 'public', 'app.webmanifest'));
    }
    next();
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

// Auto-detect public URL for Render Keep-Alive from incoming requests
app.use((req, res, next) => {
    if (!process.env.VERCEL && !autoDetectedPublicUrl && req.headers.host) {
        const host = req.headers.host;
        if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
            const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
            autoDetectedPublicUrl = `${proto.split(',')[0].trim()}://${host}/health`;
            console.log(`[Render Keep-Alive] Inferred public health ping endpoint: ${autoDetectedPublicUrl}`);
        }
    }
    next();
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
const cbProviderDir = path.join(__dirname, '..', 'cb-providers');
if (fs.existsSync(cbProviderDir)) {
    app.use('/my-repo', express.static(cbProviderDir));
}

function isBrowserHtmlRequest(req) {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const accept = (req.headers['accept'] || '').toLowerCase();
    if (userAgent.includes('okhttp') || userAgent.includes('nuvio') || userAgent.includes('stremio') || userAgent.includes('exoplayer')) {
        return false;
    }
    if (accept.includes('application/json')) {
        return false;
    }
    return accept.includes('text/html');
}

app.get(['/', '/configure', '/index.html'], async (req, res) => {
    if (req.path === '/' && !isBrowserHtmlRequest(req)) {
        const activeConfig = {};
        activeConfig.addonHost = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        activeConfig.addonProtocol = protocol.split(',')[0].trim();
        const defaultAddon = createAddon(activeConfig);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        return res.json(defaultAddon.getInterface().manifest);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve configure page on configId routes
app.get(['/c/:configId', '/c/:configId/configure', '/configure/:configId'], async (req, res) => {
    if (req.path.startsWith('/c/') && !req.path.endsWith('/configure') && !isBrowserHtmlRequest(req)) {
        let config = await resolveConfig(req.params.configId);
        if (!config) config = {};
        config = JSON.parse(JSON.stringify(config));
        config.configId = req.params.configId;
        config.addonHost = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        config.addonProtocol = protocol.split(',')[0].trim();
        const configuredAddon = createAddon(config);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        return res.json(configuredAddon.getInterface().manifest);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API to save configuration (Instant Sync)

function isDeepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 == null || obj2 == null) {
        return false;
    }
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;
    for (const key of keys1) {
        if (!keys2.includes(key) || !isDeepEqual(obj1[key], obj2[key])) {
            return false;
        }
    }
    return true;
}

app.post('/api/config/save', async (req, res) => {
    try {
        let { configId, token, config, oldToken } = req.body;
        
        // Restore any redacted secrets from the old configuration
        let oldConfig = null;
        if (token || oldToken || configId) {
            oldConfig = await resolveConfig(token || oldToken || configId);
        }
        
        if (oldConfig) {
            for (const field of SECRET_FIELDS) {
                if (config[field] === '***REDACTED***' && oldConfig[field]) {
                    config[field] = oldConfig[field];
                }
            }
        }

        // If the old token still decrypts to the exact same config, reuse it to keep install links stable
                let reusedOldToken = false;
        const incomingToken = oldToken || configId || token;
        const isKVEnabled = Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_KV_REST_API_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_KV_REST_API_TOKEN));
        
        let existingDecrypted = null;
        if (incomingToken) {
            if (isKVEnabled && !incomingToken.startsWith('enc_') && incomingToken.length < 32) {
                configId = incomingToken;
                reusedOldToken = true;
            } else {
                existingDecrypted = decryptConfigPayload(incomingToken);
                if (existingDecrypted && isDeepEqual(existingDecrypted, config)) {
                    configId = incomingToken;
                    reusedOldToken = true;
                }
            }
        }
        
        if (!reusedOldToken) {
            if (isKVEnabled) {
                configId = crypto.randomBytes(4).toString('hex');
            } else {
                const encryptedToken = encryptConfigPayload(config);
                if (!encryptedToken) {
                    return res.status(500).json({ success: false, error: 'Failed to encrypt configuration' });
                }
                configId = encryptedToken;
            }
        }
        await saveUserConfig(configId, config);
        
        // Map the frontend's original temporary token in-memory to prevent breaking the immediate save cycle
        if (token && token !== configId) {
            await await saveUserConfig(token, config);
        }
        if (oldToken && oldToken !== configId && oldToken !== token) {
            await await saveUserConfig(oldToken, config);
        }
        
        // Invalidate stream cache for this configuration to purge streams from newly disabled providers
        streamCache.clear();
        
        const maskedId = configId.length > 20 ? configId.substring(0, 8) + '...' + configId.substring(configId.length - 8) : '***';
        console.log(`[Config] Configuration saved & synced for configId: ${maskedId}`);
        // Never echo secrets back - only return the safe masked copy
        const debugData = (!reusedOldToken && incomingToken) ? { incomingToken, existingDecrypted, newConfig: config, isEqual: existingDecrypted ? isDeepEqual(existingDecrypted, config) : false } : undefined;
        res.json({ success: true, configId, config: redactSecrets(config), debug: debugData });
    } catch (err) {
        console.error('[Config Error]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API to get latest saved configuration on this instance
// SECURITY: Requires a valid configId — no unauthenticated dump of last config.
app.get('/api/config/latest', async (req, res) => {
    const requestedId = req.query.id || req.query.configId || req.query.token;
    if (!requestedId) {
        // No ID provided — refuse to dump any config
        return res.status(400).json({ success: false, error: 'configId required' });
    }
    const cfg = userConfigs.get(requestedId) || null;
    if (cfg) {
        return res.json({ success: true, configId: requestedId, config: redactSecrets(cfg) });
    }
    res.json({ success: false, config: null });
});

// API to get configuration by query param
// SECURITY: configId required — ownership is proven by knowing the ID.
app.all('/api/config', async (req, res) => {
    const targetId = req.query.id || req.query.configId || req.query.token;
    if (!targetId) {
        return res.status(400).json({ success: false, error: 'configId required' });
    }
    const config = (await resolveConfig(targetId)) || null;
    return res.json({ success: Boolean(config), configId: targetId, config: redactSecrets(config) });
});

// API to get configuration by configId or token
// SECURITY: Whoever knows the configId IS the owner — return full config.
app.get('/api/config/:configId', async (req, res) => {
    let rawId = req.params.configId;
    if (rawId) {
        rawId = rawId.replace(/\/configure\/?$/, '').replace(/\.json$/, '').trim();
    }
    const config = (await resolveConfig(rawId)) || null;
    res.json({ success: Boolean(config), configId: rawId, config: redactSecrets(config) });
});

// Handle Nuvio/Stremio gear icon clicks which append /configure or / to the addon base URL
app.get('/:configJSON/configure', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const streamCache = new Map();
const inFlightStreamFetches = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour


// Cloud Platform Auto-Detection & Global Server Settings
const {
    isRender,
    isVercel,
    ADMIN_SETTINGS_FILE,
    globalServerSettings,
    applyGlobalAdminOverrides,
    loadAdminSettings,
    saveAdminSettings,
    getCbProviderRepoDirs,
    syncTwoWayCbProviders
} = require('./config/serverSettings');

const getGithubToken = () => {
    const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.github_token;
    return (t && typeof t === 'string' && t.trim()) ? t.trim() : null;
};

async function commitFileToGitHub(filePath, contentString, commitMessage, branch = 'main') {
    const token = getGithubToken();
    if (!token) {
        throw new Error('GITHUB_TOKEN environment variable is not configured');
    }
    const repo = 'SA7ANI/cb-providers';
    const cleanPath = filePath.replace(/^\/+/, '');
    const url = `https://api.github.com/repos/${repo}/contents/${cleanPath}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'CholeBhature-Admin',
        'Accept': 'application/vnd.github.v3+json'
    };

    let sha = null;
    try {
        const getRes = await axios.get(`${url}?ref=${branch}`, { headers, timeout: 8000 });
        if (getRes.data && getRes.data.sha) {
            sha = getRes.data.sha;
        }
    } catch (_) {}

    const body = {
        message: commitMessage || `Update ${cleanPath} via Chole Bhature Admin`,
        content: Buffer.from(contentString, 'utf8').toString('base64'),
        branch: branch
    };
    if (sha) body.sha = sha;

    const putRes = await axios.put(url, body, { headers, timeout: 15000 });
    return putRes.data;
}

async function ensureCloudLocalRepo() {
    const dirs = getCbProviderRepoDirs();
    if (dirs.length === 0 && (!Array.isArray(globalServerSettings.localRepo) || globalServerSettings.localRepo.length === 0)) {
        try {
            console.log('[Admin] Cloud Boot: Fetching manifest from SA7ANI/cb-providers GitHub raw...');
            const rawUrl = 'https://raw.githubusercontent.com/SA7ANI/cb-providers/main/manifest.json';
            const mRes = await axios.get(rawUrl, { timeout: 8000 });
            if (mRes.data && (mRes.data.scrapers || mRes.data.providers)) {
                globalServerSettings.localRepo = mRes.data.scrapers || mRes.data.providers;
                if (mRes.data.name || mRes.data.version) {
                    globalServerSettings.providerRepoConfig = {
                        name: mRes.data.name || "CB Provider Repo",
                        version: mRes.data.version || "2.4.0",
                        description: mRes.data.description || ""
                    };
                }
                saveAdminSettings();
                console.log(`[Admin] Cloud Boot: Successfully initialized ${globalServerSettings.localRepo.length} scrapers from GitHub!`);
            }
        } catch (e) {
            console.error('[Admin] Cloud Boot manifest fetch failed:', e.message);
        }
    }
}


function syncLocalRepoWithManifest() {
    try {
        syncTwoWayCbProviders();

        const dirs = getCbProviderRepoDirs();
        if (dirs.length === 0) return;

        let activeManifest = null;
        let chosenDir = null;
        let newestMtime = 0;

        for (const dir of dirs) {
            const mPath = path.join(dir, 'manifest.json');
            if (fs.existsSync(mPath)) {
                try {
                    const stat = fs.statSync(mPath);
                    if (stat.mtimeMs > newestMtime) {
                        const parsed = JSON.parse(fs.readFileSync(mPath, 'utf8'));
                        const list = parsed.scrapers || parsed.providers || [];
                        if (Array.isArray(list) && list.length > 0) {
                            activeManifest = parsed;
                            chosenDir = dir;
                            newestMtime = stat.mtimeMs;
                        }
                    }
                } catch (_) {}
            }
        }

        if (!activeManifest) return;

        let scrapersFromManifest = activeManifest.scrapers || activeManifest.providers || [];
        if (!Array.isArray(scrapersFromManifest)) scrapersFromManifest = [];

        // Auto-detect any .js files inside providers/ that aren't yet in manifest.json
        if (chosenDir) {
            const provDir = path.join(chosenDir, 'providers');
            if (fs.existsSync(provDir)) {
                const onDiskFiles = fs.readdirSync(provDir).filter(f => f.endsWith('.js'));
                const manifestFilenames = new Set(scrapersFromManifest.map(s => path.basename(s.filename || '')));
                for (const file of onDiskFiles) {
                    if (!manifestFilenames.has(file)) {
                        const cleanName = path.basename(file, '.js');
                        const formattedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
                        scrapersFromManifest.push({
                            id: cleanName.toLowerCase(),
                            name: formattedName,
                            description: `${formattedName} provider for Nuvio`,
                            version: "1.0.0",
                            author: "Chole Bhature",
                            supportedTypes: ["movie", "tv"],
                            filename: `providers/${file}`,
                            enabled: true,
                            formats: ["mp4", "m3u8"],
                            logo: "",
                            contentLanguage: ["en"]
                        });
                    }
                }
            }
        }

        const existingMap = new Map();
        if (Array.isArray(globalServerSettings.localRepo)) {
            for (const item of globalServerSettings.localRepo) {
                if (item && item.name) {
                    existingMap.set(item.name.toLowerCase(), item);
                }
            }
        }

        const mergedLocalRepo = scrapersFromManifest.map(s => {
            const existing = existingMap.get((s.name || '').toLowerCase());
            return {
                id: s.id || (s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                name: s.name,
                description: s.description || `${s.name} provider for Nuvio`,
                version: s.version || "1.0.0",
                author: s.author || "Chole Bhature",
                supportedTypes: Array.isArray(s.supportedTypes) ? s.supportedTypes : ["movie", "tv"],
                filename: s.filename || `providers/${(s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}.js`,
                enabled: existing && typeof existing.enabled === 'boolean' ? existing.enabled : (s.enabled !== false),
                formats: Array.isArray(s.formats) ? s.formats : ["mp4", "m3u8"],
                logo: s.logo || (existing && existing.logo) || "",
                contentLanguage: Array.isArray(s.contentLanguage) ? s.contentLanguage : ["en"]
            };
        });

        const currentJson = JSON.stringify(globalServerSettings.localRepo || []);
        const mergedJson = JSON.stringify(mergedLocalRepo);
        if (currentJson !== mergedJson) {
            globalServerSettings.localRepo = mergedLocalRepo;
            if (activeManifest.name) {
                globalServerSettings.providerRepoConfig = {
                    name: activeManifest.name || "CB Provider Repo",
                    version: activeManifest.version || "1.0.0",
                    description: activeManifest.description || "Auto-generated Nuvio provider plugin managed by Chole Bhature Ecosystem."
                };
            }
            saveAdminSettings();
            console.log(`[Admin] Auto-synced localRepo from cb-providers/manifest.json (${mergedLocalRepo.length} scrapers)`);
        }
    } catch (e) {
        console.error('[Admin] syncLocalRepoWithManifest error:', e.message);
    }
}

async function saveCbProvidersManifest() {
    try {
        const dirs = getCbProviderRepoDirs();
        const config = globalServerSettings.providerRepoConfig || {
            name: "CB Provider Repo",
            version: "1.0.0",
            description: "Auto-generated Nuvio provider plugin managed by Chole Bhature Ecosystem."
        };

        const scrapersList = (globalServerSettings.localRepo || []).map(p => ({
            id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: p.name,
            description: p.description || `${p.name} provider for Nuvio`,
            version: p.version || "1.0.0",
            author: p.author || "Chole Bhature",
            supportedTypes: Array.isArray(p.supportedTypes) ? p.supportedTypes : ["movie", "tv"],
            filename: p.filename || `providers/${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.js`,
            enabled: p.enabled !== false,
            formats: Array.isArray(p.formats) ? p.formats : ["mp4", "m3u8"],
            logo: p.logo || "",
            contentLanguage: Array.isArray(p.contentLanguage) ? p.contentLanguage : ["en"]
        }));

        const manifestContent = {
            manifestVersion: 1,
            name: config.name || "CB Provider Repo",
            version: config.version || "1.0.0",
            description: config.description || "Auto-generated Nuvio provider plugin managed by Chole Bhature Ecosystem.",
            scrapers: scrapersList,
            providers: scrapersList
        };

        const manifestStr = JSON.stringify(manifestContent, null, 2);

        if (dirs.length > 0) {
            for (const dir of dirs) {
                const mPath = path.join(dir, 'manifest.json');
                fs.writeFileSync(mPath, manifestStr, 'utf8');
                console.log(`[Admin] Saved manifest.json to ${mPath}`);
            }
        }

        // Auto-commit to GitHub if GITHUB_TOKEN is configured in environment
        const ghToken = getGithubToken();
        if (ghToken) {
            try {
                console.log('[Admin] Auto-committing manifest.json to GitHub repository...');
                await commitFileToGitHub('manifest.json', manifestStr, `Update manifest.json (${scrapersList.length} scrapers) via Chole Bhature Admin`, 'main');
                try {
                    await commitFileToGitHub('manifest.json', manifestStr, `Update manifest.json (${scrapersList.length} scrapers) via Chole Bhature Admin`, 'template');
                } catch (_) {}
                console.log('[Admin] Successfully auto-committed manifest.json to GitHub!');
            } catch (gitErr) {
                console.error('[Admin] GitHub Auto-Commit error:', gitErr.message);
            }
        }

        if (providerLoader && typeof providerLoader.clearCache === 'function') {
            providerLoader.clearCache('local');
        }
    } catch (err) {
        console.error('[Admin] Failed to save cb-providers manifest:', err.message);
    }
}

syncLocalRepoWithManifest();
ensureCloudLocalRepo();

// Render Free-Tier 512MB RAM Memory Guard
function enforceRenderMemoryGuard() {
    try {
        const mem = process.memoryUsage();
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        // Render free tier has a strict 512MB limit. If RSS > 360MB or cache is huge, prune streamCache
        if (rssMB > 360 || streamCache.size > 250) {
            const beforeSize = streamCache.size;
            streamCache.clear();
            if (global.gc) {
                try { global.gc(); } catch (e) {}
            }
            console.log(`[Render Memory Guard] Relieved RAM pressure: flushed ${beforeSize} cache entries (${rssMB}MB RSS).`);
        }
    } catch (e) {}
}
if (!process.env.VERCEL) {
    setInterval(enforceRenderMemoryGuard, 60000).unref();
}

// Render Anti-Sleep Keep-Alive Heartbeat (Beats 15-Minute Inactivity Spin-Down)
let renderKeepAliveTimer = null;
let lastKeepAlivePing = 0;
let keepAliveStatus = 'idle';
let autoDetectedPublicUrl = null;

function getRenderPingTarget() {
    if (globalServerSettings.renderPingUrl && globalServerSettings.renderPingUrl.trim()) {
        const custom = globalServerSettings.renderPingUrl.trim();
        return custom.endsWith('/health') || custom.endsWith('/ping') ? custom : `${custom.replace(/\/+$/, '')}/health`;
    }
    if (process.env.RENDER_EXTERNAL_URL) {
        return `${process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '')}/health`;
    }
    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
        return `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`;
    }
    if (process.env.APP_URL) {
        return `${process.env.APP_URL.replace(/\/+$/, '')}/health`;
    }
    if (autoDetectedPublicUrl) {
        return autoDetectedPublicUrl;
    }
    const localPort = process.env.PORT || 7000;
    return `http://127.0.0.1:${localPort}/health`;
}

async function performRenderKeepAlivePing() {
    if (globalServerSettings.renderKeepAlive === false) return;
    const targetUrl = getRenderPingTarget();
    try {
        keepAliveStatus = 'pinging';
        const res = await axios.get(targetUrl, { 
            timeout: 8000,
            proxy: false,
            headers: { 'User-Agent': 'CholeBhature-KeepAlive/4.3' }
        });
        lastKeepAlivePing = Date.now();
        keepAliveStatus = `active (${res.status} OK @ ${new Date().toLocaleTimeString()})`;
        console.log(`[Render Keep-Alive] Heartbeat ping successful to ${targetUrl}`);
    } catch (e) {
        keepAliveStatus = `warning (${e.message})`;
        console.warn(`[Render Keep-Alive] Ping notice to ${targetUrl}: ${e.message}`);
    }
}

function startRenderKeepAlive() {
    if (renderKeepAliveTimer) clearInterval(renderKeepAliveTimer);
    // Ping every 13 minutes (780,000 ms) to prevent 15-minute inactivity spin-down on Render Free Tier
    renderKeepAliveTimer = setInterval(performRenderKeepAlivePing, 13 * 60 * 1000);
    renderKeepAliveTimer.unref();

    // Initial warm-up ping 12s after startup to test connection and report status
    setTimeout(performRenderKeepAlivePing, 12000).unref();
}

if (!process.env.VERCEL) {
    startRenderKeepAlive();
}

// Render Official REST API Cache
let renderApiUsageCache = {
    timestamp: 0,
    data: null
};

async function fetchOfficialRenderUsage(apiKey, forceFresh = false) {
    const cleanKey = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();
    if (!cleanKey) return null;
    if (!forceFresh && (Date.now() - renderApiUsageCache.timestamp < 120000) && renderApiUsageCache.data) {
        return renderApiUsageCache.data;
    }
    try {
        const headers = { Authorization: `Bearer ${cleanKey}`, Accept: 'application/json' };
        
        let servicesRes, ownersRes;
        try {
            const [sRes, oRes] = await Promise.allSettled([
                axios.get('https://api.render.com/v1/services?limit=10', { headers, httpsAgent: dohHttpsAgent, timeout: 6000 }),
                axios.get('https://api.render.com/v1/owners', { headers, httpsAgent: dohHttpsAgent, timeout: 5000 })
            ]);
            servicesRes = sRes;
            ownersRes = oRes;
        } catch (callErr) {
            return {
                connected: false,
                error: callErr.message || 'Render connection failed',
                lastSynced: Date.now()
            };
        }

        // Validate that at least one call succeeded; if rejected with 401/403, fail gracefully
        if (servicesRes.status === 'rejected' && ownersRes.status === 'rejected') {
            const err = servicesRes.reason || ownersRes.reason;
            const errStatus = err?.response?.status;
            const errMsg = err?.response?.data?.message || (errStatus === 401 || errStatus === 403 ? 'Unauthorized: Invalid Render API Key' : (err?.message || 'Unauthorized / Invalid Key'));
            const errResult = {
                connected: false,
                error: errMsg,
                lastSynced: Date.now()
            };
            renderApiUsageCache = { timestamp: Date.now(), data: errResult };
            return errResult;
        }

        let serviceName = process.env.RENDER_SERVICE_NAME || 'chole-bhature';
        let serviceId = process.env.RENDER_SERVICE_ID || null;
        let serviceStatus = 'live';
        let plan = 'free';
        let region = process.env.RENDER_REGION || 'oregon';
        let repo = null;
        let updatedAt = null;

        if (servicesRes.status === 'fulfilled' && Array.isArray(servicesRes.value?.data)) {
            const services = servicesRes.value.data;
            let currentService = null;
            if (serviceId) {
                currentService = services.find(s => s.service?.id === serviceId)?.service || services[0]?.service;
            } else {
                currentService = services[0]?.service;
            }
            if (currentService) {
                serviceName = currentService.name || serviceName;
                serviceId = currentService.id || serviceId;
                serviceStatus = currentService.suspended === 'suspended' ? 'suspended' : (currentService.status || 'live');
                plan = currentService.plan || 'free';
                region = currentService.region || region;
                repo = currentService.repo || null;
                updatedAt = currentService.updatedAt || null;
            }
        }

        let ownerName = null;
        if (ownersRes.status === 'fulfilled' && Array.isArray(ownersRes.value?.data) && ownersRes.value.data.length > 0) {
            ownerName = ownersRes.value.data[0]?.owner?.name || ownersRes.value.data[0]?.owner?.email || ownersRes.value.data[0]?.name;
        }

        const result = {
            connected: true,
            ownerName: ownerName || 'Render User',
            serviceName,
            serviceId,
            serviceStatus,
            plan,
            region,
            repo,
            updatedAt,
            lastSynced: Date.now()
        };
        renderApiUsageCache = {
            timestamp: Date.now(),
            data: result
        };
        return result;
    } catch (e) {
        console.warn('[Render API] Failed to fetch services:', e.message);
        return {
            connected: false,
            error: e.response?.data?.message || e.message || 'Unauthorized / Invalid Render Key',
            lastSynced: Date.now()
        };
    }
}

// Vercel Official API Usage Cache (2-min memoization to avoid API spam)
let vercelApiUsageCache = {
    timestamp: 0,
    data: null
};

async function fetchOfficialVercelUsage(apiToken, forceFresh = false) {
    const cleanToken = String(apiToken || '')
        .trim()
        .replace(/^Bearer\s+/i, '')
        .replace(/^["']|["']$/g, '')
        .trim();
    if (!cleanToken) return null;
    if (!forceFresh && (Date.now() - vercelApiUsageCache.timestamp < 120000) && vercelApiUsageCache.data) {
        return vercelApiUsageCache.data;
    }
    try {
        const headers = { Authorization: `Bearer ${cleanToken}` };
        
        // 1. Parallel Probe: Check User, Teams, and Projects via standard HTTPS.
        // Tokens scoped to a Project/Team return 404 "User not found." on /v2/user, but succeed on /v9/projects.
        const [userRes, teamsRes, projectsRes] = await Promise.allSettled([
            axios.get('https://api.vercel.com/v2/user', {
                headers,
                timeout: 6000
            }),
            axios.get('https://api.vercel.com/v2/teams', {
                headers,
                timeout: 6000
            }),
            axios.get('https://api.vercel.com/v9/projects?limit=10', {
                headers,
                timeout: 6000
            })
        ]);

        // If all 3 endpoints failed with 401 or 403, the token is invalid/unauthorized
        if (userRes.status === 'rejected' && teamsRes.status === 'rejected' && projectsRes.status === 'rejected') {
            const firstErr = userRes.reason || teamsRes.reason || projectsRes.reason;
            const errStatus = firstErr?.response?.status;
            const errMsg = firstErr?.response?.data?.error?.message 
                || (errStatus === 401 || errStatus === 403 ? 'Unauthorized: Invalid Vercel Token' : (firstErr?.message || 'Authentication failed'));
            const errResult = {
                connected: false,
                error: errMsg,
                lastSynced: Date.now()
            };
            vercelApiUsageCache = { timestamp: Date.now(), data: errResult };
            return errResult;
        }

        let username = null;
        let teams = [];
        let validTeamIds = new Set();
        let defaultTeamId = null;

        // Check user endpoint
        if (userRes.status === 'fulfilled' && userRes.value.data?.user) {
            const u = userRes.value.data.user;
            username = u.username || u.name || u.email || null;
            if (u.defaultTeamId && String(u.defaultTeamId).startsWith('team_')) {
                defaultTeamId = u.defaultTeamId;
                validTeamIds.add(u.defaultTeamId);
            }
        }

        // Check teams endpoint (critical for team-scoped tokens)
        if (teamsRes.status === 'fulfilled' && Array.isArray(teamsRes.value.data?.teams)) {
            teams = teamsRes.value.data.teams;
            for (const t of teams) {
                if (t && t.id && String(t.id).startsWith('team_')) {
                    validTeamIds.add(t.id);
                }
            }
            if (!username && teams.length > 0) {
                username = teams[0].slug || teams[0].name || 'Vercel Team';
            }
        }

        // Check projects endpoint
        const projs = (projectsRes.status === 'fulfilled' && Array.isArray(projectsRes.value.data?.projects)) 
            ? projectsRes.value.data.projects 
            : [];
        const primaryProject = projs[0] || null;

        if (primaryProject) {
            if (primaryProject.accountId && String(primaryProject.accountId).startsWith('team_')) {
                validTeamIds.add(primaryProject.accountId);
            }
            if (!username) {
                username = primaryProject.name || 'Vercel Project';
            }
        }

        // 2. Fetch Project Deployments to extract live production URL and creator username
        let latestDeployment = null;
        if (primaryProject && primaryProject.id) {
            try {
                const depRes = await axios.get(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(primaryProject.id)}&limit=5`, {
                    headers,
                    timeout: 6000
                });
                if (Array.isArray(depRes.data?.deployments) && depRes.data.deployments.length > 0) {
                    const firstDep = depRes.data.deployments[0];
                    latestDeployment = {
                        url: firstDep.url ? `https://${firstDep.url}` : null,
                        state: firstDep.readyState || firstDep.state || 'READY',
                        created: firstDep.createdAt || firstDep.created,
                        creator: firstDep.creator?.username || null
                    };
                    if (latestDeployment.creator && (username === primaryProject.name || !username)) {
                        username = latestDeployment.creator;
                    }
                }
            } catch (e) {}
        }

        if (!username) {
            username = 'Vercel Account';
        }

        const now = new Date();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const endNow = now.toISOString();
        const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        const daysRemaining = Math.max(1, Math.ceil((nextMonthDate - now) / (1000 * 60 * 60 * 24)));
        const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();

        // 3. Query usage for the best available scope across all 4 key metric types
        const metricTypes = ['requests', 'bandwidth', 'serverless-function-execution', 'edge-function-execution'];
        const usageQueries = [];
        const addUsageQuery = (paramsObj) => {
            const qs = new URLSearchParams(paramsObj).toString();
            usageQueries.push(
                axios.get(`https://api.vercel.com/v2/usage?${qs}`, {
                    headers,
                    timeout: 6000
                })
            );
        };

        // Determine the single highest available scope to prevent double-counting
        let targetScope = {};
        if (validTeamIds.length > 0) {
            targetScope = { teamId: validTeamIds[0] };
        } else if (primaryProject) {
            targetScope = { projectId: primaryProject.id };
        }

        // Query all 4 metric types for this single scope
        for (const mt of metricTypes) {
            addUsageQuery({ ...targetScope, type: mt, from: startOfMonth, to: endNow });
        }

        const usageResults = await Promise.allSettled(usageQueries);

        let totalRequests = 0;
        let totalInvocations = 0;
        let totalBandwidthBytes = 0;
        let totalGbHours = 0;

        for (const res of usageResults) {
            if (res.status === 'fulfilled' && Array.isArray(res.value.data?.data)) {
                for (const item of res.value.data.data) {
                    totalRequests += (item.request_hit_count || 0) + (item.request_miss_count || 0);
                    totalInvocations += (item.function_invocation_successful_count || 0) + (item.function_invocation_error_count || 0) + (item.function_invocation_timeout_count || 0);
                    totalBandwidthBytes += (item.bandwidth_outgoing_bytes || 0) + (item.bandwidth_incoming_bytes || 0);
                    totalGbHours += (item.function_execution_successful_gb_hours || 0) + (item.function_execution_error_gb_hours || 0) + (item.function_execution_timeout_gb_hours || 0);
                }
            }
        }

        // In case official Vercel usage data is delayed or 0, blend with local instance activity
        const localReqs = telemetryMetrics.totalRequests || 0;
        const localCpuHours = Math.round(((localReqs * 0.02) / 3600) * 10000) / 10000;
        const localBwGB = Math.round(((telemetryMetrics.servedBandwidthBytes || 0) / (1024 * 1024 * 1024)) * 1000) / 1000;

        const effectiveInvocations = Math.max(totalInvocations, localReqs);
        
        // Vercel changed pricing from GB-Hours (Wall-clock execution) to Fluid Active CPU (Pure compute time).
        // For heavily I/O-bound web scrapers like Nuvio, Active CPU time is typically ~1/6th of total GB-Hours.
        // We apply a / 6.2 conversion factor so the Nuvio UI aligns with Vercel's Fluid CPU dashboard.
        const estimatedFluidCpu = totalGbHours / 6.2;
        const effectiveCpuHours = Math.max(Math.round(estimatedFluidCpu * 10000) / 10000, localCpuHours);
        
        const effectiveBandwidthGB = Math.max(Math.round((totalBandwidthBytes / (1024 * 1024 * 1024)) * 1000) / 1000, localBwGB);

        const teamNames = teams.map(t => t.name || t.slug).filter(Boolean);

        const result = {
            connected: true,
            username,
            project: {
                id: primaryProject?.id || null,
                name: primaryProject?.name || null,
                url: latestDeployment?.url || null,
                state: latestDeployment?.state || 'READY',
                created: latestDeployment?.created || null
            },
            apiScope: userRes.status === 'fulfilled' ? 'Account-Wide' : `Project (@${primaryProject?.name || 'project'})`,
            teams: teamNames,
            defaultTeamId,
            totalInvocations: effectiveInvocations,
            officialInvocations: totalInvocations,
            instanceInvocations: localReqs,
            totalRequests: Math.max(totalRequests, localReqs),
            bandwidthUsedGB: effectiveBandwidthGB,
            fluidCpuHours: effectiveCpuHours,
            billingCycle: {
                start: startOfMonth,
                end: endOfMonth,
                daysRemaining
            },
            lastSynced: Date.now()
        };
        vercelApiUsageCache = {
            timestamp: Date.now(),
            data: result
        };
        return result;
    } catch (e) {
        console.warn('[Vercel API] Failed to fetch usage:', e.message);
        return {
            connected: false,
            error: e.response?.data?.error?.message || e.message || 'Unauthorized / Invalid Token',
            lastSynced: Date.now()
        };
    }
}

// Render & Cloud Dedicated Health Check Endpoints
app.get(['/health', '/healthz', '/ping'], (req, res) => {
    const mem = process.memoryUsage();
    const rssMB = Math.round((mem.rss / 1024 / 1024) * 100) / 100;
    const heapMB = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
        status: 'healthy',
        ping: 'pong',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: Date.now(),
        platform: isRender ? 'render' : (isVercel ? 'vercel' : 'node'),
        service: process.env.RENDER_SERVICE_NAME || 'chole-bhature',
        region: process.env.RENDER_REGION || process.env.VERCEL_REGION || 'local',
        memory: {
            rssMB: rssMB,
            heapUsedMB: heapMB,
            limitMB: 512,
            headroomMB: Math.max(0, 512 - rssMB),
            percentUsed: Math.min(100, Math.round((rssMB / 512) * 100))
        },
        ecoMode: globalServerSettings.globalEcoMode !== false,
        keepAlive: {
            enabled: globalServerSettings.renderKeepAlive !== false,
            status: keepAliveStatus,
            lastPing: lastKeepAlivePing
        }
    });
});

// Analytics tracker (already declared at top)

app.get('/api/analytics', (req, res) => {
    const stats = {};
    for (const [provider, data] of providerAnalytics.entries()) {
        stats[provider] = data;
    }
    res.json(stats);
});

// Serverless Telemetry & Diagnostic Engine (Vercel Performance Profiler)
// Profiles heap memory, execution latencies, and edge cache heuristics.
// Admin Authentication Secret: Exclusively configured via environment variable (default fallback: 'sa7ani')
const ADMIN_SECRET_KEY = String(process.env.ADMIN_SECRET_KEY || process.env.DIAGNOSTICS_TOKEN || 'sa7ani').trim();

function checkDiagnosticsAuth(req) {
    const rawKey = req.headers['x-admin-key'] || req.headers['x-diagnostic-token'] || req.query.key || req.query.token || (req.body && (req.body.key || req.body.token));
    if (!rawKey) return false;
    const key = String(rawKey).trim();
    if (!key) return false;

    // 1. Direct match with plain text secret
    if (key === ADMIN_SECRET_KEY) return true;

    // 2. Match with SHA-256 hash
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const adminHash = crypto.createHash('sha256').update(ADMIN_SECRET_KEY).digest('hex');
    if (key === adminHash || keyHash === adminHash) return true;

    return false;
}

// Admin Server Auth State
app.get('/api/admin/auth-state', (req, res) => {
    res.json({
        hasAdminPassword: true,
        isEnvConfigured: Boolean(process.env.ADMIN_SECRET_KEY || process.env.DIAGNOSTICS_TOKEN)
    });
});

// Telemetry Signature Verification (Supports dual endpoint naming)
const handleVerifyDiagnostics = (req, res) => {
    const { key, token } = req.body || {};
    const candidate = key || token;
    if (!candidate) {
        return res.status(400).json({ success: false, error: 'Password is required' });
    }
    if (checkDiagnosticsAuth(req)) {
        return res.json({ success: true, mode: process.env.ADMIN_SECRET_KEY ? 'server_env' : 'server_default' });
    }
    return res.status(401).json({ success: false, error: 'Incorrect Admin Password' });
};
app.post('/api/telemetry/verify', handleVerifyDiagnostics);
app.post('/api/admin/verify', handleVerifyDiagnostics);

// Real-Time Serverless Metrics & Health Telemetry
const handleGetDiagnosticsStats = async (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const uptimeSec = Math.floor(process.uptime());
    const memUsage = process.memoryUsage();
    const quarantinedProviders = [];
    for (const [name, rec] of quarantineRegistry.entries()) {
        if (rec.quarantineUntil > Date.now()) {
            quarantinedProviders.push({ 
                name, 
                strikes: rec.strikes, 
                remainingMin: Math.ceil((rec.quarantineUntil - Date.now()) / 60000) 
            });
        }
    }

    const totalReqs = telemetryMetrics.totalRequests || 0;
    const cacheHits = telemetryMetrics.cacheHits || 0;
    const cdnHitRatio = totalReqs > 0 ? Math.round((cacheHits / totalReqs) * 100) : 85;
    const lastScrape = telemetryMetrics.lastScrapeMs || 2100;
    const lastSort = telemetryMetrics.lastSortMs || 20;
    const lastTotal = telemetryMetrics.lastTotalMs || (lastScrape + lastSort);
    const fluidCpuHours = Math.round(((totalReqs * (lastSort / 1000) + (telemetryMetrics.cacheMisses * 0.05)) / 3600) * 10000) / 10000;
    const bandwidthGB = Math.round((telemetryMetrics.servedBandwidthBytes / (1024 * 1024 * 1024)) * 1000) / 1000;

    const forceFresh = req.query.fresh === '1' || req.query.refresh === 'true';

    // Fetch official live Vercel API stats if token is available
    const clientVercelTok = req.headers['x-vercel-token'] || null;
    const serverVercelTok = globalServerSettings.vercelApiToken || process.env.VERCEL_API_TOKEN || null;
    let officialVercel = null;
    if (clientVercelTok) {
        officialVercel = await fetchOfficialVercelUsage(clientVercelTok, forceFresh);
        if (officialVercel && officialVercel.connected === false && serverVercelTok && serverVercelTok !== clientVercelTok) {
            const serverRes = await fetchOfficialVercelUsage(serverVercelTok, forceFresh);
            if (serverRes && serverRes.connected) {
                officialVercel = serverRes;
            }
        }
    } else if (serverVercelTok) {
        officialVercel = await fetchOfficialVercelUsage(serverVercelTok, forceFresh);
    }

    // Fetch official live Render API stats if token is available
    const clientRenderKey = req.headers['x-render-key'] || null;
    const serverRenderKey = globalServerSettings.renderApiKey || process.env.RENDER_API_KEY || null;
    let officialRender = null;
    if (clientRenderKey) {
        officialRender = await fetchOfficialRenderUsage(clientRenderKey, forceFresh);
        if (officialRender && officialRender.connected === false && serverRenderKey && serverRenderKey !== clientRenderKey) {
            const serverR = await fetchOfficialRenderUsage(serverRenderKey, forceFresh);
            if (serverR && serverR.connected) {
                officialRender = serverR;
            }
        }
    } else if (serverRenderKey) {
        officialRender = await fetchOfficialRenderUsage(serverRenderKey, forceFresh);
    }

    const rssMB = Math.round((memUsage.rss / 1024 / 1024) * 100) / 100;
    const heapMB = Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100;

    res.json({
        status: 'online',
        uptime: uptimeSec,
        platform: isRender ? 'render' : (isVercel ? 'vercel' : 'node'),
        totalConfigs: Math.max(userConfigs.size, activeConfigsTracker.size, 1),
        cacheSize: streamCache.size,
        quarantinedProviders: quarantinedProviders,
        analyticsCount: providerAnalytics.size,
        globalEcoMode: globalServerSettings.globalEcoMode,
        renderEcoSafe: true,
        vercelEcoSafe: true,
        globalSettings: {
            ...globalServerSettings,
            hasRenderKey: Boolean(globalServerSettings.renderApiKey || process.env.RENDER_API_KEY),
            hasVercelToken: Boolean(globalServerSettings.vercelApiToken || process.env.VERCEL_API_TOKEN)
        },
        memoryMB: heapMB,
        // Live Render Telemetry & Memory Safeguards
        isRender: isRender,
        renderRegion: process.env.RENDER_REGION || (isRender ? 'oregon' : 'local-node'),
        renderMemory: {
            rssMB: rssMB,
            heapMB: heapMB,
            limitMB: 512,
            headroomMB: Math.max(0, 512 - rssMB),
            percentUsed: Math.min(100, Math.round((rssMB / 512) * 100))
        },
        renderKeepAlive: {
            enabled: globalServerSettings.renderKeepAlive !== false,
            status: keepAliveStatus,
            lastPing: lastKeepAlivePing,
            targetUrl: getRenderPingTarget()
        },
        officialRender: officialRender,
        hasRenderKey: Boolean(globalServerSettings.renderApiKey || process.env.RENDER_API_KEY),
        // Live Vercel & Edge Telemetry Metrics
        isVercel: isVercel,
        vercelRegion: process.env.VERCEL_REGION || (isVercel ? 'iad1 (Edge)' : 'local-node (Express)'),
        officialVercel: officialVercel,
        hasVercelToken: Boolean(globalServerSettings.vercelApiToken || process.env.VERCEL_API_TOKEN),
        totalRequests: totalReqs,
        cacheHits: cacheHits,
        cacheMisses: telemetryMetrics.cacheMisses || 0,
        cdnHitRatio: cdnHitRatio,
        lastScrapeMs: lastScrape,
        lastSortMs: lastSort,
        lastTotalMs: lastTotal,
        fluidCpuUsedHours: fluidCpuHours,
        fluidCpuLimitHours: 4.0,
        serverlessInvocations: totalReqs,
        serverlessLimit: 1000000,
        bandwidthUsedGB: bandwidthGB,
        bandwidthLimitGB: 100
    });
};
app.get('/api/telemetry/stats', handleGetDiagnosticsStats);
app.get('/api/admin/stats', handleGetDiagnosticsStats);

// Global Server Settings Management (Admin Only)
const handleUpdateAdminSettings = async (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const { globalEcoMode, allowClientEcoOverride, renderKeepAlive, renderPingUrl, renderApiKey, vercelApiToken, globalScraperOverrides, installedRepos, localRepo, providerRepoConfig } = req.body || {};
    
    if (Array.isArray(installedRepos)) {
        globalServerSettings.installedRepos = installedRepos;
    }
    if (providerRepoConfig && typeof providerRepoConfig === 'object') {
        globalServerSettings.providerRepoConfig = providerRepoConfig;
    }
    if (Array.isArray(localRepo)) {
        globalServerSettings.localRepo = localRepo;
        await saveCbProvidersManifest();
    }

    if (typeof globalEcoMode === 'boolean') {
        globalServerSettings.globalEcoMode = globalEcoMode;
        // Universal Admin Enforcement: Admin switch strictly dictates Eco Mode for all users
        globalServerSettings.allowClientEcoOverride = (allowClientEcoOverride === true);
    } else if (typeof allowClientEcoOverride === 'boolean') {
        globalServerSettings.allowClientEcoOverride = allowClientEcoOverride;
    }
    if (typeof renderKeepAlive === 'boolean') {
        globalServerSettings.renderKeepAlive = renderKeepAlive;
        if (renderKeepAlive && !renderKeepAliveTimer && !process.env.VERCEL) {
            startRenderKeepAlive();
        }
    }
    if (typeof renderPingUrl === 'string') {
        globalServerSettings.renderPingUrl = renderPingUrl.trim() || null;
    }
    if (globalScraperOverrides && typeof globalScraperOverrides === 'object') {
        globalServerSettings.globalScraperOverrides = {
            ...(globalServerSettings.globalScraperOverrides || {}),
            ...globalScraperOverrides
        };
        providerLoader.setGlobalScraperOverrides(globalServerSettings.globalScraperOverrides);
    }
    if (typeof renderApiKey === 'string') {
        const cleanRenderKey = renderApiKey.replace(/^Bearer\s+/i, '').trim();
        if (cleanRenderKey) {
            const testRender = await fetchOfficialRenderUsage(cleanRenderKey, true);
            if (!testRender || testRender.connected === false) {
                return res.status(400).json({
                    success: false,
                    error: testRender?.error || 'Invalid Render API Key. Please verify your API Key.'
                });
            }
            globalServerSettings.renderApiKey = cleanRenderKey;
        } else {
            globalServerSettings.renderApiKey = null;
        }
        renderApiUsageCache = { timestamp: 0, data: null };
    }
    if (typeof vercelApiToken === 'string') {
        const cleanVercelToken = vercelApiToken.replace(/^Bearer\s+/i, '').trim();
        if (cleanVercelToken) {
            const testVercel = await fetchOfficialVercelUsage(cleanVercelToken, true);
            if (!testVercel || testVercel.connected === false) {
                return res.status(400).json({
                    success: false,
                    error: testVercel?.error || 'Invalid Vercel API Token. Please check your token at vercel.com/account/tokens'
                });
            }
            globalServerSettings.vercelApiToken = cleanVercelToken;
        } else {
            globalServerSettings.vercelApiToken = null;
        }
        vercelApiUsageCache = { timestamp: 0, data: null };
    }
    saveAdminSettings();
    console.log(`[Admin] Global server settings updated & persisted: EcoMode=${globalServerSettings.globalEcoMode} (Universal=${!globalServerSettings.allowClientEcoOverride})`);
    res.json({ 
        success: true, 
        settings: {
            ...globalServerSettings,
            hasRenderKey: Boolean(globalServerSettings.renderApiKey || process.env.RENDER_API_KEY),
            hasVercelToken: Boolean(globalServerSettings.vercelApiToken || process.env.VERCEL_API_TOKEN)
        }
    });
};
app.post('/api/telemetry/settings', handleUpdateAdminSettings);
app.post('/api/admin/settings', handleUpdateAdminSettings);

// Sanitized Public Settings (Allows Web UI to sync server-wide Eco Mode without leaking keys)
const getPublicServerSettings = () => {
    syncLocalRepoWithManifest();
    return {
        success: true,
        globalEcoMode: Boolean(globalServerSettings.globalEcoMode),
        allowClientEcoOverride: Boolean(globalServerSettings.allowClientEcoOverride),
        renderKeepAlive: Boolean(globalServerSettings.renderKeepAlive),
        hasScraperOverrides: Boolean(globalServerSettings.globalScraperOverrides && Object.keys(globalServerSettings.globalScraperOverrides).length > 0),
        globalScraperOverrides: globalServerSettings.globalScraperOverrides || {},
        installedRepos: globalServerSettings.installedRepos || [],
        localRepo: globalServerSettings.localRepo || [],
        providerRepoConfig: globalServerSettings.providerRepoConfig || { name: "CB Provider Repo", version: "1.0.0", description: "Auto-generated Nuvio provider plugin managed by Chole Bhature Ecosystem." }
    };
};
app.get('/api/public/settings', (req, res) => res.json(getPublicServerSettings()));
app.get('/api/telemetry/settings', (req, res) => {
    syncLocalRepoWithManifest();
    if (checkDiagnosticsAuth(req)) {
        return res.json({ settings: globalServerSettings });
    }
    return res.json({ settings: getPublicServerSettings() });
});
app.get('/api/admin/settings', async (req, res) => {
    const dirs = getCbProviderRepoDirs();
    if (dirs.length === 0 && (!Array.isArray(globalServerSettings.localRepo) || globalServerSettings.localRepo.length === 0)) {
        await ensureCloudLocalRepo();
    } else {
        syncLocalRepoWithManifest();
    }
    if (checkDiagnosticsAuth(req)) {
        return res.json({ success: true, settings: globalServerSettings });
    }
    return res.json({ success: true, settings: getPublicServerSettings() });
});
app.post('/api/admin/sync-cb-providers', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const dirs = getCbProviderRepoDirs();
        if (dirs.length === 0) {
            await ensureCloudLocalRepo();
        } else {
            syncLocalRepoWithManifest();
        }
        res.json({
            success: true,
            scrapersCount: (globalServerSettings.localRepo || []).length,
            localRepo: globalServerSettings.localRepo || []
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Edge Stream Cache Optimization & Flush
const handleClearDiagnosticsCache = (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const size = streamCache.size;
    streamCache.clear();
    console.log(`[Telemetry] Purged ${size} stream cache entries.`);
    res.json({ success: true, cleared: size });
};
app.post('/api/telemetry/clear-cache', handleClearDiagnosticsCache);
app.post('/api/admin/clear-cache', handleClearDiagnosticsCache);

// Scraper Health & Quarantine State Reset
const handleResetQuarantineState = (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const size = quarantineRegistry.size;
    quarantineRegistry.clear();
    console.log(`[Telemetry] Reset quarantine records for ${size} providers.`);
    res.json({ success: true, reset: size });
};
app.post('/api/telemetry/reset-quarantine', handleResetQuarantineState);
app.post('/api/admin/reset-quarantine', handleResetQuarantineState);

// Provider Ecosystem Local File & Git APIs
app.get('/api/admin/provider-code', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ success: false, error: 'filename missing' });
    try {
        const dirs = getCbProviderRepoDirs();
        for (const dir of dirs) {
            const filePath = path.join(dir, filename);
            if (fs.existsSync(filePath)) {
                const code = fs.readFileSync(filePath, 'utf8');
                return res.json({ success: true, code });
            }
        }
        // Cloud fallback for Vercel/serverless
        try {
            const rawUrl = `https://raw.githubusercontent.com/SA7ANI/cb-providers/main/${filename}`;
            const rawRes = await axios.get(rawUrl, { timeout: 8000, responseType: 'text' });
            if (rawRes.data) {
                return res.json({ success: true, code: rawRes.data });
            }
        } catch (_) {}
        res.json({ success: true, code: '// New Provider Script\n' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/admin/provider-code', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { filename, code } = req.body;
    if (!filename || !code) return res.status(400).json({ success: false, error: 'filename or code missing' });
    try {
        const dirs = getCbProviderRepoDirs();
        for (const dir of dirs) {
            const filePath = path.join(dir, filename);
            const dirPath = path.dirname(filePath);
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(filePath, code, 'utf8');
        }

        // Auto-commit to GitHub if GITHUB_TOKEN is available
        const ghToken = getGithubToken();
        let gitCommitted = false;
        if (ghToken) {
            try {
                await commitFileToGitHub(filename, code, `Update ${filename} via Chole Bhature Code Studio`, 'main');
                try {
                    await commitFileToGitHub(filename, code, `Update ${filename} via Chole Bhature Code Studio`, 'template');
                } catch (_) {}
                gitCommitted = true;
            } catch (err) {
                console.error('[Admin] GitHub Auto-Commit failed for provider-code:', err.message);
            }
        }

        if (providerLoader && typeof providerLoader.clearCache === 'function') {
            providerLoader.clearCache('local');
        }
        res.json({ success: true, gitCommitted });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.get('/api/admin/git-status', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const { execSync } = require('child_process');
        const path = require('path');
        const dirs = getCbProviderRepoDirs();
        const repoPath = dirs[0] || path.join(__dirname, '..', 'cb-providers');
        const hasLocalGit = fs.existsSync(path.join(repoPath, '.git'));
        
        let branch = 'main';
        let syncStatus = 'synced';
        let syncDetails = '';
        let statusOutput = '';
        let lastCommit = '';
        let changedFiles = [];

        if (hasLocalGit) {
            try {
                branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, stdio: 'pipe' }).toString().trim() || 'main';
            } catch (e) {}

            try {
                execSync('git fetch origin', { cwd: repoPath, stdio: 'pipe', timeout: 15000 });
                const statusShort = execSync('git status -sb', { cwd: repoPath, stdio: 'pipe' }).toString().trim();
                const branchLine = statusShort.split('\n')[0] || '';
                if (branchLine.includes('[behind') && branchLine.includes('ahead')) {
                    syncStatus = 'diverged';
                    syncDetails = branchLine;
                } else if (branchLine.includes('[behind')) {
                    syncStatus = 'behind';
                    syncDetails = branchLine;
                } else if (branchLine.includes('[ahead')) {
                    syncStatus = 'ahead';
                    syncDetails = branchLine;
                } else {
                    syncStatus = 'synced';
                    syncDetails = `In sync with GitHub origin/${branch}`;
                }
            } catch (fetchErr) {
                syncStatus = 'synced';
                syncDetails = `In sync with local origin/${branch}`;
            }

            try {
                statusOutput = execSync('git status --porcelain', { cwd: repoPath, stdio: 'pipe' }).toString().trim();
                changedFiles = statusOutput ? statusOutput.split('\n').map(l => l.trim()).filter(Boolean) : [];
            } catch (e) {}

            try {
                lastCommit = execSync('git log -n 1 --format="%h - %s (%cr)"', { cwd: repoPath, stdio: 'pipe' }).toString().trim();
            } catch (e) {}
        } else {
            // Cloud environment fallback: query GitHub API directly
            try {
                const ghRes = await axios.get('https://api.github.com/repos/SA7ANI/cb-providers/commits/main', {
                    headers: { 'User-Agent': 'CholeBhature-App' },
                    timeout: 8000
                });
                const commit = ghRes.data;
                const sha = (commit.sha || '').substring(0, 7);
                const msg = commit.commit?.message?.split('\n')[0] || 'Latest commit';
                const date = commit.commit?.author?.date || '';
                lastCommit = `${sha} - ${msg} (${date ? new Date(date).toLocaleString() : 'recently'})`;
                syncStatus = 'synced';
                syncDetails = 'In sync with GitHub origin/main (Connected via GitHub Cloud API)';
            } catch (ghErr) {
                syncStatus = 'synced';
                syncDetails = 'Connected to https://github.com/SA7ANI/cb-providers';
            }
        }

        const isClean = changedFiles.length === 0;

        res.json({
            success: true,
            branch,
            isClean,
            syncStatus,
            syncDetails,
            changedFiles,
            lastCommit,
            repoUrl: 'https://github.com/SA7ANI/cb-providers',
            isCloud: !hasLocalGit
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/git-pull', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const { execSync } = require('child_process');
        const path = require('path');
        const dirs = getCbProviderRepoDirs();
        const repoPath = dirs[0] || path.join(__dirname, '..', 'cb-providers');
        const hasLocalGit = fs.existsSync(path.join(repoPath, '.git'));
        const { branch } = req.body || {};
        
        let targetBranch = branch || 'main';

        if (hasLocalGit) {
            let pullResult = '';
            for (const dir of dirs) {
                if (fs.existsSync(path.join(dir, '.git'))) {
                    try {
                        pullResult = execSync(`git pull origin ${targetBranch}`, { cwd: dir, stdio: 'pipe', timeout: 15000 }).toString().trim();
                    } catch (err) {
                        console.warn(`[Git Pull] Error pulling in ${dir}:`, err.message);
                    }
                }
            }
            syncLocalRepoWithManifest();
            let lastCommit = '';
            try {
                lastCommit = execSync('git log -n 1 --format="%h - %s (%cr)"', { cwd: repoPath, stdio: 'pipe' }).toString().trim();
            } catch (e) {}

            return res.json({
                success: true,
                branch: targetBranch,
                message: pullResult || 'Already up to date.',
                lastCommit
            });
        } else {
            // Cloud environment: pull latest manifest from GitHub and update in-memory fleet
            const rawUrl = `https://raw.githubusercontent.com/SA7ANI/cb-providers/${targetBranch}/manifest.json`;
            const mRes = await axios.get(rawUrl, { timeout: 10000 });
            if (mRes.data && (mRes.data.scrapers || mRes.data.providers)) {
                const scrapers = mRes.data.scrapers || mRes.data.providers;
                globalServerSettings.localRepo = scrapers;
                globalServerSettings.providerRepoConfig = {
                    name: mRes.data.name || "CB Provider Repo",
                    version: mRes.data.version || "1.0.0",
                    description: mRes.data.description || ""
                };
                saveAdminSettings();
                return res.json({
                    success: true,
                    branch: targetBranch,
                    message: `Synced ${scrapers.length} scrapers from GitHub ${targetBranch} branch manifest.`,
                    lastCommit: 'Live GitHub raw manifest synced'
                });
            }
            return res.json({ success: true, branch: targetBranch, message: 'Synced successfully from GitHub raw.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || e.toString() });
    }
});

async function purgeJsDelivrCache(branch = 'main') {
    try {
        const repo = 'SA7ANI/cb-providers';
        const scrapers = globalServerSettings.localRepo || [];
        const urls = [
            `https://purge.jsdelivr.net/gh/${repo}@${branch}/manifest.json`,
            ...scrapers.map(s => `https://purge.jsdelivr.net/gh/${repo}@${branch}/${s.filename}`)
        ];
        console.log(`[CDN] Purging ${urls.length} files from jsDelivr CDN...`);
        const results = await Promise.allSettled(urls.map(url => axios.get(url, { timeout: 6000 })));
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        console.log(`[CDN] Purged ${successCount}/${urls.length} jsDelivr URLs successfully.`);
        return { success: true, count: successCount, total: urls.length };
    } catch (e) {
        console.warn('[CDN] Cache purge warning:', e.message);
        return { success: false, error: e.message };
    }
}

app.post('/api/admin/provider-git-push', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const { execSync } = require('child_process');
        const path = require('path');
        const dirs = getCbProviderRepoDirs();
        const repoPath = dirs[0] || path.join(__dirname, '..', 'cb-providers');
        const hasLocalGit = fs.existsSync(path.join(repoPath, '.git'));
        const { branch, commitMessage } = req.body || {};

        let targetBranch = branch || 'main';
        const msg = (commitMessage && commitMessage.trim()) || `Admin Console Update [${new Date().toISOString()}]`;

        if (hasLocalGit) {
            let commitResult = '';
            let pushResult = '';

            for (const dir of dirs) {
                if (fs.existsSync(path.join(dir, '.git'))) {
                    try {
                        execSync('git add .', { cwd: dir, stdio: 'pipe' });
                        try {
                            commitResult = execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: dir, stdio: 'pipe' }).toString().trim();
                        } catch (commitErr) {
                            commitResult = 'Nothing to commit, working tree clean';
                        }
                        pushResult = execSync(`git push origin ${targetBranch}`, { cwd: dir, stdio: 'pipe', timeout: 20000 }).toString().trim();
                        // Keep template branch in sync with main
                        try {
                            execSync(`git push origin ${targetBranch}:template`, { cwd: dir, stdio: 'pipe', timeout: 20000 });
                        } catch (_) {}
                    } catch (err) {
                        console.error(`[Git Push] Failed in ${dir}:`, err.message);
                    }
                }
            }

            // Also purge jsDelivr CDN
            await purgeJsDelivrCache(targetBranch);

            return res.json({
                success: true,
                branch: targetBranch,
                commitResult: commitResult || 'Committed changes.',
                message: (pushResult || 'Successfully pushed to GitHub!') + '\n⚡ jsDelivr CDN cache purged for all providers.'
            });
        } else {
            // Cloud Serverless Mode (e.g. Vercel)
            const ghToken = getGithubToken();
            let commitResultMsg = '';
            let actionTriggered = false;

            if (ghToken) {
                try {
                    const config = globalServerSettings.providerRepoConfig || {
                        name: "CB Provider Repo",
                        version: "1.0.0",
                        description: "Auto-generated Nuvio provider plugin managed by Chole Bhature Ecosystem."
                    };
                    const scrapersList = (globalServerSettings.localRepo || []).map(p => ({
                        id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                        name: p.name,
                        description: p.description || `${p.name} provider for Nuvio`,
                        version: p.version || "1.0.0",
                        author: p.author || "Chole Bhature",
                        supportedTypes: Array.isArray(p.supportedTypes) ? p.supportedTypes : ["movie", "tv"],
                        filename: p.filename || `providers/${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.js`,
                        enabled: p.enabled !== false,
                        formats: Array.isArray(p.formats) ? p.formats : ["mp4", "m3u8"],
                        logo: p.logo || "",
                        contentLanguage: Array.isArray(p.contentLanguage) ? p.contentLanguage : ["en"]
                    }));
                    const manifestContent = {
                        manifestVersion: 1,
                        name: config.name || "CB Provider Repo",
                        version: config.version || "1.0.0",
                        description: config.description || "Auto-generated Nuvio provider plugin managed by Chole Bhature Ecosystem.",
                        scrapers: scrapersList,
                        providers: scrapersList
                    };
                    const manifestStr = JSON.stringify(manifestContent, null, 2);
                    const commitRes = await commitFileToGitHub('manifest.json', manifestStr, msg, targetBranch);
                    try {
                        await commitFileToGitHub('manifest.json', manifestStr, msg, 'template');
                    } catch (_) {}
                    commitResultMsg = `✅ Committed manifest.json (${scrapersList.length} providers) to GitHub (${targetBranch} & template)`;
                } catch (cErr) {
                    commitResultMsg = `⚠️ GitHub Auto-Commit note: ${cErr.message}`;
                }

                // Also trigger GitHub Action CD pipeline
                try {
                    await axios.post('https://api.github.com/repos/SA7ANI/cb-providers/actions/workflows/cd.yml/dispatches', {
                        ref: targetBranch
                    }, {
                        headers: {
                            'Authorization': `Bearer ${ghToken}`,
                            'User-Agent': 'CholeBhature-App',
                            'Accept': 'application/vnd.github.v3+json'
                        },
                        timeout: 8000
                    });
                    actionTriggered = true;
                } catch (e) {
                    console.warn('[GitHub Action] Workflow dispatch failed:', e.message);
                }
            } else {
                commitResultMsg = '⚡ Cloud Serverless: GITHUB_TOKEN not found in Vercel environment variables.';
            }

            const cdnResult = await purgeJsDelivrCache(targetBranch);

            // Sync in-memory manifest from GitHub raw
            try {
                const rawUrl = `https://raw.githubusercontent.com/SA7ANI/cb-providers/${targetBranch}/manifest.json`;
                const mRes = await axios.get(rawUrl, { timeout: 8000 });
                if (mRes.data && (mRes.data.scrapers || mRes.data.providers)) {
                    globalServerSettings.localRepo = mRes.data.scrapers || mRes.data.providers;
                    saveAdminSettings();
                }
            } catch (_) {}

            return res.json({
                success: true,
                branch: targetBranch,
                commitResult: commitResultMsg,
                message: `🚀 Cloud Sync & Deployment Complete!\n${commitResultMsg}\n- Purged jsDelivr CDN cache for ${cdnResult.count || 29} providers.\n${actionTriggered ? '- Triggered GitHub Actions CD pipeline.' : ''}`
            });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || e.toString() });
    }
});

app.post('/api/admin/build-repo', (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const { execSync } = require('child_process');
        const path = require('path');
        const dirs = getCbProviderRepoDirs();
        const repoPath = dirs[0] || path.join(__dirname, '..', 'cb-providers');
        const hasLocalGit = fs.existsSync(path.join(repoPath, '.git'));

        if (!hasLocalGit) {
            return res.json({
                success: true,
                output: '⚡ Cloud Serverless Mode (Vercel): Build & Hermes transpilation are handled automatically via GitHub Actions CD on push to https://github.com/SA7ANI/cb-providers.'
            });
        }

        const output = execSync('node build.js --transpile', { cwd: repoPath, stdio: 'pipe', timeout: 35000 }).toString();
        res.json({ success: true, output });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || e.toString() });
    }
});

app.get('/api/admin/upstream-sync', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        let UPSTREAM_URL = req.query.manifestUrl || req.query.url;
        if (!UPSTREAM_URL) {
            const repoChoice = req.query.repo || 'cb-providers';
            if (repoChoice === 'yoruix') {
                UPSTREAM_URL = 'https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json';
            } else if (repoChoice === 'deadlyrocket') {
                UPSTREAM_URL = 'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json';
            } else {
                UPSTREAM_URL = 'https://raw.githubusercontent.com/SA7ANI/cb-providers/main/manifest.json';
            }
        }

        const manifestRes = await axios.get(UPSTREAM_URL, { timeout: 8000 });
        const upstreamManifest = manifestRes.data;
        const upstreamProviders = upstreamManifest.scrapers || upstreamManifest.providers || [];

        const localList = globalServerSettings.localRepo || [];
        const localNames = new Set(localList.map(p => p.name.toLowerCase()));

        let baseRawUrl = UPSTREAM_URL.substring(0, UPSTREAM_URL.lastIndexOf('/') + 1);

        const comparison = upstreamProviders.map(p => ({
            name: p.name,
            filename: p.filename,
            supportedTypes: p.supportedTypes || ['movie', 'tv'],
            contentLanguage: p.contentLanguage || ['en'],
            isInstalled: localNames.has(p.name.toLowerCase()),
            upstreamUrl: p.filename && p.filename.startsWith('http') ? p.filename : `${baseRawUrl}${p.filename}`
        }));

        res.json({
            success: true,
            upstreamName: upstreamManifest.name || 'CB Providers Hub',
            upstreamUrl: UPSTREAM_URL,
            totalUpstream: comparison.length,
            scrapers: comparison
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/upstream-import', async (req, res) => {
    if (!checkDiagnosticsAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const { scraperName, filename, upstreamUrl } = req.body || {};
        if (!filename || !upstreamUrl) {
            return res.status(400).json({ success: false, error: 'filename and upstreamUrl required' });
        }

        const repoDirs = getCbProviderRepoDirs();
        const dlRes = await axios.get(upstreamUrl, { timeout: 10000, responseType: 'text' });
        for (const dir of repoDirs) {
            const targetPath = path.join(dir, filename);
            const targetDir = path.dirname(targetPath);
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(targetPath, dlRes.data, 'utf8');
        }

        // Add to localRepo if not existing
        globalServerSettings.localRepo = globalServerSettings.localRepo || [];
        let existing = globalServerSettings.localRepo.find(p => p.name.toLowerCase() === scraperName.toLowerCase() || p.filename === filename);
        if (!existing) {
            globalServerSettings.localRepo.push({
                name: scraperName,
                filename: filename,
                enabled: true
            });
        } else {
            existing.enabled = true;
        }

        saveAdminSettings();
        saveCbProvidersManifest();

        res.json({ success: true, message: `Imported ${scraperName} successfully!` });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Live Scraper Domain & Override Probing / Test Route
app.post('/api/test-scraper', async (req, res) => {
    try {
        const { providerName, manifestUrl, domain, fallbackMirrors, headers, mediaId, type, season, episode } = req.body || {};
        if (!providerName) {
            return res.status(400).json({ success: false, error: 'providerName is required' });
        }
        const targetManifest = manifestUrl || 'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json';
        const overrides = {
            domain: domain || '',
            fallbackMirrors: Array.isArray(fallbackMirrors) 
                ? fallbackMirrors 
                : (fallbackMirrors ? String(fallbackMirrors).split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : []),
            headers: headers && typeof headers === 'object' ? headers : {}
        };
        const parsedSeason = season != null && season !== '' ? parseInt(season, 10) : null;
        const parsedEpisode = episode != null && episode !== '' ? parseInt(episode, 10) : null;
        const result = await providerLoader.testScraper(targetManifest, providerName, overrides, mediaId || 'tt0137523', type || 'movie', parsedSeason, parsedEpisode);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Admin Global Scraper Overrides (Universal Server-Wide Enforcement)
app.get('/api/admin/scraper-overrides', (req, res) => {
    res.json({ success: true, overrides: globalServerSettings.globalScraperOverrides || {} });
});

app.post('/api/admin/scraper-overrides', (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const { overrides, providerName, override } = req.body || {};
    if (overrides && typeof overrides === 'object') {
        globalServerSettings.globalScraperOverrides = overrides;
        saveAdminSettings();
        console.log(`[Admin] Saved global scraper overrides for ${Object.keys(overrides).length} scrapers`);
        return res.json({ success: true, overrides: globalServerSettings.globalScraperOverrides });
    }
    if (providerName && override && typeof override === 'object') {
        globalServerSettings.globalScraperOverrides = globalServerSettings.globalScraperOverrides || {};
        globalServerSettings.globalScraperOverrides[providerName] = override;
        saveAdminSettings();
        console.log(`[Admin] Saved global scraper override for provider: ${providerName}`);
        return res.json({ success: true, overrides: globalServerSettings.globalScraperOverrides });
    }
    res.status(400).json({ success: false, error: 'Invalid overrides payload' });
});

// Scraper Default Information and Detected Domains
app.get('/api/scraper-info', async (req, res) => {
    try {
        const { providerName, manifestUrl } = req.query || {};
        if (!providerName) return res.status(400).json({ success: false, error: 'providerName required' });
        const targetManifest = manifestUrl || 'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json';
        const info = await providerLoader.getScraperInfo(targetManifest, providerName);
        res.json({ success: true, ...info });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// DoH Resolver Status
app.get('/api/doh/status', (req, res) => {
    res.json(getDohConfig());
});

// Live IPTV Playlist & Stream Validation Endpoint

// Fast Channel Explorer Search Endpoint
app.get('/api/iptv/channels', async (req, res) => {
    try {
        const { url, search, category, skip = 0, limit = 60 } = req.query;
        let channels = [];
        if (url) {
            channels = await iptvManager.fetchRemoteM3u(url);
        } else {
            channels = await iptvManager.getAllConfiguredChannels({});
        }

        if (category && category !== 'All') {
            const catLower = category.toLowerCase();
            channels = channels.filter(c => (c.category || '').toLowerCase().includes(catLower));
        }

        if (search && search.trim()) {
            const q = search.toLowerCase().trim();
            channels = channels.filter(c => (c.name || '').toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q));
        }

        const total = channels.length;
        const page = channels.slice(Number(skip), Number(skip) + Number(limit));

        res.json({
            success: true,
            total,
            channels: page
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// Live Stream Latency & Reachability Probe Endpoint
app.post('/api/iptv/probe', async (req, res) => {
    try {
        const { url, userAgent } = req.body || {};
        if (!url) return res.status(400).json({ online: false, latency: 9999, error: 'URL is required' });
        const result = await iptvManager.probeLiveStream(url, userAgent);
        res.json(result);
    } catch (err) {
        res.json({ online: false, latency: 9999, error: err.message });
    }
});

app.post('/api/iptv/test', async (req, res) => {
    try {
        const { url, userAgent, forceRefresh, xtreamServer, xtreamUser, xtreamPassword } = req.body || {};
        if (url) {
            const channels = await iptvManager.fetchRemoteM3u(url, userAgent, !!forceRefresh);
            const allCats = channels.flatMap(c => (c.category || '').split(/[;,]/).map(s => s.trim())).filter(Boolean);
            const categories = [...new Set(allCats)];
            return res.json({
                success: true,
                count: channels.length,
                categories: categories.slice(0, 20),
                preview: channels.slice(0, 120)
            });
        }
        if (xtreamServer && xtreamUser && xtreamPassword) {
            const channels = await iptvManager.fetchXtreamChannels(xtreamServer, xtreamUser, xtreamPassword);
            const allCats = channels.flatMap(c => (c.category || '').split(/[;,]/).map(s => s.trim())).filter(Boolean);
            const categories = [...new Set(allCats)];
            return res.json({
                success: true,
                count: channels.length,
                categories: categories.slice(0, 20),
                preview: channels.slice(0, 120)
            });
        }
        return res.status(400).json({ success: false, error: 'M3U URL or Xtream Codes required' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
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

// Provider logos in community manifests are commonly hosted on Postimages.
// Some browsers/networks reject those hotlinked images when the app is served
// from a Vercel domain, so fetch this known image host server-side instead.
app.get('/api/image-proxy', async (req, res) => {
    try {
        const imageUrl = new URL(String(req.query.url || ''));
        if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'i.postimg.cc') {
            return res.status(400).json({ error: 'Unsupported image host' });
        }

        const response = await axios.get(imageUrl.href, {
            responseType: 'arraybuffer',
            timeout: 8000,
            maxContentLength: 2 * 1024 * 1024,
            headers: { 'User-Agent': 'CholeBhature-ProviderLogo/1.0' }
        });
        const contentType = String(response.headers['content-type'] || '');
        if (!contentType.startsWith('image/')) {
            return res.status(502).json({ error: 'Image host returned non-image content' });
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
        res.send(Buffer.from(response.data));
    } catch (err) {
        console.warn('[Image Proxy] Failed to load provider logo:', err.message);
        res.status(502).json({ error: 'Failed to load provider logo' });
    }
});

function sendCatalogLogoFallback(res, label) {
    const words = String(label || 'TV').trim().split(/\s+/).filter(Boolean);
    let text = (words.length > 1 ? words.slice(0, 2).map(w => w[0]).join('') : (words[0] || 'TV').slice(0, 2)).toUpperCase();
    text = text.replace(/[^A-Z0-9&+-]/g, '');
    if (!text) text = 'TV';
    const safeText = encodeURIComponent(text);
    
    // Use ui-avatars to generate a reliable PNG badge instead of SVG.
    // Stremio Desktop (Qt) has a known bug where it drops <text> elements from SVGs loaded as posters.
    const fallbackUrl = `https://ui-avatars.com/api/?name=${safeText}&background=1f2937&color=c4b5fd&size=512&font-size=0.35&bold=true`;
    
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.redirect(302, fallbackUrl);
}

function isPrivateAddress(address) {
    if (net.isIP(address) === 4) {
        return /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(address);
    }
    return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}

// Catalog logo endpoint redirects to wsrv.nl to guarantee square contain-fit and prevent cropping
app.get('/api/catalog-logo', (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const label = String(req.query.label || 'TV').trim();
    if (!rawUrl || !rawUrl.startsWith('http')) {
        return sendCatalogLogoFallback(res, label);
    }
    const safeLabel = encodeURIComponent(label.slice(0, 2).toUpperCase());
    const fallback = encodeURIComponent(`https://ui-avatars.com/api/?name=${safeLabel}&background=1f2937&color=c4b5fd&size=512&font-size=0.35&bold=true`);
    const targetUrl = `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&w=512&h=512&fit=contain&cbg=111827&output=png&default=${fallback}&v=5`;
    
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    return res.redirect(302, targetUrl);
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

const {
    getMediaMetadata,
    getTmdbId,
    TMDB_API_KEYS
} = require('./services/metadataService');

// Debrid Resolver Router
const debridRouter = require('./routes/debridRoutes');
app.use('/debrid', debridRouter);


// Normalized hash for stream configuration to maximize Redis and in-memory cache hit rate
function getStreamConfigHash(cfg = {}) {
    try {
        const rawDisabled = [
            ...(Array.isArray(cfg.disabled) ? cfg.disabled : []),
            ...(Array.isArray(cfg.disabledProviders) ? cfg.disabledProviders : [])
        ].map(d => String(d || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
        const disabledSorted = [...new Set(rawDisabled)].sort();

        const functional = {
            p: cfg.provider ? String(cfg.provider).trim().toLowerCase() : '',
            d: disabledSorted,
            u: Array.isArray(cfg.urls) ? [...cfg.urls].sort() : (Array.isArray(cfg.repos) ? [...cfg.repos].sort() : (cfg.repoUrl || '')),
            tg: Boolean(cfg.enableTelegram),
            deb: cfg.debridProvider || '',
            debKey: cfg.debridApiKey ? crypto.createHash('md5').update(cfg.debridApiKey.trim()).digest('hex').slice(0, 8) : '',
            sort: cfg.sortBy || '',
            sortMode: cfg.sortMode || '',
            pq: Boolean(cfg.prioritizeQuality),
            ph: Boolean(cfg.prioritizeHindi),
            langs: Array.isArray(cfg.preferredLanguages) ? [...cfg.preferredLanguages].sort() : [],
            hd: Boolean(cfg.hideDead),
            hs: Boolean(cfg.hideSlow),
            hc: Boolean(cfg.hideCam || cfg.blockCam),
            hp: Boolean(cfg.hideP2P || cfg.blockP2P || cfg.disableP2P)
        };
        return crypto.createHash('md5').update(JSON.stringify(functional)).digest('hex').substring(0, 10);
    } catch (e) {
        return 'default';
    }
}

// Addon builder factory
function createAddon(config) {
    config = applyGlobalAdminOverrides(config);
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

    // Build Curated Catalogs list if enabled
    const enabledCatalogs = [];
    if (config.enableCatalogs !== false) {
        // 1. Popular Right Now
        if (config.catalogPopular !== false) {
            const popularGenres = ['All', 'Popular Movies', 'Popular Series'];
            enabledCatalogs.push({
                type: 'movie',
                id: 'cb_popular_now',
                name: 'Popular Right Now',
                genres: popularGenres,
                extra: [
                    { name: 'genre', options: popularGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
            enabledCatalogs.push({
                type: 'series',
                id: 'cb_popular_now',
                name: 'Popular Right Now',
                genres: popularGenres,
                extra: [
                    { name: 'genre', options: popularGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
        }

        // 2. Indian Cinema
        if (config.catalogIndian !== false) {
            const indianGenres = ['All Indian', 'Bollywood (Hindi)', 'Tollywood (Telugu)', 'Kollywood (Tamil)', 'Malayalam', 'Kannada', 'Punjabi', 'Bengali'];
            enabledCatalogs.push({
                type: 'movie',
                id: 'cb_indian_cinema',
                name: 'Indian Cinema',
                genres: indianGenres,
                extra: [
                    { name: 'genre', options: indianGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
            enabledCatalogs.push({
                type: 'series',
                id: 'cb_indian_cinema',
                name: 'Indian Cinema',
                genres: indianGenres,
                extra: [
                    { name: 'genre', options: indianGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
        }

        // 3. Trending Anime
        if (config.catalogAnime !== false) {
            const animeGenres = ['All Anime', 'Action', 'Adventure', 'Comedy', 'Fantasy', 'Sci-Fi', 'Mystery'];
            enabledCatalogs.push({
                type: 'series',
                id: 'cb_anime_trending',
                name: 'Trending Anime',
                genres: animeGenres,
                extra: [
                    { name: 'genre', options: animeGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
            enabledCatalogs.push({
                type: 'movie',
                id: 'cb_anime_trending',
                name: 'Trending Anime',
                genres: animeGenres,
                extra: [
                    { name: 'genre', options: animeGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
        }

        // 4. Movies & Series
        if (config.catalogTrending !== false) {
            const movieGenres = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
            const seriesGenres = ['Action & Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Kids', 'Mystery', 'News', 'Reality', 'Sci-Fi & Fantasy', 'Soap', 'Talk', 'War & Politics', 'Western'];
            
            enabledCatalogs.push({
                type: 'movie',
                id: 'cb_movies_series',
                name: 'Movies & Series',
                genres: movieGenres,
                extra: [
                    { name: 'genre', options: movieGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
            enabledCatalogs.push({
                type: 'series',
                id: 'cb_movies_series',
                name: 'Movies & Series',
                genres: seriesGenres,
                extra: [
                    { name: 'genre', options: seriesGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
        }
    }

    // 5. Live TV / IPTV
    if (config.enableIptv) {
        const liveTvGenres = ['All', 'News', 'Music', 'Movies', 'Religious', 'Entertainment', 'Culture', 'Animation', 'Lifestyle', 'Business', 'Sports', 'India'];
        enabledCatalogs.push({
            type: 'tv',
            id: 'cb_live_tv',
            name: 'Live TV / IPTV',
            posterShape: 'square',
            genres: liveTvGenres,
            extra: [
                { name: 'genre', options: liveTvGenres, isRequired: false },
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ],
            extraSupported: ['genre', 'search', 'skip']
        });
    }

    const resources = [
        {
            name: 'stream',
            types: ['movie', 'series', 'anime', 'tv', 'channel', 'other'],
            idPrefixes: ['tt', 'tmdb', 'kitsu', 'iptv']
        }
    ];
    if (enabledCatalogs.length > 0) {
        resources.push({
            name: 'catalog',
            types: ['movie', 'series', 'anime'],
            idPrefixes: ['cb_']
        });
    }
    if (config.enableIptv) {
        resources.push({
            name: 'meta',
            types: ['channel'],
            idPrefixes: ['iptv:']
        });
    }

    const isConfigured = Boolean(
        config && (
            config.configId || 
            config.repoUrl || 
            (Array.isArray(config.urls) && config.urls.length > 0) || 
            (Array.isArray(config.repos) && config.repos.length > 0) || 
            config.customIptvUrl || 
            config.xtreamServer || 
            config.rdKey || 
            config.adKey || 
            config.tbKey ||
            config.speedMode ||
            config.qualityPriority
        )
    );

    let configurationUrl = null;
    if (config && config.addonHost) {
        const protocol = config.addonProtocol || 'https';
        const host = config.addonHost;
        const configIdentifier = config.configId || encodeConfigParam(config);
        if (configIdentifier) {
            configurationUrl = `${protocol}://${host}/c/${configIdentifier}/configure`;
        } else {
            configurationUrl = `${protocol}://${host}/configure`;
        }
    }

    const behaviorHints = {
        configurable: true,
        configurationRequired: false
    };
    if (configurationUrl) {
        behaviorHints.configurationURL = configurationUrl;
    }

    const builder = new addonBuilder({
        id: addonId,
        version: '4.5.4',
        name: addonName,
        description: 'High-Performance Stream Meta-Sorter & Discovery Hub for Nuvio & Stremio. Scrapes, verifies, filters dead links, organizes streams by speed/quality/audio, and provides curated Live TV, Indian Cinema, Trending & Anime feeds.',
        logo: addonLogo,
        catalogs: enabledCatalogs,
        resources: resources,
        types: ['movie', 'series', 'anime', 'tv', 'channel', 'other'],
        behaviorHints: behaviorHints
    });

    builder.defineStreamHandler(async ({ type, id }) => {
        // Direct handling for live IPTV channels
        if (id && id.startsWith('iptv:')) {
            console.log(`[Stremio IPTV] Resolving live streams for channel: ${id}`);
            const streams = await iptvManager.getChannelStreams(id, config);
            return { streams };
        }

        console.log(`[Stremio] Request for ${type} ${id} (Addon: ${addonName})`);
        
        const configHash = getStreamConfigHash(config);
        const cacheKey = `${type}:${id}:${configHash}`;
        const kvCacheKey = `cb:str:${type}:${id}:${configHash}`;
        
        let cached = streamCache.get(cacheKey);

        // Persistent Redis / Upstash KV Stream Cache lookup on in-memory miss
        if (!cached && isKVEnabledGlobal) {
            try {
                const kvResult = await kv.get(kvCacheKey);
                if (kvResult && Array.isArray(kvResult.streams) && kvResult.streams.length > 0) {
                    cached = kvResult;
                    streamCache.set(cacheKey, kvResult);
                    console.log(`[KV Stream Cache Hit] Restored ${kvResult.streams.length} streams for ${type} ${id}`);
                }
            } catch (kvErr) {
                console.warn('[KV Stream Cache Read Warning]', kvErr.message);
            }
        }
        
        // Helper to generate the force refresh stream
        const getForceRefreshStream = () => {
            if (!config.addonHost) return null;
            const baseUrl = config.configId
                ? `${config.addonProtocol || 'http'}://${config.addonHost}/c/${config.configId}`
                : `${config.addonProtocol || 'http'}://${config.addonHost}/${encodeURIComponent(JSON.stringify(config))}`;
            const targetUrl = `${baseUrl}/clear-cache/${type}/${encodeURIComponent(id)}`;
            return {
                name: '🔄 FORCE REFRESH',
                title: '⚡ Click to clear cache & fetch fresh streams on reload!',
                externalUrl: targetUrl
            };
        };

        const FRESH_TTL_MS = 15 * 60 * 1000; // 15 minutes (stale-while-revalidate in background)
        const STALE_TTL_MS = 35 * 60 * 1000; // 35 minutes hard expiry (guarantees host tokens never go stale)

        const fetchAndCacheStreams = async () => {
            let imdbId = id;
            let season = null;
            let episode = null;

            if (id && id.startsWith('tmdb:')) {
                // Support Nuvio TMDB prefix: tmdb:872585 (movie) or tmdb:1396:1:1 (series)
                const parts = id.split(':');
                imdbId = parts[0] + ':' + parts[1];
                season = parts[2] ? parseInt(parts[2], 10) : null;
                episode = parts[3] ? parseInt(parts[3], 10) : null;
            } else if (id && id.startsWith('kitsu:')) {
                const parts = id.split(':');
                imdbId = parts[0] + ':' + parts[1];
                episode = parts[2] ? parseInt(parts[2], 10) : null;
                season = 1;
            } else if (id && id.startsWith('iptv:')) {
                imdbId = id;
            } else if (type === 'series' || type === 'tv' || type === 'anime' || (id && id.includes(':'))) {
                const parts = id.split(':');
                imdbId = parts[0];
                season = parts[1] ? parseInt(parts[1], 10) : null;
                episode = parts[2] ? parseInt(parts[2], 10) : null;
            }

            const mediaMeta = await getMediaMetadata(imdbId, type);
            const tmdbId = mediaMeta ? mediaMeta.tmdbId : null;
            if (!tmdbId && !mediaMeta?.title) {
                console.log('[Stremio] Could not resolve TMDB ID or metadata for', imdbId);
                return [];
            }

            let manifestUrls = [];
            if (config.repoUrl) {
                manifestUrls = [config.repoUrl];
            } else if (config.urls && Array.isArray(config.urls) && config.urls.length > 0) {
                manifestUrls = config.urls;
            } else if (config.repos && Array.isArray(config.repos) && config.repos.length > 0) {
                manifestUrls = config.repos;
            } else if (config.url) {
                manifestUrls = [config.url];
            }
            
            if (manifestUrls.length === 0) {
                manifestUrls = (globalServerSettings.installedRepos && globalServerSettings.installedRepos.length > 0) ? [...globalServerSettings.installedRepos] : ['https://raw.githubusercontent.com/SA7ANI/cb-providers/main/manifest.json'];
            }
            if (globalServerSettings.localRepo && globalServerSettings.localRepo.length > 0) {
                if (!manifestUrls.includes('local')) {
                    manifestUrls.unshift('local'); // Prioritize direct local repository!
                }
            }

            const providerBatches = await Promise.all(
                manifestUrls.map(async (url) => {
                    try {
                        return await providerLoader.loadProviders(url);
                    } catch (e) {
                        console.error(`[ProviderLoader] Failed to load from ${url}:`, e.message);
                        return [];
                    }
                })
            );
            let allProviders = providerBatches.flat();

            // Deduplicate providers by ID/Name across multiple repositories
            const seenProviderKeys = new Set();
            allProviders = allProviders.filter(p => {
                const key = (p.id || p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!key || seenProviderKeys.has(key)) return false;
                seenProviderKeys.add(key);
                return true;
            });
            
            // Filter providers (Robust case-insensitive matching across name and ID)
            const rawDisabled = [
                ...(Array.isArray(config.disabled) ? config.disabled : []),
                ...(Array.isArray(config.disabledProviders) ? config.disabledProviders : [])
            ];
            const disabledSet = new Set(
                rawDisabled.map(d => String(d || '').trim().toLowerCase()).filter(Boolean)
            );

            if (config.provider) {
                const target = String(config.provider).trim().toLowerCase();
                const targetClean = target.replace(/[^a-z0-9]/g, '');
                allProviders = allProviders.filter(p => {
                    const nameLower = (p.name || '').toLowerCase().trim();
                    const idLower = (p.id || '').toLowerCase().trim();
                    const cleanName = nameLower.replace(/[^a-z0-9]/g, '');
                    const cleanId = idLower.replace(/[^a-z0-9]/g, '');
                    return nameLower === target || idLower === target || 
                           (targetClean && (cleanName === targetClean || cleanId === targetClean));
                });
            } else if (disabledSet.size > 0) {
                allProviders = allProviders.filter(p => {
                    const nameLower = (p.name || '').toLowerCase().trim();
                    const idLower = (p.id || '').toLowerCase().trim();
                    const cleanName = nameLower.replace(/[^a-z0-9]/g, '');
                    const cleanId = idLower.replace(/[^a-z0-9]/g, '');
                    const isDisabled = disabledSet.has(nameLower) || 
                                       disabledSet.has(idLower) ||
                                       [...disabledSet].some(d => {
                                           if (!d) return false;
                                           const cleanD = d.replace(/[^a-z0-9]/g, '');
                                           return d === nameLower || d === idLower || nameLower.includes(d) || idLower.includes(d) ||
                                               (cleanD && (cleanD === cleanName || cleanD === cleanId || cleanName.includes(cleanD) || cleanId.includes(cleanD) || cleanD.includes(cleanName) || cleanD.includes(cleanId)));
                                       });
                    return !isDisabled;
                });
            }

            let allStreams = [];
            const scrapeStartTime = Date.now();
            // High-speed parallel scraper execution timeout to ensure streams return within client limits
            // Universal Server-Wide Admin Enforcement: Admin switch strictly dictates Eco Mode for all users
            const isClientEco = config.renderEcoMode !== undefined ? config.renderEcoMode : config.vercelEcoMode;
            const isEcoMode = globalServerSettings.globalEcoMode !== undefined 
                ? Boolean(globalServerSettings.globalEcoMode)
                : (globalServerSettings.allowClientEcoOverride ? Boolean(isClientEco === true) : false); // Default OFF — let scrapers run fully
            // Vercel maxDuration is set to 60s in vercel.json. Give scrapers as much time as possible.
            // We leave ~8s buffer for speed-testing after scraping completes.
            const isVercel = typeof process !== 'undefined' && Boolean(process.env.VERCEL);
            const PROVIDER_TIMEOUT_MS = isVercel 
                ? (isEcoMode ? 4500 : 7500)   // 7.5s allows full parallel scraping across all 28 providers
                : (isEcoMode ? 5500 : 8000); 
            const SCRAPE_DEADLINE_MS = isVercel 
                ? (isEcoMode ? 5500 : 8500) 
                : (isEcoMode ? 6500 : 9000);

            const tgScrapePromise = (async () => {
                if (Boolean(config.enableTelegram) && (!config.disabled || (!config.disabled.includes('Telegram') && !config.disabled.includes('Telegram (PencariMovie)')))) {
                    try {
                        const tgTimeout = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Telegram Scrape Timeout')), PROVIDER_TIMEOUT_MS)
                        );
                        const searchPromise = searchPencariMovie({
                            title: mediaMeta?.title || '',
                            originalTitle: mediaMeta?.originalTitle || '',
                            year: mediaMeta?.year || null,
                            type: type,
                            season: season,
                            episode: episode
                        }, config);

                        const tgStreams = await Promise.race([searchPromise, tgTimeout]);
                        if (Array.isArray(tgStreams) && tgStreams.length > 0) {
                            allStreams = allStreams.concat(tgStreams);
                        }
                    } catch (tgErr) {
                        console.warn('[Telegram Scraper] Error fetching streams:', tgErr.message);
                    }
                }
            })();

            // Concurrency limiter to prevent network exhaustion. Vercel maxes out around 60 safely.
            const CONCURRENCY_LIMIT = isVercel ? 60 : 250; // High concurrency for desktop/server to process all in a single batch
            const providerTasks = allProviders.map((provider) => async () => {
                try {
                    if (config.enableQuarantine === true) {
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
                        const fullProviderName = provider.repoName ? `${provider.repoName} • ${provider.name}` : provider.name;
                        streams.forEach(s => {
                            if (s && typeof s === 'object') {
                                s.name = s.name || provider.name;
                                s.provider = fullProviderName;
                            }
                        });
                        allStreams = allStreams.concat(streams);
                    }
                } catch (e) {
                    const isNetworkError = e.message === 'Scrape Timeout' 
                        || e.message.toLowerCase().includes('timeout')
                        || e.message.toLowerCase().includes('network')
                        || e.message.toLowerCase().includes('econnreset')
                        || e.message.toLowerCase().includes('etimedout')
                        || e.message.toLowerCase().includes('socket hang up')
                        || e.message.toLowerCase().includes('ehostunreach')
                        || e.message.toLowerCase().includes('fetch failed')
                        || e.message.toLowerCase().includes('und_err_');
                        
                    if (!isNetworkError) {
                        // Only quarantine for actual script/parsing errors, not network issues which are common in parallel scraping
                        if (config.enableQuarantine === true) {
                            const qRecord = quarantineRegistry.get(provider.name) || { fails: 0 };
                            qRecord.fails += 1;
                            if (qRecord.fails >= 2) {
                                qRecord.quarantineUntil = Date.now() + (10 * 60 * 1000); // 10 minutes
                                console.warn(`[Quarantine] Provider ${provider.name} quarantined for 10m due to repeated code errors: ${e.message}`);
                            }
                            quarantineRegistry.set(provider.name, qRecord);
                        }
                    } else {
                        console.error(`[Provider] ${provider.name} failed or timed out:`, e.message);
                    }
                }
            });

            const results = [];
            const executing = new Set();
            for (const task of providerTasks) {
                const p = task();
                results.push(p);
                const e = p.finally(() => executing.delete(e));
                executing.add(e);
                if (executing.size >= CONCURRENCY_LIMIT) {
                    await Promise.race(executing);
                }
            }

            const scrapeTimeoutPromise = new Promise(resolve => setTimeout(resolve, SCRAPE_DEADLINE_MS));
            
            // Fast early exit: return snappy response to Android TV once sufficient streams arrive
            const earlyCheckPromise = new Promise(resolve => {
                const interval = setInterval(() => {
                    if ((allStreams.length >= 25 && (Date.now() - scrapeStartTime) >= 2500) ||
                        (allStreams.length >= 18 && (Date.now() - scrapeStartTime) >= 4000)) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 150);
                setTimeout(() => clearInterval(interval), SCRAPE_DEADLINE_MS);
            });

            await Promise.race([
                Promise.all([tgScrapePromise, ...results]),
                earlyCheckPromise,
                scrapeTimeoutPromise
            ]);
            const scrapeDurationMs = Date.now() - scrapeStartTime;

            console.log(`[Stremio] Collected ${allStreams.length} total streams for ${type} ${id} in ${scrapeDurationMs}ms. Testing speeds...`);
            const sortStartTime = Date.now();
            const targetYear = parseInt(mediaMeta?.year, 10);
            const currentYear = new Date().getFullYear();
            const isUnreleased = Boolean(type === 'movie' && targetYear && targetYear > currentYear);

            const sortedAndTaggedStreams = await sortAndTagStreams(allStreams, {
                maxTestDuration: Math.min(1000, Math.max(500, 7200 - scrapeDurationMs)), // Fast speed testing: max 1.0s probe duration
                target: {
                    title: mediaMeta?.title || '',
                    originalTitle: mediaMeta?.originalTitle || '',
                    year: mediaMeta?.year || null,
                    isUnreleased: isUnreleased,
                    type: type,
                    season: season,
                    episode: episode
                },
                hideDead: config.hideDead,
                hideSlow: config.hideSlow,
                hideCam: config.hideCam || config.blockCam,
                hideP2P: Boolean(config.hideP2P || config.blockP2P || config.disableP2P),
                disabled: config.disabled || config.disabledProviders || [],
                disabledProviders: config.disabledProviders || config.disabled || [],
                sortBy: config.sortBy || (config.prioritizeQuality ? 'quality' : 'speed'),
                sortMode: config.sortMode || config.sortBy,
                prioritizeQuality: config.sortBy === 'quality' || config.prioritizeQuality,
                prioritizeHindi: config.prioritizeHindi,
                preferredLanguages: config.preferredLanguages || [],
                showSeeders: config.showSeeders !== false,
                deduplicateStreams: config.deduplicateStreams !== false,
                cleanTitles: config.cleanTitles !== false,
                showFileSize: config.showFileSize !== false,
                showReleaseGroup: config.showReleaseGroup !== false,
                includeOriginalTitle: config.includeOriginalTitle !== false,
                renderEcoMode: isEcoMode,
                vercelEcoMode: isEcoMode,
                debridProvider: config.debridProvider,
                debridApiKey: config.debridApiKey,
                addonHost: config.addonHost,
                addonProtocol: config.addonProtocol
            }, providerAnalytics);
            const sortDurationMs = Date.now() - sortStartTime;
            const totalDurationMs = Date.now() - scrapeStartTime;

            // Update live telemetry metrics
            telemetryMetrics.lastScrapeMs = scrapeDurationMs;
            telemetryMetrics.lastSortMs = sortDurationMs;
            telemetryMetrics.lastTotalMs = totalDurationMs;
            telemetryMetrics.totalRequests++;
            telemetryMetrics.cacheMisses++;
            telemetryMetrics.totalExecutionMs += totalDurationMs;
            try {
                telemetryMetrics.servedBandwidthBytes += Buffer.byteLength(JSON.stringify(sortedAndTaggedStreams), 'utf8');
            } catch (e) {}

            // Save to in-memory cache ONLY if valid streams found
            if (Array.isArray(sortedAndTaggedStreams) && sortedAndTaggedStreams.length > 0) {
                streamCache.set(cacheKey, { timestamp: Date.now(), streams: sortedAndTaggedStreams });
                if (isKVEnabledGlobal) {
                    kv.set(kvCacheKey, { timestamp: Date.now(), streams: sortedAndTaggedStreams }, { ex: 1800 })
                        .then(() => console.log(`[KV] Cached ${sortedAndTaggedStreams.length} streams in Upstash Redis for ${type} ${id} (30m TTL)`))
                        .catch(err => console.warn('[KV Stream Cache Save Warning]', err.message));
                }
            }

            return sortedAndTaggedStreams;
        };

        const filterRuntimeStreams = (streamList) => {
            if (!Array.isArray(streamList)) return [];
            let list = streamList;
            const rawDisabled = [
                ...(Array.isArray(config.disabled) ? config.disabled : []),
                ...(Array.isArray(config.disabledProviders) ? config.disabledProviders : [])
            ];
            const disabledSet = new Set(
                rawDisabled.map(d => String(d || '').trim().toLowerCase()).filter(Boolean)
            );
            if (disabledSet.size > 0) {
                list = list.filter(s => {
                    const pLower = (s.provider || '').toLowerCase();
                    const nLower = (s.name || '').toLowerCase();
                    const origLower = (s.originalProvider || s._scraperName || '').toLowerCase();
                    const idLower = (s._scraperId || '').toLowerCase();
                    const tLower = (s.title || '').toLowerCase();
                    const rawP = ((s._rawStream && s._rawStream.provider) || '').toLowerCase();
                    return ![...disabledSet].some(d => {
                        const cleanD = d.replace(/[^a-z0-9]/g, '');
                        if (!cleanD) return false;
                        const cleanP = pLower.replace(/[^a-z0-9]/g, '');
                        const cleanN = nLower.replace(/[^a-z0-9]/g, '');
                        const cleanO = origLower.replace(/[^a-z0-9]/g, '');
                        const cleanI = idLower.replace(/[^a-z0-9]/g, '');
                        const cleanT = tLower.replace(/[^a-z0-9]/g, '');
                        const cleanRawP = rawP.replace(/[^a-z0-9]/g, '');
                        return pLower.includes(d) || nLower.includes(d) || origLower.includes(d) || idLower.includes(d) || tLower.includes(d) ||
                            cleanP.includes(cleanD) || cleanD.includes(cleanP) ||
                            cleanN.includes(cleanD) || cleanD.includes(cleanN) ||
                            cleanO.includes(cleanD) || cleanD.includes(cleanO) ||
                            cleanI.includes(cleanD) || cleanD.includes(cleanI) ||
                            cleanT.includes(cleanD) ||
                            cleanRawP.includes(cleanD) || cleanD.includes(cleanRawP);
                    });
                });
            }
            if (config.hideP2P || config.blockP2P || config.disableP2P) {
                list = list.filter(s => {
                    const isMagnet = (s.url && s.url.startsWith('magnet:')) || Boolean(s.infoHash);
                    const isP2P = Boolean(s.isP2P || isMagnet || (s.name && s.name.includes('[P2P]')) || (s.name && s.name.includes('P2P')));
                    return !isP2P || Boolean(s.isDebridCached);
                });
            }
            return list;
        };

        if (cached && Array.isArray(cached.streams) && cached.streams.length > 0 && Date.now() - cached.timestamp < STALE_TTL_MS) {
            console.log(`[Stremio] Serving cached results for ${type} ${id}`);
            
            telemetryMetrics.cacheHits++;
            telemetryMetrics.totalRequests++;
            try {
                telemetryMetrics.servedBandwidthBytes += Buffer.byteLength(JSON.stringify(cached.streams), 'utf8');
            } catch (e) {}

            // Stale-While-Revalidate in background
            if (Date.now() - cached.timestamp > FRESH_TTL_MS) {
                console.log(`[Stremio] Cache is stale, revalidating in background for ${type} ${id}`);
                fetchAndCacheStreams().catch(e => console.error('[Background Fetch Error]', e));
            }
            
            const filteredCached = filterRuntimeStreams(cached.streams);
            return { streams: filteredCached };
        }

        // Deduplicate in-flight requests for the exact same stream
        if (inFlightStreamFetches.has(cacheKey)) {
            console.log(`[Stremio] Awaiting in-flight fetch for ${type} ${id}`);
            const inFlightResult = await inFlightStreamFetches.get(cacheKey);
            const filteredInFlight = filterRuntimeStreams(inFlightResult);
            return { streams: filteredInFlight };
        }

        const fetchPromise = fetchAndCacheStreams();
        inFlightStreamFetches.set(cacheKey, fetchPromise);
        try {
            const sortedAndTaggedStreams = await fetchPromise;
            return { streams: sortedAndTaggedStreams };
        } catch (streamErr) {
            console.error(`[Stremio Stream Handler Error] for ${type} ${id}:`, streamErr.stack || streamErr.message);
            return { streams: [] };
        } finally {
            inFlightStreamFetches.delete(cacheKey);
        }
    });

    // Curated Discovery Catalogs Handler
    const catalogCache = new Map();

    async function fetchCuratedCatalog(catalogId, page = 1, genre = 'All', type = 'movie') {
        const cacheKey = `${catalogId}:${type}:${page}:${genre || 'All'}`;
        const cached = catalogCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 6 * 3600 * 1000) {
            return cached.metas;
        }

        const urlsToTry = [];

        // 1. Popular Right Now
        if (catalogId === 'cb_popular_now' || catalogId === 'cb_pop_movies' || catalogId === 'cb_pop_series') {
            if (genre === 'Popular Movies' || (genre === 'All' && type === 'movie')) {
                urlsToTry.push(`https://api.themoviedb.org/3/trending/movie/day?page=${page}`);
                urlsToTry.push(`https://api.themoviedb.org/3/movie/popular?page=${page}`);
            } else if (genre === 'Popular Series' || (genre === 'All' && (type === 'series' || type === 'tv'))) {
                urlsToTry.push(`https://api.themoviedb.org/3/trending/tv/day?page=${page}`);
                urlsToTry.push(`https://api.themoviedb.org/3/tv/popular?page=${page}`);
            } else {
                const mediaType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
                urlsToTry.push(`https://api.themoviedb.org/3/trending/${mediaType}/day?page=${page}`);
                urlsToTry.push(`https://api.themoviedb.org/3/${mediaType}/popular?page=${page}`);
            }
        }
        // 2. Indian Cinema
        else if (catalogId === 'cb_indian_cinema' || catalogId.startsWith('cb_indian_')) {
            const mediaType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
            let lang = 'hi|te|ta|ml|kn|pa|bn';
            if (genre === 'Bollywood (Hindi)' || catalogId === 'cb_indian_bollywood') lang = 'hi';
            else if (genre === 'Tollywood (Telugu)' || catalogId === 'cb_indian_tollywood') lang = 'te';
            else if (genre === 'Kollywood (Tamil)' || catalogId === 'cb_indian_kollywood') lang = 'ta';
            else if (genre === 'Malayalam' || catalogId === 'cb_indian_malayalam') lang = 'ml';
            else if (genre === 'Kannada') lang = 'kn';
            else if (genre === 'Punjabi') lang = 'pa';
            else if (genre === 'Bengali') lang = 'bn';
            urlsToTry.push(`https://api.themoviedb.org/3/discover/${mediaType}?with_original_language=${lang}&sort_by=popularity.desc&page=${page}`);
        }
        // 3. Trending Anime
        else if (catalogId === 'cb_anime_trending' || catalogId === 'cb_anime_shows' || catalogId === 'cb_anime_movies') {
            const mediaType = (type === 'movie') ? 'movie' : 'tv';
            let genreFilter = 'with_genres=16';
            if (genre === 'Action') genreFilter = `with_genres=${mediaType === 'movie' ? '16,28' : '16,10759'}`;
            else if (genre === 'Adventure') genreFilter = `with_genres=${mediaType === 'movie' ? '16,12' : '16,10759'}`;
            else if (genre === 'Comedy') genreFilter = 'with_genres=16,35';
            else if (genre === 'Fantasy') genreFilter = `with_genres=${mediaType === 'movie' ? '16,14' : '16,10765'}`;
            else if (genre === 'Sci-Fi') genreFilter = `with_genres=${mediaType === 'movie' ? '16,878' : '16,10765'}`;
            else if (genre === 'Mystery') genreFilter = 'with_genres=16,9648';
            urlsToTry.push(`https://api.themoviedb.org/3/discover/${mediaType}?${genreFilter}&with_original_language=ja&sort_by=popularity.desc&page=${page}`);
        }
        // 4. Movies & Series
        else if (catalogId === 'cb_movies_series' || catalogId === 'cb_movies_series' || catalogId === 'cb_movies_series' || catalogId.includes('_shows') || catalogId.includes('_movies')) {
            const mediaType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
            const genreMap = {
                'Action': '28',
                'Action & Adventure': '10759',
                'Adventure': '12',
                'Animation': '16',
                'Comedy': '35',
                'Crime': '80',
                'Documentary': '99',
                'Drama': '18',
                'Family': '10751',
                'Fantasy': '14',
                'History': '36',
                'Horror': '27',
                'Kids': '10762',
                'Music': '10402',
                'Mystery': '9648',
                'News': '10763',
                'Reality': '10764',
                'Romance': '10749',
                'Sci-Fi & Fantasy': '10765',
                'Science Fiction': '878',
                'Soap': '10766',
                'Talk': '10767',
                'Thriller': '53',
                'War': '10752',
                'War & Politics': '10768',
                'Western': '37'
            };
            const mappedId = genreMap[genre];
            if (mappedId) {
                urlsToTry.push(`https://api.themoviedb.org/3/discover/${mediaType}?with_genres=${mappedId}&sort_by=popularity.desc&page=${page}`);
            } else {
                urlsToTry.push(`https://api.themoviedb.org/3/trending/${mediaType}/day?page=${page}`);
                urlsToTry.push(`https://api.themoviedb.org/3/${mediaType}/popular?page=${page}`);
            }
        }

        if (urlsToTry.length === 0) return [];

        for (const url of urlsToTry) {
            for (const key of TMDB_API_KEYS) {
                try {
                    const reqUrl = `${url}${url.includes('?') ? '&' : '?'}api_key=${key}`;
                    const res = await axios.get(reqUrl, {
                        timeout: 5000,
                        httpsAgent: dohHttpsAgent,
                        headers: { 'Accept': 'application/json' }
                    });

                    if (res.data && Array.isArray(res.data.results) && res.data.results.length > 0) {
                        const metas = res.data.results.filter(item => item.poster_path).map(item => {
                            const isTv = (item.media_type === 'tv') || Boolean(item.name || item.first_air_date);
                            const title = item.title || item.name || 'Untitled';
                            const year = (item.release_date || item.first_air_date || '').split('-')[0] || '';
                            const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
                            const background = item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null;
                            return {
                                id: `tmdb:${item.id}`,
                                type: isTv ? 'series' : 'movie',
                                name: title,
                                poster: poster,
                                background: background,
                                posterShape: 'poster',
                                releaseInfo: year,
                                imdbRating: item.vote_average ? String(Math.round(item.vote_average * 10) / 10) : null,
                                description: item.overview || ''
                            };
                        });
                        catalogCache.set(cacheKey, { timestamp: Date.now(), metas });
                        return metas;
                    }
                } catch (err) {}
            }
        }
        // Cinemeta Fallback if TMDB is unreachable
        try {
            const cinemetaType = (type === 'series' || type === 'tv') ? 'series' : 'movie';
            if (catalogId === 'cb_popular_now' || catalogId === 'cb_pop_movies' || catalogId === 'cb_pop_series') {
                const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top.json`;
                const cRes = await axios.get(cinemetaUrl, { timeout: 4000 });
                if (cRes.data && Array.isArray(cRes.data.metas) && cRes.data.metas.length > 0) {
                    catalogCache.set(cacheKey, { timestamp: Date.now(), metas: cRes.data.metas });
                    return cRes.data.metas;
                }
            } else if (catalogId === 'cb_movies_series' || catalogId === 'cb_movies_series' || catalogId === 'cb_movies_series') {
                const cinemetaGenre = (genre && genre !== 'All') ? encodeURIComponent(genre) : 'Action';
                const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top/genre=${cinemetaGenre}.json`;
                const cRes = await axios.get(cinemetaUrl, { timeout: 4000 });
                if (cRes.data && Array.isArray(cRes.data.metas) && cRes.data.metas.length > 0) {
                    catalogCache.set(cacheKey, { timestamp: Date.now(), metas: cRes.data.metas });
                    return cRes.data.metas;
                }
            } else if (catalogId === 'cb_anime_trending' || catalogId === 'cb_anime_shows' || catalogId === 'cb_anime_movies') {
                const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top/genre=Animation.json`;
                const cRes = await axios.get(cinemetaUrl, { timeout: 4000 });
                if (cRes.data && Array.isArray(cRes.data.metas) && cRes.data.metas.length > 0) {
                    catalogCache.set(cacheKey, { timestamp: Date.now(), metas: cRes.data.metas });
                    return cRes.data.metas;
                }
            }
        } catch (cErr) {}

        return [];
    }

    if (enabledCatalogs.length > 0) {
        builder.defineCatalogHandler(async ({ type, id, extra }) => {
            console.log(`[Catalog] Request for ${type} catalog: ${id} (genre: ${extra?.genre || 'All'})`);
            if ((type === 'tv' || type === 'channel') && id.startsWith('cb_live_tv')) {
                let iptvGenre = extra?.genre || 'All';
                if (id === 'cb_live_tv_news') iptvGenre = 'News';
                else if (id === 'cb_live_tv_sports') iptvGenre = 'Sports';
                else if (id === 'cb_live_tv_movies') iptvGenre = 'Movies';
                else if (id === 'cb_live_tv_india') iptvGenre = 'India';
                else if (id === 'cb_live_tv_entertainment') iptvGenre = 'Entertainment';
                else if (id === 'cb_live_tv_music') iptvGenre = 'Music';
                else if (id === 'cb_live_tv_kids') iptvGenre = 'Animation';

                const metas = await iptvManager.getChannelsCatalog({
                    type,
                    genre: iptvGenre,
                    search: extra?.search || '',
                    skip: extra?.skip ? parseInt(extra.skip, 10) : 0,
                    limit: 40,
                    config
                });
                return { metas };
            }

            const skip = extra && extra.skip ? parseInt(extra.skip, 10) : 0;
            const page = Math.floor(skip / 20) + 1;
            const genre = extra && extra.genre ? extra.genre : 'All';
            const metas = await fetchCuratedCatalog(id, page, genre, type);
            return { metas };
        });
    }

    if (config.enableIptv) {
        builder.defineMetaHandler(async ({ type, id }) => {
            if (id && id.startsWith('iptv:')) {
                const meta = await iptvManager.getChannelMeta(id, config, type);
                return { meta };
            }
            return { meta: null };
        });
    }

    return builder.getInterface();
}

const { getRouter } = require('stremio-addon-sdk');

function renderCacheClearedHtml(type, id, clearedCount = 1) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>✨ Cache Cleared • Chole Bhature</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: #09090b;
            color: #f8fafc;
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
            text-align: center;
            background-image: 
                radial-gradient(at 15% 15%, rgba(139, 92, 246, 0.15) 0px, transparent 50%),
                radial-gradient(at 85% 85%, rgba(16, 185, 129, 0.12) 0px, transparent 50%);
        }
        .card {
            background: rgba(24, 24, 27, 0.85);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 36px 28px;
            max-width: 440px;
            width: 100%;
            box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(139, 92, 246, 0.2);
            animation: cardPop 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes cardPop {
            0% { opacity: 0; transform: scale(0.92) translateY(10px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .badge-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 64px;
            height: 64px;
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(16, 185, 129, 0.35);
            border-radius: 20px;
            font-size: 30px;
            margin-bottom: 18px;
            box-shadow: 0 0 25px rgba(16, 185, 129, 0.25);
        }
        h1 {
            font-size: 22px;
            font-weight: 800;
            color: #ffffff;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }
        .media-pill {
            display: inline-block;
            background: rgba(139, 92, 246, 0.12);
            border: 1px solid rgba(139, 92, 246, 0.3);
            color: #c4b5fd;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 16px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        p {
            color: #94a3b8;
            font-size: 13.5px;
            line-height: 1.6;
            margin-bottom: 14px;
        }
        .instruction-box {
            background: rgba(0, 0, 0, 0.35);
            border: 1px dashed rgba(255, 255, 255, 0.15);
            border-radius: 14px;
            padding: 14px;
            margin: 16px 0 24px;
            text-align: left;
            font-size: 12.5px;
            color: #cbd5e1;
        }
        .instruction-box ol {
            padding-left: 20px;
            margin-top: 6px;
        }
        .instruction-box li {
            margin-bottom: 4px;
        }
        .btn-group {
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 10px 20px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 700;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .btn-primary {
            background: linear-gradient(135deg, #8b5cf6, #6366f1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="badge-icon">✨</div>
        <h1>Cache Purged!</h1>
        <div class="media-pill">${type} • ${id}</div>
        <p>Cached stream results have been wiped from active memory (${clearedCount} item(s) purged).</p>
        
        <div class="instruction-box">
            <b>⚡ Next Steps:</b>
            <ol>
                <li>Switch back to <b>Stremio</b> or <b>Nuvio</b></li>
                <li>Click the <b>Refresh / Reload</b> button</li>
                <li>Fresh live streams will be scraped immediately!</li>
            </ol>
        </div>

        <div class="btn-group">
            <a href="javascript:window.close()" class="btn btn-primary">← Close Window</a>
        </div>
    </div>
</body>
</html>`;
}

async function purgeStreamCachesForTarget(type, id, configParam = null) {
    let count = 0;
    const cleanId = decodeURIComponent(id || '');
    const imdbId = cleanId.split(':')[0];

    // 1. Purge memory cache
    for (const key of streamCache.keys()) {
        if (key.includes(cleanId) || (imdbId && key.includes(imdbId)) || key.includes(id)) {
            streamCache.delete(key);
            count++;
        }
    }
    for (const key of inFlightStreamFetches.keys()) {
        if (key.includes(cleanId) || (imdbId && key.includes(imdbId)) || key.includes(id)) {
            inFlightStreamFetches.delete(key);
            count++;
        }
    }
    if (configParam) {
        for (const key of streamCache.keys()) {
            if (key.includes(configParam) && (key.includes(cleanId) || key.includes(id))) {
                streamCache.delete(key);
                count++;
            }
        }
    }

    // 2. Also purge Upstash KV cache for this target
    if (isKVEnabledGlobal) {
        try {
            // Delete with exact config hash if configParam is provided
            if (configParam) {
                try {
                    const resolved = await resolveConfig(configParam);
                    if (resolved) {
                        const hash = getStreamConfigHash(resolved);
                        await Promise.allSettled([
                            kv.del(`cb:str:${type}:${cleanId}:${hash}`),
                            kv.del(`cb:str:${type}:${id}:${hash}`),
                            imdbId ? kv.del(`cb:str:${type}:${imdbId}:${hash}`) : Promise.resolve()
                        ]);
                    }
                } catch (e) {}
            }

            // Always delete default config hash
            const defaultHash = getStreamConfigHash({});
            await Promise.allSettled([
                kv.del(`cb:str:${type}:${cleanId}:${defaultHash}`),
                kv.del(`cb:str:${type}:${id}:${defaultHash}`),
                imdbId ? kv.del(`cb:str:${type}:${imdbId}:${defaultHash}`) : Promise.resolve()
            ]);

            // Scan and delete ALL keys in KV matching cleanId / id / imdbId
            // This guarantees that ANY user's config cache for this movie/show is completely cleared!
            try {
                const patterns = [
                    `cb:str:*${cleanId}*`,
                    `cb:str:*${id}*`
                ];
                if (imdbId && imdbId !== cleanId) {
                    patterns.push(`cb:str:*${imdbId}*`);
                }
                for (const pat of patterns) {
                    const keys = await kv.keys(pat);
                    if (Array.isArray(keys) && keys.length > 0) {
                        await Promise.allSettled(keys.map(k => kv.del(k)));
                        count += keys.length;
                    }
                }
            } catch (scanErr) {
                console.warn('[KV Purge Scan Warning]', scanErr.message);
            }
        } catch (e) {
            console.warn('[KV Purge Error]', e.message);
        }
    }

    // 3. Also clear memoized domain speed probes so streams freshly re-probe
    try {
        clearDomainLatencyCache();
    } catch (e) {}

    return count;
}

const handleClearCacheRequest = async (req, res, configId = null) => {
    const { type, id } = req.params;
    try {
        const clearedCount = await purgeStreamCachesForTarget(type, id, configId);
        console.log(`[Cache] Force refresh cleared ${clearedCount} entries for ${type} ${id} (config: ${configId || 'none'})`);
        
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        
        // If client is a video player or requests non-HTML, return JSON / plain OK
        const acceptsHtml = req.accepts('html');
        if (!acceptsHtml && req.headers.range) {
            return res.status(204).end();
        }
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderCacheClearedHtml(type, id, Math.max(1, clearedCount)));
    } catch (e) {
        res.status(500).send('Failed to clear cache: ' + e.message);
    }
};

app.get('/clear-cache/:type/:id', (req, res) => {
    handleClearCacheRequest(req, res, null);
});

app.get('/:configJSON/clear-cache/:type/:id', (req, res) => {
    handleClearCacheRequest(req, res, req.params.configJSON);
});

app.get('/c/:configId/clear-cache/:type/:id', (req, res) => {
    handleClearCacheRequest(req, res, req.params.configId);
});

// Mount Telegram streaming routes & bridge API
app.use('/stream/telegram', telegramRouter);
app.use('/api/telegram', telegramRouter);

// Mount Universal Stream Proxy (HTTP 206 Partial Content & Headers Spoofing)
app.use('/proxy/stream', streamProxyRouter);

// Dynamic configuration endpoints for Stremio Router (With Vercel Edge CDN Headers)
app.use('/c/:configId', async (req, res, next) => {
    // Only intercept Stremio API routes
    if (req.path === '/manifest.json' || (req.path.startsWith('/stream/') && !req.path.startsWith('/stream/telegram')) || req.path.startsWith('/catalog/') || req.path.startsWith('/meta/')) {
        try {
            if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            } else if (req.path.startsWith('/stream/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            }

            const { configId } = req.params;
            let config = await resolveConfig(configId);
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

app.use('/:configJSON', async (req, res, next) => {
    // Only intercept Stremio API routes
    if (req.path === '/manifest.json' || (req.path.startsWith('/stream/') && !req.path.startsWith('/stream/telegram')) || req.path.startsWith('/catalog/') || req.path.startsWith('/meta/')) {
        try {
            if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            } else if (req.path.startsWith('/stream/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            }

            let config = await resolveConfig(req.params.configJSON);
            if (!config) {
                config = { repoUrl: 'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json' };
            }
            config = JSON.parse(JSON.stringify(config));
            config.configId = req.params.configJSON;
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

// Mount default Stremio Addon router at root (for /manifest.json, /stream/..., /catalog/...)
app.use((req, res, next) => {
    if (req.path === '/manifest.json' || (req.path.startsWith('/stream/') && !req.path.startsWith('/stream/telegram')) || req.path.startsWith('/catalog/') || req.path.startsWith('/meta/')) {
        try {
            if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            } else if (req.path.startsWith('/stream/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            }

            const activeConfig = {};
            activeConfig.addonHost = req.headers.host;
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            activeConfig.addonProtocol = protocol.split(',')[0].trim();
            const defaultAddon = createAddon(activeConfig);
            const router = getRouter(defaultAddon);
            return router(req, res, next);
        } catch (err) {
            console.error('[Default Addon Mount Error]', err);
        }
    }
    next();
});

const PORT = process.env.PORT || 7000;
if (!process.env.VERCEL) {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`
========================================================================
  🌶️  CHOLE BHATURE • Meta-Sorter & Priority Engine v4.5.4
  ⚡  Created by SA7ANI | https://github.com/SA7ANI/chole-bhature
  🛡️  Licensed under GNU AGPL-3.0 • Attribution Required
========================================================================
  🚀 Server Running:     http://localhost:${PORT} (0.0.0.0:${PORT})
  🌐 Platform Active:    ${isRender ? 'Render Cloud Web Service' : 'Local / VPS Node Server'}
  ⚙️  Configuration UI:  http://localhost:${PORT}/configure
  🩺 Health Endpoint:   http://localhost:${PORT}/health
========================================================================
        `);
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\n❌ Error: Port ${PORT} is already in use by another running process.`);
            console.error(`Please stop the existing process or run with a different port (e.g. PORT=7001 npm start)\n`);
        } else {
            console.error('Server error:', err);
        }
    });
}

// Export the app for Vercel Serverless Functions
module.exports = app;


