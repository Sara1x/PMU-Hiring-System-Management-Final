import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDis8HWWS0LylsUdB1eefpTqR9eWNihsJk",
  authDomain: "pmu-hiring-system.firebaseapp.com",
  projectId: "pmu-hiring-system",
  storageBucket: "pmu-hiring-system.firebasestorage.app",
  messagingSenderId: "246772879896",
  appId: "1:246772879896:web:8af611b3f5ea59c02ea96d"
};

const app = initializeApp(firebaseConfig);

export const db        = getFirestore(app);
export const storage   = getStorage(app);
export const functions = getFunctions(app, "us-central1");
export const auth      = getAuth(app);