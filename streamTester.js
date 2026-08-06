const axios = require('axios');

const TIMEOUT_MS = 4500;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function cleanProviderName(rawName) {
    if (!rawName) return 'Stream';
    let clean = rawName.replace(/[🟢🟡🔴🧲]/g, '').trim();
    if (clean.includes('•')) {
        const parts = clean.split('•');
        clean = parts[parts.length - 1].trim();
    }
    if (clean.includes('|')) {
        clean = clean.split('|')[0].trim();
    }
    return clean || 'Stream';
}

function parseStreamMetadata(stream) {
    const rawName = stream.name || '';
    const rawTitle = stream.title || stream.description || stream.quality || '';
    const fullText = `${rawName} ${rawTitle}`;

    const metadata = {
        resolution: null,
        quality: null,
        hdr: [],
        special: [],
        codec: null,
        audio: [],
        channels: null,
        languages: [],
        size: null,
        seeders: null,
        peers: null
    };

    // 1. Resolution
    if (/\b(?:2160[pi]?|4k|uhd)\b/i.test(fullText)) metadata.resolution = '2160p';
    else if (/\b(?:1080[pi]?|fhd|full[\s._-]?hd)\b/i.test(fullText)) metadata.resolution = '1080p';
    else if (/\b(?:720[pi]?|hd)\b/i.test(fullText)) metadata.resolution = '720p';
    else if (/\b(?:480[pi]?|sd)\b/i.test(fullText)) metadata.resolution = '480p';

    // 2. Quality / Source
    if (/\b(?:bd|uhd)?remux\b/i.test(fullText)) metadata.special.push('REMUX');
    if (/\b(?:bluray|blu[\s._-]?ray|bd[\s._-]?rip|br[\s._-]?rip)\b/i.test(fullText)) metadata.quality = 'BluRay';
    else if (/\b(?:web[\s._-]?dl|webdl)\b/i.test(fullText)) metadata.quality = 'WEB-DL';
    else if (/\b(?:web[\s._-]?rip|webrip)\b/i.test(fullText)) metadata.quality = 'WEBRip';
    else if (/\b(?:hdtv|pdtv|dsr)\b/i.test(fullText)) metadata.quality = 'HDTV';
    else if (/\b(?:dvd[\s._-]?rip)\b/i.test(fullText)) metadata.quality = 'DVDRip';
    else if (/\b(?:cam|camrip|hdcam|telesync|ts|hdts)\b/i.test(fullText)) metadata.quality = 'CAM';

    // 3. Visual / HDR / IMAX / Bit-depth
    const hasIMAXEnhanced = /\b(?:imax[\s._-]?enhanced)\b/i.test(fullText);
    const hasIMAX = hasIMAXEnhanced || /\bimax\b/i.test(fullText) || /(?:^|[\s._\-\[/])imax(?:[\s._\-\]\/]|$)/i.test(fullText);
    if (hasIMAXEnhanced) metadata.special.push('IMAX Enhanced');
    else if (hasIMAX) metadata.special.push('IMAX');

    const hasDV = /\b(?:dv|dovi|dvision|dolby[\s._-]?vision)\b/i.test(fullText)
        || /(?:^|[\s._\-\[/])(?:dv|dovi)(?:[\s._\-\]\/]|$)/i.test(fullText)
        || /\bprofile[\s._-]?[578]\b/i.test(fullText)
        || /\b(?:dv[\s._-]?(?:hdr|hdr10|hdr10\+|hevc|remux|bluray|web|p\d+))\b/i.test(fullText)
        || /\b(?:hdr10[\s._-]?dv|hdr[\s._-]?dv)\b/i.test(fullText);

    const hasHDR10Plus = /\bhdr[\s._-]?10[\s._-]?(?:\+|plus)\b/i.test(fullText);
    const hasHDR10 = /\bhdr[\s._-]?10\b/i.test(fullText) && !hasHDR10Plus;
    const hasHDR = (/\bhdr\b/i.test(fullText) || /(?:^|[\s._\-\[/])hdr(?:[\s._\-\]\/]|$)/i.test(fullText)) && !hasHDR10Plus && !hasHDR10;

    if (hasDV) {
        metadata.hdr.push('Dolby Vision');
        if (hasHDR10Plus) metadata.hdr.push('HDR10+');
        else if (hasHDR10) metadata.hdr.push('HDR10');
    } else if (hasHDR10Plus) {
        metadata.hdr.push('HDR10+');
    } else if (hasHDR10) {
        metadata.hdr.push('HDR10');
    } else if (hasHDR) {
        metadata.hdr.push('HDR');
    }

    if (/\b10[\s._-]?bit\b/i.test(fullText) || /\bhevc[\s._-]?10\b/i.test(fullText)) metadata.special.push('10bit');

    // 4. Video Codec
    if (/\b(?:hevc|h[\s._-]?265|x265)\b/i.test(fullText)) metadata.codec = 'HEVC';
    else if (/\b(?:avc|h[\s._-]?264|x264)\b/i.test(fullText)) metadata.codec = 'H.264';
    else if (/\bav1\b/i.test(fullText)) metadata.codec = 'AV1';
    else if (/\b(?:xvid|divx)\b/i.test(fullText)) metadata.codec = 'XviD';

    // 5. Audio Formats & Atmos
    const hasAtmos = /\b(?:atmos|dolby[\s._-]?atmos|ddpa|ddpa[\s._-]?[57]\.?1)\b/i.test(fullText)
        || /(?:^|[\s._\-\[/])atmos(?:[\s._\-\]\/]|$)/i.test(fullText)
        || /\b(?:ddp|dd\+|e[\s._-]?ac[\s._-]?3|true[\s._-]?hd)[\s._-]?atmos\b/i.test(fullText)
        || /\batmos[\s._-]?(?:ddp|dd\+|true[\s._-]?hd)\b/i.test(fullText)
        || /\b(?:e[\s._-]?ac[\s._-]?3[\s._-]?joc|joc)\b/i.test(fullText);

    const hasTrueHD = /\btrue[\s._-]?hd\b/i.test(fullText);
    const hasDDP = /(?:\bddpa?|\bdd\+|e[\s._-]?ac[\s._-]?3|dolby[\s._-]?digital[\s._-]?plus)/i.test(fullText);
    const hasDD = /(?:\bdd|ac[\s._-]?3|dolby[\s._-]?digital)/i.test(fullText) && !hasDDP;
    const hasDTSX = /\bdts[\s._-]?x\b/i.test(fullText);
    const hasDTSHD = /\bdts[\s._-]?(?:hd|ma)\b/i.test(fullText);
    const hasDTS = /\bdts\b/i.test(fullText) && !hasDTSHD && !hasDTSX;
    const hasFLAC = /\bflac\b/i.test(fullText);
    const hasAAC = /\baac\b/i.test(fullText);

    if (hasAtmos) {
        metadata.audio.push('Dolby Atmos');
    }
    if (hasTrueHD) metadata.audio.push('TrueHD');
    else if (hasDDP) metadata.audio.push('DDP');
    else if (hasDD) metadata.audio.push('DD');
    else if (hasDTSX) metadata.audio.push('DTS:X');
    else if (hasDTSHD) metadata.audio.push('DTS-HD MA');
    else if (hasDTS) metadata.audio.push('DTS');
    else if (hasFLAC) metadata.audio.push('FLAC');
    else if (hasAAC && metadata.audio.length === 0) metadata.audio.push('AAC');

    // 6. Channels
    if (/(?:^|[^0-9])7[. ]1(?![0-9])|\b8ch\b/i.test(fullText)) metadata.channels = '7.1';
    else if (/(?:^|[^0-9])5[. ]1(?![0-9])|\b6ch\b/i.test(fullText)) metadata.channels = '5.1';
    else if (/(?:^|[^0-9])2[. ]0(?![0-9])|\b2ch\b|\bstereo\b/i.test(fullText)) metadata.channels = '2.0';

    // 7. Languages (Indian & Global / Anime)
    const hasMulti = /\b(?:multi[\s._-]?audio|multi[\s._-]?sub|multi)\b/i.test(fullText);
    const hasDual = /\b(?:dual[\s._-]?audio|dual)\b/i.test(fullText) && !hasMulti;
    if (hasMulti) metadata.languages.push('Multi-Audio');
    else if (hasDual) metadata.languages.push('Dual-Audio');
    if (/\bhindi\b|\bhin\b/i.test(fullText)) metadata.languages.push('Hindi');
    if (/\btamil\b|\btam\b/i.test(fullText)) metadata.languages.push('Tamil');
    if (/\btelugu\b|\btel\b/i.test(fullText)) metadata.languages.push('Telugu');
    if (/\bmalayalam\b|\bmal\b/i.test(fullText)) metadata.languages.push('Malayalam');
    if (/\bkannada\b|\bkan\b/i.test(fullText)) metadata.languages.push('Kannada');
    if (/\bbengali|bangla\b|\bben\b/i.test(fullText)) metadata.languages.push('Bengali');
    if (/\bpunjabi\b|\bpun\b/i.test(fullText)) metadata.languages.push('Punjabi');
    if (/\bjapanese|jap\b|\bjpn\b|\banime\b/i.test(fullText)) metadata.languages.push('Japanese');
    if (/\benglish\b|\beng\b/i.test(fullText)) metadata.languages.push('English');
    if (/\bkorean|kor\b/i.test(fullText)) metadata.languages.push('Korean');
    if (/\bspanish|espanol|latino\b|\besp\b/i.test(fullText)) metadata.languages.push('Spanish');
    if (/\bportuguese\b|\bpor\b/i.test(fullText)) metadata.languages.push('Portuguese');
    if (/\bfrench|vff|vfq\b|\bfre\b/i.test(fullText)) metadata.languages.push('French');
    if (/\bgerman|deutsch\b|\bger\b/i.test(fullText)) metadata.languages.push('German');
    if (/\bitalian\b|\bita\b/i.test(fullText)) metadata.languages.push('Italian');
    if (/\brussian\b|\brus\b/i.test(fullText)) metadata.languages.push('Russian');

    // 8. Size
    const sizeMatch = fullText.match(/\b(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))\b/i);
    if (sizeMatch) metadata.size = sizeMatch[1].toUpperCase();

    // 9. Torrent Seeders & Peers
    const seederMatch = fullText.match(/(?:👤|seeders?|seeds?|\bs:)\s*(\d+)/i)
        || fullText.match(/\[\s*(\d+)\s*\/\s*\d+\s*\]/);
    if (seederMatch) {
        metadata.seeders = parseInt(seederMatch[1], 10);
    }
    const peerMatch = fullText.match(/(?:peers?|leechers?|leech|\bl:)\s*(\d+)/i);
    if (peerMatch) {
        metadata.peers = parseInt(peerMatch[1], 10);
    }

    return metadata;
}

