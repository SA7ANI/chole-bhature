const axios = require('axios');

const TIMEOUT_MS = 3000;

function getQualityScore(stream) {
    if (!stream) return 0;
    // Combine all possible fields where resolution might be mentioned
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
    return 0; // Unknown or CAM
}

async function testStream(stream) {
    const startTime = Date.now();
    try {
        if (!stream.url || !stream.url.startsWith('http')) {
            throw new Error('Invalid URL');
        }

        const urlObj = new URL(stream.url);
        const origin = urlObj.origin;

        // Perform the standard HEAD ping to get latency
        const headPromise = axios.head(origin, { 
            timeout: TIMEOUT_MS,
            validateStatus: () => true 
        });
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS)
        );

        await Promise.race([headPromise, timeoutPromise]);
        
        // Specific check for HubCloud (which returns 200 OK even if dead)
        if (stream.url.includes('hubcloud.')) {
            const hcRes = await axios.get(stream.url, { timeout: TIMEOUT_MS, validateStatus: () => true });
            const data = typeof hcRes.data === 'string' ? hcRes.data.toLowerCase() : '';
            if (data.includes('file deleted') || data.includes('file not found') || data.includes('file was deleted') || data.includes('page not found')) {
                throw new Error('HubCloud Link Dead');
            }
        }
        
        const latency = Date.now() - startTime;
        
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
        
        const originalName = stream.name || 'Unknown';
        
        return {
            ...stream,
            name: `${emoji} ${tag} | ${latency}ms • ${originalName}`,
            title: stream.title || stream.quality || '',
            latency: latency,
            isDead: false,
            statusCategory: statusCategory,
            originalProvider: originalName
        };
    } catch (err) {
        // Dead link or timeout
        const originalName = stream.name || 'Unknown';
        return {
            ...stream,
            name: `🔴 DEAD | TIMEOUT • ${originalName}`,
            title: stream.title || stream.quality || '',
            latency: 99999, // push to bottom
            isDead: true,
            statusCategory: 'dead',
            originalProvider: originalName
        };
    }
}

async function sortAndTagStreams(streams, config, providerAnalytics) {
    // Run tests concurrently
    const testedStreams = await Promise.all(
        streams.map(stream => testStream(stream))
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
        // 1. ALWAYS sort by Status Category first (Fast -> Slow -> Dead)
        const rankA = categoryRank[a.statusCategory];
        const rankB = categoryRank[b.statusCategory];
        if (rankA !== rankB) {
            return rankA - rankB;
        }

        // 2. If they are in the same category (e.g. both are FAST), sort by Quality (if enabled)
        if (config && config.prioritizeQuality) {
            const scoreA = getQualityScore(a);
            const scoreB = getQualityScore(b);
            if (scoreA !== scoreB) {
                return scoreB - scoreA; // Higher quality first
            }
        }
        
        // 3. Finally, sort by exact latency
        return a.latency - b.latency;
    });

    // Clean up internal properties before sending to Stremio
    return filteredStreams.map(s => {
        const { latency, isDead, statusCategory, originalProvider, ...stremioStream } = s;
        return stremioStream;
    });
}

module.exports = { sortAndTagStreams };
