const axios = require('axios');
const crypto = require('crypto');
const { dohHttpsAgent } = require('./dohResolver');

// Cache store for parsed playlists and channels
const playlistCache = new Map();
const channelMetadataCache = new Map();
const PLAYLIST_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Rock-Solid, Legal, Free Curated Public Channels
// Curated from verified 24/7 public broadcasts with high uptime
const CURATED_CHANNELS = [
    // --- NEWS ---
    {
        id: 'iptv:curated:bbc_news',
        name: 'BBC News Live',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/BBC_News_2019.svg/1200px-BBC_News_2019.svg.png',
        category: 'News',
        country: 'UK',
        url: 'https://vs-hls-push-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_news_channel_hd/t=3840/v=pv14/b=5070016/main.m3u8',
        description: 'BBC News Channel - 24/7 Global breaking news, analysis and world affairs.'
    },
    {
        id: 'iptv:curated:sky_news',
        name: 'Sky News UK',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/5/58/Sky_News_logo_2020.svg/1200px-Sky_News_logo_2020.svg.png',
        category: 'News',
        country: 'UK',
        url: 'https://linear417-gb-dash1-prd-cf.cdn.sky.com/016a/unenc/03/live.mpd',
        fallbackUrl: 'https://skynewsau-live.akamaized.net/hls/live/2002689/skynewsau-extra1/master.m3u8',
        description: 'Sky News 24/7 Live broadcast from London.'
    },
    {
        id: 'iptv:curated:aljazeera_en',
        name: 'Al Jazeera English',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png',
        category: 'News',
        country: 'Global',
        url: 'https://live-hls-web-aje.getaj.net/AJE/03.m3u8',
        description: 'Al Jazeera English live world news from Doha.'
    },
    {
        id: 'iptv:curated:france24_en',
        name: 'France 24 English',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/65/France_24_logo.svg/1200px-France_24_logo.svg.png',
        category: 'News',
        country: 'France',
        url: 'https://static.france24.com/live/F24_EN_LO_HLS/live_tv.m3u8',
        description: 'International news 24/7 in English from Paris.'
    },
    {
        id: 'iptv:curated:dw_english',
        name: 'DW English HD',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_symbol_2012.svg/1200px-Deutsche_Welle_symbol_2012.svg.png',
        category: 'News',
        country: 'Germany',
        url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
        description: 'Deutsche Welle (DW) English live news and current affairs.'
    },
    {
        id: 'iptv:curated:euronews_en',
        name: 'Euronews English',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Euronews_2016_logo.svg/1200px-Euronews_2016_logo.svg.png',
        category: 'News',
        country: 'Europe',
        url: 'https://rakuten-euronews-1-gb.samsung.wurl.tv/playlist.m3u8',
        description: 'All views on European and global news.'
    },
    {
        id: 'iptv:curated:bloomberg_tv',
        name: 'Bloomberg Television',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Bloomberg_Television_logo.svg/1200px-Bloomberg_Television_logo.svg.png',
        category: 'News',
        country: 'USA',
        url: 'https://liveprodupmulticdn.akamaized.net/live/channel/bloomberg/live.m3u8',
        fallbackUrl: 'https://bloomberg.com/media-manifest/streams/us.m3u8',
        description: 'Global business and financial market news around the clock.'
    },

    // --- SPORTS ---
    {
        id: 'iptv:curated:redbull_tv',
        name: 'Red Bull TV',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f5/Red_Bull_TV_logo.svg/1200px-Red_Bull_TV_logo.svg.png',
        category: 'Sports',
        country: 'Global',
        url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
        description: 'Action sports, motorsports, skateboarding, snowboarding and extreme outdoor events.'
    },
    {
        id: 'iptv:curated:fite_sports',
        name: 'Fight Sports TV',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Sports_icon.png',
        category: 'Sports',
        country: 'USA',
        url: 'https://linear-105.frequency.stream/mt/studio/105/hls/master.m3u8',
        description: 'Combat sports, boxing, kickboxing, MMA tournaments and documentaries.'
    },
    {
        id: 'iptv:curated:origin_sports',
        name: 'Origin Sports Network',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Soccerball.svg/500px-Soccerball.svg.png',
        category: 'Sports',
        country: 'USA',
        url: 'https://amg01201-cinedigm-originsports-samsungus-o4sfn.amagi.tv/playlist.m3u8',
        description: 'Legendary sports rivalries, athletic biographies, and classic moments.'
    },
    {
        id: 'iptv:curated:sportsgrid',
        name: 'SportsGrid Network',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/SportsGrid_logo.png/600px-SportsGrid_logo.png',
        category: 'Sports',
        country: 'USA',
        url: 'https://sportsgrid-klowdtv.amagi.tv/playlist.m3u8',
        description: 'Live 24/7 sports betting analytics, statistics, game recaps, and fantasy insights.'
    },
    {
        id: 'iptv:curated:edge_sport',
        name: 'Edge Sport Live',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Sports_icon.png/500px-Sports_icon.png',
        category: 'Sports',
        country: 'Global',
        url: 'https://edgesport-samsunguk.amagi.tv/playlist.m3u8',
        description: 'Premier action sports, surfing, BMX, and freestyle motocross.'
    },

    // --- INDIA ---
    {
        id: 'iptv:curated:ndtv_24x7',
        name: 'NDTV 24x7 India',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/NDTV_24x7_Logo.svg/1200px-NDTV_24x7_Logo.svg.png',
        category: 'India',
        country: 'India',
        url: 'https://ndtv24x7elemarchana.akamaized.net/hls/live/2003678/ndtv24x7/master.m3u8',
        description: 'NDTV 24x7 - Premier Indian news channel delivering unbiased reporting.'
    },
    {
        id: 'iptv:curated:ndtv_india',
        name: 'NDTV India (Hindi)',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/NDTV_India_logo.png/600px-NDTV_India_logo.png',
        category: 'India',
        country: 'India',
        url: 'https://ndtvindiaelemarchana.akamaized.net/hls/live/2003679/ndtvindia/master.m3u8',
        description: 'NDTV India live in Hindi with prime time discussions.'
    },
    {
        id: 'iptv:curated:aaj_tak',
        name: 'Aaj Tak Live',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/07/Aaj_Tak_logo.svg/1200px-Aaj_Tak_logo.svg.png',
        category: 'India',
        country: 'India',
        url: 'https://feeds.intoday.in/aajtak/api/aajtak-hd/master.m3u8',
        description: 'Sabse Tez - India’s leading Hindi news network.'
    },
    {
        id: 'iptv:curated:india_today',
        name: 'India Today TV',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/65/India_Today_Television_logo.svg/1200px-India_Today_Television_logo.svg.png',
        category: 'India',
        country: 'India',
        url: 'https://feeds.intoday.in/it/api/it-hd/master.m3u8',
        description: 'India Today Television live national and international journalism.'
    },
    {
        id: 'iptv:curated:dd_national',
        name: 'DD National HD',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Doordarshan_logo.svg/1200px-Doordarshan_logo.svg.png',
        category: 'India',
        country: 'India',
        url: 'https://play.prasarbharati.org/hls/live/ddnational/master.m3u8',
        description: 'Doordarshan National - India’s state public broadcaster for culture and news.'
    },
    {
        id: 'iptv:curated:dd_sports',
        name: 'DD Sports Live',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Doordarshan_logo.svg/1200px-Doordarshan_logo.svg.png',
        category: 'India',
        country: 'India',
        url: 'https://play.prasarbharati.org/hls/live/ddsports/master.m3u8',
        description: 'Doordarshan Sports live cricket, hockey, and Olympic events coverage.'
    },

    // --- ENTERTAINMENT & MOVIES ---
    {
        id: 'iptv:curated:retro_movies',
        name: 'Retro Cinema Classics',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Film_strip.svg/500px-Film_strip.svg.png',
        category: 'Movies',
        country: 'USA',
        url: 'https://retrocrush-samsung.amagi.tv/playlist.m3u8',
        description: '24/7 Classic cinema, noir, vintage action and golden age motion pictures.'
    },
    {
        id: 'iptv:curated:filmrise_action',
        name: 'FilmRise Action',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Film_strip.svg/500px-Film_strip.svg.png',
        category: 'Movies',
        country: 'USA',
        url: 'https://filmrise-action-samsungus.amagi.tv/playlist.m3u8',
        description: 'Adrenaline-packed feature films, martial arts, heist thrillers and explosions.'
    },
    {
        id: 'iptv:curated:dust_scifi',
        name: 'DUST Sci-Fi Network',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Orbit_icon.svg/500px-Orbit_icon.svg.png',
        category: 'Entertainment',
        country: 'USA',
        url: 'https://dust-samsungus.amagi.tv/playlist.m3u8',
        description: 'Mind-bending sci-fi movies, visionary short films, and futuristic universes.'
    },
    {
        id: 'iptv:curated:nasa_tv',
        name: 'NASA TV Public HD',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/1200px-NASA_logo.svg.png',
        category: 'Entertainment',
        country: 'USA',
        url: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
        description: 'Live rocket launches, spacewalks, astronaut interviews and views of Earth from the ISS.'
    },

    // --- MUSIC ---
    {
        id: 'iptv:curated:clubbing_tv',
        name: 'Clubbing TV Electronic',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Headphones_icon.svg/500px-Headphones_icon.svg.png',
        category: 'Music',
        country: 'France',
        url: 'https://stream.clubbingtv.com/hls/clubbingtv.m3u8',
        description: 'Electronic dance music, live DJ sets, festival coverage from Ibiza and Tomorrowland.'
    },
    {
        id: 'iptv:curated:now_music',
        name: 'NOW Music Hits 80s/90s',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Musical_notes.svg/500px-Musical_notes.svg.png',
        category: 'Music',
        country: 'UK',
        url: 'https://nowmusic-samsunguk.amagi.tv/playlist.m3u8',
        description: 'Chart-topping greatest hits, pop icons, rock anthems and music videos.'
    },

    // --- RELIGIOUS ---
    {
        id: 'iptv:curated:ewtn_global',
        name: 'EWTN Global Catholic',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/EWTN_logo.svg/500px-EWTN_logo.svg.png',
        category: 'Religious',
        country: 'USA',
        url: 'https://ewtn-ewtn-1-us.samsung.wurl.tv/playlist.m3u8',
        description: '24/7 Global religious discussions, spiritual reflections, and services.'
    },
    {
        id: 'iptv:curated:peace_tv',
        name: 'Peace TV Live',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Peace_TV_logo.svg/500px-Peace_TV_logo.svg.png',
        category: 'Religious',
        country: 'India',
        url: 'https://d2e1asnsl7br7b.cloudfront.net/datnlive/smil:datn.smil/playlist.m3u8',
        description: 'Spiritual talks, interfaith dialogues and educational programming.'
    },

    // --- BUSINESS ---
    {
        id: 'iptv:curated:bloomberg_tv',
        name: 'Bloomberg Television',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Bloomberg_Television_logo.svg/1200px-Bloomberg_Television_logo.svg.png',
        category: 'Business',
        country: 'USA',
        url: 'https://bloomberg-bloombergtv-1-us.samsung.wurl.tv/playlist.m3u8',
        description: 'Global business, financial markets, stocks, and economic insights.'
    },
    {
        id: 'iptv:curated:yahoo_finance',
        name: 'Yahoo Finance HD',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Yahoo%21_Finance_logo_2021.svg/500px-Yahoo%21_Finance_logo_2021.svg.png',
        category: 'Business',
        country: 'USA',
        url: 'https://yahoofinance-samsungus.amagi.tv/playlist.m3u8',
        description: 'Live stock market coverage, tech investment trends and earnings reports.'
    },

    // --- CULTURE & DOCUMENTARY ---
    {
        id: 'iptv:curated:dw_culture',
        name: 'DW Documentary & Culture',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_symbol_2012.svg/500px-Deutsche_Welle_symbol_2012.svg.png',
        category: 'Culture',
        country: 'Germany',
        url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
        description: 'Fascinating global documentaries, deep investigative journalism, and world heritage.'
    },

    // --- ANIMATION & KIDS ---
    {
        id: 'iptv:curated:toon_goggles',
        name: 'Toon Goggles Kids',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Banana-Single.jpg/500px-Banana-Single.jpg',
        category: 'Animation',
        country: 'USA',
        url: 'https://tgkids-samsungus.amagi.tv/playlist.m3u8',
        description: 'Kid-safe cartoons, animated series, fun games, and comedy shorts.'
    },

    // --- LIFESTYLE ---
    {
        id: 'iptv:curated:tastemade_food',
        name: 'Tastemade Food & Travel',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Silver_fork_and_knife_icon.svg/500px-Silver_fork_and_knife_icon.svg.png',
        category: 'Lifestyle',
        country: 'USA',
        url: 'https://tastemade-samsungus.amagi.tv/playlist.m3u8',
        description: 'Culinary adventures, street food travel, modern recipes, and home styling.'
    }
];

