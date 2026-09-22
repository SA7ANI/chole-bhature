const axios = require('axios');
const { dohHttpAgent, dohHttpsAgent } = require('./dohResolver');
const { parseTorrentTitle, cleanReleaseNoise } = require('./torrentParser');
const { ingestStream, normalizeInfoHash, parseSizeToBytes, formatBytesToSize, extractCleanProvider } = require('./streamIngest');
const { formatStreamCard, formatProviderChain } = require('./streamFormatter');

const TIMEOUT_MS = (typeof process !== 'undefined' && process.env.VERCEL) ? 800 : 1200;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// High-speed domain latency memoization to avoid probing identical CDNs 50+ times
const domainLatencyCache = new Map();
const domainLatencyPending = new Map();

function clearDomainLatencyCache() {
    domainLatencyCache.clear();
    domainLatencyPending.clear();
}

// Debrid Instant Availability Cache (5 min TTL)
const debridAvailabilityCache = new Map();

async function checkDebridAvailability(hashes, config = {}) {
    if (!hashes || hashes.length === 0 || !config.debridApiKey) return new Set();
    const provider = (config.debridProvider || '').toLowerCase();
    const apiKey = config.debridApiKey.trim();
    const cachedSet = new Set();

    if (provider === 'realdebrid') {
        const uncachedHashes = [];
        for (const h of hashes) {
            const lowH = h.toLowerCase();
            const cachedEntry = debridAvailabilityCache.get(`rd:${lowH}`);
            if (cachedEntry && Date.now() - cachedEntry.time < 300000) {
                if (cachedEntry.available) cachedSet.add(lowH);
            } else {
                uncachedHashes.push(lowH);
            }
        }

        if (uncachedHashes.length > 0) {
            try {
                // Batch up to 50 hashes
                const batch = uncachedHashes.slice(0, 50);
                const pathStr = batch.join('/');
                const res = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${pathStr}`, {
                    headers: { Authorization: `Bearer ${apiKey}` },
                    timeout: 3500,
                    httpAgent: dohHttpAgent,
                    httpsAgent: dohHttpsAgent
                });
                if (res.data && typeof res.data === 'object') {
                    for (const [hashKey, hostData] of Object.entries(res.data)) {
                        const isInstant = Boolean(hostData && hostData.rd && Array.isArray(hostData.rd) && hostData.rd.length > 0);
                        debridAvailabilityCache.set(`rd:${hashKey.toLowerCase()}`, { available: isInstant, time: Date.now() });
                        if (isInstant) cachedSet.add(hashKey.toLowerCase());
                    }
                }
            } catch (e) {}
        }
    } else if (provider === 'torbox') {
        const uncachedHashes = [];
        for (const h of hashes) {
            const lowH = h.toLowerCase();
            const cachedEntry = debridAvailabilityCache.get(`tb:${lowH}`);
            if (cachedEntry && Date.now() - cachedEntry.time < 300000) {
                if (cachedEntry.available) cachedSet.add(lowH);
            } else {
                uncachedHashes.push(lowH);
            }
        }

        if (uncachedHashes.length > 0) {
            try {
                const res = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${uncachedHashes.slice(0, 50).join(',')}&format=object`, {
                    headers: { Authorization: `Bearer ${apiKey}` },
                    timeout: 3500,
                    httpAgent: dohHttpAgent,
                    httpsAgent: dohHttpsAgent
                });
                if (res.data && res.data.data) {
                    for (const [hashKey, isAvail] of Object.entries(res.data.data)) {
                        const isInstant = Boolean(isAvail);
                        debridAvailabilityCache.set(`tb:${hashKey.toLowerCase()}`, { available: isInstant, time: Date.now() });
                        if (isInstant) cachedSet.add(hashKey.toLowerCase());
                    }
                }
            } catch (e) {}
        }
    }
    return cachedSet;
}

function cleanProviderName(rawName) {
    return extractCleanProvider(rawName);
}

function extractCleanTitleAndDetails(rawText, stream = null) {
    const candidate = (stream && stream.behaviorHints && stream.behaviorHints.filename) 
        || (rawText ? String(rawText).split('\n')[0].trim() : '');
    const parsed = parseTorrentTitle(candidate);
    return {
        cleanTitle: parsed.title,
        year: parsed.year,
        seasonEpisode: parsed.seasonEpisode,
        releaseGroup: parsed.releaseGroup,
        dvProfile: parsed.dvProfile
    };
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'for', 'to', 'with', 'at', 'by', 'from', 'part', 'vol', 'volume', 'chapter', 'movie', 'film']);