function formatStreamLabels(stream, latency = 150, isP2P = false, isDead = false, showSeeders = true) {
    const originalName = stream.name || 'Stream';
    const originalTitle = stream.title || stream.description || stream.quality || '';
    const providerName = cleanProviderName(originalName);
    const meta = parseStreamMetadata(stream);

    let seederBadge = null;
    if (meta.seeders !== null && showSeeders !== false) {
        if (meta.seeders >= 20) {
            seederBadge = `🟢 ${meta.seeders} Seeders`;
        } else if (meta.seeders >= 5) {
            seederBadge = `🟡 ${meta.seeders} Seeders`;
        } else {
            seederBadge = `🔴 ${meta.seeders} Seeder${meta.seeders === 1 ? '' : 's'}`;
        }
    }

    const badgeTokens = [
        meta.resolution,
        meta.quality,
        ...meta.hdr,
        ...meta.special,
        meta.codec,
        ...meta.audio,
        meta.channels,
        ...meta.languages,
        seederBadge
    ].filter(Boolean);

    const uniqueBadges = [...new Set(badgeTokens)];
    const badgeSuffix = uniqueBadges.length > 0 ? ` | ${uniqueBadges.join(' • ')}` : '';

    let nameLine = '';
    if (isDead) {
        nameLine = `🔴 DEAD • ${providerName}${badgeSuffix}`;
    } else if (isP2P) {
        nameLine = `🧲 P2P • ${providerName}${badgeSuffix}`;
    } else {
        const statusEmoji = latency < 800 ? '🟢' : '🟡';
        const statusTag = latency < 800 ? 'FAST' : 'SLOW';
        nameLine = `${statusEmoji} ${statusTag} | ${latency}ms • ${providerName}${badgeSuffix}`;
    }

    return {
        name: nameLine,
        title: originalTitle
    };
}

