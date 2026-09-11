// Vercel serverless entry point. Keeping this wrapper under /api makes the
// deployment target unambiguous while the Express application stays shared
// with Render and local Node deployments.
module.exports = require('../index');
