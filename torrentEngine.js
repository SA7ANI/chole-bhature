const torrentStream = require('torrent-stream');
const path = require('path');
const os = require('os');
const fs = require('fs');

const activeEngines = new Map();

function getTorrentEngine(infoHash) {
    if (activeEngines.has(infoHash)) {
        const engineData = activeEngines.get(infoHash);
        engineData.lastAccessed = Date.now();
        return engineData.engine;
    }

    // Initialize new engine
    const engine = torrentStream(`magnet:?xt=urn:btih:${infoHash}`, {
        connections: 100,
        uploads: 10,
        path: path.join(os.tmpdir(), 'nuvio-torrent', infoHash),
        verify: true,
        dht: true,
        tracker: true,
    });

    engine.on('ready', () => {
        console.log(`[TorrentEngine] Engine ready for ${infoHash}`);
        
        // Find largest file (usually the video)
        let largestFile = engine.files[0];
        for (let i = 1; i < engine.files.length; i++) {
            if (engine.files[i].length > largestFile.length) {
                largestFile = engine.files[i];
            }
        }
        
        // Deselect all files first
        engine.files.forEach(file => file.deselect());
        
        // Attach largest file to engine
        engine.videoFile = largestFile;
        engine.isReady = true;
    });
    
    activeEngines.set(infoHash, {
        engine: engine,
        lastAccessed: Date.now()
    });

    return engine;
}

// Cleanup idle engines every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [infoHash, data] of activeEngines.entries()) {
        if (now - data.lastAccessed > 10 * 60 * 1000) { // 10 minutes idle
            console.log(`[TorrentEngine] Cleaning up idle engine ${infoHash}`);
            data.engine.destroy(() => {
                // Remove temporary files
                const tmpPath = path.join(os.tmpdir(), 'nuvio-torrent', infoHash);
                fs.rm(tmpPath, { recursive: true, force: true }, () => {});
            });
            activeEngines.delete(infoHash);
        }
    }
}, 2 * 60 * 1000);

function handleStreamRequest(req, res) {
    const infoHash = req.params.infoHash;
    const engine = getTorrentEngine(infoHash);

    // Wait until engine is ready to get the video file
    if (!engine.isReady) {
        engine.once('ready', () => serveVideo(req, res, engine, infoHash));
    } else {
        serveVideo(req, res, engine, infoHash);
    }
}

function serveVideo(req, res, engine, infoHash) {
    const file = engine.videoFile;
    if (!file) {
        return res.status(404).send('No video file found in torrent');
    }

    // Refresh last accessed
    if (activeEngines.has(infoHash)) {
        activeEngines.get(infoHash).lastAccessed = Date.now();
    }

    const range = req.headers.range;
    if (!range) {
        const head = {
            'Content-Length': file.length,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes'
        };
        res.writeHead(200, head);
        const stream = file.createReadStream();
        stream.pipe(res);
        return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const partialstart = parts[0];
    const partialend = parts[1];

    const start = parseInt(partialstart, 10);
    const end = partialend ? parseInt(partialend, 10) : file.length - 1;
    const chunksize = (end - start) + 1;

    const head = {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
    };
    
    res.writeHead(206, head);
    
    // Select this specific range for priority downloading
    file.select(); // Ensure the file is selected for download
    const stream = file.createReadStream({ start: start, end: end });
    
    req.on('close', () => {
        stream.destroy();
    });
    
    stream.pipe(res);
}

module.exports = {
    handleStreamRequest
};
