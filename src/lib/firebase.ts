import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
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

// Initialize Firestore specifying the named database
export const db = getFirestore(app, "ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8");
export const auth = getAuth(app);
export const storage = getStorage(app);
