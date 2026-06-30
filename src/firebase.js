import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

let db = null;
// Resolves to a boolean once the (anonymous) sign-in settles. NEVER rejects and
// NEVER blocks indefinitely, so it is safe to await before Firestore reads even
// while the rules are still open or anonymous auth is not yet enabled.
let firebaseAuthReady = Promise.resolve(false);

try {
  if (firebaseConfig.projectId) {
    const app = initializeApp(firebaseConfig);

    // App Check (reCAPTCHA v3). Skipped when the site key is unset, so the app
    // keeps working before App Check is configured. Enforcement is toggled in
    // the Firebase console — start in "monitor" mode, switch to "enforce" only
    // after confirming clients send tokens.
    const appCheckKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
    if (appCheckKey) {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(appCheckKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (e) {
        console.warn('[Firebase] App Check init failed:', e.message);
      }
    }

    db = getFirestore(app);

    // Anonymous sign-in so locked Firestore rules (request.auth != null) admit
    // the app once they are enabled. Requires "Anonymous" auth to be turned on
    // in the Firebase console; until then this resolves false and reads still
    // work under the current open rules.
    firebaseAuthReady = signInAnonymously(getAuth(app))
      .then(() => true)
      .catch((e) => {
        console.warn('[Firebase] Anonymous sign-in failed:', e.message);
        return false;
      });
  }
} catch (e) {
  console.warn('[Firebase] Init failed:', e.message);
}

export { db, firebaseAuthReady };