/**
 * Parses an M3U or M3U8 string into structured channel objects.
 * Handles EXTINF attributes (tvg-id, tvg-name, tvg-logo, group-title).
 */
function parseM3uPlaylist(rawM3u, sourcePrefix = 'custom') {
    if (!rawM3u || typeof rawM3u !== 'string') return [];
    
    const lines = rawM3u.split(/\r?\n/);
    const channels = [];
    let currentInfo = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentInfo = {};
            
            // Extract attributes using regex
            const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
            const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
            const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
            const groupMatch = line.match(/group-title="([^"]*)"/i);
            
            // Channel display name is everything after the last comma
            const commaIndex = line.lastIndexOf(',');
            const rawTitle = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : 'Live Channel';

            currentInfo.name = rawTitle || (tvgNameMatch ? tvgNameMatch[1] : 'Live Channel');
            currentInfo.tvgId = tvgIdMatch ? tvgIdMatch[1] : null;
            currentInfo.logo = tvgLogoMatch ? tvgLogoMatch[1] : null;
            currentInfo.category = groupMatch ? groupMatch[1].trim() : 'General';
        } else if (line.startsWith('#EXTVLCOPT:') || line.startsWith('#EXTHTTP:')) {
            // Extra stream options if present
            if (currentInfo) {
                if (line.includes('http-user-agent=')) {
                    currentInfo.userAgent = line.split('http-user-agent=')[1].trim();
                }
            }
        } else if (!line.startsWith('#') && currentInfo) {
            // This is the stream URL line
            const streamUrl = line;
            if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
                const uniqueSeed = `${sourcePrefix}_${currentInfo.tvgId || currentInfo.name}_${streamUrl}`;
                const hashId = crypto.createHash('md5').update(uniqueSeed).digest('hex').substring(0, 10);
                
                channels.push({
                    id: `iptv:${sourcePrefix}:${hashId}`,
                    name: currentInfo.name,
                    logo: currentInfo.logo || 'https://raw.githubusercontent.com/yoruix/nuvio-providers/main/public/icon-512.png',
                    category: currentInfo.category || 'General',
                    url: streamUrl,
                    userAgent: currentInfo.userAgent || null,
                    description: `${currentInfo.name} - Live Broadcast (${currentInfo.category})`
                });
            }
            currentInfo = null; // reset for next item
        }
    }

    return channels;
}

