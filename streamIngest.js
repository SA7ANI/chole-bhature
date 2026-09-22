/**
 * AIOStreams Addon Ingestion & Stream Normalizer
 * Ingests streams from Torrentio, Comet, MediaFusion, DMM, Jackett, and direct debrid/P2P sources.
 * Extracts raw filename, size, seeders, and debrid flags without mangling or destroying source data.
 */

const { parseTorrentTitle } = require('./torrentParser');

/**
 * Normalizes an infoHash string (40 hex chars or 32 base32 chars)
 */
function normalizeInfoHash(str) {
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

/**
 * Parses human-readable size string (e.g., "4.5 GB", "850 MB", "1.2 TB") to bytes
 */
function parseSizeToBytes(sizeStr) {
    if (!sizeStr || typeof sizeStr !== 'string') return null;
    const match = sizeStr.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB|GiB|MiB|TB|TiB|KB|KiB)\b/i);
    if (!match) return null;
    const num = parseFloat(match[1].replace(',', '.'));
    if (isNaN(num) || num <= 0) return null;
    const unit = match[2].toUpperCase();
    if (unit.startsWith('T')) return Math.round(num * 1024 * 1024 * 1024 * 1024);
    if (unit.startsWith('G')) return Math.round(num * 1024 * 1024 * 1024);
    if (unit.startsWith('M')) return Math.round(num * 1024 * 1024);
    if (unit.startsWith('K')) return Math.round(num * 1024);
    return null;
}

/**
 * Formats bytes to standard human-readable size string (e.g., "4.50 GB" or "850 MB")
 */
function formatBytesToSize(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return null;
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 0.9) {
        return `${gb.toFixed(2)} GB`;
    }
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
}

/**
 * Cleans provider name from Stremio name line
 */
function extractCleanProvider(rawName) {
    if (!rawName) return 'Stream';
    let clean = String(rawName).split('\n')[0].replace(/[🟢🟡🔴🧲⚡]/g, '').trim();
    // Strip debrid prefixes like "[RD+]" or "[TB+]"
    clean = clean.replace(/\[\s*(?:rd|ad|tb|pm|p2p)\+?\s*\]/gi, '').trim();
    if (clean.includes('•')) {
        const parts = clean.split('•');
        clean = parts[0].trim();
    }
    if (clean.includes('|')) {
        clean = clean.split('|')[0].trim();
    }
    return clean || 'Stream';
}

function stripFormattedCardNoise(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .split('\n')
        .filter(l => !/^[🎬💎🌐📦🟢🟡🔴🧲⚡⚙️🔗🏷️]/.test(l.trim()))
        .join(' ')
        .trim();
}

/**
 * Ingests and normalizes any stream into a standard AIOStreams Normalized Stream representation.
 * @param {object} stream - Original Stremio stream
 * @param {object} config - User / Addon configuration
 * @returns {object} Normalized stream object
 */
