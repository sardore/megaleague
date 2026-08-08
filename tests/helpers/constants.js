export const EXPECTED_SHA256 = 'fbbdad911cb6c90a95aaedb9cf66820f41dc2a323e90088a3cb5ee4d407b22a8';
export const EXPECTED_SIZE = 7372055;
export const EXPECTED_BUILD = 'CP32-ACTIVE-WRAPPER-CUTOVER-R1-20260805T2220KST';
export const TRUSTED_FILE = 'trusted/CP32_ACTIVE_WRAPPER_CUTOVER_TRUSTED_BASELINE_20260805T2220KST.html';
export const RELAY_ENDPOINT = process.env.CP32_RELAY_ENDPOINT || 'wss://cp32-online-relay.onrender.com/online';
export const PRODUCTION_URL = process.env.CP32_PRODUCTION_URL || 'https://sardore.github.io/megaleague/?relay=wss%3A%2F%2Fcp32-online-relay.onrender.com%2Fonline';
export const CANDIDATE_ORIGIN = process.env.CP32_CANDIDATE_ORIGIN || 'https://127.0.0.1:8443';
export const candidateUrl = (extra = {}) => { const url = new URL('/', CANDIDATE_ORIGIN); url.searchParams.set('relay', RELAY_ENDPOINT); for (const [key,value] of Object.entries(extra)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value)); return url.toString(); };
