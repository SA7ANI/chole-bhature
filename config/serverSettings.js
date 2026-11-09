const fs = require('fs');
const path = require('path');
const providerLoader = require('../providerLoader');

const isVercel = Boolean(process.env.VERCEL);
const isRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);

const SECRET_FIELDS = [
    'debridApiKey', 'rdKey', 'adKey', 'tbKey', 'pmKey',
    'xtreamPassword', 'xtreamUser', 'xtreamServer',
    'renderApiKey', 'vercelApiToken', 'adminKey'
];

/**
 * Returns a copy of a config object with all secret fields redacted.
 * Used before sending any config object to the client.
 */
function redactSecrets(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const safe = { ...cfg };
    for (const field of SECRET_FIELDS) {
        if (safe[field] !== undefined && safe[field] !== null && safe[field] !== '') {
            safe[field] = '***REDACTED***';
        }
    }
    return safe;
}

function encodeConfigParam(cfg) {
    try {
        if (!cfg || typeof cfg !== 'object') return '';
        const clean = { ...cfg };
        delete clean.addonHost;
        delete clean.addonProtocol;
        for (const field of SECRET_FIELDS) {
            delete clean[field];
        }
        if (Object.keys(clean).length === 0) return '';
        return Buffer.from(JSON.stringify(clean), 'utf8').toString('base64url');
    } catch (e) {
        return '';
    }
}

// Global Server-Side Configuration (Admin Managed & Enforced)
const ADMIN_SETTINGS_FILE = isVercel
    ? path.join('/tmp', 'admin_settings.json')
    : path.join(__dirname, '..', 'admin_settings.json');

let globalServerSettings = {
    globalEcoMode: process.env.GLOBAL_ECO_MODE !== undefined
        ? (process.env.GLOBAL_ECO_MODE === 'true' || process.env.GLOBAL_ECO_MODE === '1')
        : false,
    allowClientEcoOverride: false,
    renderKeepAlive: true,
    renderPingUrl: process.env.RENDER_PING_URL || null,
    renderApiKey: process.env.RENDER_API_KEY || null,
    vercelApiToken: process.env.VERCEL_API_TOKEN || null,
    globalScraperOverrides: {},
    localRepo: [],
    installedRepos: [
        'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json',
        'https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json',
        'https://codeberg.org/api/v1/repos/eclipsia/nuvio-plugin/raw/manifest.json'
    ]
};

function applyGlobalAdminOverrides(userConfig) {
    const cfg = { ...(userConfig || {}) };
    if (globalServerSettings.globalEcoMode !== undefined) {
        cfg.renderEcoMode = Boolean(globalServerSettings.globalEcoMode);
        cfg.vercelEcoMode = Boolean(globalServerSettings.globalEcoMode);
    }
    if (globalServerSettings.globalScraperOverrides && typeof globalServerSettings.globalScraperOverrides === 'object') {
        cfg.scraperOverrides = {
            ...(cfg.scraperOverrides || {}),
            ...globalServerSettings.globalScraperOverrides
        };
    }
    return cfg;
}

function loadAdminSettings() {
    try {
        const possibleSettingsFiles = [
            path.join(__dirname, '..', 'admin_settings.json'),
            path.join(process.cwd(), 'admin_settings.json'),
            ADMIN_SETTINGS_FILE
        ];
        for (const f of possibleSettingsFiles) {
            if (f && fs.existsSync(f)) {
                try {
                    const raw = fs.readFileSync(f, 'utf8');
                    const data = JSON.parse(raw);
                    if (data && typeof data === 'object') {
                        Object.assign(globalServerSettings, data);
                        break;
                    }
                } catch (_) {}
            }
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
        const repoSettings = path.join(__dirname, '..', 'admin_settings.json');
        if (ADMIN_SETTINGS_FILE !== repoSettings && fs.existsSync(repoSettings)) {
            try { fs.writeFileSync(repoSettings, JSON.stringify(globalServerSettings, null, 2)); } catch (_) {}
        }
    } catch (e) {
        console.error('[Admin] Failed to write admin_settings.json:', e.message);
    }
}

function getCbProviderRepoDirs() {
    const candidates = [
        path.join(__dirname, '..', '..', 'cb-providers'),
        path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\vkesh', 'Documents', 'GitHub', 'cb-providers')
    ];
    return candidates.filter(dir => fs.existsSync(dir));
}

function syncTwoWayCbProviders() {
    try {
        const dirs = getCbProviderRepoDirs();
        if (dirs.length < 2) return;
        const [dirA, dirB] = dirs;

        const provA = path.join(dirA, 'providers');
        const provB = path.join(dirB, 'providers');
        if (fs.existsSync(provA) && fs.existsSync(provB)) {
            const filesA = new Set(fs.readdirSync(provA).filter(f => f.endsWith('.js')));
            const filesB = new Set(fs.readdirSync(provB).filter(f => f.endsWith('.js')));
            const allFiles = new Set([...filesA, ...filesB]);

            for (const file of allFiles) {
                const pathA = path.join(provA, file);
                const pathB = path.join(provB, file);
                const hasA = fs.existsSync(pathA);
                const hasB = fs.existsSync(pathB);

                if (hasA && !hasB) {
                    fs.copyFileSync(pathA, pathB);
                } else if (!hasA && hasB) {
                    fs.copyFileSync(pathB, pathA);
                }
            }
        }
    } catch (e) {
        console.warn('[Sync] Two-way provider sync warning:', e.message);
    }
}

// Initial load
loadAdminSettings();

module.exports = {
    SECRET_FIELDS,
    redactSecrets,
    encodeConfigParam,
    ADMIN_SETTINGS_FILE,
    globalServerSettings,
    loadAdminSettings,
    saveAdminSettings,
    applyGlobalAdminOverrides,
    getCbProviderRepoDirs,
    syncTwoWayCbProviders,
    isVercel,
    isRender
};