/**
 * Fetches and parses a remote M3U playlist URL with caching.
 */
async function fetchRemoteM3u(url, customUserAgent = null, forceRefresh = false) {
    if (!url) return [];
    
    const cached = playlistCache.get(url);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < PLAYLIST_CACHE_TTL_MS) {
        return cached.channels;
    }

    try {
        console.log(`[IPTV] Fetching remote M3U playlist: ${url}`);
        const response = await axios.get(url, {
            timeout: 10000,
            httpsAgent: dohHttpsAgent,
            headers: {
                'User-Agent': customUserAgent || DEFAULT_USER_AGENT,
                'Accept': '*/*'
            },
            maxContentLength: 40 * 1024 * 1024 // Allow up to 40MB
        });

        const rawData = response.data;
        let channels = parseM3uPlaylist(typeof rawData === 'string' ? rawData : JSON.stringify(rawData), 'custom');
        if (customUserAgent) {
            channels = channels.map(ch => ({ ...ch, userAgent: customUserAgent }));
        }
        
        console.log(`[IPTV] Successfully parsed ${channels.length} channels from playlist.`);
        playlistCache.set(url, { timestamp: Date.now(), channels });
        
        // Cache metadata for individual channels
        for (const ch of channels) {
            channelMetadataCache.set(ch.id, ch);
        }

        return channels;
    } catch (err) {
        console.error(`[IPTV] Failed to fetch M3U playlist (${url}):`, err.message);
        if (cached) return cached.channels; // Return stale cache if fetch fails
        return [];
    }
}

