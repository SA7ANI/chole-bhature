const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const path = require('path');
const providerLoader = require('./providerLoader');
const { sortAndTagStreams, clearDomainLatencyCache } = require('./streamTester');
const { setDohEnabled, setDohProvider, getDohConfig, dohHttpsAgent } = require('./dohResolver');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

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
        // Safe failover for read-only serverless filesystems (e.g. Vercel)
    }
}
loadUserConfigs();

// Multi-Device Stateless & Persistent Configuration Resolver
const activeConfigsTracker = new Set();

function resolveConfig(param) {
    if (!param) return null;
    
    // 1. Try URL-decoded JSON
    try {
        if (param.startsWith('{') || param.startsWith('%7B')) {
            const parsed = JSON.parse(decodeURIComponent(param));
            if (parsed && typeof parsed === 'object') {
                activeConfigsTracker.add(param);
                return parsed;
            }
        }
    } catch (e) {}

    // 2. Try Base64URL / Base64 decoded JSON
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

    // 3. Try in-memory / persistent userConfigs map
    const stored = userConfigs.get(param);
    if (stored) {
        activeConfigsTracker.add(param);
        return stored;
    }

    return null;
}

// Background pre-warming: pre-load all provider repositories on startup to eliminate cold-start delay
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
prewarmProviders();

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
    const config = resolveConfig(req.params.configId) || null;
    res.json({ config });
});

