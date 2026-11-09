const express = require('express');
const axios = require('axios');
const { dohHttpAgent, dohHttpsAgent } = require('../dohResolver');
const router = express.Router();

/**
 * Helper to rewrite M3U8 playlists so relative & absolute child playlists and segments
 * also route through the proxy with identical headers.
 */
function rewriteM3U8Playlist(content, baseUrl, proxyBaseUrl, customHeaders) {
    const headersParam = Object.keys(customHeaders).length > 0
        ? `&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`
        : '';

    return content.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#')) {
            // Rewrite URI="..." attributes in tags like #EXT-X-KEY or #EXT-X-MAP
            return trimmed.replace(/URI="([^"]+)"/g, (match, u) => {
                try {
                    const abs = new URL(u, baseUrl).href;
                    return `URI="${proxyBaseUrl}?url=${encodeURIComponent(abs)}${headersParam}"`;
                } catch (_) {
                    return match;
                }
            });
        }

        // Segment or child playlist line
        try {
            const abs = new URL(trimmed, baseUrl).href;
            return `${proxyBaseUrl}?url=${encodeURIComponent(abs)}${headersParam}`;
        } catch (_) {
            return line;
        }
    }).join('\n');
}

/**
 * Universal Stream Proxy with:
 * 1. HTTP Range (206 Partial Content) support
 * 2. Self-Healing Auto-Failover across mirrors
 * 3. Transparent Referer / Origin / User-Agent header injection
 * 4. M3U8 HLS Playlist Auto-Rewriter for multi-variant and chunk streaming
 * 5. DoH Agent to bypass local ISP DNS blocks
 */
