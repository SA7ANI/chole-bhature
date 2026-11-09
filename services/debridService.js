const axios = require('axios');

/**
 * RealDebrid Resolver:
 * Adds magnet, selects files, identifies largest media file, and unrestricts it.
 */
async function resolveRealDebrid(apiKey, hash) {
    // 1. Add Magnet
    const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', `magnet=magnet:?xt=urn:btih:${hash}`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const torrentId = addRes.data.id;

    // 2. Select Files (All)
    await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 'files=all', {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // 3. Get Info and grab the best video download link (largest file)
    const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (infoRes.data && infoRes.data.links && infoRes.data.links.length > 0) {
        let chosenLink = infoRes.data.links[0];
        if (Array.isArray(infoRes.data.files) && infoRes.data.files.length > 0) {
            const selectedFiles = infoRes.data.files.filter(f => f.selected === 1);
            if (selectedFiles.length > 0) {
                let largestFile = selectedFiles[0];
                let largestIndex = 0;
                selectedFiles.forEach((f, idx) => {
                    if ((f.bytes || 0) > (largestFile.bytes || 0)) {
                        largestFile = f;
                        largestIndex = idx;
                    }
                });
                if (infoRes.data.links[largestIndex]) {
                    chosenLink = infoRes.data.links[largestIndex];
                }
            }
        }

        // 4. Unrestrict link
        const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${chosenLink}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (unrestrictRes.data && unrestrictRes.data.download) {
            return unrestrictRes.data.download;
        }
    }
    return null;
}

/**
 * AllDebrid Resolver:
 * Uploads magnet, waits briefly, and unrestricts largest file link.
 */
async function resolveAllDebrid(apiKey, hash) {
    const addRes = await axios.get(`https://api.alldebrid.com/v4/magnet/upload?agent=nuvio&apikey=${apiKey}&magnets[]=magnet:?xt=urn:btih:${hash}`);
    const magnetData = addRes.data?.data?.magnets?.[0];

    if (magnetData && magnetData.id) {
        await new Promise(r => setTimeout(r, 1000));

        const statusRes = await axios.get(`https://api.alldebrid.com/v4/magnet/status?agent=nuvio&apikey=${apiKey}&id=${magnetData.id}`);
        const links = statusRes.data?.data?.magnets?.[0]?.links;

        if (links && links.length > 0) {
            let chosenLink = links[0]?.link;
            if (links.length > 1) {
                const sortedLinks = [...links].sort((a, b) => (b.size || 0) - (a.size || 0));
                chosenLink = sortedLinks[0]?.link || links[0]?.link;
            }
            const unrestrictRes = await axios.get(`https://api.alldebrid.com/v4/link/unlock?agent=nuvio&apikey=${apiKey}&link=${chosenLink}`);
            if (unrestrictRes.data && unrestrictRes.data.data && unrestrictRes.data.data.link) {
                return unrestrictRes.data.data.link;
            }
        }
    }
    return null;
}

/**
 * TorBox Resolver:
 * Creates torrent, polls for cached readiness, and requests download link for largest file.
 */
async function resolveTorbox(apiKey, hash) {
    const addRes = await axios.post('https://api.torbox.app/v1/api/torrents/createtorrent', 
        { magnet: `magnet:?xt=urn:btih:${hash}` },
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );
    const torrentId = addRes.data?.data?.torrent_id;

    if (torrentId) {
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const infoRes = await axios.get(`https://api.torbox.app/v1/api/torrents/mylist?id=${torrentId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const torrent = infoRes.data?.data;
            if (torrent && torrent.download_state === 'cached' && torrent.files && torrent.files.length > 0) {
                const sortedFiles = [...torrent.files].sort((a, b) => (b.size || 0) - (a.size || 0));
                const fileId = sortedFiles[0].id;
                const linkRes = await axios.get(`https://api.torbox.app/v1/api/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${fileId}&zip_link=false`);
                if (linkRes.data?.data) {
                    return linkRes.data.data;
                }
                break;
            }
            if (torrent && torrent.download_state === 'cached') break;
        }
    }
    return null;
}

/**
 * Premiumize Resolver:
 * Creates transfer, polls for completion, and grabs largest file direct link.
 */
async function resolvePremiumize(apiKey, hash) {
    const addRes = await axios.post('https://www.premiumize.me/api/transfer/create',
        new URLSearchParams({ apikey: apiKey, src: `magnet:?xt=urn:btih:${hash}` }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const transferId = addRes.data?.id;

    if (transferId) {
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const listRes = await axios.get(`https://www.premiumize.me/api/transfer/list?apikey=${apiKey}`);
            const transfer = (listRes.data?.transfers || []).find(t => t.id === transferId);
            if (transfer && transfer.status === 'finished' && transfer.folder_id) {
                const folderRes = await axios.get(`https://www.premiumize.me/api/folder/list?apikey=${apiKey}&id=${transfer.folder_id}`);
                const files = (folderRes.data?.content || []).filter(f => f.type === 'file');
                files.sort((a, b) => (b.size || 0) - (a.size || 0));
                if (files.length > 0 && files[0].link) {
                    return files[0].link;
                }
                break;
            }
        }
    }
    return null;
}

/**
 * Dispatches debrid resolution by service name.
 */
async function resolveDebridStream(service, apiKey, hash) {
    const svc = (service || '').toLowerCase();
    switch (svc) {
        case 'realdebrid':
            return await resolveRealDebrid(apiKey, hash);
        case 'alldebrid':
            return await resolveAllDebrid(apiKey, hash);
        case 'torbox':
            return await resolveTorbox(apiKey, hash);
        case 'premiumize':
            return await resolvePremiumize(apiKey, hash);
        default:
            return null;
    }
}

module.exports = {
    resolveDebridStream,
    resolveRealDebrid,
    resolveAllDebrid,
    resolveTorbox,
    resolvePremiumize
};