function getQualityScore(stream) {
    if (!stream) return 0;
    const text = [
        stream.name || '',
        stream.title || '',
        stream.description || '',
        stream.quality || ''
    ].join(' ').toLowerCase();

    if (text.includes('4k') || text.includes('2160p') || text.includes('uhd')) return 4;
    if (text.includes('1080p') || text.includes('fhd')) return 3;
    if (text.includes('720p') || text.includes('hd')) return 2;
    if (text.includes('480p') || text.includes('sd')) return 1;
    return 0;
}

function getAudioScore(stream, preferredLanguages = [], prioritizeHindi = false) {
    const meta = parseStreamMetadata(stream);
    const langs = meta.languages || [];
    const text = [stream.name || '', stream.title || '', stream.description || ''].join(' ').toLowerCase();

    let score = 0;
    const list = Array.isArray(preferredLanguages) && preferredLanguages.length > 0
        ? preferredLanguages
        : (prioritizeHindi ? ['Hindi', 'Dual-Audio'] : []);

    if (list.length === 0) return 0;

    list.forEach((pref, index) => {
        const weight = Math.max(10, (list.length - index) * 20);
        const prefLower = pref.toLowerCase();
        if (langs.some(l => l.toLowerCase() === prefLower) || text.includes(prefLower)) {
            score += weight;
        }
    });

    if (langs.includes('Dual-Audio') || langs.includes('Multi-Audio') || text.includes('dual') || text.includes('multi')) {
        score += 15;
    }

    return score;
}

