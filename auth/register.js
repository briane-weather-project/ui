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

// UI Elements
const registerForm = document.getElementById('register-form');
const accountSection = document.getElementById('account-info-section');
const otpSection = document.getElementById('otp-section');
const sendCodeBtn = document.getElementById('send-code-btn');
const registerBtn = document.getElementById('register-btn');
const registerTitle = document.getElementById('register-title');
const registerDesc = document.getElementById('register-desc');
const errorMsg = document.getElementById('error-msg');

const emailInput = document.getElementById('reg-email');
const phoneInput = document.getElementById('reg-phone');
const passwordInput = document.getElementById('reg-password');
const confirmPasswordInput = document.getElementById('confirm-password');
const verificationCodeInput = document.getElementById('verification-code');

let confirmationResult = null;

function showError(message) {
     if (!errorMsg) return;
     errorMsg.innerText = message;
     errorMsg.style.display = 'flex';
     // Reset loading states
     sendCodeBtn.classList.remove('loading');
     sendCodeBtn.disabled = false;
     registerBtn.classList.remove('loading');
     registerBtn.disabled = false;
}

function clearError() {
     if (!errorMsg) return;
     errorMsg.innerText = '';
     errorMsg.style.display = 'none';
}

// Initialize ReCAPTCHA (Invisible)
window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
     'size': 'invisible'
});

// Step 1: Send Verification Code
sendCodeBtn.addEventListener('click', async () => {
     clearError();
     const email = emailInput.value.trim();
     const phoneNumber = phoneInput.value.trim();
     const password = passwordInput.value.trim();
     const confirmPassword = confirmPasswordInput.value.trim();

     // Basic Validations
     if (!email || !password || !phoneNumber) {
          showError("Please fill in all fields.");
          return;
     }
     if (!phoneNumber.startsWith('+')) {
          showError("Include country code (e.g. +63)");
          return;
     }
     if (password !== confirmPassword) {
          showError("Passwords do not match!");
          return;
     }
     if (password.length < 6) {
          showError("Password must be at least 6 characters.");
          return;
     }

     try {
          sendCodeBtn.classList.add('loading');
          sendCodeBtn.disabled = true;

          // 1. Check if Email is already in Firestore
          const emailCheck = await db.collection('users').where('email', '==', email).get();
          if (!emailCheck.empty) {
               showError("This email is already registered.");
               return;
          }

          // 2. Check if Phone Number is already in Firestore
          const phoneCheck = await db.collection('users').where('phoneNumber', '==', phoneNumber).get();
          if (!phoneCheck.empty) {
               showError("This phone number is already registered.");
               return;
          }

          const appVerifier = window.recaptchaVerifier;
          confirmationResult = await auth.signInWithPhoneNumber(phoneNumber, appVerifier);

          // UI Transition
          registerTitle.innerText = "Check your messages";
          registerDesc.innerText = `We sent a code to ${phoneNumber}`;
          accountSection.style.display = 'none';
          otpSection.style.display = 'block';
          sendCodeBtn.style.display = 'none';
          registerBtn.style.display = 'block';

     } catch (error) {
          console.error("SMS Error:", error);
          let msg = "Failed to send code.";

          switch (error.code) {
               case 'auth/invalid-phone-number': msg = "The phone number is not valid."; break;
               case 'auth/too-many-requests': msg = "Too many requests. Try again later."; break;
               default: msg = error.message.replace("Firebase: ", "").split(" (")[0];
          }

          if (msg === "Error") msg = "Check your phone number and try again.";
          showError(msg);
          if (window.grecaptcha) grecaptcha.reset();
     }
});

// Step 2: Final Registration
registerForm.addEventListener('submit', async (e) => {
     e.preventDefault();
     clearError();

     const code = verificationCodeInput.value.trim();
     const email = emailInput.value.trim();
     const password = passwordInput.value.trim();

     if (!code || code.length < 6) {
          showError("Enter the 6-digit code.");
          return;
     }

     try {
          registerBtn.classList.add('loading');
          registerBtn.disabled = true;

          // 1. Verify SMS
          const result = await confirmationResult.confirm(code);
          const user = result.user;

          // 2. Link Email/Password
          const credential = firebase.auth.EmailAuthProvider.credential(email, password);
          try {
               await user.linkWithCredential(credential);
          } catch (linkError) {
               if (linkError.code === 'auth/email-already-in-use') {
                    showError("This email is already registered.");
                    return;
               }
               throw linkError;
          }

          // 3. Create Firestore Profile
          await db.collection('users').doc(user.uid).set({
               email: email,
               phoneNumber: phoneInput.value.trim(),
               role: 'user',
               isVerified: true,
               createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });

          window.location.href = "../dashboard/index.html";

     } catch (error) {
          console.error("Verification Error:", error);
          let msg = "Verification failed.";

          switch (error.code) {
               case 'auth/invalid-verification-code': msg = "The code is incorrect."; break;
               case 'auth/code-expired': msg = "The code has expired."; break;
               case 'auth/weak-password': msg = "The password is too weak."; break;
               default: msg = error.message.replace("Firebase: ", "").split(" (")[0];
          }

          showError(msg);
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
          if (hour >= 19 || hour < 5) {
               weatherType = 'night';
          } else if ((currentLightVal >= 0 && currentLightVal < 6000) || currentCloudCoverVal >= 50.0) {
               weatherType = 'cloudy'; // Low light or high cloud cover during daytime = overcast sky
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

