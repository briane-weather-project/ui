// Initialize Lucide Icons
lucide.createIcons();

// Firebase Config
const firebaseConfig = {
     apiKey: "AIzaSyCBrJFnwz7zl4NdJHxh__a43E-76HLmvLY",
     authDomain: "weather-project-a5fb5.firebaseapp.com",
     projectId: "weather-project-a5fb5",
     storageBucket: "weather-project-a5fb5.firebasestorage.app",
     messagingSenderId: "321079306454",
     appId: "1:321079306454:web:5b25917f72c2cc90850177"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const loginBtn = document.getElementById('admin-login-btn');
const errorMsg = document.getElementById('error-msg');

function showError(message) {
     if (!errorMsg) return;
     errorMsg.innerText = message;
     errorMsg.style.display = 'flex';
}

function clearError() {
     if (!errorMsg) return;
     errorMsg.innerText = '';
     errorMsg.style.display = 'none';
}

loginBtn.addEventListener('click', async () => {
     clearError();
     const email = document.getElementById('admin-email').value.trim();
     const password = document.getElementById('admin-password').value.trim();

     if (!email || !password) {
          showError("Please enter both email and password.");
          return;
     }

     try {
          loginBtn.disabled = true;
          loginBtn.classList.add('loading');

          const userCredential = await auth.signInWithEmailAndPassword(email, password);
          const user = userCredential.user;

          const userDoc = await db.collection('users').doc(user.uid).get();

          if (userDoc.exists && userDoc.data().role === 'admin') {
               window.location.href = "dashboard.html";
          } else {
               await auth.signOut();
               throw new Error("Unauthorized: This account does not have administrator privileges.");
          }
     } catch (error) {
          // Log the error to Firestore
          try {
               await db.collection('logs').add({
                    type: "Auth",
                    message: "Failed admin login attempt: " + email + " (" + error.message + ")",
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
               });
          } catch (e) { console.error("Log error:", e); }

          let msg = "Authorization failed.";

          if (error.message.includes("privileges")) {
               msg = "This account does not have admin privileges.";
          } else {
               switch (error.code) {
                    case 'auth/user-not-found':
                    case 'auth/wrong-password':
                    case 'auth/invalid-credential':
                         msg = "Incorrect admin credentials.";
                         break;
                    case 'auth/invalid-email':
                         msg = "Please enter a valid email.";
                         break;
                    case 'auth/too-many-requests':
                         msg = "Access locked due to many attempts. Try again later.";
                         break;
                    case 'auth/user-disabled':
                         msg = "This admin account has been disabled.";
                         break;
                    case 'auth/network-request-failed':
                         msg = "Network error. Please check your connection.";
                         break;
                    default:
                         msg = error.message.replace("Firebase: ", "").split(" (")[0];
                         if (msg === "Error" || !msg) msg = "Authorization failed. Check your credentials.";
               }
          }

          showError(msg);

          loginBtn.disabled = false;
          loginBtn.classList.remove('loading');
     }
});

// --- Real-time Weather Background Sync ---
let alertThresholdVal = 50.0;
let currentRainRateVal = 0.0;
let currentWaterVal = -1.0;
let currentCloudCoverVal = 0.0;
let currentLightVal = -1.0;

function syncWeatherBackground() {
     // Safety timeout
     setTimeout(() => {
          const splash = document.getElementById('splash-screen');
          if (splash) {
               splash.style.opacity = '0';
               setTimeout(() => splash.remove(), 500);
          }
     }, 5000);

     db.collection('weather').doc('config').onSnapshot(doc => {
          if (doc.exists) {
               alertThresholdVal = parseFloat(doc.data().alertThreshold) || 50.0;
               updateWeatherBackground();
          }
     });

     db.collection('weather').doc('current').onSnapshot(doc => {
          if (doc.exists) {
               const data = doc.data();
               const light = data.lightLevel !== undefined ? parseFloat(data.lightLevel) : -1.0;
               currentRainRateVal = data.rainRate !== undefined ? parseFloat(data.rainRate) : 0.0;
               currentWaterVal = data.waterLevel !== undefined ? parseFloat(data.waterLevel) : -1.0;
               currentLightVal = light;
               let cc = data.cloudCover !== undefined ? parseFloat(data.cloudCover) : 0.0;
               if ((data.cloudCover === undefined || cc === 0) && light >= 0) {
                    cc = (1.0 - Math.min(1.0, light / 65000.0)) * 100.0;
               }
               currentCloudCoverVal = cc;
               updateWeatherBackground();
          } else {
               updateWeatherBackground();
          }
     });
}

function updateWeatherBackground() {
     let weatherType = "sunny";

     if (currentWaterVal >= 20.0 || currentRainRateVal >= 15.0) {
          weatherType = "stormy";
     } else if (currentRainRateVal > 0.0) {
          weatherType = "rainy";
     } else {
          const hour = new Date().getHours();
          const isDaytime = hour >= 5 && hour < 18; // 5:00 AM to 6:00 PM

          if (hour >= 18 || hour < 5) {
               weatherType = 'night';
          } else if (isDaytime && currentLightVal >= 0 && currentLightVal < 6000) {
               weatherType = 'cloudy';
          } else {
               weatherType = 'sunny';
          }
     }

     if (typeof setWeatherBackground === 'function') {
          setWeatherBackground(weatherType);
     }

     // Hide splash screen after background is determined
     const splash = document.getElementById('splash-screen');
     if (splash) {
          splash.style.opacity = '0';
          setTimeout(() => splash.remove(), 500);
     }
}

// Initialize weather background
syncWeatherBackground();
if (typeof updateBackgroundByTime === 'function') {
     updateBackgroundByTime();
}

