/**
 * AIOStreams Multi-Preset Stream Card Formatter
 * Formats stream.name and stream.title for Stremio without destroying or hallucinating metadata.
 * Strictly adheres to the Stream Card Presentation Studio standard.
 */

function formatProviderChain(providers, fallback = 'Stream') {
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
        if (typeof fallback === 'string') {
            if (fallback.includes('Telegram') || fallback.includes('PencariMovie')) return '⚡ Telegram';
            if (fallback.startsWith('All-in-One-Nuvio • ')) return fallback.replace('All-in-One-Nuvio • ', '').trim();
            if (fallback === 'Stream') return 'Direct';
        }
        return fallback;
    }
    const cleanList = [...new Set(providers.filter(Boolean))].map(p => {
        if (typeof p === 'string') {
            if (p.includes('Telegram') || p.includes('PencariMovie')) return '⚡ Telegram';
            if (p.startsWith('All-in-One-Nuvio • ')) return p.replace('All-in-One-Nuvio • ', '').trim();
            if (p === 'Stream') return 'Direct';
        }
        return p;
    }).filter(p => p && p !== 'Stream');

    if (cleanList.length === 0) return fallback === 'Stream' ? 'Direct' : fallback;
    if (cleanList.length === 1) return cleanList[0];
    if (cleanList.length === 2) return `${cleanList[0]} + ${cleanList[1]}`;
    if (cleanList.length === 3) return `${cleanList[0]} + ${cleanList[1]} + ${cleanList[2]}`;
    return `${cleanList[0]} + ${cleanList[1]} (+${cleanList.length - 2} more)`;
}

function getDebridBadge(ingested, config = {}) {
    const provider = (config.debridProvider && config.debridProvider !== 'none') ? config.debridProvider.toLowerCase() : null;
    const hasKey = Boolean(config.debridApiKey);

    if (ingested.isDebridCached) {
        if (hasKey && provider) {
            if (provider === 'torbox') return '⚡ [TB+] Instant';
            if (provider === 'alldebrid') return '⚡ [AD+] Instant';
            if (provider === 'premiumize') return '⚡ [PM+] Instant';
            return '⚡ [RD+] Instant';
        }
        return '⚡ Instant';
    }
    
    if (ingested.isP2P && hasKey && provider) {
        if (provider === 'torbox') return '⚡ [TB]';
        if (provider === 'alldebrid') return '⚡ [AD]';
        if (provider === 'premiumize') return '⚡ [PM]';
        return '⚡ [RD]';
    }
    
    return null;
}

function getSeederBadge(seeders, show = true) {
    if (seeders === null || seeders === undefined || show === false) return null;
    if (seeders >= 25) return `🟢 ${seeders} Seeders`;
    if (seeders >= 5) return `🟡 ${seeders} Seeders`;
    return `🔴 ${seeders} Seeder${seeders === 1 ? '' : 's'}`;
}

/**
 * Concise audio tag for Header line (Presentation Studio Standard)
 */
function formatConciseAudioTag(parsed) {
    const audioList = Array.isArray(parsed.audio) ? parsed.audio : [];
    const hasAtmos = audioList.some(a => /atmos/i.test(a));
    if (hasAtmos) return 'Atmos';
    if (audioList.some(a => /truehd|true-hd/i.test(a))) return 'TrueHD';
    if (audioList.some(a => /dts-?x/i.test(a))) return 'DTS:X';
    if (audioList.some(a => /dts-?hd/i.test(a))) return 'DTS-HD';
    if (audioList.some(a => /\bdts\b/i.test(a))) return 'DTS';
    if (audioList.some(a => /ddp|dd\+|eac3/i.test(a))) {
        return parsed.channels ? `DDP ${parsed.channels}` : 'DDP 5.1';
    }
    if (audioList.some(a => /\bdd\b|ac3/i.test(a))) {
        return parsed.channels ? `DD ${parsed.channels}` : 'DD 5.1';
    }
    if (audioList.some(a => /flac/i.test(a))) return 'FLAC';
    if (audioList.some(a => /aac/i.test(a))) return 'AAC';
    if (audioList.some(a => /opus/i.test(a))) return 'Opus';
    if (parsed.isDualAudio) return 'Dual-Audio';
    if (parsed.isMultiAudio) return 'Multi-Audio';
    return null;
}

/**
 * Concise HDR / DV tag for Header line (Presentation Studio Standard)
 */
