const axios = require('axios');
axios.get('https://hubcloud.ist/drive/bj2u5ss6yu51xzs')
    .then(res => {
        const isDead = res.data.includes('File Deleted') || res.data.includes('File Not Found') || res.data.includes('deleted') || res.data.includes('error');
        console.log('GET status:', res.status);
        console.log('Is dead?', isDead);
        console.log('Data length:', res.data.length);
        console.log('Snippets:', res.data.substring(0, 100));
    })
    .catch(err => console.log('GET error:', err.message));
