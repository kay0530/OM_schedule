/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  createGoogleTokenClient,
  revokeGoogleToken,
  loadGoogleConfig,
} from '../services/googleAuthService';

const GoogleAuthContext = createContext(null);

/**
 * Parallel, independent auth surface for Google Calendar (member 瀬戸).
 * Kept entirely separate from AuthContext (MSAL) so the two identities never
 * interleave. Google login is OPTIONAL and never gates app entry — MSAL remains
 * the primary login gate.
 */
export function GoogleAuthProvider({ children }) {
  const [isGoogleAuthenticated, setIsGoogleAuthenticated] = useState(false);
  const [error, setError] = useState(null);

  const tokenClientRef = useRef(null); // GIS token client (created lazily)
  const tokenRef = useRef(null); // { token, expiresAt }
  const pendingRef = useRef(null); // { resolve, reject } for the in-flight request

  // Lazily create the token client bound to a callback that resolves the
  // currently pending getGoogleToken()/googleLogin() promise.
  const ensureClient = useCallback(async () => {
    if (tokenClientRef.current) return tokenClientRef.current;
    const { clientId } = loadGoogleConfig();
    if (!clientId) {
      throw new Error('Google Client ID が未設定です（設定画面で登録してください）');
    }
    const client = await createGoogleTokenClient(clientId, (resp) => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (resp?.error) {
        setIsGoogleAuthenticated(false);
        if (pending) pending.reject(new Error(resp.error));
        return;
      }
      // 60s safety margin before the real expiry.
      tokenRef.current = {
        token: resp.access_token,
        expiresAt: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000,
      };
      setIsGoogleAuthenticated(true);
      if (pending) pending.resolve(resp.access_token);
    });
    tokenClientRef.current = client;
    return client;
  }, []);

  // prompt: 'consent' for the first interactive grant, '' for silent refresh
  // within an active Google session.
  const requestToken = useCallback(
    (prompt) =>
      new Promise((resolve, reject) => {
        ensureClient()
          .then((client) => {
            pendingRef.current = { resolve, reject };
            client.requestAccessToken({ prompt });
          })
          .catch(reject);
      }),
    [ensureClient]
  );

  const googleLogin = useCallback(async () => {
    setError(null);
    try {
      await requestToken('consent');
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [requestToken]);

  const googleLogout = useCallback(async () => {
    const current = tokenRef.current?.token;
    tokenRef.current = null;
    setIsGoogleAuthenticated(false);
    if (current) {
      try {
        await revokeGoogleToken(current);
      } catch {
        // ignore revoke failures
      }
    }
  }, []);

  // Returns a valid access token, silently refreshing if it is near expiry.
  // Throws if not granted / no active Google session (caller shows re-login).
  const getGoogleToken = useCallback(async () => {
    const cached = tokenRef.current;
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
      return cached.token;
    }
    return requestToken('');
  }, [requestToken]);

  const value = {
    isGoogleAuthenticated,
    error,
    googleLogin,
    googleLogout,
    getGoogleToken,
  };

  return <GoogleAuthContext.Provider value={value}>{children}</GoogleAuthContext.Provider>;
}

export function useGoogleAuth() {
  const context = useContext(GoogleAuthContext);
  if (!context) {
    throw new Error('useGoogleAuth must be used within a GoogleAuthProvider');
  }
  return context;
}
