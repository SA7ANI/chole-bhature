const axios = require('axios');
axios.head('https://hubcloud.ist/drive/bj2u5ss6yu51xzs')
    .then(res => console.log('HEAD status:', res.status))
    .catch(err => console.log('HEAD error:', err.response ? err.response.status : err.message));
