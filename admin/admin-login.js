// Initialize Lucide Icons
lucide.createIcons();

// Firebase is initialized by firebase-config.js

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

let adminFailedAttempts = 0;

async function handleAdminLogin() {
     clearError();

     if (adminFailedAttempts >= 5) {
          showError("Access locked due to repeated failed attempts. Please wait 30 seconds.");
          return;
     }

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
               adminFailedAttempts = 0;
               window.location.href = "dashboard.html";
          } else {
               await auth.signOut();
               throw new Error("Unauthorized: This account does not have administrator privileges.");
          }
     } catch (error) {
          adminFailedAttempts++;
          // Log the attempt safely to Firestore
          try {
               await db.collection('logs').add({
                    type: "Auth",
                    message: "Failed admin login attempt for " + (email || "unknown") + ": " + (error.message || "Unknown error"),
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
               });
          } catch (e) { console.error("Log error:", e); }

          let msg = "Authorization failed.";

          if (error.message && error.message.includes("privileges")) {
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
                         msg = error.message ? error.message.replace("Firebase: ", "").split(" (")[0] : "Authorization failed.";
                         if (msg === "Error" || !msg) msg = "Authorization failed. Check your credentials.";
               }
          }

          showError(msg);

          if (adminFailedAttempts >= 5) {
               loginBtn.disabled = true;
               setTimeout(() => {
                    adminFailedAttempts = 0;
                    loginBtn.disabled = false;
                    loginBtn.classList.remove('loading');
                    clearError();
               }, 30000);
          } else {
               loginBtn.disabled = false;
               loginBtn.classList.remove('loading');
          }
     }
}

const adminForm = document.getElementById('admin-login-form');
if (adminForm) {
     adminForm.addEventListener('submit', (e) => {
          e.preventDefault();
          handleAdminLogin();
     });
}
loginBtn.addEventListener('click', handleAdminLogin);

// Password Visibility Toggle Listener
document.querySelectorAll('.toggle-password').forEach(button => {
     button.addEventListener('click', () => {
          const targetId = button.getAttribute('data-target');
          const input = document.getElementById(targetId);
          if (!input) return;
          const isPassword = input.getAttribute('type') === 'password';
          input.setAttribute('type', isPassword ? 'text' : 'password');
          button.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}" style="width: 18px; height: 18px;"></i>`;
          lucide.createIcons();
     });
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

     const handleConfig = (data) => {
          if (data && data.alertThreshold) {
               alertThresholdVal = parseFloat(data.alertThreshold) || 50.0;
          }
          updateWeatherBackground();
     };

     const handleCurrent = (data) => {
          if (data) {
               const light = data.lightLevel !== undefined ? parseFloat(data.lightLevel) : (data.light !== undefined ? parseFloat(data.light) : -1.0);
               let cc = data.cloudCover !== undefined ? parseFloat(data.cloudCover) : 0.0;
               if ((data.cloudCover === undefined || cc === 0) && light >= 0) {
                    cc = (1.0 - Math.min(1.0, light / 65000.0)) * 100.0;
               }
               currentRainRateVal = data.rainRate !== undefined ? parseFloat(data.rainRate) : 0.0;
               currentWaterVal = data.waterLevel !== undefined ? parseFloat(data.waterLevel) : -1.0;
               currentLightVal = light;
               currentCloudCoverVal = cc;
          }
          updateWeatherBackground();
     };

     // 1. Get Config with Dual RTDB / Firestore sync
     let configFromRtdb = false;
     if (typeof rtdb !== 'undefined' && rtdb) {
          rtdb.ref('weather/config').on('value', snap => {
               if (snap.val()) {
                    configFromRtdb = true;
                    handleConfig(snap.val());
               } else if (!configFromRtdb) {
                    db.collection('weather').doc('config').get().then(doc => doc.exists && handleConfig(doc.data())).catch(() => {});
               }
          }, () => {
               db.collection('weather').doc('config').onSnapshot(doc => doc.exists && handleConfig(doc.data()));
          });
     } else {
          db.collection('weather').doc('config').onSnapshot(doc => doc.exists && handleConfig(doc.data()));
     }

     // 2. Get Current Rain & Water Level & Cloud Cover with Dual RTDB / Firestore sync
     let currentFromRtdb = false;
     if (typeof rtdb !== 'undefined' && rtdb) {
          rtdb.ref('weather/current').on('value', snap => {
               if (snap.val()) {
                    currentFromRtdb = true;
                    handleCurrent(snap.val());
               } else if (!currentFromRtdb) {
                    db.collection('weather').doc('current').onSnapshot(doc => {
                         if (doc.exists) handleCurrent(doc.data());
                         else updateWeatherBackground();
                    });
               }
          }, () => {
               db.collection('weather').doc('current').onSnapshot(doc => {
                    if (doc.exists) handleCurrent(doc.data());
                    else updateWeatherBackground();
               });
          });
     } else {
          db.collection('weather').doc('current').onSnapshot(doc => {
               if (doc.exists) handleCurrent(doc.data());
               else updateWeatherBackground();
          });
     }
}

function updateWeatherBackground() {
     let weatherType = "sunny";

     if (currentRainRateVal >= 50.0) {
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

// Register PWA Service Worker on Admin Login Page
if ('serviceWorker' in navigator) {
     window.addEventListener('load', () => {
          navigator.serviceWorker.register('../service-worker.js')
               .then(reg => console.log('[PWA Admin Login] Service Worker registered:', reg.scope))
               .catch(err => console.warn('[PWA Admin Login] Service Worker registration note:', err));
     });
}