/**
 * Resolves Xtream Codes API into M3U channels
 */
async function fetchXtreamChannels(server, username, password) {
    if (!server || !username || !password) return [];
    
    const cleanServer = server.replace(/\/+$/, '');
    const cacheKey = `xtream:${cleanServer}:${username}`;
    const cached = playlistCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PLAYLIST_CACHE_TTL_MS) {
        return cached.channels;
    }

    try {
        // Option 1: Direct M3U Plus endpoint (fast and standardized)
        const m3uUrl = `${cleanServer}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=m3u8`;
        const channels = await fetchRemoteM3u(m3uUrl);
        if (channels && channels.length > 0) {
            playlistCache.set(cacheKey, { timestamp: Date.now(), channels });
            return channels;
        }

        // Option 2: Live Streams JSON API Fallback
        const apiUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
        const res = await axios.get(apiUrl, { timeout: 8000, headers: { 'User-Agent': DEFAULT_USER_AGENT } });
        if (Array.isArray(res.data)) {
            const parsed = res.data.map(item => {
                const streamUrl = `${cleanServer}/live/${username}/${password}/${item.stream_id}.m3u8`;
                const id = `iptv:xtream:${item.stream_id}`;
                return {
                    id,
                    name: item.name || 'Live Channel',
                    logo: item.stream_icon || null,
                    category: item.category_name || 'Live TV',
                    url: streamUrl,
                    description: `${item.name} - Live Stream`
                };
            });
            playlistCache.set(cacheKey, { timestamp: Date.now(), channels: parsed });
            for (const ch of parsed) channelMetadataCache.set(ch.id, ch);
            return parsed;
        }
    } catch (err) {
        console.error('[IPTV] Failed to resolve Xtream Codes:', err.message);
    }

    return [];
}

