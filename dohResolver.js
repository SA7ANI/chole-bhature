const https = require('https');
const http = require('http');
const dns = require('dns');
const net = require('net');
const axios = require('axios');

// Supported DoH Providers
const DOH_PROVIDERS = {
    cloudflare: {
        name: 'Cloudflare (1.1.1.1)',
        url: 'https://cloudflare-dns.com/dns-query',
        headers: { 'Accept': 'application/dns-json' }
    },
    google: {
        name: 'Google (8.8.8.8)',
        url: 'https://dns.google/resolve',
        headers: { 'Accept': 'application/json' }
    },
    adguard: {
        name: 'AdGuard DNS',
        url: 'https://dns.adguard-dns.com/resolve',
        headers: { 'Accept': 'application/json' }
    },
    quad9: {
        name: 'Quad9 (9.9.9.9)',
        url: 'https://dns.quad9.net:5053/dns-query',
        headers: { 'Accept': 'application/dns-json' }
    }
};

let currentProvider = 'cloudflare';
let isDohEnabled = true;

// In-memory DNS cache: hostname -> { address: '1.2.3.4', family: 4, expiresAt: timestamp }
const dnsCache = new Map();
const pendingResolutions = new Map();

function normalizeHostname(hostname) {
    if (!hostname) return '';
    return hostname.toLowerCase().replace(/\.$/, '').trim();
}

/**
 * Resolves a hostname to an IPv4/IPv6 address via DNS-over-HTTPS
 */
async function resolveDoH(hostname, providerKey = currentProvider) {
    const normHost = normalizeHostname(hostname);
    if (!normHost) throw new Error('Invalid hostname');

    // 1. Direct IP check
    const ipType = net.isIP(normHost);
    if (ipType !== 0) {
        return { address: normHost, family: ipType };
    }

    // 2. Local / internal domains fallback
    if (normHost === 'localhost' || normHost.endsWith('.local') || normHost.endsWith('.internal')) {
        return new Promise((resolve, reject) => {
            dns.lookup(normHost, (err, address, family) => {
                if (err) return reject(err);
                resolve({ address, family });
            });
        });
    }

    // 3. Cache lookup
    const cached = dnsCache.get(normHost);
    if (cached && cached.expiresAt > Date.now()) {
        return { address: cached.address, family: cached.family };
    }

    // 4. Coalesce in-flight requests for identical hostnames
    if (pendingResolutions.has(normHost)) {
        return await pendingResolutions.get(normHost);
    }

    const resolutionPromise = (async () => {
        const providerConfig = DOH_PROVIDERS[providerKey] || DOH_PROVIDERS.cloudflare;
        
        try {
            const res = await axios.get(providerConfig.url, {
                params: {
                    name: normHost,
                    type: 'A'
                },
                headers: {
                    ...providerConfig.headers,
                    'User-Agent': 'CholeBhature-DoH-Resolver/2.2'
                },
                timeout: 3500
            });

            if (res.data && Array.isArray(res.data.Answer)) {
                // Look for Type 1 (A record)
                const aRecord = res.data.Answer.find(ans => ans.type === 1 && net.isIPv4(ans.data));
                if (aRecord) {
                    const ttl = Math.max(60, Math.min(aRecord.TTL || 300, 3600));
                    const result = { address: aRecord.data, family: 4 };
                    dnsCache.set(normHost, {
                        address: result.address,
                        family: result.family,
                        expiresAt: Date.now() + (ttl * 1000)
                    });
                    return result;
                }
            }

            // If no A record in Answer, try fallback to native DNS
            return await new Promise((resolve, reject) => {
                dns.lookup(normHost, (err, address, family) => {
                    if (err) return reject(err);
                    resolve({ address, family });
                });
            });

        } catch (err) {
            // If DoH fails or times out, fallback to native DNS lookup
            return await new Promise((resolve, reject) => {
                dns.lookup(normHost, (err, address, family) => {
                    if (err) return reject(err);
                    resolve({ address, family });
                });
            });
        } finally {
            pendingResolutions.delete(normHost);
        }
    })();

    pendingResolutions.set(normHost, resolutionPromise);
    return await resolutionPromise;
}

/**
 * Node.js custom lookup function compatible with http.Agent and https.Agent
 */
function dohLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    } else if (typeof options === 'number') {
        options = { family: options };
    } else if (!options) {
        options = {};
    }

    if (!isDohEnabled) {
        return dns.lookup(hostname, options, callback);
    }

    resolveDoH(hostname)
        .then(({ address, family }) => {
            if (options.all) {
                callback(null, [{ address, family }]);
            } else {
                callback(null, address, family);
            }
        })
        .catch(err => {
            // Final fallback to native DNS lookup
            dns.lookup(hostname, options, callback);
        });
}

function setDohEnabled(enabled) {
    isDohEnabled = !!enabled;
}

function setDohProvider(provider) {
    if (DOH_PROVIDERS[provider]) {
        currentProvider = provider;
    }
}

function getDohConfig() {
    return {
        enabled: isDohEnabled,
        provider: currentProvider,
        providerName: DOH_PROVIDERS[currentProvider]?.name || currentProvider,
        cacheSize: dnsCache.size
    };
}

function clearDnsCache() {
    dnsCache.clear();
}

// Pre-configured connection pooled agents equipped with DoH lookup
const dohHttpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 30,
    timeout: 30000,
    lookup: dohLookup
});

const dohHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 30,
    timeout: 30000,
    lookup: dohLookup
});

module.exports = {
    DOH_PROVIDERS,
    resolveDoH,
    dohLookup,
    setDohEnabled,
    setDohProvider,
    getDohConfig,
    clearDnsCache,
    dohHttpAgent,
    dohHttpsAgent
};
