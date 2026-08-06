const axios = require('axios');

const TIMEOUT_MS = 4500;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function extractStreamMetadata(stream, originalProvider) {
    const rawText = [
        stream.name || '',
        stream.title || '',
        stream.description || '',
        stream.quality || '',
        stream.size || '',
        stream.url ? decodeURIComponent(stream.url) : ''
    ].join(' ');

    const lower = rawText.toLowerCase();

    // 1. Resolution / Quality
    let resolution = '1080p';
    let resTag = '1080p';
    if (lower.includes('4k') || lower.includes('2160p') || lower.includes('uhd') || lower.includes('2160')) {
        resolution = '2160p';
        resTag = '4K';
    } else if (lower.includes('1080p') || lower.includes('fhd') || lower.includes('1080')) {
        resolution = '1080p';
        resTag = '1080p';
    } else if (lower.includes('720p') || lower.includes('hd') || lower.includes('720')) {
        resolution = '720p';
        resTag = '720p';
    } else if (lower.includes('480p') || lower.includes('sd') || lower.includes('480') || lower.includes('360')) {
        resolution = '480p';
        resTag = '480p';
    }

    // 2. Source Quality
    let source = 'WEB-DL';
    if (lower.includes('remux')) source = 'REMUX';
    else if (lower.includes('bluray') || lower.includes('blu-ray') || lower.includes('bdrip') || lower.includes('brrip')) source = 'BluRay';
    else if (lower.includes('web-dl') || lower.includes('webdl') || lower.includes('web dl')) source = 'WebDL';
    else if (lower.includes('webrip') || lower.includes('web-rip')) source = 'WEBRip';
    else if (lower.includes('hdrip') || lower.includes('hd-rip')) source = 'HDRip';
    else if (lower.includes('dvdrip') || lower.includes('dvd')) source = 'DVDRip';
    else if (lower.includes('cam') || lower.includes('hdts') || lower.includes('telesync')) source = 'CAM';

    // 3. Edition / IMAX
    let edition = '';
    if (lower.includes('imax')) edition = 'IMAX';
    else if (lower.includes('proper')) edition = 'PROPER';
    else if (lower.includes('repack')) edition = 'REPACK';
    else if (lower.includes('extended')) edition = 'Extended';
    else if (lower.includes('unrated')) edition = 'Unrated';
    else if (lower.includes('director')) edition = "Director's Cut";

    // 4. Dynamic Range
    let dynamicRange = 'SDR';
    if (lower.includes('dv') || lower.includes('dolby vision') || lower.includes('dolby-vision')) {
        dynamicRange = 'DV HDR';
    } else if (lower.includes('hdr10+')) {
        dynamicRange = 'HDR10+';
    } else if (lower.includes('hdr10') || lower.includes('hdr')) {
        dynamicRange = 'HDR';
    } else if (lower.includes('10bit') || lower.includes('10-bit')) {
        dynamicRange = '10bit SDR';
    }

    // 5. Codec
    let codec = 'H.264';
    if (resolution === '2160p' || dynamicRange.includes('HDR') || dynamicRange.includes('DV') || lower.includes('hevc') || lower.includes('x265') || lower.includes('h265') || lower.includes('h.265')) {
        codec = 'H.265';
    } else if (lower.includes('av1')) {
        codec = 'AV1';
    } else if (lower.includes('x264') || lower.includes('h264') || lower.includes('h.264') || lower.includes('avc')) {
        codec = 'H.264';
    }

    // 6. Platform / OTT Service
    let platform = '';
    if (lower.includes('amzn') || lower.includes('amazon') || lower.includes('prime')) platform = 'prime video';
    else if (lower.includes('nf') || lower.includes('netflix')) platform = 'netflix';
    else if (lower.includes('dsnp') || lower.includes('disney') || lower.includes('hotstar')) platform = 'disney+';
    else if (lower.includes('atvp') || lower.includes('apple') || lower.includes('itunes')) platform = 'apple tv+';
    else if (lower.includes('hmax') || lower.includes('hbo')) platform = 'hbo max';
    else if (lower.includes('zee5')) platform = 'zee5';
    else if (lower.includes('jio')) platform = 'jiocinema';

    // 7. Languages
    let languages = [];
    let isDual = false;
    let isMulti = false;
    if (lower.includes('hindi') || lower.includes('hin') || lower.includes('dual-audio') || lower.includes('dual audio') || lower.includes('dual') || lower.includes('bollywood')) {
        languages.push('Hindi');
    }
    if (lower.includes('english') || lower.includes('eng') || lower.includes('hollywood')) {
        languages.push('English');
    }
    if (lower.includes('tamil') || lower.includes('tam')) {
        languages.push('Tamil');
    }
    if (lower.includes('telugu') || lower.includes('tel')) {
        languages.push('Telugu');
    }
    if (lower.includes('malayalam') || lower.includes('mal')) {
        languages.push('Malayalam');
    }
    if (lower.includes('korean') || lower.includes('kor')) {
        languages.push('Korean');
    }
    if (lower.includes('japanese') || lower.includes('jap') || lower.includes('anime')) {
        languages.push('Japanese');
    }

    if (lower.includes('dual') || lower.includes('dual-audio')) isDual = true;
    if (lower.includes('multi') || lower.includes('multi-audio') || languages.length > 2) isMulti = true;
    if (languages.length === 0) languages.push('Multi');

    // 8. Audio format
    let audioFormat = 'DDP 5.1';
    if (lower.includes('atmos')) audioFormat = 'Dolby Atmos';
    else if (lower.includes('dts-hd') || lower.includes('dts')) audioFormat = 'DTS-HD 5.1';
    else if (lower.includes('ddp5.1') || lower.includes('dd+ 5.1') || lower.includes('5.1')) audioFormat = 'DDP 5.1';
    else if (lower.includes('aac')) audioFormat = 'AAC 2.0';

    // 9. File Size
    let sizeStr = '';
    const sizeMatch = rawText.match(/(?:size\s*[:\s]?\s*|💾\s*|\[)?(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))(?:\s*\])?/i);
    if (sizeMatch) {
        sizeStr = sizeMatch[1].toUpperCase().replace('GIB', 'GB').replace('MIB', 'MB');
    } else {
        if (resolution === '2160p') sizeStr = '18.5 GB';
        else if (resolution === '1080p') sizeStr = '2.8 GB';
        else if (resolution === '720p') sizeStr = '1.2 GB';
        else sizeStr = '550 MB';
    }

    return {
        resolution,
        resTag,
        source,
        edition,
        dynamicRange,
        codec,
        platform,
        languages,
        isDual,
        isMulti,
        audioFormat,
        sizeStr
    };
}

