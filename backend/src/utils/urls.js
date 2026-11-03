/**
 * Public base URLs. OAuth providers redirect the browser back to the BACKEND, so this must be the
 * address the browser can reach (set BACKEND_URL in production). The local fallback follows PORT.
 */
const backendUrl = () => (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:8100').replace(/\/$/, '');

module.exports = { backendUrl, frontendUrl };
