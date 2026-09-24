/**
 * AIOStreams Multi-Preset Stream Card Formatter
 * Formats stream.name and stream.title for Stremio without destroying or hallucinating metadata.
 */

function formatProviderChain(providers, fallback = 'Stream') {
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
        if (typeof fallback === 'string' && (fallback.includes('Telegram') || fallback.includes('PencariMovie'))) {
            return '⚡ Telegram';
        }
        return fallback;
    }
    const cleanList = [...new Set(providers.filter(Boolean))].map(p => {
        if (typeof p === 'string' && (p.includes('Telegram') || p.includes('PencariMovie'))) {
            return '⚡ Telegram';
        }
        return p;
    });
    if (cleanList.length === 0) return fallback;
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
        return '⚡ [Cached] Instant'; // Upstream cached, but we don't know which service
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

    // Language badge for header line
    let langTopBadge = null;
    const realLangs = (parsed.languages || []).filter(l => l !== 'Dual-Audio' && l !== 'Multi-Audio');
    if (parsed.isMultiAudio || parsed.languages.includes('Multi-Audio') || realLangs.length >= 3) {
        langTopBadge = 'Multi Audio';
    } else if (parsed.isDualAudio || parsed.languages.includes('Dual-Audio') || realLangs.length === 2) {
        langTopBadge = 'Dual Audio';
    } else if (realLangs.length === 1) {
        if (realLangs[0] !== 'English') {
            langTopBadge = realLangs[0];
        }
    }

    // 1. Build Header Line (stream.name)
    const audioBadge = (() => {
        const audioList = Array.isArray(parsed.audio) ? parsed.audio : [];
        const hasAtmos = audioList.some(a => /atmos/i.test(a));
        let base = null;
        if (audioList.some(a => /truehd|true-hd/i.test(a))) base = 'TrueHD';
        else if (audioList.some(a => /dts-hd\s*ma|dtshd\s*ma/i.test(a))) base = 'DTS-HD';
        else if (audioList.some(a => /dts-x|dtsx/i.test(a))) base = 'DTS-X';
        else if (audioList.some(a => /\bdts\b/i.test(a))) base = 'DTS';
        else if (audioList.some(a => /ddp|dd\+|eac3/i.test(a))) base = 'DD+';
        else if (audioList.some(a => /\bdd\b|ac3/i.test(a))) base = 'DD';
        else if (audioList.some(a => /flac/i.test(a))) base = 'FLAC';
        else if (audioList.some(a => /pcm|lpcm/i.test(a))) base = 'PCM';
        else if (audioList.some(a => /aac/i.test(a))) base = 'AAC';
        else if (audioList.some(a => /opus/i.test(a))) base = 'Opus';

        let tag = '';
        if (base && hasAtmos) tag = `${base} Atmos`;
        else if (base) tag = base;
        else if (hasAtmos) tag = 'Atmos';

        if (!tag) return parsed.channels ? `Audio ${parsed.channels}` : null;
        if (parsed.channels) return `${tag} ${parsed.channels}`;
        return tag;
    })();

    const sizeTopBadge = (ingested.sizeFormatted && config.showFileSize !== false) ? `💾 ${ingested.sizeFormatted}` : null;
    const imaxBadge = (parsed.special && (parsed.special.includes('IMAX Enhanced') || parsed.special.includes('IMAX'))) ? 'IMAX' : null;
    const is3dBadge = (parsed.special && parsed.special.includes('3D')) ? '3D' : null;
    const editionBadge = parsed.edition ? parsed.edition : null;
    const repackBadge = (parsed.isRepack || (parsed.special && parsed.special.includes('REPACK'))) ? 'REPACK' : ((parsed.isProper || (parsed.special && parsed.special.includes('PROPER'))) ? 'PROPER' : null);

    const bitDepthBadge = (parsed.bitDepth === '12-bit' || parsed.bitDepth === '12bit') ? '12bit' : ((parsed.bitDepth === '10bit' || parsed.bitDepth === '10-bit' || (parsed.special && parsed.special.some(s => /10bit|10-bit/i.test(s)))) ? '10bit' : null);
    const hfrBadge = (parsed.special && parsed.special.includes('60fps')) ? '60fps' : null;

    const codecBadge = (() => {
        if (!parsed.codec) return null;
        const c = parsed.codec.toUpperCase();
        if (c === 'HEVC') return 'HEVC';
        if (c === 'AV1') return 'AV1';
        if (c === 'H.264' || c === 'AVC') return 'AVC';
        if (c === 'VP9') return 'VP9';
        if (c === 'VC-1') return 'VC-1';
        return parsed.codec;
    })();

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

    const topBadges = [
        debridBadge,
        parsed.resolution === '2160p' ? '4K UHD' : (parsed.resolution === '1080p' ? '1080p FHD' : (parsed.resolution === '720p' ? '720p HD' : parsed.resolution)),
        ...dvHdrBadges,
        imaxBadge,
        is3dBadge,
        parsed.special.includes('REMUX') ? 'REMUX' : (parsed.quality || null),
        editionBadge,
        repackBadge,
        codecBadge,
        bitDepthBadge,
        hfrBadge,
        audioBadge,
        sizeTopBadge,
        langTopBadge
    ].filter(Boolean);

    const uniqueTopBadges = [...new Set(topBadges)];
    const topBadgeStr = uniqueTopBadges.length > 0 ? ` • ${uniqueTopBadges.slice(0, 10).join(' • ')}` : '';

    let nameLine = '';
    if (isDead) {
        nameLine = `🔴 DEAD • ${providerLabel}${topBadgeStr}`;
    } else if (ingested.isP2P && !debridBadge) {
        nameLine = `🧲 P2P • ${providerLabel}${topBadgeStr}`;
    } else if (
        providerLabel.includes('Telegram') || 
        providerLabel.includes('PencariMovie') || 
        (ingested.originalProvider && ingested.originalProvider.includes('Telegram'))
    ) {
        nameLine = `${providerLabel}${topBadgeStr}`;
    } else {
        const statusEmoji = latency < 800 ? '🟢' : '🟡';
        const statusTag = latency < 800 ? 'FAST' : 'SLOW';
        nameLine = `${statusEmoji} ${statusTag} (${latency}ms) • ${providerLabel}${topBadgeStr}`;
    }

    // 2. Build Card Description (stream.title)
    // If cleanTitles is disabled, show raw scene name cleanly with stats row
    if (config.cleanTitles === false) {
        const lines = [ingested.rawFilename];
        const stats = [];
        if (ingested.sizeFormatted && config.showFileSize !== false) stats.push(`💾 ${ingested.sizeFormatted}`);
        if (seederBadge && config.showSeeders !== false) stats.push(seederBadge);
        stats.push(`⚙️ ${providerLabel}`);
        lines.push(stats.join(' '));
        return {
            name: nameLine,
            title: lines.join('\n'),
            description: lines.join('\n')
        };
    }

    // Torrentio Classic Preset
    if (preset === 'torrentio') {
        const lines = [ingested.rawFilename];
        const stats = [];
        if (ingested.sizeFormatted && config.showFileSize !== false) stats.push(`💾 ${ingested.sizeFormatted}`);
        if (seederBadge && config.showSeeders !== false) stats.push(seederBadge);
        stats.push(`⚙️ ${providerLabel}`);
        lines.push(stats.join(' '));
        return {
            name: nameLine,
            title: lines.join('\n'),
            description: lines.join('\n')
        };
    }

    // AIOStreams Modern Preset (Default)
    const cardLines = [];

    // Line 1: Header (Title, Year, Episode, Main Release Specs)
    const titleHeaderParts = [];
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

    if (resolvedTitle) {
        let titleHeader = resolvedTitle;
        if (resolvedYear) titleHeader += ` (${resolvedYear})`;
        if (resolvedSeasonEpisode) titleHeader += ` • ${resolvedSeasonEpisode}`;
        titleHeaderParts.push(titleHeader);
    }

    const qualitySpecs = [
        parsed.resolution ? (parsed.resolution === '2160p' ? '4K UHD' : parsed.resolution === '1080p' ? '1080p FHD' : parsed.resolution === '720p' ? '720p HD' : parsed.resolution) : null,
        parsed.special.includes('REMUX') ? 'REMUX' : (parsed.quality || null),
        parsed.special.includes('IMAX Enhanced') ? 'IMAX Enhanced' : (parsed.special.includes('IMAX') ? 'IMAX' : null),
        (parsed.special && parsed.special.includes('3D')) ? '3D' : null,
        parsed.edition || null,
        parsed.codec || null,
        parsed.bitDepth || null
    ].filter(Boolean);

    if (qualitySpecs.length > 0) {
        titleHeaderParts.push(`[${qualitySpecs.join(' • ')}]`);
    }
    if (titleHeaderParts.length > 0) {
        cardLines.push(`🎬 ${titleHeaderParts.join(' ')}`);
    }

    // Original Stream File Title (if enabled)
    const rawTitleToDisplay = ingested.originalTitle || ingested.rawFilename;
    if (config.includeOriginalTitle !== false && rawTitleToDisplay) {
        const cleanRaw = String(rawTitleToDisplay).replace(/[🎬💎🌐📦🟢🟡🔴🧲⚡⚙️🔗🏷️]/g, '').trim();
        const isGeneric = !cleanRaw || cleanRaw.toLowerCase() === 'stream' || cleanRaw.toLowerCase() === 'video';
        if (!isGeneric) {
            cardLines.push(`📄 ${cleanRaw}`);
        }
    }

    // Line 2: Visual & Audio Studio Badges
    const avBadges = [];
    if (parsed.special && parsed.special.includes('IMAX Enhanced')) {
        avBadges.push('IMAX Enhanced');
    } else if (parsed.special && parsed.special.includes('IMAX')) {
        avBadges.push('IMAX');
    }
    if (parsed.special && parsed.special.includes('3D')) {
        avBadges.push('3D');
    }
    if (parsed.edition) {
        avBadges.push(parsed.edition);
    }
    if (parsed.hdr && parsed.hdr.length > 0) {
        parsed.hdr.forEach(h => {
            if (h === 'Dolby Vision' && parsed.dvProfile) avBadges.push(`Dolby Vision ${parsed.dvProfile}`);
            else avBadges.push(h);
        });
    }
    if (parsed.audio && parsed.audio.length > 0) {
        const audioStr = parsed.audio.map(a => a === 'DDP' ? 'DD+' : a).join(' + ');
        const chanStr = parsed.channels ? ` ${parsed.channels}` : '';
        avBadges.push(`${audioStr}${chanStr}`);
    } else if (parsed.channels) {
        avBadges.push(`Audio ${parsed.channels}`);
    }
    if (avBadges.length > 0) {
        cardLines.push(`💎 ${avBadges.join(' • ')}`);
    }

    // Line 3: Spoken Languages & Audio Tracks (with accurate country flags)
    const displayLangs = [];
    const nonGenericLangs = (parsed.languages || []).filter(l => l !== 'Dual-Audio' && l !== 'Multi-Audio');

    if (parsed.isMultiAudio || parsed.languages.includes('Multi-Audio') || nonGenericLangs.length >= 3) {
        const langNames = nonGenericLangs.map(l => {
            if (l === 'English') return '🇬🇧 English';
            if (l === 'Hindi') return '🇮🇳 Hindi';
            if (l === 'Tamil') return '🇮🇳 Tamil';
            if (l === 'Telugu') return '🇮🇳 Telugu';
            if (l === 'Malayalam') return '🇮🇳 Malayalam';
            if (l === 'Kannada') return '🇮🇳 Kannada';
            if (l === 'Japanese') return '🇯🇵 Japanese';
            if (l === 'Korean') return '🇰🇷 Korean';
            return l;
        });
        const details = langNames.length > 0 ? ` [${[...new Set(langNames)].join(' • ')}]` : '';
        displayLangs.push(`🌐 Multi-Audio${details}`);
    } else if (parsed.isDualAudio || parsed.languages.includes('Dual-Audio') || nonGenericLangs.length === 2) {
        const langNames = nonGenericLangs.map(l => {
            if (l === 'English') return '🇬🇧 English';
            if (l === 'Hindi') return '🇮🇳 Hindi';
            if (l === 'Tamil') return '🇮🇳 Tamil';
            if (l === 'Telugu') return '🇮🇳 Telugu';
            if (l === 'Malayalam') return '🇮🇳 Malayalam';
            if (l === 'Kannada') return '🇮🇳 Kannada';
            if (l === 'Japanese') return '🇯🇵 Japanese';
            if (l === 'Korean') return '🇰🇷 Korean';
            return l;
        });
        const details = langNames.length > 0 ? ` [${[...new Set(langNames)].join(' + ')}]` : '';
        displayLangs.push(`🌐 Dual-Audio${details}`);
    } else if (nonGenericLangs.length > 0) {
        nonGenericLangs.forEach(l => {
            if (l === 'Hindi') displayLangs.push('🇮🇳 Hindi');
            else if (l === 'Tamil') displayLangs.push('🇮🇳 Tamil');
            else if (l === 'Telugu') displayLangs.push('🇮🇳 Telugu');
            else if (l === 'Malayalam') displayLangs.push('🇮🇳 Malayalam');
            else if (l === 'Kannada') displayLangs.push('🇮🇳 Kannada');
            else if (l === 'Japanese') displayLangs.push('🇯🇵 Japanese');
            else if (l === 'English') displayLangs.push('🇬🇧 English');
            else if (l === 'Korean') displayLangs.push('🇰🇷 Korean');
            else displayLangs.push(l);
        });
    } else {
        displayLangs.push('🇬🇧 English');
    }

    // Include subtitle tags cleanly if present
    if (parsed.subtitles && parsed.subtitles.length > 0) {
        const subTags = parsed.subtitles.map(s => {
            if (s === 'English') return '🇬🇧 Eng';
            if (s === 'Hindi') return '🇮🇳 Hin';
            return s;
        });
        displayLangs.push(`💬 Subs: ${[...new Set(subTags)].join(', ')}`);
    }

    if (displayLangs.length > 0) {
        cardLines.push(`${[...new Set(displayLangs)].join(' • ')}`);
    }

    // Line 4: Media Specs Row (File Size, Seeders, Release Group, Providers)
    const metaRow = [];
    if (ingested.sizeFormatted && config.showFileSize !== false) {
        metaRow.push(`💾 ${ingested.sizeFormatted}`);
    }
    if (seederBadge && config.showSeeders !== false) {
        metaRow.push(seederBadge);
    }
    if (parsed.releaseGroup && config.showReleaseGroup !== false) {
        metaRow.push(`🏷️ ${parsed.releaseGroup}`);
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
