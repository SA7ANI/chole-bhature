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
        return `${parseFloat(gb.toFixed(1))} GB`;
    }
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
}

/**
 * Cleans provider name from Stremio name line
 */
/**
 * Infers genuine provider/scraper name from stream URL or proxy headers
 */
function inferProviderFromStream(stream) {
    if (!stream || typeof stream !== 'object') return null;
    const ref = stream?.behaviorHints?.proxyHeaders?.request?.Referer 
        || stream?.behaviorHints?.proxyHeaders?.request?.referer 
        || stream?.headers?.Referer 
        || stream?.headers?.referer 
        || '';
    const origin = stream?.behaviorHints?.proxyHeaders?.request?.Origin 
        || stream?.behaviorHints?.proxyHeaders?.request?.origin 
        || stream?.headers?.Origin 
        || stream?.headers?.origin 
        || '';
    const url = stream?.url || '';
    const bingeGroup = stream?.behaviorHints?.bingeGroup || '';
    const bhFilename = stream?.behaviorHints?.filename || '';
    const rawFilename = stream?.rawFilename || stream?._rawFilename || '';
    const name = String(stream?.name || '');
    const title = String(stream?.title || '');
    const desc = String(stream?.description || '');
    const combined = `${ref} ${origin} ${url} ${bingeGroup} ${bhFilename} ${rawFilename} ${name} ${title} ${desc}`.toLowerCase();

    // Check high-priority provider signatures
    if (combined.includes('4khdhub')) return '4KHDHub';
    if (combined.includes('hdhub4u')) return 'HDHub4u';
    if (combined.includes('movie-box') || combined.includes('aoneroom.com') || combined.includes('moviebox')) return 'MovieBox';
    if (combined.includes('multimovies') || combined.includes('vidout.pages.dev') || combined.includes('vidout')) return 'MultiMovies';
    if (combined.includes('vegamovies')) return 'VegaMovies';
    if (combined.includes('moviesdrive')) return 'MoviesDrive';
    if (combined.includes('castle') || combined.includes('fcxmb.com')) return 'Castle';
    if (combined.includes('playimdb') || combined.includes('dataanalyticsacademy.site') || combined.includes('nextgencloudfabric.com')) return 'PlayIMDb';
    if (combined.includes('vidrock')) return 'VidRock';
    if (combined.includes('desiflix')) return 'DesiFlix';
    if (combined.includes('redflix')) return 'RedFlix';
    if (combined.includes('kurage')) return 'Kurage';
    if (combined.includes('anizone')) return 'AniZone';
    if (combined.includes('dahmermovies-tv') || combined.includes('dahmer-tv')) return 'DahmerMovies-TV';
    if (combined.includes('dahmermovies') || combined.includes('dahmer')) return 'DahmerMovies';
    if (combined.includes('moviesmod')) return 'MoviesMod';
    if (combined.includes('movix-vf') || combined.includes('movix vf') || combined.includes('movix')) return 'Movix VF';
    if (combined.includes('topcartoons')) return 'TopCartoons';
    if (combined.includes('reanime')) return 'ReAnime';
    if (combined.includes('animeworld')) return 'AnimeWorld';
    if (combined.includes('animesalt')) return 'AnimeSalt';
    if (combined.includes('anizen')) return 'AniZen';
    if (combined.includes('netmirror')) return 'NetMirror';
    if (combined.includes('anikage')) return 'AniKage';
    if (combined.includes('toonstream')) return 'ToonStream';
    if (combined.includes('puretoons')) return 'PureToons';
    if (combined.includes('einthusan')) return 'Einthusan';
    if (combined.includes('karnis')) return 'Karnis';
    if (combined.includes('bollyflix')) return 'BollyFlix';
    if (combined.includes('katmoviehd')) return 'KatMovieHD';
    if (combined.includes('net52') || combined.includes('imgcdn.kim')) return 'Net52';
    if (combined.includes('animepahe')) return 'AnimePahe';
    if (combined.includes('gogoanime')) return 'GogoAnime';
    if (combined.includes('uhdmovies')) return 'UHDMovies';
    if (combined.includes('hindilinks4u')) return 'HindiLinks4u';
    if (combined.includes('pencarimovie')) return 'PencariMovie';
    if (combined.includes('topmovies')) return 'TopMovies';
    if (combined.includes('cinevood')) return 'CineVood';
    if (combined.includes('animedekho')) return 'AnimeDekho';
    if (combined.includes('hubcloud') || combined.includes('cloudflarestorage.com') || combined.includes('r2.dev')) return 'HubCloud';
    if (combined.includes('pixeldrain')) return 'PixelDrain';
    if (combined.includes('gofile')) return 'Gofile';
    if (combined.includes('streamtape')) return 'StreamTape';
    if (combined.includes('dood')) return 'DoodStream';
    if (combined.includes('mixdrop')) return 'MixDrop';
    if (combined.includes('streamwish')) return 'StreamWish';
    if (combined.includes('filelions')) return 'FileLions';
    if (combined.includes('vidsrc')) return 'VidSrc';
    if (combined.includes('superembed')) return 'SuperEmbed';
    if (combined.includes('2embed')) return '2Embed';
    if (combined.includes('torrentio')) return 'Torrentio';
    if (combined.includes('mediafusion')) return 'MediaFusion';
    if (combined.includes('comet')) return 'Comet';
    if (combined.includes('knightcrawler')) return 'KnightCrawler';
    return null;
}

