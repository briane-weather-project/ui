// firebase-config.js — Single source of truth for Firebase configuration
const firebaseConfig = {
     apiKey: "AIzaSyCBrJFnwz7zl4NdJHxh__a43E-76HLmvLY",
     authDomain: "weather-project-a5fb5.firebaseapp.com",
     databaseURL: "https://weather-project-a5fb5-default-rtdb.firebaseio.com",
     projectId: "weather-project-a5fb5",
     storageBucket: "weather-project-a5fb5.firebasestorage.app",
     messagingSenderId: "321079306454",
     appId: "1:321079306454:web:5b25917f72c2cc90850177"
};

// Initialize Firebase (safe to call once per page)
if (!firebase.apps.length) {
     firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebase.database();