function getSeederScore(stream) {
    const meta = parseStreamMetadata(stream);
    return meta.seeders || 0;
}

async function testStream(stream, showSeeders = true) {
    const startTime = Date.now();
    const originalName = stream.name || 'Stream';
    const providerName = cleanProviderName(originalName);

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

    // Handle P2P Magnet streams (e.g. Torrentio)
    if ((stream.url && stream.url.startsWith('magnet:')) || stream.infoHash) {
        const labels = formatStreamLabels(stream, 150, true, false, showSeeders);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 150,
            isDead: false,
            statusCategory: 'fast',
            originalProvider: providerName
        };
    }

    // Handle external links or YouTube links
    if (stream.externalUrl || stream.ytId) {
        const labels = formatStreamLabels(stream, 100, true, false, showSeeders);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 100,
            isDead: false,
            statusCategory: 'fast',
            originalProvider: providerName
        };
    }

    if (!stream.url || !stream.url.startsWith('http')) {
        const labels = formatStreamLabels(stream, 99999, false, true, showSeeders);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 99999,
            isDead: true,
            statusCategory: 'dead',
            originalProvider: providerName
        };
    }

    try {
        const urlObj = new URL(stream.url);
        const origin = urlObj.origin;

        const probeHeaders = {
            'User-Agent': customHeaders['User-Agent'] || customHeaders['user-agent'] || USER_AGENT,
            ...(customHeaders['Referer'] || customHeaders['referer'] ? { 'Referer': customHeaders['Referer'] || customHeaders['referer'] } : {}),
            ...(customHeaders['Origin'] || customHeaders['origin'] ? { 'Origin': customHeaders['Origin'] || customHeaders['origin'] } : {})
        };

        // Specific check for HubCloud links (detect if file was removed)
        if (stream.url.includes('hubcloud.')) {
            try {
                const hcRes = await axios.get(stream.url, { 
                    timeout: TIMEOUT_MS, 
                    headers: probeHeaders,
                    validateStatus: () => true 
                });
                const data = typeof hcRes.data === 'string' ? hcRes.data.toLowerCase() : '';
                if (data.includes('file deleted') || data.includes('file not found') || data.includes('file was deleted') || data.includes('page not found') || hcRes.status === 404) {
                    const labels = formatStreamLabels(stream, 99999, false, true, showSeeders);
                    return {
                        ...stream,
                        name: labels.name,
                        title: labels.title,
                        latency: 99999,
                        isDead: true,
                        statusCategory: 'dead',
                        originalProvider: providerName
                    };
                }
            } catch (err) {
                // If HubCloud network call fails, don't kill the link
            }
        }

        // Standard latency probe
        let latency = 0;
        try {
            await axios.head(origin, {
                timeout: TIMEOUT_MS,
                headers: probeHeaders,
                validateStatus: (status) => status < 500
            });
            latency = Date.now() - startTime;
        } catch (e) {
            try {
                await axios.get(stream.url, {
                    timeout: TIMEOUT_MS,
                    headers: { 
                        ...probeHeaders,
                        'Range': 'bytes=0-10'
                    },
                    validateStatus: (status) => status < 500
                });
                latency = Date.now() - startTime;
            } catch (e2) {
                // Probe blocked by CDN bot-filter, but video still streamable in player
                latency = 850;
            }
        }

        const statusCategory = latency < 800 ? 'fast' : 'slow';
        const labels = formatStreamLabels(stream, latency, false, false, showSeeders);

        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: latency,
            isDead: false,
            statusCategory: statusCategory,
            originalProvider: providerName
        };

    } catch (err) {
        const labels = formatStreamLabels(stream, 1200, false, false, showSeeders);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 1200,
            isDead: false,
            statusCategory: 'slow',
            originalProvider: providerName
        };
    }
}

