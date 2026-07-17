const axios = require('axios');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const vm = require('vm');

class ProviderLoader {
    constructor() {
        // Cache providers by their manifest URL to avoid reloading on every request
        this.providerCache = new Map();
    }

    async loadProviders(manifestUrl) {
        if (this.providerCache.has(manifestUrl)) {
            const cached = this.providerCache.get(manifestUrl);
            // Re-fetch only if cache is older than 1 hour
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

            for (const scraper of manifest.scrapers || []) {
                if (!scraper.enabled) continue;
                
                const scriptUrl = `${baseUrl}/${scraper.filename}`;
                console.log(`[ProviderLoader] Loading script for ${scraper.name}: ${scriptUrl}`);
                
                try {
                    const scriptRes = await axios.get(scriptUrl);
                    const scriptCode = scriptRes.data;
                    
                    // Create a secure sandbox for the provider script
                    const sandbox = {
                        console: console,
                        fetch: fetch,
                        setTimeout: setTimeout,
                        clearTimeout: clearTimeout,
                        setInterval: setInterval,
                        clearInterval: clearInterval,
                        require: (moduleName) => {
                            if (moduleName === 'axios') return axios;
                            if (moduleName === 'crypto-js') return CryptoJS;
                            if (moduleName === 'cheerio-without-node-native' || moduleName === 'cheerio') return cheerio;
                            return null;
                        },
                        module: { exports: {} },
                        exports: {},
                    };

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
