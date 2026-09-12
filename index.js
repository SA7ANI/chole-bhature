const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const path = require('path');
const providerLoader = require('./providerLoader');
const { sortAndTagStreams, clearDomainLatencyCache } = require('./streamTester');
const { setDohEnabled, setDohProvider, getDohConfig, dohHttpsAgent } = require('./dohResolver');
const iptvManager = require('./iptvManager');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

// Live Analytics and Quarantine Registries
const providerAnalytics = new Map();
const quarantineRegistry = new Map();

// Core configuration dependency check (Cloud & Serverless Safe)
if (!fs.existsSync(path.join(__dirname, '.secret')) && !process.env.VERCEL && !process.env.NODE_ENV) {
    try {
        fs.writeFileSync(path.join(__dirname, '.secret'), '');
    } catch (e) {}
}

const app = express();

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
let lastSavedConfig = null;
let lastSavedConfigId = null;

function loadUserConfigs() {
    try {
        if (fs.existsSync(CONFIGS_FILE)) {
            const raw = fs.readFileSync(CONFIGS_FILE, 'utf8');
            const data = JSON.parse(raw);
            for (const [k, v] of Object.entries(data)) {
                userConfigs.set(k, v);
                lastSavedConfig = v;
                lastSavedConfigId = k;
            }
            console.log(`[Config] Loaded ${userConfigs.size} user configurations.`);
        }
    } catch (e) {
        console.error('[Config] Failed to load user_configs.json:', e.message);
    }
}