async function sortAndTagStreams(streams, config = {}, providerAnalytics, hostUrl = '') {
    if (!streams || streams.length === 0) return [];

    const showSeeders = config && config.showSeeders !== false;

    // Deduplicate identical stream URLs or infohashes
    const uniqueStreams = [];
    const urlMap = new Map();

    for (const stream of streams) {
        const streamKey = stream.url || (stream.infoHash ? `magnet:${stream.infoHash}` : null) || stream.externalUrl || stream.ytId;
        if (!streamKey) continue;
        if (urlMap.has(streamKey)) {
            const existing = urlMap.get(streamKey);
            if (!existing.name.includes(stream.name)) {
                existing.name = `${existing.name} + ${stream.name}`;
            }
        } else {
            const copy = { ...stream };
            urlMap.set(streamKey, copy);
            uniqueStreams.push(copy);
        }
    }

    // Run tests concurrently
    const testedStreams = await Promise.all(
        uniqueStreams.map(stream => testStream(stream, showSeeders))
    );

    // Record Analytics
    if (providerAnalytics) {
        testedStreams.forEach(s => {
            const p = s.originalProvider;
            if (!providerAnalytics.has(p)) {
                providerAnalytics.set(p, { fast: 0, slow: 0, dead: 0 });
            }
            const stats = providerAnalytics.get(p);
            stats[s.statusCategory]++;
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

    // Sort
    const categoryRank = { 'fast': 1, 'slow': 2, 'dead': 3 };
    const isQualityFirst = config && (config.sortBy === 'quality' || config.sortMode === 'quality' || config.prioritizeQuality);
    const prefLanguages = config.preferredLanguages || [];
    const hasAudioPref = (Array.isArray(prefLanguages) && prefLanguages.length > 0) || config.prioritizeHindi;

    filteredStreams.sort((a, b) => {
        // Dead streams always go to the bottom
        if (a.isDead !== b.isDead) {
            return a.isDead ? 1 : -1;
        }

        // Multi-Language / Audio prioritization
        if (hasAudioPref) {
            const audioA = getAudioScore(a, prefLanguages, config.prioritizeHindi);
            const audioB = getAudioScore(b, prefLanguages, config.prioritizeHindi);
            if (audioA !== audioB) {
                return audioB - audioA;
            }
        }

        // P2P Seeders Prioritization for torrent streams
        const seederA = getSeederScore(a);
        const seederB = getSeederScore(b);
        if (seederA > 0 || seederB > 0) {
            if (Math.abs(seederA - seederB) >= 10) {
                return seederB - seederA;
            }
        }

        if (isQualityFirst) {
            // Sort by Resolution: 4K (4) -> 1080p (3) -> 720p (2) -> 480p (1) -> Unknown (0)
            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }

            // Within same resolution: Fast -> Slow -> Dead
            const rankA = categoryRank[a.statusCategory] || 2;
            const rankB = categoryRank[b.statusCategory] || 2;
            if (rankA !== rankB) {
                return rankA - rankB;
            }

            // Within same status: Lowest latency / fastest ping first
            return a.latency - b.latency;
        } else {
            // Sort by Speed (Default):
            // 1. Status Category (Fast -> Slow -> Dead)
            const rankA = categoryRank[a.statusCategory] || 2;
            const rankB = categoryRank[b.statusCategory] || 2;
            if (rankA !== rankB) {
                return rankA - rankB;
            }

            // 2. Exact latency (lowest ms first)
            if (a.latency !== b.latency) {
                return a.latency - b.latency;
            }

            // 3. Higher quality as tie breaker
            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            return scoreB - scoreA;
        }
    });

    // Apply ISP Anti-Block Stream Proxy if enabled
    if (config && (config.enableProxy || config.antiBlockProxy) && hostUrl) {
        filteredStreams.forEach(stream => {
            if (stream.url && stream.url.startsWith('http') && !stream.url.includes('/proxy/stream')) {
                const targetData = {
                    url: stream.url,
                    headers: stream.behaviorHints?.proxyHeaders?.request || stream.headers || {}
                };
                const encodedPayload = Buffer.from(JSON.stringify(targetData)).toString('base64url');
                stream.url = `${hostUrl}/proxy/stream?payload=${encodedPayload}`;
            }
        });
    }

    // Clean up internal properties and ensure behaviorHints.filename is enriched for Nuvio Native Badges
    return filteredStreams.map(s => {
        const { latency, isDead, statusCategory, originalProvider, ...stremioStream } = s;
        
        // Enrich behaviorHints.filename for Nuvio Fusion badges
        const meta = parseStreamMetadata(stremioStream);
        const tokens = [
            meta.resolution || '1080p',
            meta.quality || 'WEB-DL',
            ...meta.hdr,
            ...meta.special,
            meta.codec || 'HEVC',
            ...meta.audio,
            meta.channels,
            ...meta.languages
        ].filter(Boolean);

        const baseTitle = (stremioStream.title || stremioStream.name || 'Video').split('\n')[0].replace(/[^a-zA-Z0-9]/g, '.');
        const synthFilename = `${baseTitle}.${tokens.join('.')}.mkv`;

        stremioStream.behaviorHints = {
            ...(stremioStream.behaviorHints || {}),
            filename: stremioStream.behaviorHints?.filename || synthFilename
        };

        return stremioStream;
    });
}

module.exports = { 
    sortAndTagStreams,
    parseStreamMetadata,
    formatStreamLabels,
    getAudioScore,
    getSeederScore
};