/**
 * Initializes and retrieves all active channels based on user configuration.
 */
async function getAllConfiguredChannels(config = {}) {
    let allChannels = [];

    // 1. Custom M3U / M3U8 Playlist (Prioritized first so user-selected presets show immediately at top of catalog)
    if (config.customIptvUrl) {
        let customChannels = await fetchRemoteM3u(config.customIptvUrl, config.iptvUserAgent);
        if (config.iptvLimit && Number(config.iptvLimit) > 0) {
            customChannels = customChannels.slice(0, Number(config.iptvLimit));
        }
        allChannels = allChannels.concat(customChannels);
    }

    // 2. Curated Channels (Enabled by default unless disabled)
    if (config.enableCuratedIptv !== false) {
        allChannels = allChannels.concat(CURATED_CHANNELS);
        for (const ch of CURATED_CHANNELS) {
            channelMetadataCache.set(ch.id, ch);
        }
    }

    // 3. Xtream Codes Integration
    if (config.xtreamServer && config.xtreamUser && config.xtreamPassword) {
        const xtreamChannels = await fetchXtreamChannels(config.xtreamServer, config.xtreamUser, config.xtreamPassword);
        allChannels = allChannels.concat(xtreamChannels);
    }

    return allChannels;
}

/**
 * Probes a live stream URL to check latency and verify it's responsive.
 */
async function probeLiveStream(url, customUserAgent = null) {
    const start = Date.now();
    try {
        const headers = {
            'User-Agent': customUserAgent || DEFAULT_USER_AGENT,
            'Accept': '*/*'
        };
        
        let res;
        try {
            // Quick Range chunk probe with 2.5s timeout
            res = await axios.get(url, {
                timeout: 2500,
                httpsAgent: dohHttpsAgent,
                headers: {
                    ...headers,
                    'Range': 'bytes=0-1024'
                },
                validateStatus: (status) => status >= 200 && status < 400
            });
        } catch (rangeErr) {
            // If Range request rejected (e.g. 416 or strict server), fallback to quick HEAD probe
            res = await axios.head(url, {
                timeout: 2000,
                httpsAgent: dohHttpsAgent,
                headers,
                validateStatus: (status) => status >= 200 && status < 400
            });
        }

        const latency = Date.now() - start;
        return {
            online: true,
            latency,
            contentType: res.headers['content-type'] || 'application/x-mpegURL'
        };
    } catch (e) {
        return {
            online: false,
            latency: 9999,
            error: e.message
        };
    }
}

/**
 * Formats channel logo into a contain-fitted 1:1 square to prevent
 * Nuvio and Stremio from horizontally cropping rectangular channel logos.
 */
