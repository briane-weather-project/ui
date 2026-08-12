// firebase-config.js — Single source of truth for Firebase configuration
const firebaseConfig = {
     apiKey: "",
     authDomain: "",
     projectId: "",
     storageBucket: "",
     messagingSenderId: "",
     appId: ""
};

// Initialize Firebase (safe to call once per page)
if (!firebase.apps.length) {
     firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
