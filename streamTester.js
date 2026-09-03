const axios = require('axios');
const { dohHttpAgent, dohHttpsAgent } = require('./dohResolver');

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

function extractCleanTitleAndDetails(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return { cleanTitle: '', year: null, seasonEpisode: null, releaseGroup: null, dvProfile: null };
    }

    let text = rawText.split('\n')[0].trim();
    // Strip file extensions (.mkv, .mp4, .avi, .ts, etc.)
    text = text.replace(/\.(mkv|mp4|avi|mov|ts|m2ts|webm)$/i, '');

    // 1. Extract Release Group at the end (e.g. -FraMeSToR, -FLUX, [PSA], -NTb, etc.)
    let releaseGroup = null;
    const groupMatch = text.match(/[-_]([A-Za-z0-9]+)$/) || text.match(/\[([A-Za-z0-9]+)\]$/);
    if (groupMatch) {
        const potentialGroup = groupMatch[1];
        if (!/^(mkv|mp4|avi|2160p|1080p|720p|480p|hevc|x265|x264|aac|ac3|dvd|hd|uhd|web|dl|rip)$/i.test(potentialGroup)) {
            releaseGroup = potentialGroup;
        }
    }

    // 2. Extract DV Profile (e.g., Profile 5, Profile 7, Profile 8, P8, P5, P7)
    let dvProfile = null;
    const dvMatch = text.match(/\bprofile[\s._-]?([578])\b/i) || text.match(/\b(?:dv|dovi)[\s._-]?p?([578])\b/i);
    if (dvMatch) {
        dvProfile = `Profile ${dvMatch[1]}`;
    }

    // 3. Extract Season & Episode (e.g., S01E05, S01-S03, 1x04)
    let seasonEpisode = null;
    const seMatch = text.match(/\b(S\d{1,2}(?:[\s._-]?E\d{1,3}(?:-E\d{1,3})?|[\s._-]?S\d{1,2})?|\d{1,2}x\d{1,3})\b/i);
    if (seMatch) {
        seasonEpisode = seMatch[1].toUpperCase().replace(/[\s._-]+/g, '');
    }

    // 4. Extract 4-digit Year (1920-2035)
    let year = null;
    const yearMatch = text.match(/\b(19\d\d|20[0-3]\d)\b/);
    if (yearMatch) {
        year = yearMatch[1];
    }

    // 5. Tokenizer boundary regex: identify where scene metadata starts
    const tokenRegex = /\b(?:2160p|1080p|720p|480p|4k|uhd|fhd|hd|bluray|blu-ray|bdrip|brrip|web-dl|webdl|webrip|web|hdtv|dvdrip|remux|imax|hdr|hdr10|hdr10\+|dv|dovi|dolby|atmos|truehd|ddp|dd\+|eac3|ac3|dts|flac|aac|hevc|h265|x265|h264|x264|av1|10bit|hindi|tamil|telugu|malayalam|kannada|english|japanese|multi|dual|subs?|complete|repack|proper)\b/i;
    
    let titlePortion = text;
    if (year) {
        const yearIdx = text.indexOf(year);
        if (yearIdx > 2) {
            titlePortion = text.substring(0, yearIdx);
        }
    } else if (seasonEpisode && seMatch) {
        const seIdx = text.indexOf(seMatch[1]);
        if (seIdx > 2) {
            titlePortion = text.substring(0, seIdx);
        }
    } else {
        const tokenMatch = text.match(tokenRegex);
        if (tokenMatch && tokenMatch.index > 2) {
            titlePortion = text.substring(0, tokenMatch.index);
        }
    }

    // Clean dots, underscores, brackets, and extra spaces
    titlePortion = titlePortion
        .replace(/[\._]/g, ' ')
        .replace(/[\[\]\(\)\{\}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        cleanTitle: titlePortion || text.replace(/[\._]/g, ' ').trim(),
        year: year,
        seasonEpisode: seasonEpisode,
        releaseGroup: releaseGroup,
        dvProfile: dvProfile
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
    const rawName = stream.name || '';
    const rawTitle = stream.title || stream.description || stream.quality || '';
    const fullText = `${rawName} ${rawTitle}`;
    const sceneDetails = extractCleanTitleAndDetails(rawTitle || rawName);

    const metadata = {
        cleanTitle: sceneDetails.cleanTitle,
        year: sceneDetails.year,
        seasonEpisode: sceneDetails.seasonEpisode,
        releaseGroup: sceneDetails.releaseGroup,
        dvProfile: sceneDetails.dvProfile,
        resolution: null,
        quality: null,
        hdr: [],
        special: [],
        codec: null,
        audio: [],
        channels: null,
        languages: [],
        size: null,
        sizeGB: null,
        seeders: null,
        peers: null,
        isCam: false,
        isSample: false
    };

    // 1. CAM / TeleSync / Screener & Low-Quality Theater Recording Detection
    const camPattern = /\b(?:cam|camrip|hdcam|hd[\s._-]?cam|telesync|tele[\s._-]?sync|ts|hdts|hd[\s._-]?ts|tc|telecine|tele[\s._-]?cine|dvdscr|scr|screener|workprint)\b/i;
    if (camPattern.test(fullText)) {
        metadata.isCam = true;
        metadata.quality = 'CAM';
    }

    // Sample & Promo Detection
    const samplePattern = /\b(?:sample|trailer|promo|teaser)\b/i;
    if (samplePattern.test(fullText) || /[\s._\-/]sample[\s._\-\]\/]/i.test(fullText) || /\.sample\./i.test(fullText)) {
        metadata.isSample = true;
    }

    // 2. Resolution (Strict pattern matching, ignoring release group noise like 4kHDHub, UHDMovies)
    const has2160 = /\b2160[pi]?\b/i.test(fullText);
    const has1080 = /\b1080[pi]?\b/i.test(fullText);
    const has720  = /\b720[pi]?\b/i.test(fullText);
    const has480  = /\b(?:480[pi]?|576[pi]?)\b/i.test(fullText);

    if (has2160 && !has1080 && !has720 && !has480) {
        metadata.resolution = '2160p';
    } else if (has1080 && !has2160) {
        metadata.resolution = '1080p';
    } else if (has720 && !has1080 && !has2160) {
        metadata.resolution = '720p';
    } else if (has480 && !has1080 && !has2160 && !has720) {
        metadata.resolution = '480p';
    } else if (has2160 && has1080) {
        const match2160 = fullText.search(/\b2160[pi]?\b/i);
        const match1080 = fullText.search(/\b1080[pi]?\b/i);
        metadata.resolution = match2160 < match1080 ? '2160p' : '1080p';
    } else {
        const cleanText = fullText.replace(/uhdmovies|4khdhub|hdhub4u|hdhub|uhdrip/gi, ' ');
        if (/\b(?:4k|uhd)\b/i.test(cleanText)) metadata.resolution = '2160p';
        else if (/\b(?:fhd|full[\s._-]?hd)\b/i.test(cleanText)) metadata.resolution = '1080p';
        else if (/\b(?:hd)\b/i.test(cleanText) && !/\b(?:hdtv|hdrip|hdcam|hdts)\b/i.test(fullText)) metadata.resolution = '720p';
        else if (/\b(?:sd)\b/i.test(cleanText)) metadata.resolution = '480p';
    }

    // 3. Quality / Source
    if (/\b(?:bd|uhd)?remux\b/i.test(fullText)) metadata.special.push('REMUX');
    if (/\b(?:bluray|blu[\s._-]?ray|bd[\s._-]?rip|br[\s._-]?rip)\b/i.test(fullText)) metadata.quality = 'BluRay';
    else if (/\b(?:web[\s._-]?dl|webdl)\b/i.test(fullText)) metadata.quality = 'WEB-DL';
    else if (/\b(?:web[\s._-]?rip|webrip)\b/i.test(fullText)) metadata.quality = 'WEBRip';
    else if (/\b(?:hdtv|pdtv|dsr)\b/i.test(fullText)) metadata.quality = 'HDTV';
    else if (/\b(?:dvd[\s._-]?rip)\b/i.test(fullText)) metadata.quality = 'DVDRip';
    else if (metadata.isCam) metadata.quality = 'CAM';

    // 4. Visual / HDR / IMAX / Bit-depth
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

    // 5. Video Codec
    if (/\b(?:hevc|h[\s._-]?265|x265)\b/i.test(fullText)) metadata.codec = 'HEVC';
    else if (/\b(?:avc|h[\s._-]?264|x264)\b/i.test(fullText)) metadata.codec = 'H.264';
    else if (/\bav1\b/i.test(fullText)) metadata.codec = 'AV1';
    else if (/\b(?:xvid|divx)\b/i.test(fullText)) metadata.codec = 'XviD';

    // 6. Audio Formats & Atmos
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

    // 7. Channels
    if (/(?:^|[^0-9])7[. ]1(?![0-9])|\b8ch\b/i.test(fullText)) metadata.channels = '7.1';
    else if (/(?:^|[^0-9])5[. ]1(?![0-9])|\b6ch\b/i.test(fullText)) metadata.channels = '5.1';
    else if (/(?:^|[^0-9])2[. ]0(?![0-9])|\b2ch\b|\bstereo\b/i.test(fullText)) metadata.channels = '2.0';

    // 8. Languages (Indian & Global / Anime)
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

    // 9. Size & Normalized Size in GB
    const sizeMatch = fullText.match(/\b(\d+(?:\.\d+)?)\s*(GB|MB|GiB|MiB)\b/i);
    if (sizeMatch) {
        metadata.size = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;
        const numVal = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2].toUpperCase();
        if (unit.startsWith('M')) {
            metadata.sizeGB = Math.round((numVal / 1024) * 100) / 100;
        } else {
            metadata.sizeGB = numVal;
        }
    }

    // 10. Torrent Seeders & Peers
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