function formatChannelLogo(url, config = {}, label = 'Live TV') {
    if (!url || typeof url !== 'string' || !url.trim()) {
        return 'https://raw.githubusercontent.com/yoruix/nuvio-providers/main/public/icon-512.png';
    }
    const cleanUrl = url.trim();
    if (cleanUrl.startsWith('data:') || cleanUrl.includes('wsrv.nl')) {
        return cleanUrl;
    }
    // Don't proxy localhost or private IP addresses through public image proxy
    if (/(localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(cleanUrl)) {
        return cleanUrl;
    }
    // On hosted deployments, proxy through this addon so an unavailable playlist
    // logo becomes a generated badge instead of a blank catalog poster.
    if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
        if (config.addonHost) {
            const protocol = config.addonProtocol || 'https';
            return `${protocol}://${config.addonHost}/api/catalog-logo?url=${encodeURIComponent(cleanUrl)}&label=${encodeURIComponent(label)}`;
        }
        // Local fallback keeps catalog posters square when no public addon host exists.
        return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&w=512&h=512&fit=contain&cbg=0c101d&output=png`;
    }
    return cleanUrl;
}

/**
 * Retrieves catalog items for Stremio/Nuvio catalog handler.
 */
async function getChannelsCatalog({ genre = 'All', search = '', skip = 0, limit = 40, config = {} }) {
    const channels = await getAllConfiguredChannels(config);
    if (!channels || channels.length === 0) return [];

    let filtered = channels;

    // Filter by genre/category/country
    if (genre && genre !== 'All') {
        const target = genre.toLowerCase().trim();
        filtered = filtered.filter(ch => {
            const cat = (ch.category || '').toLowerCase();
            const country = (ch.country || '').toLowerCase();
            const name = (ch.name || '').toLowerCase();
            
            if (target === 'news') return cat.includes('news') || name.includes('news') || cat.includes('info');
            if (target === 'music') return cat.includes('music') || name.includes('music') || cat.includes('song') || cat.includes('audio');
            if (target === 'movies') return cat.includes('movie') || cat.includes('cinema') || cat.includes('film') || name.includes('cinema');
            if (target === 'religious') return cat.includes('relig') || cat.includes('spirit') || cat.includes('faith') || cat.includes('peace') || cat.includes('god') || cat.includes('church');
            if (target === 'entertainment') return cat.includes('entertain') || cat.includes('general') || cat.includes('series') || cat.includes('show');
            if (target === 'culture') return cat.includes('cultur') || cat.includes('classic') || cat.includes('art') || cat.includes('travel') || cat.includes('heritage') || cat.includes('world');
            if (target === 'animation' || target === 'kids') return cat.includes('anim') || cat.includes('kid') || cat.includes('cartoon') || cat.includes('toon');
            if (target === 'lifestyle') return cat.includes('life') || cat.includes('style') || cat.includes('food') || cat.includes('cook') || cat.includes('home') || cat.includes('fashion') || cat.includes('health');
            if (target === 'business') return cat.includes('busin') || cat.includes('finan') || cat.includes('econ') || cat.includes('market') || cat.includes('stock') || cat.includes('trade');
            if (target === 'sports') return cat.includes('sport') || name.includes('sport') || cat.includes('combat') || cat.includes('racing');
            if (target === 'documentary') return cat.includes('doc') || cat.includes('history') || cat.includes('science');
            if (target === 'india') return country === 'in' || country.includes('india') || cat.includes('hindi') || cat.includes('telugu') || cat.includes('tamil') || cat.includes('malayalam');
            if (target === 'usa') return country === 'us' || country.includes('usa') || country.includes('america');
            if (target === 'uk') return country === 'uk' || country.includes('brit') || cat.includes('bbc') || cat.includes('sky');

            return cat.includes(target) || country.includes(target) || name.includes(target);
        });
    }

    // Filter by search query if user typed into Stremio search bar
    if (search && search.trim()) {
        const q = search.toLowerCase().trim();
        filtered = filtered.filter(ch => 
            (ch.name || '').toLowerCase().includes(q) || 
            (ch.category || '').toLowerCase().includes(q)
        );
    }

    // Pagination
    const pageItems = filtered.slice(skip, skip + limit);

    return pageItems.map(ch => {
        const formattedLogo = formatChannelLogo(ch.logo, config, ch.name);
        return {
            id: ch.id,
            type: 'tv',
            name: ch.name,
            poster: formattedLogo,
            posterShape: 'square',
            background: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=1280&q=80',
            logo: formattedLogo,
            genres: [ch.category || 'Live TV', ch.country || 'Global'].filter(Boolean),
            description: ch.description || `${ch.name} - 24/7 Live Stream`
        };
    });
}

/**
 * Retrieves metadata for a specific channel when clicked in Stremio.
 */
async function getChannelMeta(channelId, config = {}, type = 'tv') {
    try {
        let channel = channelMetadataCache.get(channelId);
        if (!channel) {
            // Re-scan channels to find match
            const channels = await getAllConfiguredChannels(config);
            channel = channels.find(c => c.id === channelId);
        }

        if (!channel) {
            // Fallback: Synthesize metadata so Nuvio/Stremio never fails to load the details page
            const parts = (channelId || '').split(':');
            const fallbackName = parts.slice(2).join(' ').replace(/[_-]/g, ' ') || 'Live Channel';
            channel = {
                id: channelId,
                name: fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1),
                logo: 'https://raw.githubusercontent.com/yoruix/nuvio-providers/main/public/icon-512.png',
                category: 'Live TV',
                country: 'Global',
                description: 'Live Broadcast Stream'
            };
        }

        const formattedLogo = formatChannelLogo(channel.logo, config, channel.name);
        const resolvedType = type || 'tv';

        return {
            id: channel.id,
            type: resolvedType,
            name: channel.name,
            poster: formattedLogo,
            posterShape: 'square',
            background: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=1280&q=80',
            logo: formattedLogo,
            genres: [channel.category || 'Live TV', channel.country || 'Global'].filter(Boolean),
            description: channel.description || `${channel.name} - Live Broadcast`,
            releaseInfo: 'LIVE',
            behaviorHints: {
                isLive: true,
                defaultVideoId: channel.id
            },
            videos: [
                {
                    id: channel.id,
                    title: channel.name || 'Live Stream',
                    released: new Date().toISOString()
                }
            ]
        };
    } catch (err) {
        console.error(`[IPTV] Error getting channel meta for ${channelId}:`, err);
        return {
            id: channelId,
            type: type || 'tv',
            name: 'Live Stream',
            poster: 'https://raw.githubusercontent.com/yoruix/nuvio-providers/main/public/icon-512.png',
            posterShape: 'square',
            background: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=1280&q=80',
            logo: 'https://raw.githubusercontent.com/yoruix/nuvio-providers/main/public/icon-512.png',
            genres: ['Live TV'],
            description: '24/7 Live Stream Broadcast',
            releaseInfo: 'LIVE',
            behaviorHints: {
                isLive: true,
                defaultVideoId: channelId
            },
            videos: [
                {
                    id: channelId,
                    title: 'Live Stream',
                    released: new Date().toISOString()
                }
            ]
        };
    }
}

/**
 * Resolves playable live stream objects for Stremio / Nuvio player.
 */
async function getChannelStreams(channelId, config = {}) {
    let channel = channelMetadataCache.get(channelId);
    if (!channel) {
        const channels = await getAllConfiguredChannels(config);
        channel = channels.find(c => c.id === channelId);
    }

    if (!channel || !channel.url) return [];

    // Probe stream latency concurrently
    const urlsToTest = [
        { url: channel.url, name: 'Primary HLS' },
        ...(channel.fallbackUrl ? [{ url: channel.fallbackUrl, name: 'Backup Feed' }] : [])
    ];

    const streams = await Promise.all(urlsToTest.map(async (item) => {
        const probe = await probeLiveStream(item.url, channel.userAgent);
        const pingBadge = probe.online 
            ? (probe.latency < 500 ? `🟢 FAST (${probe.latency}ms)` : `🟡 STABLE (${probe.latency}ms)`)
            : '⚪ DIRECT STREAM';

        return {
            name: '⚡ CHOLE BHATURE [LIVE]',
            title: `📡 ${channel.name} • ${item.name} • ${pingBadge}\n🌐 Live 24/7 Broadcast (HLS)`,
            url: item.url,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: 'chole-iptv-live',
                headers: channel.userAgent ? { 'User-Agent': channel.userAgent } : undefined
            }
        };
    }));

    return streams;
}

module.exports = {
    CURATED_CHANNELS,
    parseM3uPlaylist,
    fetchRemoteM3u,
    fetchXtreamChannels,
    getAllConfiguredChannels,
    probeLiveStream,
    getChannelsCatalog,
    getChannelMeta,
    getChannelStreams
};
