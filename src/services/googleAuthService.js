/**
 * Google Identity Services (GIS) token client wrapper.
 *
 * Mirrors the role msalService.js plays for Microsoft Graph, but for Google.
 * Used ONLY for member 瀬戸 (seto_r), whose schedule lives on a personal Google
 * Calendar shared (with edit access) to the operator's Google account. The app
 * reads and writes that calendar with the operator's own access token.
 *
 * The GIS browser token client issues a short-lived (~1h) access token and NO
 * refresh token; silent re-acquisition works only within an active Google
 * session (prompt:''). This is a weaker refresh story than MSAL — callers must
 * tolerate getGoogleToken() failing and surface a re-login affordance.
 */

/** Scope: create/read/update/delete events on calendars the operator can access. */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Default OAuth client. The Web client ID is a PUBLIC identifier (like the Azure
 *  clientId) — fill in after creating the OAuth client in Google Cloud, or set it
 *  per-device in Settings. */
export const DEFAULT_GOOGLE_CONFIG = { clientId: '' };

/** localStorage key for the Google OAuth client ID (mirrors msalService keys). */
export const STORAGE_KEYS = {
  clientId: 'construction-schedule-google-client-id',
};

export function loadGoogleConfig() {
  try {
    return {
      clientId: localStorage.getItem(STORAGE_KEYS.clientId) || DEFAULT_GOOGLE_CONFIG.clientId,
    };
  } catch {
    return { ...DEFAULT_GOOGLE_CONFIG };
  }
}

export function saveGoogleConfig(clientId) {
  try {
    if (clientId) localStorage.setItem(STORAGE_KEYS.clientId, clientId.trim());
    else localStorage.removeItem(STORAGE_KEYS.clientId);
  } catch {
    // ignore
  }
}

export function isGoogleConfigured() {
  return !!loadGoogleConfig().clientId;
}

/**
 * Resolve the GIS oauth2 namespace. The GIS script (added in index.html) loads
 * async, so wait for window.google.accounts.oauth2 to appear.
 * @returns {Promise<object>} window.google.accounts.oauth2
 */
export function loadGisOauth2() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve(window.google.accounts.oauth2);
      return;
    }
    let tries = 0;
    const iv = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(iv);
        resolve(window.google.accounts.oauth2);
      } else if (++tries > 100) {
        clearInterval(iv);
        reject(new Error('Google Identity Services の読み込みに失敗しました'));
      }
    }, 50);
  });
}

/**
 * Create a token client bound to a callback (invoked on each token response).
 * @param {string} clientId - Google OAuth Web client ID
 * @param {(resp: {access_token?: string, expires_in?: number, error?: string}) => void} callback
 * @returns {Promise<object>} GIS token client with requestAccessToken()
 */
export async function createGoogleTokenClient(clientId, callback) {
  const oauth2 = await loadGisOauth2();
  return oauth2.initTokenClient({
    client_id: clientId,
    scope: GOOGLE_SCOPE,
    callback,
  });
}

/**
 * Revoke an access token (GIS has no logoutRedirect equivalent).
 * @param {string} token
 */
export async function revokeGoogleToken(token) {
  if (!token) return;
  const oauth2 = await loadGisOauth2();
  await new Promise((resolve) => oauth2.revoke(token, resolve));
}