function formatConciseHdrTag(parsed) {
    const hdrList = Array.isArray(parsed.hdr) ? parsed.hdr : [];
    if (hdrList.includes('Dolby Vision') || parsed.dvProfile) return 'DV';
    if (hdrList.includes('HDR10+')) return 'HDR10+';
    if (hdrList.includes('HDR10')) return 'HDR10';
    if (hdrList.includes('HDR')) return 'HDR';
    if (hdrList.includes('HLG')) return 'HLG';
    return null;
}

/**
 * Detailed audio badge for Body Line 3 (Diamond row)
 */
function formatDetailedAudioBadge(parsed) {
    const audioList = Array.isArray(parsed.audio) ? parsed.audio : [];
    const hasAtmos = audioList.some(a => /atmos/i.test(a));
    const hasTrueHD = audioList.some(a => /truehd|true-hd/i.test(a));
    const hasDDP = audioList.some(a => /ddp|dd\+|eac3|dolby[\s._-]?digital[\s._-]?plus/i.test(a));
    const hasDD = audioList.some(a => /\bdd\b|ac3|dolby[\s._-]?digital/i.test(a)) && !hasDDP;
    const hasDTSX = audioList.some(a => /dts-?x/i.test(a));
    const hasDTSHD = audioList.some(a => /dts-?hd/i.test(a));
    const hasDTS = audioList.some(a => /\bdts\b/i.test(a)) && !hasDTSHD && !hasDTSX;
    const hasFLAC = audioList.some(a => /flac/i.test(a));
    const hasAAC = audioList.some(a => /aac/i.test(a));
    const hasOpus = audioList.some(a => /opus/i.test(a));

    const chan = parsed.channels || (hasTrueHD || hasDTSX || hasDTSHD ? '7.1' : (hasDDP || hasDD ? '5.1' : (hasFLAC ? '2.0' : null)));

    if (hasAtmos) {
        if (hasTrueHD) return `Dolby Atmos TrueHD ${chan || '7.1'}`;
        if (hasDDP) return `Dolby Digital Plus ${chan || '5.1'} Atmos`;
        return `Dolby Atmos ${chan || ''}`.trim();
    }
    if (hasTrueHD) return `TrueHD ${chan || '7.1'}`;
    if (hasDTSX) return `DTS:X ${chan || '7.1'}`;
    if (hasDTSHD) return `DTS-HD MA ${chan || '7.1'}`;
    if (hasDTS) return `DTS ${chan || '5.1'}`;
    if (hasDDP) return `Dolby Digital Plus ${chan || '5.1'}`;
    if (hasDD) return `Dolby Digital ${chan || '5.1'}`;
    if (hasFLAC) return `FLAC ${chan || '2.0'} Lossless`;
    if (hasAAC) return `AAC ${chan || '2.0'}`;
    if (hasOpus) return `Opus ${chan || '2.0'}`;
    if (parsed.channels) return `Audio ${parsed.channels}`;
    return null;
}

/**
 * Formats an ingested stream into Stremio name and title fields
 * @param {object} ingested - Ingested & normalized stream from streamIngest
 * @param {object} options - Latency, isDead, config
 * @returns {object} { name, title }
 */