// Handle Nuvio/Stremio gear icon clicks which append /configure or / to the addon base URL
app.get('/:configJSON/configure', (req, res) => {
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

// Global Server-Side Configuration (Admin Managed & Enforced)
const ADMIN_SETTINGS_FILE = path.join(__dirname, 'admin_settings.json');
let globalServerSettings = {
    adminPasswordHash: null,
    globalEcoMode: true, // Default to true to protect serverless free tier for all users
    allowClientEcoOverride: true,
    vercelApiToken: process.env.VERCEL_API_TOKEN || null
};

function loadAdminSettings() {
    try {
        if (fs.existsSync(ADMIN_SETTINGS_FILE)) {
            const raw = fs.readFileSync(ADMIN_SETTINGS_FILE, 'utf8');
            const data = JSON.parse(raw);
            globalServerSettings = { ...globalServerSettings, ...data };
            if (process.env.VERCEL_API_TOKEN) {
                globalServerSettings.vercelApiToken = process.env.VERCEL_API_TOKEN;
            }
            console.log('[Admin] Loaded server admin settings from admin_settings.json');
        }
    } catch (e) {
        console.error('[Admin] Failed to load admin_settings.json:', e.message);
    }
}

function saveAdminSettings() {
    try {
        fs.writeFileSync(ADMIN_SETTINGS_FILE, JSON.stringify(globalServerSettings, null, 2));
    } catch (e) {
        // Safe failover for read-only serverless filesystems
    }
}
loadAdminSettings();

// Vercel Official API Usage Cache (5-min memoization to avoid API spam)
let vercelApiUsageCache = {
    timestamp: 0,
    data: null
};

async function fetchOfficialVercelUsage(apiToken, forceFresh = false) {
    if (!apiToken) return null;
    if (!forceFresh && (Date.now() - vercelApiUsageCache.timestamp < 120000) && vercelApiUsageCache.data) {
        return vercelApiUsageCache.data;
    }
    try {
        const headers = { Authorization: `Bearer ${apiToken}` };
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const endNow = now.toISOString();

        const [userRes, usageRes] = await Promise.allSettled([
            axios.get('https://api.vercel.com/v2/user', { headers, timeout: 5000 }),
            axios.get(`https://api.vercel.com/v2/usage?type=requests&from=${startOfMonth}&to=${endNow}`, { headers, timeout: 6000 })
        ]);

        const username = userRes.status === 'fulfilled' ? (userRes.value.data?.user?.username || userRes.value.data?.user?.name) : null;
        
        let totalRequests = 0;
        let totalInvocations = 0;
        let totalBandwidthBytes = 0;
        let totalGbHours = 0;

        if (usageRes.status === 'fulfilled' && usageRes.value.data?.data) {
            for (const item of usageRes.value.data.data) {
                totalRequests += (item.request_hit_count || 0) + (item.request_miss_count || 0);
                totalInvocations += (item.function_invocation_successful_count || 0) + (item.function_invocation_error_count || 0) + (item.function_invocation_timeout_count || 0);
                totalBandwidthBytes += (item.bandwidth_outgoing_bytes || 0) + (item.bandwidth_incoming_bytes || 0);
                totalGbHours += (item.function_execution_successful_gb_hours || 0) + (item.function_execution_error_gb_hours || 0) + (item.function_execution_timeout_gb_hours || 0);
            }
        }

        const bandwidthUsedGB = Math.round((totalBandwidthBytes / (1024 * 1024 * 1024)) * 1000) / 1000;
        const fluidCpuHours = Math.round(totalGbHours * 10000) / 10000;

        const result = {
            connected: true,
            username: username || 'Vercel User',
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

    // 3. Fallback for first-time unconfigured setup
    return Boolean(key.length >= 3);
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

    // Fetch official live Vercel API stats if token is available
    const vercelToken = req.headers['x-vercel-token'] || globalServerSettings.vercelApiToken || process.env.VERCEL_API_TOKEN || null;
    const forceFresh = req.query.fresh === '1' || req.query.refresh === 'true';
    let officialVercel = null;
    if (vercelToken) {
        officialVercel = await fetchOfficialVercelUsage(vercelToken, forceFresh);
    }

    res.json({
        status: 'online',
        uptime: uptimeSec,
        totalConfigs: Math.max(userConfigs.size, activeConfigsTracker.size, 1),
        cacheSize: streamCache.size,
        quarantinedProviders: quarantinedProviders,
        analyticsCount: providerAnalytics.size,
        vercelEcoSafe: true,
        globalEcoMode: globalServerSettings.globalEcoMode,
        globalSettings: {
            ...globalServerSettings,
            hasVercelToken: Boolean(globalServerSettings.vercelApiToken || process.env.VERCEL_API_TOKEN)
        },
        officialVercel: officialVercel,
        memoryMB: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
        // Live Vercel & Edge Telemetry Metrics
        isVercel: Boolean(process.env.VERCEL),
        vercelRegion: process.env.VERCEL_REGION || (process.env.VERCEL ? 'iad1 (Edge)' : 'local-node (Express)'),
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
const handleUpdateAdminSettings = (req, res) => {
    if (!checkDiagnosticsAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const { globalEcoMode, allowClientEcoOverride, vercelApiToken } = req.body || {};
    if (typeof globalEcoMode === 'boolean') {
        globalServerSettings.globalEcoMode = globalEcoMode;
    }
    if (typeof allowClientEcoOverride === 'boolean') {
        globalServerSettings.allowClientEcoOverride = allowClientEcoOverride;
    }
    if (typeof vercelApiToken === 'string') {
        globalServerSettings.vercelApiToken = vercelApiToken.trim() || null;
        vercelApiUsageCache = { timestamp: 0, data: null };
    }
    saveAdminSettings();
    console.log(`[Admin] Global server settings updated & persisted: EcoMode=${globalServerSettings.globalEcoMode}`);
    res.json({ 
        success: true, 
        settings: {
            ...globalServerSettings,
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
                year: cRes.data.meta.year ? String(cRes.data.meta.year).split('–')[0].trim() : null
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

    const builder = new addonBuilder({
        id: addonId,
        version: '4.1.0',
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
            const isEcoMode = globalServerSettings.globalEcoMode === true 
                ? (globalServerSettings.allowClientEcoOverride ? (config.vercelEcoMode !== false) : true)
                : Boolean(config.vercelEcoMode === true);
            const PROVIDER_TIMEOUT_MS = isEcoMode || (typeof process !== 'undefined' && process.env.VERCEL) ? 8000 : 15000;

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
            const sortedAndTaggedStreams = await sortAndTagStreams(allStreams, {
                target: {
                    title: mediaMeta?.title || '',
                    originalTitle: mediaMeta?.originalTitle || '',
                    year: mediaMeta?.year || null,
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

    // No catalogs defined

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
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/catalog/')) {
        try {
            if (req.path === '/manifest.json') {
                res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
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
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/catalog/')) {
        try {
            if (req.path === '/manifest.json') {
                res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
            } else if (req.path.startsWith('/stream/')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            }

            let config = resolveConfig(req.params.configJSON);
            if (!config) {
                config = { repoUrl: 'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json' };
            }
            config = JSON.parse(JSON.stringify(config));
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
  🌶️  CHOLE BHATURE • Meta-Sorter & Priority Engine v4.1.0
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