function formatProviderLabel(providers, defaultName) {
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
        return defaultName || 'Stream';
    }
    const cleanList = [...new Set(providers.filter(Boolean))];
    if (cleanList.length === 0) return defaultName || 'Stream';
    if (cleanList.length === 1) return cleanList[0];
    if (cleanList.length === 2) return `${cleanList[0]} + ${cleanList[1]}`;
    if (cleanList.length === 3) return `${cleanList[0]} + ${cleanList[1]} + ${cleanList[2]}`;
    return `${cleanList[0]} + ${cleanList[1]} (+${cleanList.length - 2} more)`;
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

function formatStreamLabels(stream, latency = 150, isP2P = false, isDead = false, showSeeders = true, config = {}) {
    const originalName = stream.name || 'Stream';
    const originalTitle = stream.title || stream.description || stream.quality || '';
    const rawProviderName = cleanProviderName(originalName);
    const providerLabel = formatProviderLabel(stream.providers, rawProviderName);
    const meta = parseStreamMetadata(stream);

    // Apply merged seeders if present on stream
    if (stream.seeders !== undefined && stream.seeders !== null && stream.seeders > 0) {
        meta.seeders = Math.max(meta.seeders || 0, stream.seeders);
    }

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

    let debridBadge = null;
    const dp = (config.debridProvider || '').toLowerCase();
    if (stream.isDebridCached) {
        if (dp === 'torbox') debridBadge = '⚡ [TB+] Instant';
        else if (dp === 'alldebrid') debridBadge = '⚡ [AD+] Instant';
        else if (dp === 'premiumize') debridBadge = '⚡ [PM+] Instant';
        else debridBadge = '⚡ [RD+] Instant';
    } else if (isP2P && dp) {
        if (dp === 'torbox') debridBadge = '⚡ [TB]';
        else if (dp === 'alldebrid') debridBadge = '⚡ [AD]';
        else if (dp === 'premiumize') debridBadge = '⚡ [PM]';
        else if (dp === 'realdebrid') debridBadge = '⚡ [RD]';
    }

    // High-impact top badges for stream.name
    const topBadges = [
        debridBadge,
        meta.resolution === '2160p' ? '4K UHD' : (meta.resolution === '1080p' ? '1080p FHD' : meta.resolution),
        ...meta.hdr,
        meta.special.includes('REMUX') ? 'REMUX' : (meta.quality || null),
        meta.audio.includes('Dolby Atmos') ? 'Atmos' : (meta.audio.includes('TrueHD') ? 'TrueHD' : (meta.audio.includes('DTS-HD MA') ? 'DTS-HD' : null)),
        meta.languages.includes('Hindi') ? 'Hindi' : (meta.languages.includes('Dual-Audio') ? 'Dual' : null)
    ].filter(Boolean);

    const uniqueTopBadges = [...new Set(topBadges)];
    const topBadgeStr = uniqueTopBadges.length > 0 ? ` • ${uniqueTopBadges.slice(0, 4).join(' • ')}` : '';

    let nameLine = '';
    if (isDead) {
        nameLine = `🔴 DEAD • ${providerLabel}${topBadgeStr}`;
    } else if (isP2P) {
        nameLine = `🧲 P2P • ${providerLabel}${topBadgeStr}`;
    } else {
        const statusEmoji = latency < 800 ? '🟢' : '🟡';
        const statusTag = latency < 800 ? 'FAST' : 'SLOW';
        nameLine = `${statusEmoji} ${statusTag} (${latency}ms) • ${providerLabel}${topBadgeStr}`;
    }

    // If user explicitly disabled cleanTitles, fallback to raw description
    if (config.cleanTitles === false) {
        return {
            name: nameLine,
            title: originalTitle
        };
    }

    // Build Ultra-Clean Formatted Description Card (stream.title)
    const cardLines = [];

    // Line 1: Header (Title, Year, Episode, Main Release Specs)
    const titleHeaderParts = [];
    if (meta.cleanTitle) {
        let titleHeader = meta.cleanTitle;
        if (meta.year) titleHeader += ` (${meta.year})`;
        if (meta.seasonEpisode) titleHeader += ` • ${meta.seasonEpisode}`;
        titleHeaderParts.push(titleHeader);
    }
    const qualityTags = [
        meta.resolution ? (meta.resolution === '2160p' ? '4K UHD' : meta.resolution === '1080p' ? '1080p FHD' : meta.resolution) : null,
        meta.special.includes('REMUX') ? 'REMUX' : (meta.quality || null),
        meta.special.includes('IMAX Enhanced') ? 'IMAX Enhanced' : (meta.special.includes('IMAX') ? 'IMAX' : null),
        meta.codec || null,
        meta.special.includes('10bit') ? '10-bit' : null
    ].filter(Boolean);

    if (qualityTags.length > 0) {
        titleHeaderParts.push(`[${qualityTags.join(' • ')}]`);
    }
    if (titleHeaderParts.length > 0) {
        cardLines.push(`🎬 ${titleHeaderParts.join(' ')}`);
    }

    // Line 2: Audio & Visual Studio Badges
    const avBadges = [];
    if (meta.hdr && meta.hdr.length > 0) {
        meta.hdr.forEach(h => {
            if (h === 'Dolby Vision' && meta.dvProfile) avBadges.push(`Dolby Vision ${meta.dvProfile}`);
            else avBadges.push(h);
        });
    }
    if (meta.audio && meta.audio.length > 0) {
        const audioStr = meta.audio.join(' + ');
        const chanStr = meta.channels ? ` ${meta.channels}` : '';
        avBadges.push(`${audioStr}${chanStr}`);
    } else if (meta.channels) {
        avBadges.push(`Audio ${meta.channels}`);
    }
    if (avBadges.length > 0) {
        cardLines.push(`💎 ${avBadges.join(' • ')}`);
    }

    // Line 3: Languages & Dubs (if present)
    if (meta.languages && meta.languages.length > 0) {
        const langTags = meta.languages.map(l => {
            if (l === 'Hindi') return '🇮🇳 Hindi Dub';
            if (l === 'Tamil') return 'Tamil';
            if (l === 'Telugu') return 'Telugu';
            if (l === 'Malayalam') return 'Malayalam';
            if (l === 'Kannada') return 'Kannada';
            if (l === 'Japanese') return '🇯🇵 Japanese Audio/Sub';
            if (l === 'English') return '🇬🇧 English';
            if (l === 'Dual-Audio') return '🌐 Dual-Audio';
            if (l === 'Multi-Audio') return '🌐 Multi-Audio';
            return l;
        });
        cardLines.push(`🌐 ${langTags.join(' • ')}`);
    }

    // Line 4: Media Specs Row (File Size, Health, Release Group, Providers)
    const metaRow = [];
    if (meta.size && config.showFileSize !== false) {
        metaRow.push(`📦 ${meta.size}`);
    }
    if (seederBadge && showSeeders !== false) {
        metaRow.push(seederBadge);
    }
    if (meta.releaseGroup && config.showReleaseGroup !== false) {
        metaRow.push(`🏷️ ${meta.releaseGroup}`);
    }
    metaRow.push(`🔗 ${providerLabel}`);
    if (metaRow.length > 0) {
        cardLines.push(metaRow.join(' • '));
    }

    const cleanTitleCard = cardLines.join('\n');

    return {
        name: nameLine,
        title: cleanTitleCard || originalTitle
    };
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
            const matched = langs.includes(pref) || new RegExp(`\\b${pref}\\b`, 'i').test(text);
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
            originalProvider: stream.originalProvider || providerName
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
            originalProvider: providerName
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
            originalProvider: providerName
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
            originalProvider: providerName
        };
    }

    // Fast Eco Mode for Vercel Free-Tier (Zero-Blocking CPU / Instant Heuristics < 5ms)
    // Disabled by default; user can enable via Settings / Admin tab
    const isEcoMode = Boolean(config.vercelEcoMode === true);
    if (isEcoMode) {
        let heuristicLatency = 120;
        let isDead = false;
        let statusCategory = 'fast';

        const urlLower = (stream.url || '').toLowerCase();
        if (urlLower.includes('hubcloud') || urlLower.includes('pixeldrain') || urlLower.includes('fastdl') || urlLower.includes('drive.google')) {
            heuristicLatency = 95;
            statusCategory = 'fast';
        } else if (urlLower.includes('streamtape') || urlLower.includes('dood') || urlLower.includes('mixdrop')) {
            heuristicLatency = 420;
            statusCategory = 'fast';
        } else {
            heuristicLatency = 140;
            statusCategory = 'fast';
        }

        const labels = formatStreamLabels(stream, heuristicLatency, false, isDead, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: heuristicLatency,
            isDead: isDead,
            statusCategory: statusCategory,
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

        // Check if origin has already been probed recently (< 5 min TTL)
        let latency = 0;
        let isDead = false;

        if (domainLatencyCache.has(origin)) {
            const cachedDomain = domainLatencyCache.get(origin);
            if (Date.now() - cachedDomain.timestamp < 300000) {
                latency = cachedDomain.latency;
                isDead = cachedDomain.isDead;
            }
        }

        if (!latency && domainLatencyPending.has(origin)) {
            const result = await domainLatencyPending.get(origin);
            latency = result.latency;
            isDead = result.isDead;
        }

        if (!latency) {
            const probeTask = (async () => {
                let probedLat = 280;
                let deadState = false;

                // Specific check for HubCloud links (detect if file was removed)
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
                        if (data.includes('file deleted') || data.includes('file not found') || data.includes('file was deleted') || data.includes('page not found') || hcRes.status === 404) {
                            return { latency: 99999, isDead: true };
                        }
                    } catch (err) {
                        // Keep stream alive on transient error
                    }
                }

                // Fast HEAD probe on server origin
                const pStart = Date.now();
                try {
                    await axios.head(origin, {
                        timeout: TIMEOUT_MS,
                        headers: probeHeaders,
                        httpAgent: dohHttpAgent,
                        httpsAgent: dohHttpsAgent,
                        validateStatus: (status) => status < 500
                    });
                    probedLat = Math.max(45, Date.now() - pStart);
                } catch (e) {
                    // Nominal fast latency if HEAD is blocked by CDN bot-filter
                    probedLat = 320;
                }

                const res = { latency: probedLat, isDead: deadState };
                domainLatencyCache.set(origin, { timestamp: Date.now(), ...res });
                return res;
            })();

            domainLatencyPending.set(origin, probeTask);
            try {
                const probeRes = await probeTask;
                latency = probeRes.latency;
                isDead = probeRes.isDead;
            } finally {
                domainLatencyPending.delete(origin);
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
                originalProvider: providerName
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
            originalProvider: providerName
        };

    } catch (err) {
        const labels = formatStreamLabels(stream, 350, false, false, showSeeders, config);
        return {
            ...stream,
            name: labels.name,
            title: labels.title,
            latency: 350,
            isDead: false,
            statusCategory: 'fast',
            originalProvider: providerName
        };
    }
}

async function sortAndTagStreams(streams, config = {}, providerAnalytics) {
    if (!streams || streams.length === 0) return [];

    // Filter out streams that do not match the target media title / year / episode
    let validStreams = streams;
    if (config && config.target && config.target.title) {
        validStreams = streams.filter(s => isStreamMatchingTarget(s, config.target));
        const rejectedCount = streams.length - validStreams.length;
        if (rejectedCount > 0) {
            console.log(`[MetaSorter] Purged ${rejectedCount} mismatched/wrong-title streams for "${config.target.title}"`);
        }
    }

    if (validStreams.length === 0) {
        return [];
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
    const testedStreams = await Promise.all(
        uniqueStreams.map(stream => testStream(stream, showSeeders, config))
    );

    // Record Analytics
    if (providerAnalytics) {
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
        const { latency, isDead, statusCategory, originalProvider, ...stremioStream } = s;
        
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
    clearDomainLatencyCache,
    parseStreamMetadata,
    extractCleanTitleAndDetails,
    formatStreamLabels,
    formatProviderLabel,
    getAudioScore,
    getSeederScore,
    deduplicateAndMergeStreams,
    getStreamFingerprint,
    normalizeTorrentHash
};