function formatStreamOutput(stream, latency, originalProvider, statusCategory) {
    const meta = extractStreamMetadata(stream, originalProvider);
    
    // Strip zero-width characters, emojis, and messy artifacts from provider name
    let cleanProvider = (originalProvider || 'Stream')
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
        .replace(/^[^\w\s]+/, '')
        .replace(/\b(FAST|SLOW|DEAD|DIRECT|P2P)\b/gi, '')
        .replace(/\b(2160p|1080p|720p|480p|4k|fhd|hd|sd|dual-audio|multi)\b/gi, '')
        .replace(/\|/g, '')
        .replace(/\s+/g, ' ')
        .trim() || 'Stream';

    let emoji = '🟢';
    let statusLabel = 'FAST';
    if (statusCategory === 'slow') {
        emoji = '🟡';
        statusLabel = 'DIRECT';
    } else if (statusCategory === 'dead') {
        emoji = '🔴';
        statusLabel = 'DEAD';
    } else if (stream.url && stream.url.startsWith('magnet:')) {
        emoji = '🧲';
        statusLabel = 'P2P';
    }

    // Header (Card Top Name) - e.g. "HdHub 2160p" or "VegaMovies 1080p"
    const formattedName = `${cleanProvider} ${meta.resolution}`;

    // Language display formatting with flag icons
    const langStr = meta.languages.map(l => {
        if (l === 'Hindi') return 'Hindi 🇮🇳';
        if (l === 'English') return 'English 🇺🇸';
        if (l === 'Tamil') return 'Tamil';
        if (l === 'Telugu') return 'Telugu';
        if (l === 'Malayalam') return 'Malayalam';
        if (l === 'Japanese') return 'Japanese 🇯🇵';
        if (l === 'Korean') return 'Korean 🇰🇷';
        return l;
    }).join(' • ');

    // Extract cleanest title snippet from existing title
    let firstLine = (stream.title || '').split('\n')[0].trim();
    if (!firstLine || firstLine.length < 5) {
        firstLine = `${cleanProvider} ${meta.resolution} ${meta.source} ${meta.codec}`;
    }

    // Clean first line from duplicated size tags and zero width chars
    firstLine = firstLine
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
        .replace(/\[💾?\s*[\d.]+\s*(?:GB|MB)\]/gi, '')
        .trim();

    // Line 1: [FSL] [💾 XX.XX GB] Movie Title (Year) [IMAX] 2160p 10bit SDR WEB-DL HEVC x265 [Hindi-Tamil-Telugu AMZN DDP...
    const line1 = `[FSL] [💾 ${meta.sizeStr}] ${firstLine}`;

    // Line 2: Edition, Dynamic Range, Audio Languages
    const line2Parts = [];
    if (meta.edition) line2Parts.push(meta.edition);
    if (langStr) line2Parts.push(langStr);
    const line2 = line2Parts.join(', ') || `${meta.resolution}, ${meta.source}`;

    // Line 3: FSL | ProviderName | Speed
    const line3 = `FSL | ${cleanProvider} (${latency > 0 && latency < 90000 ? latency + 'ms' : statusLabel})`;

    // Line 4: Explicit Standard Release Badges (for Nuvio Badge UI Parsing)
    // Renders: [4K] [WebDL] [IMAX] [SDR] [H.265] [prime video] [HIN] [SIZE 25.5 GB]
    const badgeTokens = [
        meta.resTag,
        meta.source,
        meta.edition,
        meta.dynamicRange,
        meta.codec,
        meta.platform,
        meta.languages.includes('Hindi') ? 'HIN' : '',
        meta.languages.includes('English') ? 'ENG' : '',
        meta.languages.includes('Tamil') ? 'TAM' : '',
        meta.languages.includes('Telugu') ? 'TEL' : '',
        `SIZE ${meta.sizeStr}`
    ].filter(Boolean).join(' ');

    const fullDescription = [line1, line2, line3, badgeTokens].filter(Boolean).join('\n');

    return {
        ...stream,
        name: formattedName,
        title: fullDescription,
        description: fullDescription,
        latency: latency,
        isDead: statusCategory === 'dead',
        statusCategory: statusCategory,
        originalProvider: cleanProvider
    };
}

function getQualityScore(stream) {
    if (!stream) return 0;
    const text = [
        stream.name || '',
        stream.title || '',
        stream.description || '',
        stream.quality || '',
        (stream.behaviorHints && stream.behaviorHints.videoSize) ? stream.behaviorHints.videoSize : ''
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

    // Handle P2P Magnet streams (e.g. Torrentio)
    if ((stream.url && stream.url.startsWith('magnet:')) || stream.infoHash) {
        return formatStreamOutput(stream, 150, originalName, 'fast');
    }

    if (!stream.url || !stream.url.startsWith('http')) {
        return formatStreamOutput(stream, 99999, originalName, 'dead');
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
                    return formatStreamOutput(stream, 99999, originalName, 'dead');
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

        let statusCategory = latency < 800 ? 'fast' : 'slow';
        return formatStreamOutput(stream, latency, originalName, statusCategory);

    } catch (err) {
        return formatStreamOutput(stream, 1200, originalName, 'slow');
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

    // Clean up internal properties before sending to Stremio / Nuvio
    return filteredStreams.map(s => {
        const { latency, isDead, statusCategory, originalProvider, ...stremioStream } = s;
        return stremioStream;
    });
}

module.exports = { sortAndTagStreams };
