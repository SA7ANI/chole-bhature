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
        size: null
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
    if (/\b(?:imax[\s._-]?enhanced)\b/i.test(fullText)) metadata.special.push('IMAX Enhanced');
    else if (/\bimax\b/i.test(fullText)) metadata.special.push('IMAX');

    if (/\b(?:dv|dovi|dolby[\s._-]?vision)\b/i.test(fullText)) metadata.hdr.push('DV');
    if (/\bhdr[\s._-]?10[\s._-]?(?:\+|plus)\b/i.test(fullText)) metadata.hdr.push('HDR10+');
    else if (/\bhdr(?:10)?\b/i.test(fullText) && !metadata.hdr.includes('DV')) metadata.hdr.push('HDR');

    if (/\b10[\s._-]?bit\b/i.test(fullText) || /\bhevc[\s._-]?10\b/i.test(fullText)) metadata.special.push('10bit');

    // 4. Video Codec
    if (/\b(?:hevc|h[\s._-]?265|x265)\b/i.test(fullText)) metadata.codec = 'HEVC';
    else if (/\b(?:avc|h[\s._-]?264|x264)\b/i.test(fullText)) metadata.codec = 'H.264';
    else if (/\bav1\b/i.test(fullText)) metadata.codec = 'AV1';
    else if (/\b(?:xvid|divx)\b/i.test(fullText)) metadata.codec = 'XviD';

    // 5. Audio Formats & Atmos
    const hasAtmos = /\batmos\b/i.test(fullText) || /dolby[\s._-]?atmos/i.test(fullText);
    const hasTrueHD = /\btrue[\s._-]?hd\b/i.test(fullText);
    const hasDDP = /(?:\bddp|\bdd\+|e[\s._-]?ac[\s._-]?3|dolby[\s._-]?digital[\s._-]?plus)/i.test(fullText);
    const hasDD = /(?:\bdd|ac[\s._-]?3|dolby[\s._-]?digital)/i.test(fullText) && !hasDDP;
    const hasDTSX = /\bdts[\s._-]?x\b/i.test(fullText);
    const hasDTSHD = /\bdts[\s._-]?(?:hd|ma)\b/i.test(fullText);
    const hasDTS = /\bdts\b/i.test(fullText) && !hasDTSHD && !hasDTSX;
    const hasFLAC = /\bflac\b/i.test(fullText);
    const hasAAC = /\baac\b/i.test(fullText);

    if (hasAtmos) metadata.audio.push('Atmos');
    if (hasTrueHD) metadata.audio.push('TrueHD');
    if (hasDDP) metadata.audio.push('DDP');
    else if (hasDD) metadata.audio.push('DD');
    if (hasDTSX) metadata.audio.push('DTS:X');
    else if (hasDTSHD) metadata.audio.push('DTS-HD MA');
    else if (hasDTS) metadata.audio.push('DTS');
    if (hasFLAC) metadata.audio.push('FLAC');
    else if (hasAAC && metadata.audio.length === 0) metadata.audio.push('AAC');

    // 6. Channels
    if (/(?:^|[^0-9])7[. ]1(?![0-9])|\b8ch\b/i.test(fullText)) metadata.channels = '7.1';
    else if (/(?:^|[^0-9])5[. ]1(?![0-9])|\b6ch\b/i.test(fullText)) metadata.channels = '5.1';
    else if (/(?:^|[^0-9])2[. ]0(?![0-9])|\b2ch\b|\bstereo\b/i.test(fullText)) metadata.channels = '2.0';

    // 7. Languages
    if (/\b(?:dual[\s._-]?audio|dual)\b/i.test(fullText)) metadata.languages.push('Dual-Audio');
    if (/\b(?:multi[\s._-]?audio|multi)\b/i.test(fullText)) metadata.languages.push('Multi-Audio');
    if (/\bhindi\b/i.test(fullText)) metadata.languages.push('Hindi');
    if (/\benglish\b/i.test(fullText)) metadata.languages.push('English');
    if (/\btamil\b/i.test(fullText)) metadata.languages.push('Tamil');
    if (/\btelugu\b/i.test(fullText)) metadata.languages.push('Telugu');
    if (/\bmalayalam\b/i.test(fullText)) metadata.languages.push('Malayalam');
    if (/\bkannada\b/i.test(fullText)) metadata.languages.push('Kannada');
    if (/\bbengali|bangla\b/i.test(fullText)) metadata.languages.push('Bengali');
    if (/\bpunjabi\b/i.test(fullText)) metadata.languages.push('Punjabi');
    if (/\bjapanese|jap\b/i.test(fullText)) metadata.languages.push('Japanese');
    if (/\bkorean|kor\b/i.test(fullText)) metadata.languages.push('Korean');
    if (/\bspanish|latino\b/i.test(fullText)) metadata.languages.push('Spanish');
    if (/\bportuguese\b/i.test(fullText)) metadata.languages.push('Portuguese');
    if (/\bfrench\b/i.test(fullText)) metadata.languages.push('French');
    if (/\bgerman\b/i.test(fullText)) metadata.languages.push('German');
    if (/\bitalian\b/i.test(fullText)) metadata.languages.push('Italian');
    if (/\brussian\b/i.test(fullText)) metadata.languages.push('Russian');

    // 8. Size
    const sizeMatch = fullText.match(/\b(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))\b/i);
    if (sizeMatch) metadata.size = sizeMatch[1].toUpperCase();

    return metadata;
}