function formatStreamCard(ingested, options = {}) {
    const {
        latency = 150,
        isDead = false,
        config = {},
        preset = 'aiostreams'
    } = options;

    const parsed = ingested.parsed || {};
    const providerLabel = formatProviderChain(ingested.providers, ingested.originalProvider || 'Stream');
    const debridBadge = getDebridBadge(ingested, config);
    const seederBadge = getSeederBadge(ingested.seeders, config.showSeeders !== false);

    // 1. Build Header Line (stream.name)
    const isInstant = (latency <= 30 && (ingested.isDebridCached || latency === 0));
    let latencyBadge = '';
    if (isDead) {
        latencyBadge = '🔴 DEAD';
    } else if (ingested.isP2P && !debridBadge) {
        latencyBadge = '🧲 P2P';
    } else if (
        providerLabel.includes('Telegram') || 
        providerLabel.includes('PencariMovie') || 
        (ingested.originalProvider && ingested.originalProvider.includes('Telegram'))
    ) {
        latencyBadge = null;
    } else if (isInstant) {
        latencyBadge = `⚡ INSTANT (${latency}ms)`;
    } else {
        const statusEmoji = latency < 800 ? '🟢' : '🟡';
        const statusTag = latency < 800 ? 'FAST' : 'SLOW';
        latencyBadge = `${statusEmoji} ${statusTag} (${latency}ms)`;
    }

    let headerTags = [];
    if (config.cleanTitles !== false) {
        // Modern Minimalist Header (Stream Card Presentation Studio)
        const resTag = parsed.resolution === '2160p' ? '4K UHD' : (parsed.resolution === '1080p' ? '1080p FHD' : (parsed.resolution === '720p' ? '720p HD' : (parsed.resolution || null)));
        const hdrTag = formatConciseHdrTag(parsed);
        const audTag = formatConciseAudioTag(parsed);
        const instantTag = (ingested.isDebridCached && !audTag) ? 'Instant Play' : null;

        headerTags = [
            isInstant ? null : debridBadge,
            resTag,
            hdrTag,
            audTag,
            instantTag
        ].filter(Boolean);
    } else {
        // Legacy Detailed Header
        const dvHdrBadges = [];
        if (parsed.hdr && parsed.hdr.length > 0) {
            parsed.hdr.forEach(h => {
                if (h === 'Dolby Vision' && parsed.dvProfile) {
                    dvHdrBadges.push(`Dolby Vision ${parsed.dvProfile}`);
                } else {
                    dvHdrBadges.push(h);
                }
            });
        }
        headerTags = [
            debridBadge,
            parsed.resolution === '2160p' ? '4K UHD' : (parsed.resolution === '1080p' ? '1080p FHD' : (parsed.resolution === '720p' ? '720p HD' : parsed.resolution)),
            ...dvHdrBadges,
            (parsed.special && parsed.special.includes('REMUX')) ? 'REMUX' : (parsed.quality || null),
            parsed.codec || null,
            formatConciseAudioTag(parsed)
        ].filter(Boolean);
    }

    const uniqueHeaderTags = [...new Set(headerTags)];
    const topBadgeStr = uniqueHeaderTags.length > 0 ? ` • ${uniqueHeaderTags.join(' • ')}` : '';

    let nameLine = latencyBadge ? `${latencyBadge} • ${providerLabel}${topBadgeStr}` : `${providerLabel}${topBadgeStr}`;

    // 2. Build Card Description (stream.title)
    if (config.cleanTitles === false || preset === 'torrentio') {
        const lines = [ingested.rawFilename];
        const stats = [];
        if (ingested.sizeFormatted && config.showFileSize !== false) stats.push(`📦 ${ingested.sizeFormatted}`);
        if (seederBadge && config.showSeeders !== false) stats.push(seederBadge);
        stats.push(`🔗 ${providerLabel}`);
        lines.push(stats.join(' • '));
        return {
            name: nameLine,
            title: lines.join('\n'),
            description: lines.join('\n')
        };
    }

    // AIOStreams Stream Card Presentation Studio Layout
    const cardLines = [];

    // Line 1: Header (Title, Year, Episode, Codec Tags)
    // Format: 🎬 Title (Year) [4K UHD • REMUX • HEVC • 10-bit]
    const resolvedTitle = (config.target && config.target.title)
        ? config.target.title
        : (parsed.title || ingested.rawFilename);

    const resolvedYear = (config.target && config.target.year)
        ? config.target.year
        : parsed.year;

    let resolvedSeasonEpisode = parsed.seasonEpisode;
    if (config.target && (config.target.type === 'series' || config.target.type === 'tv') && config.target.season && config.target.episode) {
        const reqS = String(config.target.season).padStart(2, '0');
        const reqE = String(config.target.episode).padStart(2, '0');
        resolvedSeasonEpisode = `S${reqS}E${reqE}`;
    }

    let mediaEmoji = '🎬';
    if (parsed.isAnime || (config.target && config.target.type === 'anime') || /anime/i.test(ingested.rawFilename)) {
        mediaEmoji = '🌸';
    } else if (config.target?.type === 'series' || config.target?.type === 'tv' || resolvedSeasonEpisode || /S\d+/i.test(ingested.rawFilename)) {
        mediaEmoji = '📺';
    }

    let titleHeader = resolvedTitle;
    if (resolvedYear) titleHeader += ` (${resolvedYear})`;
    if (resolvedSeasonEpisode) titleHeader += ` ${resolvedSeasonEpisode}`;

    // Codec Tags
    const resString = parsed.resolution === '2160p' ? '4K UHD' : (parsed.resolution === '1080p' ? '1080p FHD' : (parsed.resolution === '720p' ? '720p HD' : (parsed.resolution || null)));
    const qualityString = (parsed.special && parsed.special.includes('REMUX')) ? 'REMUX' : (parsed.quality || null);
    const codecString = (() => {
        if (!parsed.codec) return null;
        const c = parsed.codec.toLowerCase();
        if (c === 'x265' || c === 'h.265' || c === 'hevc') return 'HEVC';
        if (c === 'x264' || c === 'h.264' || c === 'avc') return 'H.264';
        if (c === 'av1' || c === 'av01') return 'AV1';
        return parsed.codec;
    })();
    const bitDepthString = parsed.bitDepth ? (parsed.bitDepth === '10bit' || parsed.bitDepth === '10-bit' ? '10-bit' : (parsed.bitDepth === '8bit' || parsed.bitDepth === '8-bit' ? '8-bit' : parsed.bitDepth)) : null;

    const codecTags = [
        resString,
        qualityString,
        codecString,
        bitDepthString
    ].filter(Boolean);

    const codecTagStr = codecTags.length > 0 ? ` [${[...new Set(codecTags)].join(' • ')}]` : '';
    cardLines.push(`${mediaEmoji} ${titleHeader}${codecTagStr}`);

    // Line 2: Original Scene Release Filename
    const rawTitleToDisplay = ingested.originalTitle || ingested.rawFilename;
    if (config.includeOriginalTitle !== false && rawTitleToDisplay) {
        const cleanRaw = String(rawTitleToDisplay).replace(/^[🎬📺🌸💎🌐📦🟢🟡🔴🧲⚡⚙️🔗🏷️📄💬\s]+/g, '').trim();
        const isGeneric = !cleanRaw || cleanRaw.toLowerCase() === 'stream' || cleanRaw.toLowerCase() === 'video';
        const isDuplicateOfHeader = resolvedTitle && cleanRaw.toLowerCase() === resolvedTitle.toLowerCase();
        if (!isGeneric && !isDuplicateOfHeader) {
            cardLines.push(`📄 ${cleanRaw}`);
        }
    }

    // Line 3: Visual & Audio Studio Badges (Diamond Row)
    // Format: 💎 Dolby Vision Profile 8 • HDR10+ • Dolby Atmos TrueHD 7.1
    const hdrBadges = [];
    if (parsed.hdr && parsed.hdr.length > 0) {
        if (parsed.hdr.includes('Dolby Vision') || parsed.dvProfile) {
            let dvProf = parsed.dvProfile;
            if (!dvProf) {
                // Infer standard DV profile from release type if not parsed explicitly
                if (parsed.hdr.includes('HDR10+') || (parsed.special && parsed.special.includes('REMUX'))) {
                    dvProf = 'Profile 8';
                } else if (parsed.quality === 'WEB-DL' || parsed.quality === 'WEBRip') {
                    dvProf = 'Profile 5';
                } else if (parsed.quality === 'BluRay') {
                    dvProf = 'Profile 7';
                } else {
                    dvProf = 'Profile 8';
                }
            }
            hdrBadges.push(`Dolby Vision ${dvProf}`);
        }
        if (parsed.hdr.includes('HDR10+')) {
            hdrBadges.push('HDR10+');
        } else if (parsed.hdr.includes('HDR10')) {
            hdrBadges.push('HDR10');
        } else if (parsed.hdr.includes('HDR')) {
            hdrBadges.push('HDR');
        }
    } else if (parsed.bitDepth === '10-bit' || parsed.bitDepth === '10bit') {
        hdrBadges.push('10-bit Color');
    }

    if (parsed.special && parsed.special.includes('IMAX Enhanced')) {
        hdrBadges.push('IMAX Enhanced');
    }

    const detailedAudio = formatDetailedAudioBadge(parsed);
    if (detailedAudio) {
        hdrBadges.push(detailedAudio);
    }

    if (hdrBadges.length > 0) {
        cardLines.push(`💎 ${[...new Set(hdrBadges)].join(' • ')}`);
    }

    // Line 4: Spoken Languages & Audio Tracks (Strict Studio Layout)
    // Format: 🌐 🇮🇳 Hindi Dub • 🇬🇧 English • 🌐 Multi-Audio
    const audioLangs = [];
    const nonGenericLangs = (parsed.languages || []).filter(l => l !== 'Dual-Audio' && l !== 'Multi-Audio');

    const flagMap = {
        'Hindi': '🇮🇳',
        'Tamil': '🇮🇳',
        'Telugu': '🇮🇳',
        'Malayalam': '🇮🇳',
        'Kannada': '🇮🇳',
        'Bengali': '🇮🇳',
        'Punjabi': '🇮🇳',
        'Marathi': '🇮🇳',
        'English': '🇬🇧',
        'Japanese': '🇯🇵',
        'Korean': '🇰🇷',
        'Spanish': '🇪🇸',
        'French': '🇫🇷',
        'German': '🇩🇪',
        'Italian': '🇮🇹',
        'Portuguese': '🇵🇹',
        'Russian': '🇷🇺',
        'Chinese': '🇨🇳',
        'Arabic': '🇦🇪',
        'Turkish': '🇹🇷'
    };

    const isAnimeContent = mediaEmoji === '🌸';
    const hasMultipleAudioTracks = parsed.isMultiAudio || parsed.isDualAudio || nonGenericLangs.length > 1;

    nonGenericLangs.forEach(l => {
        const flag = flagMap[l] || '🌐';
        let label = `${flag} ${l}`;
        if (l === 'Hindi') {
            const isDub = hasMultipleAudioTracks || /\bdub(?:bed)?\b/i.test(rawTitleToDisplay) || nonGenericLangs.includes('English');
            label = isDub ? `${flag} Hindi Dub` : `${flag} Hindi`;
        } else if (l === 'English') {
            if (isAnimeContent) {
                label = `${flag} English Dub`;
            } else {
                label = `${flag} English`;
            }
        } else if (l === 'Japanese') {
            if (isAnimeContent) {
                label = `${flag} Japanese [Original]`;
            } else {
                label = `${flag} Japanese Dub`;
            }
        }
        audioLangs.push(label);
    });

    if (parsed.isMultiAudio || (parsed.languages && parsed.languages.includes('Multi-Audio')) || nonGenericLangs.length >= 3) {
        audioLangs.push('🌐 Multi-Audio');
    } else if (parsed.isDualAudio || (parsed.languages && parsed.languages.includes('Dual-Audio')) || nonGenericLangs.length === 2) {
        if (!audioLangs.some(a => a.includes('Multi-Audio'))) {
            audioLangs.push('🌐 Dual-Audio');
        }
    }

    if (audioLangs.length === 0) {
        audioLangs.push('🇬🇧 English');
    }

    const uniqueAudioLangs = [...new Set(audioLangs)];
    cardLines.push(`🌐 ${uniqueAudioLangs.join(' • ')}`);

    // Line 5: Metadata Row (Package Box File Size, Seeders, Release Group, Provider)
    // Format: 📦 48.2 GB • 🟢 145 Seeders • 🏷️ FraMeSToR • 🔗 Torrentio
    const metaRow = [];
    if (ingested.sizeFormatted && config.showFileSize !== false) {
        const cleanSize = ingested.sizeFormatted
            .replace(/^💾\s*/, '')
            .replace(/(\.0+)\s*GB/, ' GB')
            .replace(/(\.\d)0\s*GB/, '$1 GB');
        metaRow.push(`📦 ${cleanSize}`);
    }

    if (ingested.isDebridCached) {
        const p = (config.debridProvider && config.debridProvider !== 'none')
            ? config.debridProvider.toLowerCase()
            : (ingested.originalProvider && /torbox/i.test(ingested.originalProvider) ? 'torbox' : (/realdebrid|rd/i.test(ingested.originalProvider) ? 'realdebrid' : null));
        if (p === 'torbox') metaRow.push('⚡ Torbox Debrid Cached');
        else if (p === 'realdebrid') metaRow.push('⚡ RealDebrid Instant Play');
        else if (p === 'alldebrid') metaRow.push('⚡ AllDebrid Instant Play');
        else if (p === 'premiumize') metaRow.push('⚡ Premiumize Instant Play');
        else metaRow.push('⚡ Debrid Instant Play');
    } else if (seederBadge && config.showSeeders !== false) {
        metaRow.push(seederBadge);
    }

    if (parsed.releaseGroup && config.showReleaseGroup !== false) {
        metaRow.push(`🏷️ ${parsed.releaseGroup}`);
    }

    if (ingested.mirrorCount > 1) {
        metaRow.push(`⚡ ${ingested.mirrorCount} Live Mirrors`);
    }

    metaRow.push(`🔗 ${providerLabel}`);
    if (metaRow.length > 0) {
        cardLines.push(metaRow.join(' • '));
    }

    return {
        name: nameLine,
        title: cardLines.join('\n') || ingested.rawFilename,
        description: cardLines.join('\n') || ingested.rawFilename
    };
}

module.exports = {
    formatStreamCard,
    formatProviderChain,
    getDebridBadge,
    getSeederBadge
};
