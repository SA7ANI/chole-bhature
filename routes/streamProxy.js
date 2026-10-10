const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * Universal Stream Proxy with HTTP Range (206 Partial Content) support
 * Injects required Referer and User-Agent headers so Cloudflare workers and protected CDNs
 * stream seamlessly to Stremio, ExoPlayer, and Nuvio without 403 blocks or loading hangs.
 */
router.get('/', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing target stream url parameter');
    }

    let customHeaders = {};
    try {
        if (req.query.headers) {
            customHeaders = JSON.parse(req.query.headers);
        }
    } catch (_) {}

    const clientHeaders = {
        'User-Agent': customHeaders['User-Agent'] || customHeaders['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...(customHeaders['Referer'] || customHeaders['referer'] ? { 'Referer': customHeaders['Referer'] || customHeaders['referer'] } : {}),
        ...(customHeaders['Origin'] || customHeaders['origin'] ? { 'Origin': customHeaders['Origin'] || customHeaders['origin'] } : {})
    };

    if (req.headers.range) {
        clientHeaders['Range'] = req.headers.range;
    }

    try {
        const remoteRes = await axios({
            method: 'get',
            url: targetUrl,
            headers: clientHeaders,
            responseType: 'stream',
            timeout: 12000,
            maxRedirects: 5,
            validateStatus: (status) => status < 400
        });

        res.status(remoteRes.status);
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
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (process.env.VERCEL && !customHeaders['Referer'] && !customHeaders['referer'] && !customHeaders['Origin'] && !customHeaders['origin']) {
            // Vercel Serverless limits execution time (10s-60s) for unbounded media.
            // Only redirect directly when custom referer/origin headers are NOT required.
            return res.redirect(302, targetUrl);
        }

        remoteRes.data.pipe(res);

        req.on('close', () => {
            if (remoteRes.data && typeof remoteRes.data.destroy === 'function') {
                remoteRes.data.destroy();
            }
        });
    } catch (err) {
        // Fallback: Redirect client directly if proxy stream fails
        res.redirect(302, targetUrl);
    }
});

module.exports = router;