function formatStreamLabels(stream, latency = 150, isP2P = false, isDead = false) {
    const originalName = stream.name || 'Stream';
    const originalTitle = stream.title || stream.description || stream.quality || '';
    const providerName = cleanProviderName(originalName);
    const meta = parseStreamMetadata(stream);

    const badgeTokens = [
        meta.resolution,
        meta.quality,
        ...meta.hdr,
        ...meta.special,
        meta.codec,
        ...meta.audio,
        meta.channels ? (meta.audio.includes('DDP') || meta.audio.includes('DD') ? null : meta.channels) : null,
        ...meta.languages
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

function getAudioScore(stream) {
    const text = [stream.name || '', stream.title || '', stream.description || ''].join(' ').toLowerCase();
    if (text.includes('hindi') || text.includes('hin') || text.includes('dual') || text.includes('multi')) {
        return 10;
    }
    return 0;
}

async function testStream(stream) {
    const startTime = Date.now();
    const originalName = stream.name || 'Stream';
    const providerName = cleanProviderName(originalName);

    // Handle P2P Magnet streams (e.g. Torrentio)
    if ((stream.url && stream.url.startsWith('magnet:')) || stream.infoHash) {
        const labels = formatStreamLabels(stream, 150, true, false);
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

    if (!stream.url || !stream.url.startsWith('http')) {
        const labels = formatStreamLabels(stream, 99999, false, true);
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

        // Specific check for HubCloud links (detect if file was removed)
        if (stream.url.includes('hubcloud.')) {
            try {
                const hcRes = await axios.get(stream.url, { 
                    timeout: TIMEOUT_MS, 
                    headers: { 'User-Agent': USER_AGENT },
                    validateStatus: () => true 
                });
                const data = typeof hcRes.data === 'string' ? hcRes.data.toLowerCase() : '';
                if (data.includes('file deleted') || data.includes('file not found') || data.includes('file was deleted') || data.includes('page not found') || hcRes.status === 404) {
                    const labels = formatStreamLabels(stream, 99999, false, true);
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
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: (status) => status < 500
            });
            latency = Date.now() - startTime;
        } catch (e) {
            try {
                await axios.get(stream.url, {
                    timeout: TIMEOUT_MS,
                    headers: { 
                        'User-Agent': USER_AGENT,
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
        const labels = formatStreamLabels(stream, latency, false, false);

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
        const labels = formatStreamLabels(stream, 1200, false, false);
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

async function sortAndTagStreams(streams, config = {}, providerAnalytics) {
    if (!streams || streams.length === 0) return [];

    // Deduplicate identical stream URLs
    const uniqueStreams = [];
    const urlMap = new Map();

    for (const stream of streams) {
        if (!stream.url) continue;
        if (urlMap.has(stream.url)) {
            const existing = urlMap.get(stream.url);
            if (!existing.name.includes(stream.name)) {
                existing.name = `${existing.name} + ${stream.name}`;
            }
        } else {
            const copy = { ...stream };
            urlMap.set(stream.url, copy);
            uniqueStreams.push(copy);
        }
    }

    // Run tests concurrently
    const testedStreams = await Promise.all(
        uniqueStreams.map(stream => testStream(stream))
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

    filteredStreams.sort((a, b) => {
        // 1. Status Category (Fast -> Slow -> Dead)
        const rankA = categoryRank[a.statusCategory];
        const rankB = categoryRank[b.statusCategory];
        if (rankA !== rankB) {
            return rankA - rankB;
        }

        // 2. Hindi / Audio prioritization (if configured)
        if (config && config.prioritizeHindi) {
            const audioA = getAudioScore(a);
            const audioB = getAudioScore(b);
            if (audioA !== audioB) {
                return audioB - audioA;
            }
        }

        // 3. Quality (if configured)
        if (config && config.prioritizeQuality) {
            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }
        }
        
        // 4. Exact latency
        return a.latency - b.latency;
    });

    // Clean up internal properties before sending to Stremio
    return filteredStreams.map(s => {
        const { latency, isDead, statusCategory, originalProvider, ...stremioStream } = s;
        return stremioStream;
    });
}

module.exports = { sortAndTagStreams };
