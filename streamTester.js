const axios = require('axios');

const TIMEOUT_MS = 4500;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
    const originalTitle = stream.title || stream.quality || '';

    // Handle P2P Magnet streams (e.g. Torrentio)
    if ((stream.url && stream.url.startsWith('magnet:')) || stream.infoHash) {
        return {
            ...stream,
            name: `🧲 P2P • ${originalName}`,
            title: originalTitle,
            latency: 150,
            isDead: false,
            statusCategory: 'fast',
            originalProvider: originalName
        };
    }

    if (!stream.url || !stream.url.startsWith('http')) {
        return {
            ...stream,
            name: `🔴 DEAD • ${originalName}`,
            title: originalTitle,
            latency: 99999,
            isDead: true,
            statusCategory: 'dead',
            originalProvider: originalName
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
                    return {
                        ...stream,
                        name: `🔴 DEAD | REMOVED • ${originalName}`,
                        title: originalTitle,
                        latency: 99999,
                        isDead: true,
                        statusCategory: 'dead',
                        originalProvider: originalName
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

        let tag = '';
        let emoji = '';
        let statusCategory = 'fast';

        if (latency < 800) {
            tag = 'FAST';
            emoji = '🟢';
            statusCategory = 'fast';
        } else {
            tag = 'SLOW';
            emoji = '🟡';
            statusCategory = 'slow';
        }

        return {
            ...stream,
            name: `${emoji} ${tag} | ${latency}ms • ${originalName}`,
            title: originalTitle,
            latency: latency,
            isDead: false,
            statusCategory: statusCategory,
            originalProvider: originalName
        };

    } catch (err) {
        return {
            ...stream,
            name: `🟡 DIRECT • ${originalName}`,
            title: originalTitle,
            latency: 1200,
            isDead: false,
            statusCategory: 'slow',
            originalProvider: originalName
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
