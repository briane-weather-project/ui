// Initialize Lucide Icons
lucide.createIcons();

// Firebase is initialized by firebase-config.js

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

// Initialize ReCAPTCHA (Visible "I'm not a robot" Box)
function initRecaptcha() {
     const container = document.getElementById('recaptcha-container');
     if (container) {
          container.innerHTML = ''; // Wipe DOM to prevent "reCAPTCHA already rendered" error
     }
     if (window.recaptchaVerifier) {
          try { window.recaptchaVerifier.clear(); } catch(e) {}
          window.recaptchaVerifier = null;
     }
     try {
          window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
               'size': 'normal',
               'callback': () => {
                    clearError();
               },
               'expired-callback': () => {
                    showError("reCAPTCHA expired. Please check the box again.");
               }
          });
          window.recaptchaVerifier.render().catch(err => console.error("reCAPTCHA render error:", err));
     } catch (err) {
          console.error("Failed to initialize reCAPTCHA:", err);
     }
}
initRecaptcha();

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

          // 1. Check if Email or Phone Number is already in Firestore (non-blocking if Firestore rules restrict unauthenticated reads)
          try {
               const emailCheck = await db.collection('users').where('email', '==', email).get();
               if (!emailCheck.empty) {
                    showError("This email is already registered.");
                    return;
               }

               const phoneCheck = await db.collection('users').where('phoneNumber', '==', phoneNumber).get();
               if (!phoneCheck.empty) {
                    showError("This phone number is already registered.");
                    return;
               }
          } catch (dbError) {
               console.warn("Pre-registration Firestore check skipped (unauthenticated read restricted):", dbError);
          }

          // Re-initialize reCAPTCHA if it was cleared or expired
          if (!window.recaptchaVerifier) {
               initRecaptcha();
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
               case 'auth/invalid-phone-number': msg = "The phone number is not valid. Make sure to include country code (e.g. +639...)"; break;
               case 'auth/too-many-requests': msg = "Too many attempts. Please try again later."; break;
               case 'auth/captcha-check-failed': msg = "Security check failed. Please refresh the page and try again."; break;
               case 'auth/quota-exceeded': msg = "SMS quota exceeded. Please try again later."; break;
               case 'auth/missing-phone-number': msg = "Please enter a phone number."; break;
               case 'auth/network-request-failed': msg = "Network error. Check your internet connection."; break;
               case 'auth/unauthorized-domain': msg = "Domain not authorized. Please add briane-weather-project.github.io under Firebase Console > Authentication > Settings > Authorized domains."; break;
               case 'auth/operation-not-allowed': msg = "Phone Auth is disabled. Please enable Phone sign-in in Firebase Console > Authentication > Sign-in method."; break;
               case 'auth/internal-error': 
                    msg = error.message ? error.message.replace("Firebase: ", "") : "Firebase Auth internal error. Check Firebase Authorized Domains and Phone Auth configuration."; 
                    break;
               default:
                    msg = error.message ? error.message.replace("Firebase: ", "").split(" (")[0] : "An unexpected error occurred.";
                    if (!msg || msg === "Error" || msg.trim() === "") {
                         msg = "Something went wrong (" + (error.code || "unknown") + "). Please refresh and try again.";
                    }
          }

          showError(msg);
          // Re-initialize reCAPTCHA for the next attempt
          initRecaptcha();
     }
});

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

// Resend Code Logic
const resendCodeBtn = document.getElementById('resend-code-btn');
let resendCooldown = 0;

if (resendCodeBtn) {
     resendCodeBtn.addEventListener('click', async () => {
          if (resendCooldown > 0) return;
          clearError();
          
          const phoneNumber = phoneInput.value.trim();
          if (!phoneNumber) {
               showError("Please enter a valid phone number.");
               return;
          }

          try {
               resendCodeBtn.style.opacity = '0.5';
               resendCodeBtn.style.cursor = 'not-allowed';
               resendCodeBtn.innerText = "Sending...";

               if (!window.recaptchaVerifier) {
                    initRecaptcha();
               }

               const appVerifier = window.recaptchaVerifier;
               confirmationResult = await auth.signInWithPhoneNumber(phoneNumber, appVerifier);
               
               showError("A new verification code has been sent to your phone.", true);

               // 30-second cooldown
               resendCooldown = 30;
               const timer = setInterval(() => {
                    resendCooldown--;
                    if (resendCooldown <= 0) {
                         clearInterval(timer);
                         resendCodeBtn.innerText = "Didn't receive code? Resend";
                         resendCodeBtn.style.opacity = '1';
                         resendCodeBtn.style.cursor = 'pointer';
                    } else {
                         resendCodeBtn.innerText = `Resend available in ${resendCooldown}s`;
                    }
               }, 1000);

          } catch (err) {
               console.error("Resend SMS Error:", err);
               showError(err.message ? err.message.replace("Firebase: ", "") : "Failed to resend verification code.");
               resendCodeBtn.innerText = "Didn't receive code? Resend";
               resendCodeBtn.style.opacity = '1';
               resendCodeBtn.style.cursor = 'pointer';
               initRecaptcha();
          }
     });
}

// Step 2: Final Registration
registerForm.addEventListener('submit', async (e) => {
     e.preventDefault();
     clearError();

     const code = verificationCodeInput.value.trim();
     const email = emailInput.value.trim();
     const password = passwordInput.value.trim();
     const confirmPassword = confirmPasswordInput.value.trim();

     if (!code || code.length < 6) {
          showError("Enter the 6-digit code.");
          return;
     }

     // Re-validate password alignment before linking
     if (password !== confirmPassword) {
          showError("Passwords do not match!");
          return;
     }
     if (password.length < 6) {
          showError("Password must be at least 6 characters.");
          return;
     }

     try {
          registerBtn.classList.add('loading');
          registerBtn.disabled = true;

          // 1. Verify SMS
          if (!confirmationResult) {
               showError("Session expired. Please click Send Verification Code again.");
               return;
          }
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
               default: 
                    msg = error && error.message ? error.message.replace("Firebase: ", "").split(" (")[0] : "An unexpected verification error occurred.";
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