function extractCleanProvider(rawName) {
    if (!rawName) return 'Stream';
    let clean = String(rawName).split('\n')[0].replace(/[🟢🟡🔴🧲⚡🎬💎🌐📦⚙️🔗🏷️📄💬]/g, '').trim();
    // Strip debrid prefixes like [RD+] or [TB+]
    clean = clean.replace(/\[\s*(?:rd|ad|tb|pm|p2p|cached|instant)\+?\s*\]/gi, '').trim();
    // Strip repository prefixes
    clean = clean.replace(/^(?:CB Provider Repo|CB-Providers|Nuvio Repo|Chole Bhature|All-in-One-Nuvio)\s*•\s*/i, '').trim();
    if (clean.includes('•')) {
        const parts = clean.split('•').map(p => p.trim()).filter(Boolean);
        // Find genuine provider part (skip latency tags like "FAST (34ms)" and resolution/codec/direct tags)
        const nonStatusPart = parts.find(p => 
            !/^(?:FAST|SLOW|INSTANT|DEAD|\d+ms)\b/i.test(p) && 
            !/\b(?:2160p|1080p|720p|480p|4k|uhd|fhd|hd|remux|bluray|web-?dl|hevc|h264|x265|aac|dts|ddp?|direct|stream)\b/i.test(p)
        );
        if (nonStatusPart) {
            clean = nonStatusPart;
        } else {
            // Check if any part matches a known provider
            const known = parts.find(p => /^(?:4khdhub|hdhub4u|vegamovies|moviesdrive|moviebox|multimovies|castle|playimdb|vidrock|desiflix|redflix|kurage|anizone|dahmermovies|moviesmod|movix|torrentio|comet|mediafusion)$/i.test(p));
            clean = known || parts[0];
        }
    }
    if (clean.includes('|')) {
        clean = clean.split('|')[0].trim();
    }
    clean = clean.trim();
    // If string has media title indicators, year, or resolution, it is not a provider name
    if (/\(\d{4}\)/.test(clean) || /\b(?:19\d{2}|20\d{2})\b/.test(clean) || /\bS\d+E?\d*\b/i.test(clean) || /\b(?:2160p|1080p|720p|480p|4k|uhd|fhd|hd|remux|bluray|web-?dl|hevc|h264|x265)\b/i.test(clean)) {
        return 'Stream';
    }
    if (/^(?:direct|stream|direct stream)$/i.test(clean)) {
        return 'Stream';
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
        if (/^📄\s*(.+)/.test(line)) {
            const fnMatch = line.match(/^📄\s*(.+)/);
            if (fnMatch && fnMatch[1] && !candidateFilename) {
                candidateFilename = fnMatch[1].trim();
            }
        } else if (/^[🎬💎🌐📦🟢🟡🔴🧲⚡⚙️🔗🏷️]/.test(line) || /(?:💾|👤|👥|🌱|⚙️|🌐|\[\s*\d+\s*(?:GB|MB|GiB|MiB)\s*\])/i.test(line)) {
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
    } else if (typeof stream.size === 'string' && stream.size.trim() && !/^(?:direct|stream)$/i.test(stream.size.trim())) {
        sizeBytes = parseSizeToBytes(stream.size);
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
    let scraperProvider = stream._scraperName || stream.originalProvider || stream.provider;
    if (typeof scraperProvider === 'string') {
        scraperProvider = scraperProvider.replace(/^(?:CB Provider Repo|CB-Providers|Nuvio Repo|Chole Bhature|All-in-One-Nuvio)\s*•\s*/i, '').trim();
    }
    
    let originalProvider = 'Stream';
    if (scraperProvider && scraperProvider !== 'Stream' && !/\(\d{4}\)/.test(scraperProvider)) {
        originalProvider = scraperProvider;
        // Combine scraper name with genuine internal provider name (e.g., AnimeWorld • UpCloud)
        if (extractedProvider && extractedProvider !== 'Stream' && extractedProvider !== scraperProvider && !extractedProvider.toLowerCase().includes(scraperProvider.toLowerCase()) && !scraperProvider.toLowerCase().includes(extractedProvider.toLowerCase())) {
            if (extractedProvider.length <= 25 && !/\b(?:2160p|1080p|720p|480p|4k|audio|dub|multi|dual|ost|hindi|english|tamil|telugu)\b/i.test(extractedProvider)) {
                originalProvider = `${scraperProvider} • ${extractedProvider}`;
            }
        }
    } else if (extractedProvider && extractedProvider !== 'Stream') {
        originalProvider = extractedProvider;
    }

    if (originalProvider === 'Stream' || originalProvider === 'Direct' || originalProvider === 'Direct Stream') {
        const inferred = inferProviderFromStream(stream);
        if (inferred) originalProvider = inferred;
    }

    let finalProviders = [];
    if (stream.providers && Array.isArray(stream.providers) && stream.providers.length > 0) {
        const set = new Set();
        [originalProvider, ...stream.providers].forEach(p => {
            if (p && typeof p === 'string') {
                const clean = p.replace(/^(?:CB Provider Repo|CB-Providers|Nuvio Repo|Chole Bhature|All-in-One-Nuvio)\s*•\s*/i, '').trim();
                if (/\b\d+\s*seed(?:er)?s?\b/i.test(clean) || /\b\d+\s*(?:GB|MB)\b/i.test(clean) || /^[🌱👥👤]/.test(clean)) {
                    return;
                }
                if (clean && clean !== 'Stream' && clean !== 'Direct' && clean !== 'Direct Stream') {
                    set.add(clean);
                }
            }
        });
        finalProviders = Array.from(set);
    }
    if (finalProviders.length === 0) {
        finalProviders = [originalProvider];
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
        providers: finalProviders,
        mirrorCount: stream.mirrorCount || (Array.isArray(stream.mirrors) ? stream.mirrors.length : 1),
        mirrors: stream.mirrors || [],
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
    extractCleanProvider,
    inferProviderFromStream
};