function normalizeTitleForMatching(raw) {
    if (!raw) return '';
    return raw
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTitleKeywords(title) {
    const norm = normalizeTitleForMatching(title);
    return norm.split(' ').filter(w => w.length > 0 && !STOP_WORDS.has(w));
}

function isStreamMatchingTarget(stream, target) {
    if (!target || !target.title) return true; // Don't block if target metadata is unavailable

    const rawStreamText = [
        stream.title || '',
        stream.name || '',
        stream.description || '',
        stream.url || ''
    ].join(' ');

    const sceneDetails = extractCleanTitleAndDetails((stream.title || stream.name || '').split('\n')[0]);
    const cleanStreamTitle = sceneDetails.cleanTitle || '';
    
    // Discard placeholder/dummy streams
    if (cleanStreamTitle.toLowerCase().includes('anime title') || (stream.title || '').toLowerCase().includes('anime title')) {
        return false;
    }

    const rawNormalizedStream = normalizeTitleForMatching(rawStreamText);
    const targetKeywords = extractTitleKeywords(target.title);
    const altKeywords = target.originalTitle ? extractTitleKeywords(target.originalTitle) : [];

    // Helper to evaluate keyword match
    const evaluateKeywords = (keywords) => {
        if (!keywords || keywords.length === 0) return false;
        let matched = 0;
        for (const kw of keywords) {
            const kwRegex = new RegExp('(\\b|\\d)' + kw + '(\\b|\\d)', 'i');
            if (kwRegex.test(rawNormalizedStream) || rawNormalizedStream.includes(kw)) {
                matched++;
            }
        }
        // If 1 or 2 keywords (e.g. 'Heart Beast', 'Fight Club'), MUST match 100% of distinctive words
        if (keywords.length <= 2) {
            return matched === keywords.length;
        }
        // If 3+ keywords (e.g. 'Avatar The Way of Water'), require at least 70%
        return (matched / keywords.length) >= 0.70;
    };

    const targetMatched = evaluateKeywords(targetKeywords) || evaluateKeywords(altKeywords);

    // If target keywords are not satisfied in the stream title or URL, discard wrong movie
    if (!targetMatched) {
        return false;
    }

    // 2. Year & Unreleased Movie Validation
    if (target.type === 'movie' && target.year) {
        const tYear = parseInt(target.year, 10);
        const yearMatch = rawStreamText.match(/\b(19\d{2}|20\d{2})\b/);
        const sYear = sceneDetails.year ? parseInt(sceneDetails.year, 10) : (yearMatch ? parseInt(yearMatch[1], 10) : null);
        
        // Strict year drift check (must be within 1 year of target release)
        if (sYear && !isNaN(tYear) && !isNaN(sYear) && Math.abs(tYear - sYear) > 1) {
            return false;
        }

        // Future unreleased movies (scheduled beyond current calendar year) have no digital releases yet
        const currentYear = new Date().getFullYear();
        if (!isNaN(tYear) && tYear > currentYear && target.isUnreleased) {
            return false;
        }
    }

    // 3. Series / Episode Validation (for TV series)
    if ((target.type === 'series' || target.type === 'tv') && target.season && target.episode) {
        const reqS = parseInt(target.season, 10);
        const reqE = parseInt(target.episode, 10);
        
        if (sceneDetails.seasonEpisode) {
            const seStr = sceneDetails.seasonEpisode.toUpperCase();
            const epMatch = seStr.match(/S(\d+)E(\d+)/i) || seStr.match(/(\d+)X(\d+)/i);
            if (epMatch) {
                const sNum = parseInt(epMatch[1], 10);
                const eNum = parseInt(epMatch[2], 10);
                if (sNum !== reqS || eNum !== reqE) {
                    return false;
                }
            } else {
                const seasonOnlyMatch = seStr.match(/S(\d+)(?:-S?(\d+))?/i);
                if (seasonOnlyMatch) {
                    const startS = parseInt(seasonOnlyMatch[1], 10);
                    const endS = seasonOnlyMatch[2] ? parseInt(seasonOnlyMatch[2], 10) : startS;
                    if (reqS < startS || reqS > endS) {
                        return false;
                    }
                }
            }
        }
    }

    return true;
}

function parseStreamMetadata(stream) {
    if (!stream) return {};
    if (stream._preparsedMeta) return stream._preparsedMeta;
    const target = stream._rawStream || stream;
    const ingested = ingestStream(target);
    if (!ingested) return {};
    const parsed = ingested.parsed || {};
    return {
        cleanTitle: parsed.title,
        year: parsed.year,
        seasonEpisode: parsed.seasonEpisode,
        releaseGroup: parsed.releaseGroup,
        dvProfile: parsed.dvProfile,
        resolution: parsed.resolution,
        quality: parsed.quality,
        hdr: parsed.hdr || [],
        special: parsed.special || [],
        codec: parsed.codec,
        audio: parsed.audio || [],
        channels: parsed.channels,
        languages: parsed.languages || [],
        languageFlags: parsed.languageFlags || [],
        subtitles: parsed.subtitles || [],
        size: ingested.sizeFormatted,
        sizeBytes: ingested.sizeBytes,
        sizeGB: ingested.sizeBytes ? Math.round((ingested.sizeBytes / (1024 * 1024 * 1024)) * 100) / 100 : null,
        seeders: ingested.seeders,
        peers: null,
        isCam: parsed.isCam,
        isSample: parsed.isSample,
        isComplete: parsed.isComplete,
        edition: parsed.edition,
        isMultiAudio: parsed.isMultiAudio,
        isDualAudio: parsed.isDualAudio
    };
}

function formatProviderLabel(providers, defaultName) {
    return formatProviderChain(providers, defaultName);
}

function normalizeTorrentHash(str) {
    if (!str || typeof str !== 'string') return null;
    const magnetMatch = str.match(/xt=urn:btih:([a-zA-Z0-9]{32,40})/i);
    if (magnetMatch) {
        return magnetMatch[1].toLowerCase();
    }
    if (/^[a-fA-F0-9]{40}$/.test(str) || /^[a-zA-Z2-7]{32}$/.test(str)) {
        return str.toLowerCase();
    }
    return null;
}

function getStreamFingerprint(stream) {
    if (!stream) return null;

    // 1. Torrent InfoHash / Magnet URI
    const hashFromInfoHash = normalizeTorrentHash(stream.infoHash);
    if (hashFromInfoHash) return `torrent:${hashFromInfoHash}`;

    const hashFromUrl = stream.url ? normalizeTorrentHash(stream.url) : null;
    if (hashFromUrl) return `torrent:${hashFromUrl}`;

    // 2. Direct Video URL or External URL
    const rawUrl = stream.url || stream.externalUrl || stream.ytId;
    if (rawUrl && typeof rawUrl === 'string') {
        try {
            if (rawUrl.startsWith('http')) {
                const parsed = new URL(rawUrl);
                const searchParams = new URLSearchParams(parsed.search);
                ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source', 'token_expiry', 'session_id'].forEach(p => searchParams.delete(p));
                const cleanQuery = searchParams.toString() ? `?${searchParams.toString()}` : '';
                return `url:${parsed.protocol}//${parsed.host}${parsed.pathname}${cleanQuery}`.toLowerCase();
            }
        } catch (e) {}
        return `raw:${rawUrl.trim().toLowerCase()}`;
    }

    // 3. Fallback: Release signature match (identical normalized title + resolution + size)
    const meta = parseStreamMetadata(stream);
    const titleNorm = (stream.title || stream.description || stream.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (titleNorm && meta.resolution && meta.size) {
        return `release:${titleNorm}:${meta.resolution}:${meta.size}`;
    }

    return null;
}

function deduplicateAndMergeStreams(streams, enabled = true) {
    if (!streams || !Array.isArray(streams) || streams.length === 0) return [];
    if (!enabled) return streams;

    const mergedMap = new Map();
    const result = [];

    for (const stream of streams) {
        const fingerprint = getStreamFingerprint(stream);
        const pName = cleanProviderName(stream.originalProvider || stream.name);

        if (!fingerprint) {
            const copy = { ...stream, providers: pName ? [pName] : ['Stream'] };
            result.push(copy);
            continue;
        }

        if (mergedMap.has(fingerprint)) {
            const existing = mergedMap.get(fingerprint);

            // Merge providers
            if (!existing.providers) {
                existing.providers = [cleanProviderName(existing.originalProvider || existing.name)];
            }
            if (pName && !existing.providers.includes(pName)) {
                existing.providers.push(pName);
            }

            // Merge seeders (preserve highest seeders count)
            const metaExisting = parseStreamMetadata(existing);
            const metaNew = parseStreamMetadata(stream);
            const maxSeeders = Math.max(metaExisting.seeders || 0, metaNew.seeders || 0, existing.seeders || 0, stream.seeders || 0);
            if (maxSeeders > 0) {
                existing.seeders = maxSeeders;
            }

            // Merge descriptions / titles if new one is richer (e.g. contains regional audio tags)
            if (stream.title && existing.title && stream.title !== existing.title) {
                if (stream.title.length > existing.title.length) {
                    existing.title = stream.title;
                }
            }

            // Merge custom headers
            if (stream.headers || stream.behaviorHints) {
                existing.headers = { ...(existing.headers || {}), ...(stream.headers || {}) };
                existing.behaviorHints = { ...(existing.behaviorHints || {}), ...(stream.behaviorHints || {}) };
            }
        } else {
            const copy = { ...stream, providers: pName ? [pName] : ['Stream'] };
            mergedMap.set(fingerprint, copy);
            result.push(copy);
        }
    }

    return result;
}

function parseStreamMetadata(stream) {
    if (!stream) return {};
    if (stream.parsed) return stream.parsed;
    if (stream._preparsedMeta) return stream._preparsedMeta;
    const text = [
        stream.title || '',
        stream.name || '',
        stream.behaviorHints?.filename || '',
        stream.description || ''
    ].filter(Boolean).join(' ');
    return parseTorrentTitle(text);
}

function formatStreamLabels(stream, latency = 150, isP2P = false, isDead = false, showSeeders = true, config = {}) {
    const target = stream._rawStream || stream;
    const ingested = ingestStream(target, config);
    if (!ingested) return { name: stream.name || 'Stream', title: stream.title || '' };
    if (stream._preparsedMeta) {
        ingested.parsed = { ...stream._preparsedMeta };
    }
    if (isP2P) ingested.isP2P = true;
    return formatStreamCard(ingested, {
        latency,
        isDead,
        config: { ...config, showSeeders },
        preset: config.cardPreset || 'aiostreams'
    });
}

function getResolutionTier(stream) {
    if (!stream) return 0;
    const meta = parseStreamMetadata(stream);
    if (meta.resolution === '2160p') return 4;
    if (meta.resolution === '1080p') return 3;
    if (meta.resolution === '720p') return 2;
    if (meta.resolution === '480p') return 1;
    return 0;
}

function getQualityScore(stream) {
    if (!stream) return 0;
    const meta = parseStreamMetadata(stream);
    let score = 0;

    // 1. Resolution Base Tier (4000 = 4K, 3000 = 1080p, 2000 = 720p, 1000 = 480p)
    if (meta.resolution === '2160p') score += 4000;
    else if (meta.resolution === '1080p') score += 3000;
    else if (meta.resolution === '720p') score += 2000;
    else if (meta.resolution === '480p') score += 1000;

    // 2. Source / Release Quality Tier (Within resolution tier)
    if (meta.special.includes('REMUX')) score += 500;
    else if (meta.quality === 'BluRay') score += 400;
    else if (meta.quality === 'WEB-DL') score += 300;
    else if (meta.quality === 'WEBRip') score += 200;
    else if (meta.quality === 'HDTV') score += 100;
    else if (meta.quality === 'CAM') score -= 500;

    // 3. HDR / Visual Quality Bonuses
    if (meta.hdr.includes('Dolby Vision')) score += 50;
    if (meta.hdr.includes('HDR10+') || meta.hdr.includes('HDR10') || meta.hdr.includes('HDR')) score += 30;
    if (meta.special.includes('IMAX Enhanced') || meta.special.includes('IMAX')) score += 20;
    if (meta.special.includes('10bit')) score += 10;

    // 4. Audio Quality Bonuses
    if (meta.audio.includes('Dolby Atmos')) score += 25;
    if (meta.audio.includes('TrueHD') || meta.audio.includes('DTS-HD MA') || meta.audio.includes('DTS:X')) score += 20;
    else if (meta.audio.includes('DDP')) score += 15;
    else if (meta.audio.includes('FLAC')) score += 15;
    else if (meta.audio.includes('DD') || meta.audio.includes('DTS')) score += 10;

    return score;
}

function getAudioScore(stream, preferredLanguages = [], prioritizeHindi = false) {
    if (!stream) return 0;
    const meta = parseStreamMetadata(stream);
    const langs = (meta.languages || []).map(l => l.toLowerCase());
    const text = [stream.name || '', stream.title || '', stream.description || ''].join(' ').toLowerCase();

    const list = Array.isArray(preferredLanguages) && preferredLanguages.length > 0
        ? preferredLanguages.map(l => l.toLowerCase())
        : (prioritizeHindi ? ['hindi', 'dual-audio'] : []);

    if (list.length === 0) return 0;

    let score = 0;
    let matchedSpecific = false;

    list.forEach((pref, index) => {
        const isGenericTag = (pref === 'dual-audio' || pref === 'multi-audio');
        const weight = Math.max(200, (list.length - index) * 500);

        if (isGenericTag) {
            // Only reward generic Dual-Audio/Multi-Audio token if specifically in requested list
            if (langs.includes(pref) || text.includes(pref.replace('-', ' ')) || text.includes(pref.replace('-', ''))) {
                score += Math.max(50, Math.floor(weight / 4));
            }
        } else {
            // Match specific languages (e.g. hindi, tamil, telugu, english, japanese, etc.)
            let regexPattern = `\\b${pref}\\b`;
            if (pref === 'portuguese') {
                regexPattern = `\\b(portuguese|pt\\-?br|pt)\\b`;
            } else if (pref === 'japanese') {
                regexPattern = `\\b(japanese|jap)\\b`;
            } else if (pref === 'english') {
                regexPattern = `\\b(english|eng|en)\\b`;
            }

            const matched = langs.includes(pref) || new RegExp(regexPattern, 'i').test(text);
            if (matched) {
                score += weight;
                matchedSpecific = true;
            }
        }
    });

    // Dual-Audio / Multi-Audio synergy bonus ONLY if stream actually contains one of the user's preferred languages
    const hasDualOrMulti = langs.includes('dual-audio') || langs.includes('multi-audio') || text.includes('dual') || text.includes('multi');
    if (hasDualOrMulti && matchedSpecific) {
        score += 150;
    }

    return score;
}

function getSeederScore(stream) {
    const meta = parseStreamMetadata(stream);
    return meta.seeders || 0;
}

async function testStream(stream, showSeeders = true, config = {}) {
    const startTime = Date.now();
    const originalName = stream.name || 'Stream';
    const providerName = cleanProviderName(originalName);

    const rawSnapshot = stream._rawStream || {
        name: stream.name,
        title: stream.title,
        filename: stream.behaviorHints?.filename
    };
    stream._rawStream = rawSnapshot;
    const initialMeta = stream._preparsedMeta || parseStreamMetadata(rawSnapshot);
    stream._preparsedMeta = initialMeta;

    // Normalize headers for players (ExoPlayer, Nuvio, Stremio)
    const customHeaders = {
        ...(stream.headers || {}),
        ...(stream.behaviorHints?.proxyHeaders?.request || {})
    };

    if (Object.keys(customHeaders).length > 0) {
        stream.behaviorHints = stream.behaviorHints || {};
        stream.behaviorHints.proxyHeaders = stream.behaviorHints.proxyHeaders || {};
        stream.behaviorHints.proxyHeaders.request = {
            ...(stream.behaviorHints.proxyHeaders.request || {}),
            ...customHeaders
        };
    }

    // If stream already has pre-computed test results (e.g. from cache or mock tests)
    if (stream._pretested || (typeof stream.latency === 'number' && stream.statusCategory)) {
        const isDead = Boolean(stream.isDead || stream.statusCategory === 'dead' || stream.latency >= 90000);
        const labels = formatStreamLabels(stream, stream.latency, false, isDead, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: stream.latency,
            isDead: isDead,
            statusCategory: stream.statusCategory,
            originalProvider: stream.originalProvider || providerName,
            _rawStream: rawSnapshot,
            _preparsedMeta: initialMeta
        };
    }

    // Handle P2P Magnet streams (e.g. Torrentio)
    if ((stream.url && stream.url.startsWith('magnet:')) || stream.infoHash) {
        const meta = parseStreamMetadata(stream);
        const seeders = stream.seeders !== undefined && stream.seeders !== null 
            ? stream.seeders 
            : (meta.seeders !== null && meta.seeders !== undefined ? meta.seeders : null);

        let p2pLatency = 350;
        let isDead = false;
        let statusCategory = 'fast';

        if (seeders !== null) {
            if (seeders === 0) {
                isDead = true;
                statusCategory = 'dead';
                p2pLatency = 99999;
            } else if (seeders < 5) {
                // 🔴 1-4 seeders: Unhealthy swarm, severe buffering risk -> SLOW
                isDead = false;
                statusCategory = 'slow';
                p2pLatency = 1500 + (5 - seeders) * 100; // 1600ms - 1900ms
            } else if (seeders < 20) {
                // 🟡 5-19 seeders: Moderate swarm -> SLOW tier
                isDead = false;
                statusCategory = 'slow';
                p2pLatency = 850 + (20 - seeders) * 25; // 875ms - 1225ms
            } else {
                // 🟢 >= 20 seeders: Healthy swarm -> FAST tier
                isDead = false;
                statusCategory = 'fast';
                p2pLatency = Math.max(120, Math.round(520 - Math.min(seeders, 500) * 0.8));
            }
        }

        const labels = formatStreamLabels(stream, p2pLatency, true, isDead, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: p2pLatency,
            isDead: isDead,
            statusCategory: statusCategory,
            originalProvider: providerName,
            _rawStream: rawSnapshot,
            _preparsedMeta: initialMeta
        };
    }

    // Handle external links or YouTube links
    if (stream.externalUrl || stream.ytId) {
        const labels = formatStreamLabels(stream, 100, true, false, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 100,
            isDead: false,
            statusCategory: 'fast',
            originalProvider: providerName,
            _rawStream: rawSnapshot,
            _preparsedMeta: initialMeta
        };
    }

    if (!stream.url || !stream.url.startsWith('http')) {
        const labels = formatStreamLabels(stream, 99999, false, true, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 99999,
            isDead: true,
            statusCategory: 'dead',
            originalProvider: providerName,
            _rawStream: rawSnapshot,
            _preparsedMeta: initialMeta
        };
    }

    // Handle Telegram cloud streams
    if (stream.url && (stream.url.includes('/stream/telegram') || stream.provider === 'Telegram' || providerName.toLowerCase().includes('telegram'))) {
        const tgLatency = (typeof stream.latency === 'number' && stream.latency > 0) 
            ? stream.latency 
            : ((config && config.telegramBridgePing) ? config.telegramBridgePing : 45);
        const labels = formatStreamLabels(stream, tgLatency, false, false, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: tgLatency,
            isDead: false,
            statusCategory: 'fast',
            originalProvider: providerName,
            _rawStream: rawSnapshot,
            _preparsedMeta: initialMeta
        };
    }

    // Eco Mode heuristic bypass removed: We now perform real HTTP HEAD checks even in Eco Mode
    // because the timeout is strictly capped at 800ms on Vercel, which prevents blocking while ensuring dead links are filtered.

    try {
        const urlObj = new URL(stream.url);
        
        // 🚨 Bypass probing for Localhost / LAN / Telegram Bridge URLs
        // Vercel cannot probe the user's local PC, so we must assume these are alive.
        const hostname = urlObj.hostname;
        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
        if (isLocal || providerName === 'Telegram') {
            const labels = formatStreamLabels(stream, 45, false, false, showSeeders, config);
            return {
                ...stream,
                name: labels.name,
                title: labels.title,
                latency: 45,
                isDead: false,
                statusCategory: 'fast',
                originalProvider: providerName,
                _rawStream: rawSnapshot,
                _preparsedMeta: initialMeta
            };
        }

        const origin = urlObj.origin;

        const probeHeaders = {
            'User-Agent': customHeaders['User-Agent'] || customHeaders['user-agent'] || USER_AGENT,
            ...(customHeaders['Referer'] || customHeaders['referer'] ? { 'Referer': customHeaders['Referer'] || customHeaders['referer'] } : {}),
            ...(customHeaders['Origin'] || customHeaders['origin'] ? { 'Origin': customHeaders['Origin'] || customHeaders['origin'] } : {})
        };

        // Specific per-stream check for HubCloud links (detect if this specific file was removed)
        if (stream.url.includes('hubcloud.')) {
            try {
                const hcRes = await axios.get(stream.url, { 
                    timeout: TIMEOUT_MS, 
                    headers: probeHeaders,
                    httpAgent: dohHttpAgent,
                    httpsAgent: dohHttpsAgent,
                    validateStatus: () => true 
                });
                const data = typeof hcRes.data === 'string' ? hcRes.data.toLowerCase() : '';
                if (data.includes('file deleted') || data.includes('file not found') || data.includes('file was deleted') || data.includes('page not found') || hcRes.status === 404 || hcRes.status === 410) {
                    const labels = formatStreamLabels(stream, 99999, false, true, showSeeders, config);
                    return {
                        ...stream,
                        name: labels.name,
                        title: labels.title,
                        latency: 99999,
                        isDead: true,
                        statusCategory: 'dead',
                        originalProvider: providerName,
                        _rawStream: rawSnapshot,
                        _preparsedMeta: initialMeta
                    };
                }
            } catch (err) { 
                // Keep stream alive on transient error
            }
        }

        // Direct per-stream real-time latency & health probe
        let latency = 0;
        let isDead = false;

        try {
            // 1. Primary probe: Direct HEAD request to stream.url
            const res = await axios.head(stream.url, {
                timeout: TIMEOUT_MS,
                headers: probeHeaders,
                httpAgent: dohHttpAgent,
                httpsAgent: dohHttpsAgent,
                validateStatus: () => true,
                maxRedirects: 3
            });

            if (res.status === 404 || res.status === 410 || res.status >= 500) {
                isDead = true;
                latency = 99999;
            } else if (res.status === 403) {
                // If HEAD returns 403, verify with GET Range before assuming dead
                try {
                    const rangeRes = await axios.get(stream.url, {
                        timeout: TIMEOUT_MS,
                        headers: { ...probeHeaders, 'Range': 'bytes=0-10' },
                        httpAgent: dohHttpAgent,
                        httpsAgent: dohHttpsAgent,
                        validateStatus: () => true,
                        maxRedirects: 3
                    });
                    if (rangeRes.status === 404 || rangeRes.status === 410 || rangeRes.status >= 500) {
                        isDead = true;
                        latency = 99999;
                    } else if (rangeRes.status === 403) {
                        // Both HEAD and GET Range returned 403: verify if server origin is reachable
                        try {
                            await axios.head(origin, {
                                timeout: TIMEOUT_MS,
                                headers: probeHeaders,
                                httpAgent: dohHttpAgent,
                                httpsAgent: dohHttpsAgent,
                                validateStatus: (status) => status >= 200 && status < 400
                            });
                            latency = Math.max(45, Date.now() - startTime);
                        } catch (oErr) {
                            isDead = true;
                            latency = 99999;
                        }
                    } else {
                        latency = Math.max(35, Date.now() - startTime);
                    }
                } catch (rErr) {
                    if (rErr.code === 'ECONNREFUSED' || rErr.code === 'ENOTFOUND') {
                        isDead = true;
                        latency = 99999;
                    } else {
                        latency = 850;
                    }
                }
            } else {
                latency = Math.max(35, Date.now() - startTime);
            }
        } catch (headErr) {
            // HEAD rejected or connection error -> fallback to GET Range probe
            try {
                const getRes = await axios.get(stream.url, {
                    timeout: TIMEOUT_MS,
                    headers: { ...probeHeaders, 'Range': 'bytes=0-10' },
                    httpAgent: dohHttpAgent,
                    httpsAgent: dohHttpsAgent,
                    validateStatus: () => true,
                    maxRedirects: 3
                });

                if (getRes.status === 404 || getRes.status === 410 || getRes.status >= 500) {
                    isDead = true;
                    latency = 99999;
                } else if (getRes.status === 403) {
                    try {
                        await axios.head(origin, {
                            timeout: TIMEOUT_MS,
                            headers: probeHeaders,
                            httpAgent: dohHttpAgent,
                            httpsAgent: dohHttpsAgent,
                            validateStatus: (status) => status >= 200 && status < 400
                        });
                        latency = Math.max(50, Date.now() - startTime);
                    } catch (oErr) {
                        isDead = true;
                        latency = 99999;
                    }
                } else {
                    latency = Math.max(45, Date.now() - startTime);
                }
            } catch (getErr) {
                if (getErr.code === 'ECONNREFUSED' || getErr.code === 'ENOTFOUND') {
                    isDead = true;
                    latency = 99999;
                } else {
                    try {
                        await axios.head(origin, {
                            timeout: TIMEOUT_MS,
                            headers: probeHeaders,
                            httpAgent: dohHttpAgent,
                            httpsAgent: dohHttpsAgent,
                            validateStatus: (status) => status < 500
                        });
                        latency = Math.max(60, Date.now() - startTime);
                    } catch (oErr) {
                        latency = 850;
                    }
                }
            }
        }

        if (isDead || latency >= 90000) {
            const labels = formatStreamLabels(stream, 99999, false, true, showSeeders, config);
            return {
                ...stream,
                name: labels.name,
                title: labels.title,
                latency: 99999,
                isDead: true,
                statusCategory: 'dead',
                originalProvider: providerName,
                _rawStream: rawSnapshot,
                _preparsedMeta: initialMeta
            };
        }

        const statusCategory = latency < 800 ? 'fast' : 'slow';
        const labels = formatStreamLabels(stream, latency, false, false, showSeeders, config);

        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: latency,
            isDead: false,
            statusCategory: statusCategory,
            originalProvider: providerName,
            _rawStream: rawSnapshot,
            _preparsedMeta: initialMeta
        };

    } catch (err) {
        const labels = formatStreamLabels(stream, 1200, false, false, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 1200,
            isDead: false,
            statusCategory: 'slow',
            originalProvider: providerName,
            _rawStream: rawSnapshot,
            _preparsedMeta: initialMeta
        };
    }
}

/**
 * Builds a standardized Scene release filename for Nuvio Badge Matcher.
 * Matches Nuvio / NardBadges regex requirements for Resolution, HDR/DV, Codec, Audio, Channels, and Languages.
 */
function buildNuvioSceneFilename(meta, target = {}) {
    const parts = [];
    
    // 1. Title & Year
    const title = target.title || meta.cleanTitle || 'Video';
    const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
    parts.push(cleanTitle);

    const year = target.year || meta.year;
    if (year) parts.push(String(year));

    // 2. Season/Episode if series
    if (meta.seasonEpisode) {
        parts.push(meta.seasonEpisode.toUpperCase());
    } else if (target.season && target.episode) {
        const s = String(target.season).padStart(2, '0');
        const e = String(target.episode).padStart(2, '0');
        parts.push(`S${s}E${e}`);
    }

    // 3. Resolution (2160p.UHD, 1080p, 720p, 480p) - Only add if genuinely detected
    const res = (meta.resolution || '').toLowerCase();
    if (res.includes('4k') || res.includes('2160') || res.includes('uhd')) {
        parts.push('2160p.UHD');
    } else if (res.includes('1080') || res.includes('fhd')) {
        parts.push('1080p');
    } else if (res.includes('720') || res.includes('hd')) {
        parts.push('720p');
    } else if (res.includes('480') || res.includes('sd')) {
        parts.push('480p');
    }

    // 4. Source / Quality (Remux, BluRay, WEB-DL, WEBRip, HDTV) - Only add if genuinely detected
    const qual = (meta.quality || '').toLowerCase();
    const isRemux = (meta.special && meta.special.includes('REMUX')) || qual.includes('remux');
    if (isRemux) {
        parts.push('Remux');
    } else if (qual.includes('bluray') || qual.includes('blu-ray') || qual.includes('bdrip')) {
        parts.push('BluRay');
    } else if (qual.includes('web-dl') || qual.includes('webdl')) {
        parts.push('WEB-DL');
    } else if (qual.includes('web-rip') || qual.includes('webrip')) {
        parts.push('WEBRip');
    } else if (qual.includes('hdtv')) {
        parts.push('HDTV');
    } else if (qual.includes('dvd')) {
        parts.push('DVDRip');
    } else if (qual.includes('cam')) {
        parts.push('CAM');
    }

    // 4b. Edition (Extended, Directors.Cut, Unrated, Criterion)
    if (meta.edition) {
        const edToken = meta.edition.replace(/['\s]+/g, '.');
        parts.push(edToken);
    }

    // 4c. Proper / Repack
    if (meta.isRepack || (meta.special && meta.special.includes('REPACK'))) {
        parts.push('REPACK');
    } else if (meta.isProper || (meta.special && meta.special.includes('PROPER'))) {
        parts.push('PROPER');
    }

    // 5. Visual / HDR / IMAX / 3D (IMAX, 3D, DV, Profile, HDR10+, HDR10, HDR, HLG, SDR)
    const hdrList = Array.isArray(meta.hdr) ? meta.hdr.map(h => String(h).toLowerCase()) : [];
    const hasDV = hdrList.some(h => h.includes('vision') || h.includes('dv') || h.includes('dovi'));
    const hasHDR10Plus = hdrList.some(h => h.includes('hdr10+') || h.includes('hdr10plus') || h.includes('hdr10 plus'));
    const hasHDR10 = hdrList.some(h => h.includes('hdr10') && !h.includes('+') && !h.includes('plus'));
    const hasHLG = hdrList.some(h => h.includes('hlg'));
    const hasSDR = hdrList.some(h => h.includes('sdr'));
    const hasHDR = hdrList.some(h => h.includes('hdr')) || hasHDR10Plus || hasHDR10;
    const isIMAX = (meta.special && meta.special.some(s => /imax/i.test(s)));
    const is3D = (meta.special && meta.special.some(s => /\b3d\b/i.test(s)));

    if (isIMAX) parts.push('IMAX');
    if (is3D) parts.push('3D');
    if (hasDV) {
        parts.push('DV');
        if (meta.dvProfile) parts.push(meta.dvProfile.replace(/\s+/g, '.'));
    }
    if (hasHDR10Plus) parts.push('HDR10+');
    else if (hasHDR10) parts.push('HDR10');
    else if (hasHDR) parts.push('HDR');
    else if (hasHLG) parts.push('HLG');
    else if (hasSDR) parts.push('SDR');

    // 6. Codec (HEVC.x265, AVC.x264, AV1, VP9, VC-1) - Only add if genuinely detected
    const codec = (meta.codec || '').toLowerCase();
    if (codec.includes('hevc') || codec.includes('265') || codec.includes('h265')) {
        parts.push('HEVC.x265');
    } else if (codec.includes('av1')) {
        parts.push('AV1');
    } else if (codec.includes('avc') || codec.includes('264') || codec.includes('h264')) {
        parts.push('AVC.x264');
    } else if (codec.includes('vp9')) {
        parts.push('VP9');
    } else if (codec.includes('vc1') || codec.includes('vc-1')) {
        parts.push('VC-1');
    } else if (codec.includes('xvid')) {
        parts.push('XviD');
    }

    // 7. Bit Depth
    if (meta.bitDepth || (meta.special && meta.special.some(s => /10bit|10-bit|12bit|12-bit/i.test(s)))) {
        const bd = (meta.bitDepth && meta.bitDepth.includes('12')) ? '12bit' : '10bit';
        parts.push(bd);
    }

    // 8. Audio Codec & Channels
    const audioList = Array.isArray(meta.audio) ? meta.audio.map(a => String(a).toLowerCase()) : [];
    const hasAtmos = audioList.some(a => a.includes('atmos'));
    const hasTrueHD = audioList.some(a => a.includes('truehd') || a.includes('true-hd'));
    const hasDDP = audioList.some(a => a.includes('ddp') || a.includes('dd+') || a.includes('eac3') || a.includes('plus'));
    const hasDD = audioList.some(a => (a.includes('dd') || a.includes('ac3')) && !a.includes('plus') && !a.includes('ddp'));
    const hasDtsX = audioList.some(a => a.includes('dts-x') || a.includes('dtsx'));
    const hasDtsHdMa = audioList.some(a => a.includes('dts-hd ma') || a.includes('dtshd ma') || a.includes('ma'));
    const hasDtsHd = audioList.some(a => a.includes('dts-hd') && !hasDtsHdMa);
    const hasDTS = audioList.some(a => a.includes('dts') && !hasDtsX && !hasDtsHd && !hasDtsHdMa);
    const hasAAC = audioList.some(a => a.includes('aac'));
    const hasFLAC = audioList.some(a => a.includes('flac'));
    const hasPCM = audioList.some(a => a.includes('pcm') || a.includes('lpcm'));

    let audioToken = '';
    if (hasTrueHD) audioToken = 'TrueHD';
    else if (hasDDP) audioToken = 'DD+';
    else if (hasDD) audioToken = 'DD';
    else if (hasDtsX) audioToken = 'DTS-X';
    else if (hasDtsHdMa) audioToken = 'DTS-HD.MA';
    else if (hasDtsHd) audioToken = 'DTS-HD';
    else if (hasDTS) audioToken = 'DTS';
    else if (hasFLAC) audioToken = 'FLAC';
    else if (hasPCM) audioToken = 'PCM';
    else if (hasAAC) audioToken = 'AAC';

    const channels = meta.channels ? String(meta.channels) : null;
    let chToken = '';
    if (channels) {
        if (channels.includes('7.1')) chToken = '7.1';
        else if (channels.includes('6.1')) chToken = '6.1';
        else if (channels.includes('5.1')) chToken = '5.1';
        else if (channels.includes('2.0')) chToken = '2.0';
    }

    if (audioToken && chToken) {
        parts.push(`${audioToken}.${chToken}`);
    } else if (audioToken) {
        parts.push(audioToken);
    } else if (chToken) {
        parts.push(chToken);
    }

    if (hasAtmos) {
        parts.push('Atmos');
    }

    // 9. Languages
    const langs = Array.isArray(meta.languages) ? meta.languages.filter(l => l !== 'Dual-Audio' && l !== 'Multi-Audio') : [];
    if (meta.isMultiAudio || (meta.languages && meta.languages.includes('Multi-Audio')) || langs.length >= 3) {
        parts.push('Multi');
    } else if (meta.isDualAudio || (meta.languages && meta.languages.includes('Dual-Audio')) || langs.length === 2) {
        parts.push('Dual.Audio');
    }
    for (const lang of langs) {
        const l = String(lang).trim();
        if (l) parts.push(l);
    }
    if (langs.length === 0 && !meta.isMultiAudio && !meta.isDualAudio) {
        parts.push('English');
    }

    // 10. Release Group & Extension
    const group = meta.releaseGroup || 'FLUX';
    return `${parts.join('.')}-${group}.mkv`;
}

async function sortAndTagStreams(streams, config = {}, providerAnalytics) {
    if (!streams || streams.length === 0) return [];

    // Filter out streams that do not match the target media title / year / episode
    let validStreams = streams;
    if (config && config.target && config.target.title) {
        const filtered = streams.filter(s => isStreamMatchingTarget(s, config.target));
        if (filtered.length > 0) {
            const rejectedCount = streams.length - filtered.length;
            if (rejectedCount > 0) {
                console.log(`[MetaSorter] Purged ${rejectedCount} mismatched/wrong-title streams for "${config.target.title}"`);
            }
            validStreams = filtered;
        } else {
            console.log(`[MetaSorter] Target filter matched 0 streams for "${config.target.title}", keeping all ${streams.length} streams as fallback`);
        }
    }

    const showSeeders = config && config.showSeeders !== false;
    const deduplicate = config && config.deduplicateStreams !== false;

    // Deduplicate and merge identical streams across providers
    const uniqueStreams = deduplicateAndMergeStreams(validStreams, deduplicate);

    // Batch check Debrid Instant Cache if configured
    if (config && config.debridApiKey && (config.debridProvider === 'realdebrid' || config.debridProvider === 'torbox')) {
        const hashesToCheck = [];
        for (const s of uniqueStreams) {
            let hash = s.infoHash;
            if (!hash && s.url && s.url.startsWith('magnet:')) {
                const match = s.url.match(/btih:([a-zA-Z0-9]{40})/i);
                if (match) hash = match[1];
            }
            if (hash) {
                s.extractedHash = hash.toLowerCase();
                hashesToCheck.push(s.extractedHash);
            }
        }
        if (hashesToCheck.length > 0) {
            try {
                const instantSet = await checkDebridAvailability(hashesToCheck, config);
                for (const s of uniqueStreams) {
                    if (s.extractedHash && instantSet.has(s.extractedHash)) {
                        s.isDebridCached = true;
                    }
                }
            } catch (e) {}
        }
    }

    // Run tests concurrently
    const testingPromise = Promise.all(
        uniqueStreams.map(stream => testStream(stream, showSeeders, config))
    );

    let testedStreams;
    if (config.maxTestDuration) {
        const globalTimeoutPromise = new Promise(resolve => {
            setTimeout(() => {
                console.warn(`[StreamTester] Global testing timeout reached (${config.maxTestDuration}ms). Bailing out to prevent 504.`);
                const untested = uniqueStreams.map(s => {
                    const tLatency = config.hideSlow ? 45 : 120;
                    const labels = formatStreamLabels(s, tLatency, false, false, showSeeders, config);
                    return { ...s, name: labels.name, title: labels.title, latency: tLatency, isDead: false, statusCategory: 'fast' };
                });
                resolve(untested);
            }, config.maxTestDuration);
        });
        testedStreams = await Promise.race([testingPromise, globalTimeoutPromise]);
    } else {
        testedStreams = await testingPromise;
    }

    // Record Analytics
    if (providerAnalytics && typeof providerAnalytics.has === 'function') {
        testedStreams.forEach(s => {
            const p = s.originalProvider;
            if (!providerAnalytics.has(p)) {
                providerAnalytics.set(p, { fast: 0, slow: 0, dead: 0, totalLatency: 0, count: 0 });
            }
            const stats = providerAnalytics.get(p);
            stats[s.statusCategory]++;
            if (typeof s.latency === 'number' && !isNaN(s.latency) && s.latency < 90000) {
                stats.totalLatency = (stats.totalLatency || 0) + s.latency;
                stats.count = (stats.count || 0) + 1;
            }
        });
    }

    // Filter
    let filteredStreams = testedStreams;
    if (config && config.hideDead) {
        filteredStreams = filteredStreams.filter(s => s.statusCategory !== 'dead');
    }
    if (config && config.hideSlow) {
        filteredStreams = filteredStreams.filter(s => s.statusCategory !== 'slow');
    }
    // Auto-Hide CAM, TeleSync, and Screener theater recordings
    if (config && (config.hideCam || config.blockCam)) {
        filteredStreams = filteredStreams.filter(s => {
            const meta = parseStreamMetadata(s);
            return !meta.isCam;
        });
    }

    // Safety fallback: if strict filters leave 0 streams, retain all tested streams
    if (filteredStreams.length === 0 && testedStreams.length > 0) {
        filteredStreams = testedStreams;
    }

    // Sort
    const categoryRank = { 'fast': 1, 'slow': 2, 'dead': 3 };
    const sortBy = (config && (config.sortBy || config.sortMode)) 
        || (config && config.prioritizeQuality ? 'quality' : 'speed');
    const prefLanguages = config ? (config.preferredLanguages || []) : [];
    const hasAudioPref = (Array.isArray(prefLanguages) && prefLanguages.length > 0) || (config && config.prioritizeHindi);

    filteredStreams.sort((a, b) => {
        // Safe numeric latency
        const latA = typeof a.latency === 'number' && !isNaN(a.latency) ? a.latency : 99999;
        const latB = typeof b.latency === 'number' && !isNaN(b.latency) ? b.latency : 99999;

        // 1. Dead streams ALWAYS sink to the absolute bottom across all modes
        const isDeadA = Boolean(a.isDead || a.statusCategory === 'dead' || latA >= 90000);
        const isDeadB = Boolean(b.isDead || b.statusCategory === 'dead' || latB >= 90000);
        if (isDeadA !== isDeadB) {
            return isDeadA ? 1 : -1;
        }

        // 2. Debrid Instant Cached streams boost to the top
        const debridA = Boolean(a.isDebridCached);
        const debridB = Boolean(b.isDebridCached);
        if (debridA !== debridB) {
            return debridA ? -1 : 1;
        }

        const rankA = categoryRank[a.statusCategory] || 2;
        const rankB = categoryRank[b.statusCategory] || 2;

        if (sortBy === 'quality') {
            // =========================================================================
            // 🎬 MODE: MAXIMUM QUALITY (4K UHD FIRST, SORTED BY SPEED)
            // =========================================================================

            // 1. STRICT RESOLUTION TIER (4K > 1080p > 720p > 480p)
            // Absolute guarantee: 1080p will NEVER jump above 4K in Quality mode!
            const resA = getResolutionTier(a);
            const resB = getResolutionTier(b);
            if (resA !== resB) {
                return resB - resA;
            }

            // 2. Multi-Language / Preferred Audio within the same resolution tier
            if (hasAudioPref) {
                const audioA = getAudioScore(a, prefLanguages, config?.prioritizeHindi);
                const audioB = getAudioScore(b, prefLanguages, config?.prioritizeHindi);
                if (audioA !== audioB) {
                    return audioB - audioA;
                }
            }

            // 3. Status Category: Fast (<800ms) -> Slow (>=800ms) -> Dead
            if (rankA !== rankB) {
                return rankA - rankB;
            }

            // 4. Latency / Ping: Lowest ms first (Strict ping sorting within resolution tier)
            if (latA !== latB) {
                return latA - latB;
            }

            // 5. Release & Codec Quality (REMUX > BluRay > WEB-DL, HDR/DV, Atmos) as tie-breaker
            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }

            // 6. P2P Seeders Prioritization for torrent streams as tie-breaker
            const seederA = getSeederScore(a);
            const seederB = getSeederScore(b);
            if (seederA !== seederB) {
                return seederB - seederA;
            }

            return 0;

        } else if (sortBy === 'seeders') {
            // =========================================================================
            // 🧲 MODE: P2P SEEDERS FIRST (TORRENT HEALTH)
            // =========================================================================

            // 1. Highest seeders first
            const seederA = getSeederScore(a);
            const seederB = getSeederScore(b);
            if (seederA !== seederB) {
                return seederB - seederA;
            }

            // 2. Preferred Audio Language
            if (hasAudioPref) {
                const audioA = getAudioScore(a, prefLanguages, config?.prioritizeHindi);
                const audioB = getAudioScore(b, prefLanguages, config?.prioritizeHindi);
                if (audioA !== audioB) {
                    return audioB - audioA;
                }
            }

            // 3. Resolution Tier
            const resA = getResolutionTier(a);
            const resB = getResolutionTier(b);
            if (resA !== resB) {
                return resB - resA;
            }

            // 4. Status Category: Fast -> Slow
            if (rankA !== rankB) {
                return rankA - rankB;
            }

            // 5. Latency / Ping
            if (latA !== latB) {
                return latA - latB;
            }

            // 6. Quality Score
            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }

            return 0;

        } else if (sortBy === 'balanced') {
            // =========================================================================
            // ⚖️ MODE: SMART BALANCED (PERFORMANCE & QUALITY)
            // =========================================================================

            // 1. Preferred Audio Language
            if (hasAudioPref) {
                const audioA = getAudioScore(a, prefLanguages, config?.prioritizeHindi);
                const audioB = getAudioScore(b, prefLanguages, config?.prioritizeHindi);
                if (audioA !== audioB) {
                    return audioB - audioA;
                }
            }

            // 2. Balanced Performance Matrix
            const getBalancedTier = (s, lat) => {
                const res = getResolutionTier(s);
                const isFast = s.statusCategory === 'fast' && lat < 800;
                if (res === 4 && isFast) return 5; // 4K Fast (< 800ms)
                if (res === 3 && isFast) return 4; // 1080p Fast (< 800ms)
                if (res === 4) return 3;           // 4K Slow (> 800ms)
                if (res === 3) return 2;           // 1080p Slow (> 800ms)
                if (res === 2 && isFast) return 1; // 720p Fast
                return 0;
            };

            const tierA = getBalancedTier(a, latA);
            const tierB = getBalancedTier(b, latB);
            if (tierA !== tierB) {
                return tierB - tierA;
            }

            // 3. Status Category: Fast -> Slow
            if (rankA !== rankB) {
                return rankA - rankB;
            }

            // 4. Latency / Ping: Lowest ms first
            if (latA !== latB) {
                return latA - latB;
            }

            // 5. Quality score within same balanced tier
            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }

            return 0;

        } else {
            // =========================================================================
            // ⚡ MODE: SPEED & LOW LATENCY FIRST (DEFAULT)
            // =========================================================================

            // 1. Status Category (Fast < 800ms -> Slow -> Dead)
            if (rankA !== rankB) {
                return rankA - rankB;
            }

            // 2. Exact latency (lowest ms first) — STRICT PRIMARY sort in speed mode
            if (latA !== latB) {
                return latA - latB;
            }

            // 3. Multi-Language / Preferred Audio (tie-breaker for exact same latency)
            if (hasAudioPref) {
                const audioA = getAudioScore(a, prefLanguages, config?.prioritizeHindi);
                const audioB = getAudioScore(b, prefLanguages, config?.prioritizeHindi);
                if (audioA !== audioB) {
                    return audioB - audioA;
                }
            }

            // 4. Higher resolution & quality as tie-breaker
            const resA = getResolutionTier(a);
            const resB = getResolutionTier(b);
            if (resA !== resB) {
                return resB - resA;
            }

            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }

            return 0;
        }
    });

    // Clean up internal properties and ensure behaviorHints.filename is enriched for Nuvio Native Badges
    return filteredStreams.map(s => {
        const stremioStream = { ...s };
        
        if (config.debridProvider && config.debridProvider !== 'none' && config.debridApiKey && config.addonHost) {
            const isP2P = (stremioStream.url && stremioStream.url.startsWith('magnet:')) || stremioStream.infoHash;
            if (isP2P) {
                const hash = stremioStream.infoHash || normalizeTorrentHash(stremioStream.url);
                if (hash) {
                    const protocol = config.addonProtocol || 'https';
                    stremioStream.url = `${protocol}://${config.addonHost}/debrid/${config.debridProvider}/${config.debridApiKey}/${hash}`;
                    delete stremioStream.infoHash;
                }
            }
        }

        // Enrich behaviorHints.filename and clientResolve for Nuvio native and fusion badges
        const meta = s._preparsedMeta || parseStreamMetadata(s._rawStream || stremioStream);
        const synthFilename = buildNuvioSceneFilename(meta, config && config.target ? config.target : {});

        stremioStream.behaviorHints = {
            ...(stremioStream.behaviorHints || {}),
            filename: synthFilename
        };

        const target = (config && config.target) || {};
        const mediaType = target.type === 'series' || target.type === 'tv' ? 'series' : 'movie';
        const seasonNum = target.season ? parseInt(target.season, 10) : (meta.season ? parseInt(meta.season, 10) : null);
        const episodeNum = target.episode ? parseInt(target.episode, 10) : (meta.episode ? parseInt(meta.episode, 10) : null);

        stremioStream.clientResolve = {
            type: stremioStream.url ? 'url' : 'torrent',
            infoHash: stremioStream.infoHash || null,
            torrentName: synthFilename,
            filename: synthFilename,
            mediaType: mediaType,
            mediaId: target.id || null,
            mediaOnlyId: target.id ? target.id.split(':')[0] : null,
            title: target.title || meta.cleanTitle || 'Video',
            season: seasonNum,
            episode: episodeNum,
            isCached: Boolean(s.isDebridCached),
            stream: {
                raw: {
                    torrentName: synthFilename,
                    filename: synthFilename,
                    size: meta.sizeBytes || null,
                    tracker: s.originalProvider || '',
                    parsed: {
                        raw_title: synthFilename,
                        parsed_title: target.title || meta.cleanTitle || 'Video',
                        year: target.year ? parseInt(target.year, 10) : (meta.year || null),
                        resolution: meta.resolution || null,
                        seasons: seasonNum ? [seasonNum] : [],
                        episodes: episodeNum ? [episodeNum] : [],
                        quality: meta.quality || null,
                        hdr: Array.isArray(meta.hdr) && meta.hdr.length > 0 ? meta.hdr : [],
                        codec: meta.codec || null,
                        audio: Array.isArray(meta.audio) && meta.audio.length > 0 ? meta.audio : [],
                        channels: meta.channels ? [String(meta.channels)] : [],
                        languages: Array.isArray(meta.languages) && meta.languages.length > 0 ? meta.languages : (meta.isHindi ? ['Hindi'] : ['English']),
                        group: meta.releaseGroup || 'NUVIO',
                        network: null,
                        edition: meta.edition || null,
                        duration: null,
                        bit_depth: meta.bitDepth || (meta.special?.includes('10bit') ? '10bit' : null),
                        extended: Boolean(meta.edition && /extended/i.test(meta.edition)),
                        theatrical: Boolean(meta.edition && /theatrical/i.test(meta.edition)),
                        remastered: Boolean(meta.edition && /remastered/i.test(meta.edition)),
                        unrated: Boolean(meta.edition && /unrated/i.test(meta.edition))
                    }
                }
            }
        };

        // Clean up internal properties so they never leak into the response
        delete stremioStream._rawStream;
        delete stremioStream._preparsedMeta;
        delete stremioStream._rawFilename;

        return stremioStream;
    });
}

module.exports = { 
    sortAndTagStreams,
    clearDomainLatencyCache,
    parseStreamMetadata,
    extractCleanTitleAndDetails,
    formatStreamLabels,
    formatProviderLabel,
    getAudioScore,
    getSeederScore,
    deduplicateAndMergeStreams,
    getStreamFingerprint,
    normalizeTorrentHash,
    buildNuvioSceneFilename
};
