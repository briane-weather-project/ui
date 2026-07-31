// Initialize Lucide Icons
lucide.createIcons();

// Firebase Configuration
const firebaseConfig = {
     apiKey: "AIzaSyCBrJFnwz7zl4NdJHxh__a43E-76HLmvLY",
     authDomain: "weather-project-a5fb5.firebaseapp.com",
     projectId: "weather-project-a5fb5",
     storageBucket: "weather-project-a5fb5.firebasestorage.app",
     messagingSenderId: "321079306454",
     appId: "1:321079306454:web:5b25917f72c2cc90850177"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// UI Elements
const authBtn = document.getElementById('auth-btn');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const errorMsg = document.getElementById('error-msg');

// New Forgot Password Elements
const loginView = document.getElementById('login-view');
const forgotView = document.getElementById('forgot-view');
const forgotLink = document.getElementById('forgot-password-link');
const backToLogin = document.getElementById('back-to-login');
const resetBtn = document.getElementById('reset-btn');
const resetInput = document.getElementById('reset-id');

function showError(message, isSuccess = false) {
     if (!errorMsg) return;
     errorMsg.innerText = message;
     errorMsg.style.display = 'flex';
     errorMsg.style.backgroundColor = isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
     errorMsg.style.color = isSuccess ? '#10b981' : '#ef4444';
     errorMsg.style.borderColor = isSuccess ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
}

function clearError() {
     if (!errorMsg) return;
     errorMsg.innerText = '';
     errorMsg.style.display = 'none';
}

// Toggle Views
forgotLink.addEventListener('click', (e) => {
     e.preventDefault();
     clearError();
     loginView.style.display = 'none';
     forgotView.style.display = 'block';
});

backToLogin.addEventListener('click', (e) => {
     e.preventDefault();
     clearError();
     loginView.style.display = 'block';
     forgotView.style.display = 'none';
});

// Reset Password Logic
resetBtn.addEventListener('click', async () => {
     clearError();
     const id = resetInput.value.trim();

     if (!id) {
          showError("Please enter your email or phone number.");
          return;
     }

     try {
          resetBtn.classList.add('loading');
          resetBtn.disabled = true;

          let targetEmail = "";

          // Identify and check database
          if (id.startsWith('+')) {
               // Check by Phone Number
               const phoneSnap = await db.collection('users').where('phoneNumber', '==', id).get();
               if (phoneSnap.empty) {
                    throw new Error("No account found with this phone number.");
               }
               targetEmail = phoneSnap.docs[0].data().email;
          } else if (id.includes('@')) {
               // Check by Email
               const emailSnap = await db.collection('users').where('email', '==', id).get();
               if (emailSnap.empty) {
                    throw new Error("No account found with this email address.");
               }
               targetEmail = id;
          } else {
               throw new Error("Please enter a valid email or phone number (+63...).");
          }

          await auth.sendPasswordResetEmail(targetEmail);

          showError(`Password reset link sent to ${targetEmail}. Please check your inbox and spam folder.`, true);
          resetInput.value = '';

          // Auto back to login after 3 seconds
          setTimeout(() => {
               loginView.style.display = 'block';
               forgotView.style.display = 'none';
               clearError();
          }, 8000);

     } catch (error) {
          console.error("Reset Error:", error);
          let msg = "Failed to send reset link.";
          if (error.code === 'auth/user-not-found') msg = "No account found with this email.";
          else if (error.message.includes("phone number")) msg = error.message;

          showError(msg);
     } finally {
          resetBtn.classList.remove('loading');
          resetBtn.disabled = false;
     }
});

// Auth Logic with Rapid-Click Protection
authBtn.addEventListener('click', async () => {
     clearError();
     const email = emailInput.value.trim();
     const password = passwordInput.value.trim();

     if (!email || !password) {
          showError("Please enter both email and password.");
          return;
     }

     try {
          // Start Loading State
          authBtn.classList.add('loading');
          authBtn.disabled = true;

          const userCredential = await auth.signInWithEmailAndPassword(email, password);
          const user = userCredential.user;

          // Check if disabled in Firestore
          const userDoc = await db.collection('users').doc(user.uid).get();
          if (userDoc.exists && userDoc.data().disabled === true) {
               await auth.signOut();
               showError("This account has been disabled by an administrator.");
               authBtn.classList.remove('loading');
               authBtn.disabled = false;
               return;
          }

          // Success redirect
          window.location.href = "dashboard/index.html";

     } catch (error) {
          console.error("Login failed:", error);

          let msg = "Something went wrong. Please try again.";

          switch (error.code) {
               case 'auth/user-not-found':
               case 'auth/wrong-password':
               case 'auth/invalid-credential':
                    msg = "Incorrect email or password.";
                    break;
               case 'auth/invalid-email':
                    msg = "The email address is not valid.";
                    break;
               case 'auth/too-many-requests':
                    msg = "Too many failed attempts. Try again later.";
                    break;
               case 'auth/user-disabled':
                    msg = "This account has been disabled.";
                    break;
               case 'auth/network-request-failed':
                    msg = "Network error. Check your connection.";
                    break;
               default:
                    // If it's a generic "Error" message, use a better fallback
                    msg = error.message.replace("Firebase: ", "").split(" (")[0];
                    if (msg === "Error" || !msg) msg = "Login failed. Please check your credentials.";
          }

          showError(msg);

          // Reset State on Error
          authBtn.classList.remove('loading');
          authBtn.disabled = false;
     }
});

// Auto-redirect if already logged in
auth.onAuthStateChanged(user => {
     if (user) {
          window.location.href = "dashboard/index.html";
     }
});

// --- Real-time Weather Background Sync ---
let alertThresholdVal = 50.0;
let currentRainRateVal = 0.0;
let currentWaterVal = -1.0;
let currentCloudCoverVal = 0.0;
let currentLightVal = -1.0;

function syncWeatherBackground() {
     // Safety timeout to hide splash screen if data takes too long
     setTimeout(() => {
          const splash = document.getElementById('splash-screen');
          if (splash) {
               splash.style.opacity = '0';
               setTimeout(() => splash.remove(), 500);
          }
     }, 5000);

     // 1. Get Threshold
     db.collection('weather').doc('config').onSnapshot(doc => {
          if (doc.exists) {
               alertThresholdVal = parseFloat(doc.data().alertThreshold) || 50.0;
               updateWeatherBackground();
          }
     });

     // 2. Get Current Rain & Water Level & Cloud Cover
     db.collection('weather').doc('current').onSnapshot(doc => {
          if (doc.exists) {
               const data = doc.data();
               const light = data.lightLevel !== undefined ? parseFloat(data.lightLevel) : -1.0;
               let cc = data.cloudCover !== undefined ? parseFloat(data.cloudCover) : 0.0;
               if ((data.cloudCover === undefined || cc === 0) && light >= 0) {
                    cc = (1.0 - Math.min(1.0, light / 65000.0)) * 100.0;
               }
               currentRainRateVal = data.rainRate !== undefined ? parseFloat(data.rainRate) : 0.0;
               currentWaterVal = data.waterLevel !== undefined ? parseFloat(data.waterLevel) : -1.0;
               currentLightVal = light;
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
          if (hour >= 19 || hour < 5) {
               weatherType = 'night';
          } else if (currentLightVal >= 0 && currentLightVal < 6000) {
               weatherType = 'cloudy'; // Strictly when light level is under 6000 lux during daytime
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