function ingestStream(stream, config = {}) {
    if (!stream || typeof stream !== 'object') return null;

    // Use original unformatted stream snapshot if available
    const rawName = stream._rawStream?.name || String(stream.name || '');
    const rawTitle = stream._rawStream?.title || String(stream.title || stream.description || stream.quality || '');
    
    // Check if filename was synthetic or genuine
    let behaviorFilename = stream._rawFilename || stream.rawFilename;
    if (!behaviorFilename && stream.behaviorHints && typeof stream.behaviorHints.filename === 'string') {
        const bhName = stream.behaviorHints.filename.trim();
        if (!bhName.endsWith('-FLUX.mkv') && !bhName.endsWith('-NUVIO.mkv')) {
            behaviorFilename = bhName;
        }
    }

    // 1. Separate filename lines from stats/indexer lines (Torrentio & Comet multi-line format)
    const titleLines = rawTitle.split('\n').map(l => l.trim()).filter(Boolean);
    let candidateFilename = behaviorFilename;
    let statsLine = '';

    for (const line of titleLines) {
        // Line containing UI card emojis or size or seeders emoji or indexer
        if (/^[🎬💎🌐📦🟢🟡🔴🧲⚡⚙️🔗🏷️]/.test(line) || /(?:💾|👤|👥|🌱|⚙️|🌐|\[\s*\d+\s*(?:GB|MB|GiB|MiB)\s*\])/i.test(line)) {
            statsLine += ` ${line}`;
        } else if (!candidateFilename && line.length > 5) {
            candidateFilename = line;
        }
    }

    if (!candidateFilename) {
        const cleanFirstLine = stripFormattedCardNoise(titleLines[0] || rawName.split('\n')[0] || '');
        candidateFilename = cleanFirstLine || 'Stream';
    }

    // Fallback to URL filename if candidateFilename is still generic
    if ((!candidateFilename || candidateFilename === 'Stream') && stream.url && typeof stream.url === 'string') {
        try {
            const u = new URL(stream.url);
            const pathname = decodeURIComponent(u.pathname);
            const lastSegment = pathname.split('/').filter(Boolean).pop();
            if (lastSegment && /\.(mkv|mp4|avi|mov|ts|m3u8|webm)$/i.test(lastSegment)) {
                candidateFilename = lastSegment;
            }
        } catch (e) {}
    }

    // 2. Extract real file size (Bytes & Formatted)
    let sizeBytes = null;
    if (stream.behaviorHints && typeof stream.behaviorHints.videoSize === 'number' && stream.behaviorHints.videoSize > 0) {
        sizeBytes = stream.behaviorHints.videoSize;
    } else if (typeof stream.fileSize === 'number' && stream.fileSize > 0) {
        sizeBytes = stream.fileSize;
    } else if (typeof stream.size === 'number' && stream.size > 0) {
        sizeBytes = stream.size;
    } else {
        const sizeStrCandidate = `${statsLine} ${rawTitle} ${rawName}`;
        sizeBytes = parseSizeToBytes(sizeStrCandidate);
    }
    const sizeFormatted = sizeBytes ? formatBytesToSize(sizeBytes) : null;

    // 3. Extract seeders & peers
    let seeders = null;
    if (typeof stream.seeders === 'number' && stream.seeders >= 0) {
        seeders = stream.seeders;
    } else if (typeof stream.seeds === 'number' && stream.seeds >= 0) {
        seeders = stream.seeds;
    } else if (typeof stream.peerCount === 'number' && stream.peerCount >= 0) {
        seeders = stream.peerCount;
    } else {
        const textForSeeds = `${statsLine} ${rawTitle} ${rawName}`;
        const seedMatch = textForSeeds.match(/(?:👤|👥|🌱|\bseeds?[:\s]*|\bseeders?[:\s]*|\bs:)\s*(\d+)/i)
            || textForSeeds.match(/\[\s*(\d+)\s*\/\s*\d+\s*\]/);
        if (seedMatch) {
            seeders = parseInt(seedMatch[1], 10);
        }
    }

    // 4. Extract InfoHash & P2P / Debrid status
    const infoHash = stream.infoHash 
        ? normalizeInfoHash(stream.infoHash) 
        : (stream.url ? normalizeInfoHash(stream.url) : null);

    const isP2P = Boolean(
        infoHash || 
        (stream.url && stream.url.startsWith('magnet:')) ||
        /\b\[?p2p\]?/i.test(rawName) ||
        /\b\[?p2p\]?/i.test(rawTitle)
    );

    let isDebridCached = Boolean(stream.isDebridCached);
    if (!isDebridCached) {
        if (/\[\s*(?:rd|ad|tb|pm)\+\s*\]|instant|cached/i.test(rawName) || /\[\s*(?:rd|ad|tb|pm)\+\s*\]|instant|cached/i.test(rawTitle)) {
            isDebridCached = true;
        }
    }

    // 5. Parse release metadata using AIOStreams torrentParser
    // Clean card noise from rawTitle and candidateFilename so emojis/badges never re-parse
    const cleanCand = stripFormattedCardNoise(candidateFilename);
    const cleanTitle = stripFormattedCardNoise(rawTitle);
    const parsed = parseTorrentTitle(cleanCand);

    const combinedText = `${cleanCand} ${cleanTitle}`;
    const fullParsed = parseTorrentTitle(combinedText);

    if (!parsed.resolution && fullParsed.resolution) parsed.resolution = fullParsed.resolution;
    if (!parsed.quality && fullParsed.quality) parsed.quality = fullParsed.quality;
    if ((!parsed.hdr || parsed.hdr.length === 0) && fullParsed.hdr && fullParsed.hdr.length > 0) parsed.hdr = fullParsed.hdr;
    if (!parsed.dvProfile && fullParsed.dvProfile) parsed.dvProfile = fullParsed.dvProfile;
    if (!parsed.codec && fullParsed.codec) parsed.codec = fullParsed.codec;
    if ((!parsed.audio || parsed.audio.length === 0) && fullParsed.audio && fullParsed.audio.length > 0) {
        parsed.audio = fullParsed.audio;
    } else if (fullParsed.audio && fullParsed.audio.length > 0) {
        // Merge any additional audio tracks found without duplicates
        for (const a of fullParsed.audio) {
            if (!parsed.audio.includes(a)) parsed.audio.push(a);
        }
    }
    if (!parsed.channels && fullParsed.channels) parsed.channels = fullParsed.channels;
    if ((!parsed.languages || parsed.languages.length === 0) && fullParsed.languages && fullParsed.languages.length > 0) {
        parsed.languages = fullParsed.languages;
        parsed.languageFlags = fullParsed.languageFlags;
        parsed.isMultiAudio = fullParsed.isMultiAudio;
        parsed.isDualAudio = fullParsed.isDualAudio;
    }
    if ((!parsed.special || parsed.special.length === 0) && fullParsed.special && fullParsed.special.length > 0) {
        parsed.special = fullParsed.special;
    }
    if (!parsed.bitDepth && fullParsed.bitDepth) parsed.bitDepth = fullParsed.bitDepth;
    if (!parsed.edition && fullParsed.edition) parsed.edition = fullParsed.edition;
    if (fullParsed.isRepack) parsed.isRepack = true;
    if (fullParsed.isProper) parsed.isProper = true;
    if (!parsed.releaseGroup && fullParsed.releaseGroup) parsed.releaseGroup = fullParsed.releaseGroup;
    if (fullParsed.subtitles && fullParsed.subtitles.length > 0) {
        parsed.subtitles = [...new Set([...(parsed.subtitles || []), ...fullParsed.subtitles])];
    }

    // 6. Clean provider label
    const extractedProvider = extractCleanProvider(rawName);
    const scraperProvider = stream.originalProvider || stream.provider;
    
    let originalProvider = scraperProvider || extractedProvider;
    
    // Combine scraper name with internal provider name (e.g., AnimeWorld • UpCloud)
    if (scraperProvider && extractedProvider && extractedProvider !== 'Stream' && scraperProvider !== extractedProvider && !extractedProvider.includes(scraperProvider)) {
        originalProvider = `${scraperProvider} • ${extractedProvider}`;
    }
    return {
        originalStream: stream,
        rawFilename: cleanCand || candidateFilename,
        originalTitle: cleanCand || candidateFilename,
        parsed: parsed,
        sizeBytes: sizeBytes,
        sizeFormatted: sizeFormatted,
        seeders: seeders,
        infoHash: infoHash,
        isP2P: isP2P,
        isDebridCached: isDebridCached,
        originalProvider: originalProvider,
        providers: stream.providers && Array.isArray(stream.providers) ? stream.providers : [originalProvider],
        behaviorHints: {
            ...(stream.behaviorHints || {}),
            filename: behaviorFilename || cleanCand || candidateFilename
        }
    };
}

module.exports = {
    ingestStream,
    normalizeInfoHash,
    parseSizeToBytes,
    formatBytesToSize,
    extractCleanProvider
};
