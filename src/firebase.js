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

// reCAPTCHA v3 site key for App Check — a PUBLIC identifier (safe in the bundle,
// like the Firebase config itself). App Check attests that requests come from
// this app/domain; it does nothing until enforcement is turned on per-product in
// the Firebase console (start in "monitor" to verify before enforcing).
const APPCHECK_SITE_KEY = '6Lc0oT4tAAAAAPIGV3j4_9LO9RlReW-A_ZVZQqkQ';

let db = null;

// Resolves once the anonymous Firebase session is established, so Firestore
// reads/writes carry `request.auth` (required once the locked rules are live).
// When Firebase is unconfigured (local/localStorage mode) it resolves to null.
let firebaseAuthReady = Promise.resolve(null);

try {
  if (firebaseConfig.projectId) {
    const app = initializeApp(firebaseConfig);

    // App Check must be initialized before Firestore calls start.
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn('[Firebase] App Check init failed:', e.message);
    }

    db = getFirestore(app);

    firebaseAuthReady = signInAnonymously(getAuth(app))
      .then((cred) => cred.user)
      .catch((e) => {
        console.warn('[Firebase] Anonymous sign-in failed:', e.message);
        return null;
      });
  }
} catch (e) {
  console.warn('[Firebase] Init failed:', e.message);
}

export { db, firebaseAuthReady };
