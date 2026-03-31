import { PublicClientApplication } from '@azure/msal-browser';

/** Default scopes for Microsoft Graph calendar access */
export const DEFAULT_SCOPES = ['Calendars.ReadWrite', 'Calendars.ReadWrite.Shared', 'User.Read'];

/** Default Azure AD app registration for Construction Schedule */
export const DEFAULT_AZURE_CONFIG = {
  clientId: '85420e2f-eb38-4a8e-931f-4be552f953b0',
  tenantId: '61b80e23-6dd9-4dc6-b355-d7f210b12ef5',
};

/** localStorage keys for Azure AD config */
export const STORAGE_KEYS = {
  clientId: 'construction-schedule-azure-client-id',
  tenantId: 'construction-schedule-azure-tenant-id',
};

/**
 * Create an MSAL PublicClientApplication instance.
 * @param {string} clientId - Azure AD application (client) ID
 * @param {string} tenantId - Azure AD tenant (directory) ID
 * @param {string} [redirectUri] - Redirect URI (defaults to current page origin + pathname)
 * @returns {PublicClientApplication}
 */
export function createMsalInstance(clientId, tenantId, redirectUri) {
  const config = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: redirectUri || window.location.origin + window.location.pathname,
    },
    cache: {
      cacheLocation: 'localStorage',
      storeAuthStateInCookie: false,
    },
  };

  return new PublicClientApplication(config);
}

/**
 * Login via redirect (navigates away from the app, then returns).
 * @param {PublicClientApplication} msalInstance
 * @param {string[]} [scopes] - Scopes to request
 */
export function login(msalInstance, scopes = DEFAULT_SCOPES) {
  return msalInstance.loginRedirect({
    scopes,
    prompt: 'select_account',
  });
}

/**
 * Handle redirect response after returning from login.
 * @param {PublicClientApplication} msalInstance
 * @returns {Promise<import('@azure/msal-browser').AuthenticationResult|null>}
 */
export function handleRedirectResponse(msalInstance) {
  return msalInstance.handleRedirectPromise();
}

/**
 * Logout via redirect.
 * @param {PublicClientApplication} msalInstance
 * @param {import('@azure/msal-browser').AccountInfo} [account]
 */
export function logout(msalInstance, account) {
  return msalInstance.logoutRedirect({
    account: account || msalInstance.getActiveAccount(),
  });
}

/**
 * Silently acquire an access token, falling back to popup if needed.
 * @param {PublicClientApplication} msalInstance
 * @param {import('@azure/msal-browser').AccountInfo} account
 * @param {string[]} [scopes] - Scopes to request
 * @returns {Promise<string>} Access token
 */
export async function getAccessToken(msalInstance, account, scopes = DEFAULT_SCOPES) {
  try {
    const response = await msalInstance.acquireTokenSilent({ scopes, account });
    return response.accessToken;
  } catch {
    // Silent acquisition failed — fall back to redirect
    await msalInstance.acquireTokenRedirect({ scopes, account });
    return null;
  }
}

/**
 * Read Azure AD config from localStorage.
 * @returns {{ clientId: string|null, tenantId: string|null }}
 */
export function loadAzureConfig() {
  return {
    clientId: localStorage.getItem(STORAGE_KEYS.clientId) || DEFAULT_AZURE_CONFIG.clientId,
    tenantId: localStorage.getItem(STORAGE_KEYS.tenantId) || DEFAULT_AZURE_CONFIG.tenantId,
  };
}

/**
 * Save Azure AD config to localStorage.
 * @param {string} clientId
 * @param {string} tenantId
 */
export function saveAzureConfig(clientId, tenantId) {
  localStorage.setItem(STORAGE_KEYS.clientId, clientId);
  localStorage.setItem(STORAGE_KEYS.tenantId, tenantId);
}