async function handleStreamProxy(req, res) {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing target stream url parameter');
    }

    // CORS headers for all players (Stremio Web, ExoPlayer, Nuvio Web)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Parse fallback mirrors for Self-Healing Stream Failover
    let fallbackUrls = [];
    if (req.query.fallbacks) {
        try {
            if (req.query.fallbacks.startsWith('[')) {
                fallbackUrls = JSON.parse(req.query.fallbacks);
            } else {
                fallbackUrls = req.query.fallbacks.split(',').map(u => decodeURIComponent(u.trim())).filter(Boolean);
            }
        } catch (_) {
            fallbackUrls = [];
        }
    }

    const candidateUrls = [targetUrl, ...fallbackUrls.filter(u => u && u !== targetUrl)];

    let customHeaders = {};
    try {
        if (req.query.headers) {
            customHeaders = JSON.parse(req.query.headers);
        }
    } catch (_) {}

    const clientHeaders = {
        'User-Agent': customHeaders['User-Agent'] || customHeaders['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...customHeaders
    };

    if (customHeaders['user-agent'] || customHeaders['User-Agent']) {
        clientHeaders['User-Agent'] = customHeaders['User-Agent'] || customHeaders['user-agent'];
    }
    if (customHeaders['referer'] || customHeaders['Referer']) {
        clientHeaders['Referer'] = customHeaders['Referer'] || customHeaders['referer'];
    }
    if (customHeaders['origin'] || customHeaders['Origin']) {
        clientHeaders['Origin'] = customHeaders['Origin'] || customHeaders['origin'];
    }

    if (req.headers.range) {
        clientHeaders['Range'] = req.headers.range;
    }

    const isHead = req.method === 'HEAD';
    const isM3U8Url = targetUrl.toLowerCase().includes('.m3u8');

    for (let i = 0; i < candidateUrls.length; i++) {
        const urlToTry = candidateUrls[i];
        try {
            // For HLS playlists (non-HEAD), we buffer text to rewrite child URLs
            const isPlaylistTarget = !isHead && (isM3U8Url || urlToTry.toLowerCase().includes('.m3u8'));
            const isS3Presigned = urlToTry.includes('X-Amz-Signature') || 
                                  urlToTry.includes('X-Amz-Algorithm') || 
                                  urlToTry.includes('cloudflarestorage.com') || 
                                  urlToTry.includes('r2.dev');

            let remoteRes;
            let simulatedHeadViaRange = false;

            if (isHead && isS3Presigned) {
                // S3/R2 presigned URLs reject HEAD with 403 Forbidden because signature method is GET.
                // Simulate HEAD by probing bytes=0-1 with GET so players receive valid headers & file length.
                simulatedHeadViaRange = true;
                remoteRes = await axios({
                    method: 'get',
                    url: urlToTry,
                    headers: { ...clientHeaders, 'Range': 'bytes=0-1' },
                    responseType: 'stream',
                    httpAgent: dohHttpAgent,
                    httpsAgent: dohHttpsAgent,
                    timeout: candidateUrls.length > 1 ? 8000 : 15000,
                    maxRedirects: 5,
                    validateStatus: (status) => status < 400
                });
                if (remoteRes.data && typeof remoteRes.data.destroy === 'function') {
                    remoteRes.data.destroy();
                }
            } else {
                try {
                    remoteRes = await axios({
                        method: isHead ? 'head' : 'get',
                        url: urlToTry,
                        headers: clientHeaders,
                        responseType: isPlaylistTarget ? 'text' : (isHead ? undefined : 'stream'),
                        httpAgent: dohHttpAgent,
                        httpsAgent: dohHttpsAgent,
                        timeout: candidateUrls.length > 1 ? 8000 : 15000,
                        maxRedirects: 5,
                        validateStatus: (status) => status < 400
                    });
                } catch (headErr) {
                    if (isHead && headErr.response && (headErr.response.status === 403 || headErr.response.status === 405 || headErr.response.status === 501)) {
                        // Upstream rejected HEAD -> Fallback to GET Range probe
                        simulatedHeadViaRange = true;
                        remoteRes = await axios({
                            method: 'get',
                            url: urlToTry,
                            headers: { ...clientHeaders, 'Range': 'bytes=0-1' },
                            responseType: 'stream',
                            httpAgent: dohHttpAgent,
                            httpsAgent: dohHttpsAgent,
                            timeout: candidateUrls.length > 1 ? 8000 : 15000,
                            maxRedirects: 5,
                            validateStatus: (status) => status < 400
                        });
                        if (remoteRes.data && typeof remoteRes.data.destroy === 'function') {
                            remoteRes.data.destroy();
                        }
                    } else {
                        throw headErr;
                    }
                }
            }

            if (i > 0) {
                console.log(`[StreamProxy] Auto-healed stream using mirror ${i}/${candidateUrls.length - 1}: ${urlToTry.substring(0, 60)}...`);
            }

            const copyHeaders = [
                'content-type',
                'content-length',
                'content-range',
                'accept-ranges',
                'content-disposition',
                'cache-control'
            ];
            for (const h of copyHeaders) {
                if (remoteRes.headers[h]) {
                    res.setHeader(h, remoteRes.headers[h]);
                }
            }

            if (!res.getHeader('accept-ranges')) {
                res.setHeader('Accept-Ranges', 'bytes');
            }

            // If we simulated HEAD with Range 0-1, calculate and return the actual total content-length
            if (simulatedHeadViaRange) {
                res.status(200);
                const cr = remoteRes.headers['content-range'];
                if (cr && cr.includes('/')) {
                    const total = cr.split('/')[1].trim();
                    if (total && total !== '*' && !isNaN(parseInt(total, 10))) {
                        res.setHeader('Content-Length', total);
                    }
                }
                res.removeHeader('content-range');
            } else {
                res.status(remoteRes.status);
            }

            // Ensure proper video/HLS Content-Type for players (prevent ExoPlayer UnrecognizedInputFormatException)
            const currentCt = (res.getHeader('content-type') || '').toLowerCase();
            const checkUrl = (urlToTry + ' ' + (req.params.filename || '')).toLowerCase();

            if (checkUrl.includes('.m3u8') || (typeof remoteRes.data === 'string' && remoteRes.data.startsWith('#EXTM3U'))) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            } else if (!currentCt || currentCt.includes('octet-stream') || currentCt.includes('text/plain') || currentCt.includes('text/html')) {
                if (checkUrl.includes('.mp4')) {
                    res.setHeader('Content-Type', 'video/mp4');
                } else if (checkUrl.includes('.mkv')) {
                    res.setHeader('Content-Type', 'video/x-matroska');
                } else if (checkUrl.includes('.webm')) {
                    res.setHeader('Content-Type', 'video/webm');
                } else {
                    res.setHeader('Content-Type', 'video/mp4');
                }
            }

            if (isHead) {
                return res.end();
            }

            // Handle HLS Playlist rewriting
            if (typeof remoteRes.data === 'string' && remoteRes.data.startsWith('#EXTM3U')) {
                const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
                const host = req.headers.host;
                const proxyBaseUrl = `${protocol}://${host}${req.baseUrl || '/proxy/stream'}`;
                const rewritten = rewriteM3U8Playlist(remoteRes.data, urlToTry, proxyBaseUrl, customHeaders);
                res.setHeader('Content-Length', Buffer.byteLength(rewritten, 'utf8'));
                return res.send(rewritten);
            }

            // Standard binary stream piping (MP4, MKV, TS segments)
            if (process.env.VERCEL && !customHeaders['Referer'] && !customHeaders['referer'] && !customHeaders['Origin'] && !customHeaders['origin'] && candidateUrls.length === 1) {
                return res.redirect(302, urlToTry);
            }

            if (remoteRes.data && typeof remoteRes.data.pipe === 'function') {
                remoteRes.data.pipe(res);

                req.on('close', () => {
                    if (remoteRes.data && typeof remoteRes.data.destroy === 'function') {
                        remoteRes.data.destroy();
                    }
                });
                return;
            } else {
                return res.send(remoteRes.data);
            }
        } catch (err) {
            console.warn(`[StreamProxy] Mirror attempt ${i + 1}/${candidateUrls.length} failed (${err.message}) for: ${urlToTry.substring(0, 60)}...`);
        }
    }

    // Fallback: Redirect client directly if all candidate mirrors fail
    res.redirect(302, targetUrl);
}

router.options('/', handleStreamProxy);
router.options('/:filename', handleStreamProxy);
router.get('/', handleStreamProxy);
router.head('/', handleStreamProxy);
router.get('/:filename', handleStreamProxy);
router.head('/:filename', handleStreamProxy);

module.exports = router;