function saveUserConfig(configId, configData) {
    userConfigs.set(configId, configData);
    lastSavedConfig = configData;
    lastSavedConfigId = configId;
    try {
        const obj = {};
        for (const [k, v] of userConfigs.entries()) {
            obj[k] = v;
        }
        fs.writeFileSync(CONFIGS_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        // Safe failover for read-only serverless filesystems (e.g. Vercel)
    }
}
loadUserConfigs();

function encodeConfigParam(cfg) {
    try {
        if (!cfg || typeof cfg !== 'object') return '';
        const clean = { ...cfg };
        delete clean.addonHost;
        delete clean.addonProtocol;
        if (Object.keys(clean).length === 0) return '';
        return Buffer.from(JSON.stringify(clean), 'utf8').toString('base64url');
    } catch (e) {
        return '';
    }
}

// Multi-Device Stateless & Persistent Configuration Resolver
const activeConfigsTracker = new Set();

function resolveConfig(param) {
    if (!param) return null;
    if (typeof param !== 'string') return null;
    param = param.replace(/\/configure\/?$/, '').replace(/\.json$/, '').trim();
    if (!param) return null;

    if (param === 'latest' && lastSavedConfig) {
        return lastSavedConfig;
    }
    
    // 1. Priority 1: Check in-memory & persistent userConfigs map FIRST
    // This ensures any changes saved via the Web UI immediately update the catalog in Nuvio/Stremio
    const stored = userConfigs.get(param);
    if (stored) {
        activeConfigsTracker.add(param);
        return stored;
    }

    if (lastSavedConfigId === param && lastSavedConfig) {
        return lastSavedConfig;
    }

    // 2. Try URL-decoded JSON
    try {
        if (param.startsWith('{') || param.startsWith('%7B')) {
            const parsed = JSON.parse(decodeURIComponent(param));
            if (parsed && typeof parsed === 'object') {
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
                activeConfigsTracker.add(param);
                return parsed;
            }
        }
    } catch (e) {}

    // 4. Fallback to lastSavedConfig if available on single-user instances
    if (lastSavedConfig) {
        return lastSavedConfig;
    }

    return null;
}

// Background pre-warming: pre-load all provider repositories on startup to eliminate cold-start delay.
// Do not do this during a Vercel function cold start: it starts several outbound
// requests before the first API request can be served and can exhaust its time budget.
async function prewarmProviders() {
    try {
        const reposToWarm = new Set([
            'https://cdn.jsdelivr.net/gh/D3adlyRocket/All-in-One-Nuvio@main/manifest.json',
            'https://cdn.jsdelivr.net/gh/yoruix/nuvio-providers@main/manifest.json',
            'https://codeberg.org/eclipsia/nuvio-plugin/raw/branch/main/manifest.json'
        ]);
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

app.get('/manifest.json', (req, res, next) => {
    if (req.query.v || req.query.pwa) {
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
app.use(express.static(path.join(__dirname, 'public')));

app.get(['/', '/configure', '/index.html'], (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve configure page on configId routes
app.get(['/c/:configId', '/c/:configId/configure', '/configure/:configId'], (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API to save configuration (Instant Sync)
app.post('/api/config/save', (req, res) => {
    try {
        let { configId, token, config } = req.body;
        if (!configId && token) {
            configId = token;
        }
        if (!configId) {
            configId = crypto.randomBytes(4).toString('hex');
        }
        
        saveUserConfig(configId, config);
        if (token && token !== configId) {
            saveUserConfig(token, config);
        }
        
        // Invalidate stream cache for this configuration
        for (const key of streamCache.keys()) {
            if (key.includes(configId) || (token && key.includes(token))) {
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

// API to get latest saved configuration on this instance
app.get('/api/config/latest', (req, res) => {
    if (lastSavedConfig) {
        return res.json({ success: true, configId: lastSavedConfigId, config: lastSavedConfig });
    }
    if (userConfigs.size > 0) {
        const lastEntry = Array.from(userConfigs.entries()).pop();
        return res.json({ success: true, configId: lastEntry[0], config: lastEntry[1] });
    }
    res.json({ success: false, config: null });
});

// API to get configuration by query param or latest
app.all('/api/config', (req, res) => {
    const targetId = req.query.id || req.query.configId || req.query.token;
    if (targetId) {
        const config = resolveConfig(targetId) || null;
        return res.json({ success: Boolean(config), configId: targetId, config });
    }
    if (lastSavedConfig) {
        return res.json({ success: true, configId: lastSavedConfigId, config: lastSavedConfig });
    }
    if (userConfigs.size > 0) {
        const lastEntry = Array.from(userConfigs.entries()).pop();
        return res.json({ success: true, configId: lastEntry[0], config: lastEntry[1] });
    }
    res.json({ success: false, config: null });
});

// API to get configuration by configId or token
app.get('/api/config/:configId', (req, res) => {
    let rawId = req.params.configId;
    if (rawId) {
        rawId = rawId.replace(/\/configure\/?$/, '').replace(/\.json$/, '').trim();
    }
    const config = resolveConfig(rawId) || null;
    res.json({ success: Boolean(config), configId: rawId, config });
});

// Handle Nuvio/Stremio gear icon clicks which append /configure or / to the addon base URL
app.get('/:configJSON/configure', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const streamCache = new Map();
const inFlightStreamFetches = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Real-Time Serverless & Edge Telemetry Profiler
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

// Cloud Platform Auto-Detection (Render Web Service vs Vercel Serverless vs Local Node)
const isRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
const isVercel = Boolean(process.env.VERCEL);

// Global Server-Side Configuration (Admin Managed & Enforced)
const ADMIN_SETTINGS_FILE = isVercel
    ? path.join('/tmp', 'admin_settings.json')
    : path.join(__dirname, 'admin_settings.json');
let globalServerSettings = {
    adminPasswordHash: null,
    globalEcoMode: true, // Protects both Render (0.1 CPU / 512MB RAM) and Vercel (Fluid CPU / 10s timeout)
    allowClientEcoOverride: true,
    renderKeepAlive: true,
    renderPingUrl: process.env.RENDER_PING_URL || null,
    renderApiKey: process.env.RENDER_API_KEY || null,
    vercelApiToken: process.env.VERCEL_API_TOKEN || null
};

function loadAdminSettings() {
    try {
        const repoSettingsFile = path.join(__dirname, 'admin_settings.json');
        if (fs.existsSync(repoSettingsFile)) {
            const raw = fs.readFileSync(repoSettingsFile, 'utf8');
            const data = JSON.parse(raw);
            globalServerSettings = { ...globalServerSettings, ...data };
        }
        if (isVercel && fs.existsSync(ADMIN_SETTINGS_FILE)) {
            const raw = fs.readFileSync(ADMIN_SETTINGS_FILE, 'utf8');
            const data = JSON.parse(raw);
            globalServerSettings = { ...globalServerSettings, ...data };
        }
        if (process.env.RENDER_API_KEY) {
            globalServerSettings.renderApiKey = process.env.RENDER_API_KEY;
        }
        if (process.env.VERCEL_API_TOKEN) {
            globalServerSettings.vercelApiToken = process.env.VERCEL_API_TOKEN;
        }
        if (globalServerSettings.globalScraperOverrides) {
            providerLoader.setGlobalScraperOverrides(globalServerSettings.globalScraperOverrides);
        }
        console.log('[Admin] Loaded server admin settings successfully');
    } catch (e) {
        console.error('[Admin] Failed to load admin_settings.json:', e.message);
    }
}

function saveAdminSettings() {
    try {
        if (globalServerSettings.globalScraperOverrides) {
            providerLoader.setGlobalScraperOverrides(globalServerSettings.globalScraperOverrides);
        }
        fs.writeFileSync(ADMIN_SETTINGS_FILE, JSON.stringify(globalServerSettings, null, 2));
    } catch (e) {
        // Safe failover for read-only serverless filesystems
        console.error('[Admin] Failed to write admin_settings.json:', e.message);
    }
}
loadAdminSettings();

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
setInterval(enforceRenderMemoryGuard, 60000).unref();

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
    const cleanToken = String(apiToken || '').replace(/^Bearer\s+/i, '').trim();
    if (!cleanToken) return null;
    if (!forceFresh && (Date.now() - vercelApiUsageCache.timestamp < 120000) && vercelApiUsageCache.data) {
        return vercelApiUsageCache.data;
    }
    try {
        const headers = { Authorization: `Bearer ${cleanToken}` };
        
        // 1. Authenticate user identity and check validity
        let userRes;
        try {
            userRes = await axios.get('https://api.vercel.com/v2/user', {
                headers,
                httpsAgent: dohHttpsAgent,
                timeout: 6000
            });
        } catch (authErr) {
            const errStatus = authErr.response?.status;
            const errMsg = authErr.response?.data?.error?.message || (errStatus === 401 || errStatus === 403 ? 'Unauthorized: Invalid Vercel Token' : (authErr.message || 'Failed to authenticate with Vercel'));
            const errResult = {
                connected: false,
                error: errMsg,
                lastSynced: Date.now()
            };
            vercelApiUsageCache = { timestamp: Date.now(), data: errResult };
            return errResult;
        }

        const userData = userRes.data?.user || {};
        const username = userData.username || userData.name || userData.email || 'Vercel User';
        const defaultTeamId = userData.defaultTeamId || null;

        // 2. Discover user teams (in case project is deployed under a team)
        let teams = [];
        try {
            const teamsRes = await axios.get('https://api.vercel.com/v2/teams', {
                headers,
                httpsAgent: dohHttpsAgent,
                timeout: 5000
            });
            teams = Array.isArray(teamsRes.data?.teams) ? teamsRes.data.teams : [];
        } catch (e) {
            // Teams discovery optional
        }

        const now = new Date();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const endNow = now.toISOString();

        // 3. Query usage for user personal scope + team scopes
        const usageQueries = [
            axios.get(`https://api.vercel.com/v2/usage?type=requests&from=${startOfMonth}&to=${endNow}`, {
                headers,
                httpsAgent: dohHttpsAgent,
                timeout: 6000
            })
        ];

        for (const team of teams) {
            if (team && team.id) {
                usageQueries.push(
                    axios.get(`https://api.vercel.com/v2/usage?type=requests&from=${startOfMonth}&to=${endNow}&teamId=${team.id}`, {
                        headers,
                        httpsAgent: dohHttpsAgent,
                        timeout: 6000
                    })
                );
            }
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

        const bandwidthUsedGB = Math.round((totalBandwidthBytes / (1024 * 1024 * 1024)) * 1000) / 1000;
        const fluidCpuHours = Math.round(totalGbHours * 10000) / 10000;
        const teamNames = teams.map(t => t.name || t.slug).filter(Boolean);

        const result = {
            connected: true,
            username,
            teams: teamNames,
            defaultTeamId,
            totalInvocations,
            totalRequests,
            bandwidthUsedGB,
            fluidCpuHours,
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
// Optional environment token: process.env.ADMIN_SECRET_KEY / process.env.DIAGNOSTICS_TOKEN
const DIAGNOSTICS_TOKEN = process.env.ADMIN_SECRET_KEY || process.env.DIAGNOSTICS_TOKEN || null;

function checkDiagnosticsAuth(req) {
    const rawKey = req.headers['x-admin-key'] || req.headers['x-diagnostic-token'] || req.query.key || req.query.token || (req.body && (req.body.key || req.body.token));
    if (!rawKey) return false;
    const key = String(rawKey).trim();
    if (!key) return false;

    // 1. Match environment variable secret if set
    if (DIAGNOSTICS_TOKEN) {
        if (key === DIAGNOSTICS_TOKEN) return true;
        const keyHash = crypto.createHash('sha256').update(key).digest('hex');
        const tokenHash = crypto.createHash('sha256').update(DIAGNOSTICS_TOKEN).digest('hex');
        if (key === tokenHash || keyHash === tokenHash) return true;
    }

    // 2. Match server-stored password hash
    if (globalServerSettings.adminPasswordHash) {
        if (key === globalServerSettings.adminPasswordHash) return true;
        const keyHash = crypto.createHash('sha256').update(key).digest('hex');
        if (keyHash === globalServerSettings.adminPasswordHash) return true;
        return false;
    }

    // Never accept arbitrary passwords
    return false;
}

// Admin Server Auth State
app.get('/api/admin/auth-state', (req, res) => {
    const hasPassword = Boolean(DIAGNOSTICS_TOKEN || globalServerSettings.adminPasswordHash);
    res.json({
        hasAdminPassword: hasPassword,
        isEnvConfigured: Boolean(DIAGNOSTICS_TOKEN)
    });
});

// Setup admin password on server (Multi-device universal sync)
app.post('/api/admin/setup-password', (req, res) => {
    const hasExisting = Boolean(DIAGNOSTICS_TOKEN || globalServerSettings.adminPasswordHash);
    if (hasExisting && !checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Admin password already set on server.' });
    }
    const { key, password, hash } = req.body || {};
    const candidate = password || key;
    const finalHash = hash || (candidate ? crypto.createHash('sha256').update(String(candidate).trim()).digest('hex') : null);
    if (!finalHash) {
        return res.status(400).json({ success: false, error: 'Password is required' });
    }
    globalServerSettings.adminPasswordHash = finalHash;
    saveAdminSettings();
    console.log('[Admin] Admin password hash registered & persisted on server.');
    res.json({ success: true, message: 'Admin password saved on server' });
});

// Change admin password
app.post('/api/admin/change-password', (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Current key is incorrect.' });
    }
    const { newPassword, newKey, newHash } = req.body || {};
    const candidate = newPassword || newKey;
    const finalHash = newHash || (candidate ? crypto.createHash('sha256').update(String(candidate).trim()).digest('hex') : null);
    if (!finalHash) {
        return res.status(400).json({ success: false, error: 'New password is required' });
    }
    globalServerSettings.adminPasswordHash = finalHash;
    saveAdminSettings();
    console.log('[Admin] Admin password hash updated & persisted on server.');
    res.json({ success: true, message: 'Password changed successfully' });
});

// Telemetry Signature Verification (Supports dual endpoint naming)
const handleVerifyDiagnostics = (req, res) => {
    const { key, token } = req.body || {};
    const candidate = key || token;
    if (!candidate) {
        return res.status(400).json({ success: false, error: 'Password or key required' });
    }
    const hasPassword = Boolean(DIAGNOSTICS_TOKEN || globalServerSettings.adminPasswordHash);
    if (!hasPassword) {
        return res.status(401).json({ success: false, error: 'No admin password configured on server. Please initialize admin password.' });
    }
    if (checkDiagnosticsAuth(req)) {
        return res.json({ success: true, mode: DIAGNOSTICS_TOKEN ? 'server_env' : 'server_saved' });
    }
    return res.status(401).json({ success: false, error: 'Incorrect Admin Secret Key' });
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
    const vercelToken = req.headers['x-vercel-token'] || globalServerSettings.vercelApiToken || process.env.VERCEL_API_TOKEN || null;
    let officialVercel = null;
    if (vercelToken) {
        officialVercel = await fetchOfficialVercelUsage(vercelToken, forceFresh);
    }

    // Fetch official live Render API stats if token is available
    const renderKey = req.headers['x-render-key'] || globalServerSettings.renderApiKey || process.env.RENDER_API_KEY || null;
    let officialRender = null;
    if (renderKey) {
        officialRender = await fetchOfficialRenderUsage(renderKey, forceFresh);
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
    const { globalEcoMode, allowClientEcoOverride, renderKeepAlive, renderPingUrl, renderApiKey, vercelApiToken } = req.body || {};
    if (typeof globalEcoMode === 'boolean') {
        globalServerSettings.globalEcoMode = globalEcoMode;
    }
    if (typeof allowClientEcoOverride === 'boolean') {
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
    console.log(`[Admin] Global server settings updated & persisted: EcoMode=${globalServerSettings.globalEcoMode}`);
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
app.get('/api/telemetry/settings', (req, res) => res.json({ settings: globalServerSettings }));
app.get('/api/admin/settings', (req, res) => res.json({ settings: globalServerSettings }));

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

// Live Scraper Domain & Override Probing / Test Route
app.post('/api/test-scraper', async (req, res) => {
    try {
        const { providerName, manifestUrl, domain, fallbackMirrors, headers, mediaId, type } = req.body || {};
        if (!providerName) {
            return res.status(400).json({ success: false, error: 'providerName is required' });
        }
        const targetManifest = manifestUrl || 'https://cdn.jsdelivr.net/gh/D3adlyRocket/All-in-One-Nuvio@main/manifest.json';
        const overrides = {
            domain: domain || '',
            fallbackMirrors: Array.isArray(fallbackMirrors) 
                ? fallbackMirrors 
                : (fallbackMirrors ? String(fallbackMirrors).split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : []),
            headers: headers && typeof headers === 'object' ? headers : {}
        };
        const result = await providerLoader.testScraper(targetManifest, providerName, overrides, mediaId || 'tt0137523', type || 'movie');
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Admin Global Scraper Overrides
app.get('/api/admin/scraper-overrides', (req, res) => {
    res.json({ success: true, overrides: globalServerSettings.globalScraperOverrides || {} });
});

app.post('/api/admin/scraper-overrides', (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const { overrides } = req.body || {};
    if (overrides && typeof overrides === 'object') {
        globalServerSettings.globalScraperOverrides = overrides;
        saveAdminSettings();
        console.log(`[Admin] Saved global scraper overrides for ${Object.keys(overrides).length} scrapers`);
        return res.json({ success: true, overrides: globalServerSettings.globalScraperOverrides });
    }
    res.status(400).json({ success: false, error: 'Invalid overrides payload' });
});

// Scraper Default Information and Detected Domains
app.get('/api/scraper-info', async (req, res) => {
    try {
        const { providerName, manifestUrl } = req.query || {};
        if (!providerName) return res.status(400).json({ success: false, error: 'providerName required' });
        const targetManifest = manifestUrl || 'https://cdn.jsdelivr.net/gh/D3adlyRocket/All-in-One-Nuvio@main/manifest.json';
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

const TMDB_API_KEYS = [
    '439c478a771f35c05022f9feabcca01c',
    '1865f43a0549ca50d341dd9ab8b29f49',
    'e49339e830e014e414c2b9a71b2d4f82',
    '847a158b5489812f851da8cf02476566',
    'b025d23315a6b0c266cc6cb221a68134'
];

async function getMediaMetadata(imdbId, type) {
    const rawId = imdbId.split(':')[0];
    let tmdbId = null;
    let title = null;
    let originalTitle = null;
    let year = null;

    if (rawId.startsWith('tmdb:')) {
        tmdbId = rawId.split(':')[1];
    } else if (/^\d+$/.test(rawId)) {
        tmdbId = rawId;
    }

    // 1. If TMDB ID is directly provided, fetch details from TMDB
    if (tmdbId) {
        const tmdbType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
        for (const key of TMDB_API_KEYS) {
            try {
                const res = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${key}`, {
                    timeout: 4000,
                    httpsAgent: dohHttpsAgent,
                    headers: { 'Accept': 'application/json' }
                });
                if (res.data) {
                    title = res.data.title || res.data.name;
                    originalTitle = res.data.original_title || res.data.original_name;
                    const dateStr = res.data.release_date || res.data.first_air_date;
                    year = dateStr ? dateStr.split('-')[0] : null;
                    return { tmdbId, title, originalTitle, year };
                }
            } catch (err) {}
        }
    }

    // 2. If IMDb ID (tt...), search TMDB by external_source=imdb_id
    if (rawId.startsWith('tt')) {
        for (const key of TMDB_API_KEYS) {
            try {
                const res = await axios.get(`https://api.themoviedb.org/3/find/${rawId}?api_key=${key}&external_source=imdb_id`, {
                    timeout: 4000,
                    httpsAgent: dohHttpsAgent,
                    headers: { 'Accept': 'application/json' }
                });
                if (type === 'movie' && res.data && res.data.movie_results && res.data.movie_results.length > 0) {
                    const m = res.data.movie_results[0];
                    return {
                        tmdbId: m.id.toString(),
                        title: m.title,
                        originalTitle: m.original_title,
                        year: m.release_date ? m.release_date.split('-')[0] : null
                    };
                } else if ((type === 'series' || type === 'tv') && res.data && res.data.tv_results && res.data.tv_results.length > 0) {
                    const t = res.data.tv_results[0];
                    return {
                        tmdbId: t.id.toString(),
                        title: t.name,
                        originalTitle: t.original_name,
                        year: t.first_air_date ? t.first_air_date.split('-')[0] : null
                    };
                }
            } catch (err) {}
        }
    }

    // 3. Cinemeta Fallback
    try {
        const cinemetaType = (type === 'tv' ? 'series' : type);
        const cRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${cinemetaType}/${rawId}.json`, { timeout: 3000 });
        if (cRes.data && cRes.data.meta) {
            return {
                tmdbId: tmdbId || null,
                title: cRes.data.meta.name,
                originalTitle: cRes.data.meta.name,
                year: (cRes.data.meta.year || cRes.data.meta.releaseInfo) ? String(cRes.data.meta.year || cRes.data.meta.releaseInfo).split('–')[0].trim() : null
            };
        }
    } catch (e) {}

    return { tmdbId, title, originalTitle, year };
}

async function getTmdbId(imdbId, type) {
    const meta = await getMediaMetadata(imdbId, type);
    return meta ? meta.tmdbId : null;
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
            const movieSeriesGenres = ['Action', 'Comedy', 'Drama', 'Sci-Fi', 'Horror', 'Thriller', 'Romance', 'Crime', 'Adventure', 'Animation', 'Fantasy', 'Mystery'];
            enabledCatalogs.push({
                type: 'movie',
                id: 'cb_movies_series',
                name: 'Movies & Series',
                genres: movieSeriesGenres,
                extra: [
                    { name: 'genre', options: movieSeriesGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
            enabledCatalogs.push({
                type: 'series',
                id: 'cb_movies_series',
                name: 'Movies & Series',
                genres: movieSeriesGenres,
                extra: [
                    { name: 'genre', options: movieSeriesGenres, isRequired: false },
                    { name: 'skip', isRequired: false }
                ],
                extraSupported: ['genre', 'skip']
            });
        }
    }

    // 5. Live TV / IPTV
    if (config.enableIptv !== false) {
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
        enabledCatalogs.push({
            type: 'channel',
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

    const resources = ['stream'];
    if (enabledCatalogs.length > 0) {
        resources.push('catalog');
    }
    if (config.enableIptv !== false) {
        resources.push('meta');
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
        configurationRequired: !isConfigured
    };
    if (configurationUrl) {
        behaviorHints.configurationURL = configurationUrl;
    }

    const builder = new addonBuilder({
        id: addonId,
        version: '4.3.0',
        name: addonName,
        description: 'High-Performance Stream Meta-Sorter & Discovery Hub for Nuvio & Stremio. Scrapes, verifies, filters dead links, organizes streams by speed/quality/audio, and provides curated Live TV, Indian Cinema, Trending & Anime feeds.',
        logo: addonLogo,
        catalogs: enabledCatalogs,
        resources: resources,
        types: ['movie', 'series', 'anime', 'tv', 'channel', 'other'],
        idPrefixes: ['tt', 'tmdb:', 'kitsu:', 'iptv:'],
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
        
        const cacheKey = `${type}:${id}:${JSON.stringify(config)}`;
        const cached = streamCache.get(cacheKey);
        
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
                manifestUrls = [
                    'https://cdn.jsdelivr.net/gh/D3adlyRocket/All-in-One-Nuvio@main/manifest.json',
                    'https://cdn.jsdelivr.net/gh/yoruix/nuvio-providers@main/manifest.json',
                    'https://codeberg.org/eclipsia/nuvio-plugin/raw/branch/main/manifest.json'
                ];
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
            // High-speed parallel scraper execution timeout to ensure streams return within client limits
            const isClientEco = config.renderEcoMode !== undefined ? config.renderEcoMode : config.vercelEcoMode;
            const isEcoMode = globalServerSettings.globalEcoMode === true 
                ? (globalServerSettings.allowClientEcoOverride ? (isClientEco !== false) : true)
                : Boolean(isClientEco === true);
            const PROVIDER_TIMEOUT_MS = isEcoMode || (typeof process !== 'undefined' && (process.env.RENDER || process.env.VERCEL)) ? 8000 : 15000;

            const scrapeStartTime = Date.now();
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
                    if (config.enableQuarantine !== false && err.message !== 'Scrape Timeout') {
                        const qRecord = quarantineRegistry.get(provider.name) || { strikes: 0, quarantineUntil: 0 };
                        qRecord.strikes++;
                        if (qRecord.strikes >= 5) {
                            qRecord.quarantineUntil = Date.now() + (10 * 60 * 1000); // 10 minutes
                            console.error(`[Quarantine] ${provider.name} failed 5 times. Quarantined for 10m.`);
                        }
                        quarantineRegistry.set(provider.name, qRecord);
                    }
                    console.error(`[Provider] ${provider.name} failed or timed out:`, err.message);
                }
            }));
            const scrapeDurationMs = Date.now() - scrapeStartTime;

            console.log(`[Stremio] Collected ${allStreams.length} total streams for ${type} ${id}. Testing speeds...`);
            const sortStartTime = Date.now();
            const targetYear = parseInt(mediaMeta?.year, 10);
            const currentYear = new Date().getFullYear();
            const isUnreleased = Boolean(type === 'movie' && targetYear && targetYear > currentYear);

            const sortedAndTaggedStreams = await sortAndTagStreams(allStreams, {
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
                sortBy: config.sortBy || (config.prioritizeQuality ? 'quality' : 'speed'),
                sortMode: config.sortMode || config.sortBy,
                prioritizeQuality: config.sortBy === 'quality' || config.prioritizeQuality,
                prioritizeHindi: config.prioritizeHindi,
                preferredLanguages: config.preferredLanguages || (config.prioritizeHindi ? ['Hindi', 'Dual-Audio'] : []),
                showSeeders: config.showSeeders !== false,
                deduplicateStreams: config.deduplicateStreams !== false,
                cleanTitles: config.cleanTitles !== false,
                showFileSize: config.showFileSize !== false,
                showReleaseGroup: config.showReleaseGroup !== false,
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

            // Save to cache
            streamCache.set(cacheKey, { timestamp: Date.now(), streams: sortedAndTaggedStreams });
            return sortedAndTaggedStreams;
        };

        if (cached && Date.now() - cached.timestamp < STALE_TTL_MS) {
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
            
            const frStream = getForceRefreshStream();
            return { streams: frStream ? [frStream, ...cached.streams] : cached.streams };
        }

        // Deduplicate in-flight requests for the exact same stream
        if (inFlightStreamFetches.has(cacheKey)) {
            console.log(`[Stremio] Awaiting in-flight fetch for ${type} ${id}`);
            const inFlightResult = await inFlightStreamFetches.get(cacheKey);
            const frStream = getForceRefreshStream();
            return { streams: frStream ? [frStream, ...inFlightResult] : inFlightResult };
        }

        const fetchPromise = fetchAndCacheStreams();
        inFlightStreamFetches.set(cacheKey, fetchPromise);
        try {
            const sortedAndTaggedStreams = await fetchPromise;
            const frStream = getForceRefreshStream();
            return { streams: frStream ? [frStream, ...sortedAndTaggedStreams] : sortedAndTaggedStreams };
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
        else if (catalogId === 'cb_movies_series' || catalogId === 'cb_trending_movies' || catalogId === 'cb_trending_series' || catalogId.includes('_shows') || catalogId.includes('_movies')) {
            const mediaType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
            const genreMap = {
                'Action': mediaType === 'movie' ? '28' : '10759',
                'Comedy': '35',
                'Drama': '18',
                'Sci-Fi': mediaType === 'movie' ? '878' : '10765',
                'Horror': mediaType === 'movie' ? '27' : '9648',
                'Thriller': '53',
                'Romance': mediaType === 'movie' ? '10749' : '18',
                'Crime': '80',
                'Adventure': mediaType === 'movie' ? '12' : '10759',
                'Animation': '16',
                'Fantasy': mediaType === 'movie' ? '14' : '10765',
                'Mystery': '9648'
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
                        const metas = res.data.results.map(item => {
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
            } else if (catalogId === 'cb_movies_series' || catalogId === 'cb_trending_movies' || catalogId === 'cb_trending_series') {
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

    if (config.enableIptv !== false) {
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

function purgeStreamCachesForTarget(type, id, configId = null) {
    let count = 0;
    const cleanId = decodeURIComponent(id || '');
    const imdbId = cleanId.split(':')[0];

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
    if (configId) {
        for (const key of streamCache.keys()) {
            if (key.includes(configId) && (key.includes(cleanId) || key.includes(id))) {
                streamCache.delete(key);
                count++;
            }
        }
    }

    // Also clear memoized domain speed probes so Normal Mode freshly re-probes
    try {
        clearDomainLatencyCache();
    } catch (e) {}

    return count;
}

const handleClearCacheRequest = (req, res, configId = null) => {
    const { type, id } = req.params;
    try {
        const clearedCount = purgeStreamCachesForTarget(type, id, configId);
        console.log(`[Cache] Force refresh cleared ${clearedCount} entries for ${type} ${id} (configId: ${configId || 'none'})`);
        
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
    handleClearCacheRequest(req, res, null);
});

app.get('/c/:configId/clear-cache/:type/:id', (req, res) => {
    handleClearCacheRequest(req, res, req.params.configId);
});

// Dynamic configuration endpoints for Stremio Router (With Vercel Edge CDN Headers)
app.use('/c/:configId', (req, res, next) => {
    // Only intercept Stremio API routes
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/catalog/') || req.path.startsWith('/meta/')) {
        try {
            if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            } else if (req.path.startsWith('/stream/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            }

            const { configId } = req.params;
            let config = resolveConfig(configId);
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
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/catalog/') || req.path.startsWith('/meta/')) {
        try {
            if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            } else if (req.path.startsWith('/stream/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            }

            let config = resolveConfig(req.params.configJSON);
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
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/catalog/') || req.path.startsWith('/meta/')) {
        try {
            if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            } else if (req.path.startsWith('/stream/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            }

            const activeConfig = lastSavedConfig || {};
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
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
========================================================================
  🌶️  CHOLE BHATURE • Meta-Sorter & Priority Engine v4.3.0
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
}

// Export the app for Vercel Serverless Functions
module.exports = app;

