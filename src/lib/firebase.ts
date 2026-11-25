import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBYsL02Skr7gEfTM4rnImR8JVUtXCFEsZM",
  authDomain: "gen-lang-client-0006222540.firebaseapp.com",
  projectId: "gen-lang-client-0006222540",
  storageBucket: "gen-lang-client-0006222540.firebasestorage.app",
  messagingSenderId: "1093488651129",
  appId: "1:1093488651129:web:f09bce253a4ad2190d5da8"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const BASE_DE_DATOS = "ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8";

// Caché en el navegador (25/11/2026): al recargar la página, la base solo manda lo que ha cambiado desde la última vez,
// en vez de toda la flota y todos los documentos otra vez (la base tiene un tope diario de lecturas gratis y el 25/11 se
// agotó). Además, sin conexión se sigue viendo lo último que se cargó. Vale con varias pestañas abiertas.
let db: Firestore;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }, BASE_DE_DATOS);
} catch {
  db = getFirestore(app, BASE_DE_DATOS);   // ya estaba creada (recarga en caliente al programar)
}
export { db };
export const auth = getAuth(app);
export const storage = getStorage(app);
