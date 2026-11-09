const express = require('express');
const router = express.Router();
const { resolveDebridStream } = require('../services/debridService');

/**
 * GET /debrid/:service/:apiKey/:hash
 * Resolves cached or cloud-transferred debrid torrent streams and redirects to playable stream URL.
 */
router.get('/:service/:apiKey/:hash', async (req, res) => {
    const { service, apiKey, hash } = req.params;

    try {
        const streamUrl = await resolveDebridStream(service, apiKey, hash);
        if (streamUrl) {
            return res.redirect(302, streamUrl);
        }
    } catch (err) {
        console.error('[Debrid Route Error]', err.response?.data || err.message);
    }

    // Fallback: If debrid fails, return error response
    return res.status(500).send('Debrid resolution failed.');
});

module.exports = router;
