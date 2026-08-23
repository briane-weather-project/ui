// Initialize Lucide Icons
lucide.createIcons();

// Firebase is initialized by firebase-config.js

// UI Elements
const registerForm = document.getElementById('register-form');
const accountSection = document.getElementById('account-info-section');
const verifyEmailSection = document.getElementById('verify-email-section');
const sendVerificationBtn = document.getElementById('send-verification-btn');
const confirmVerifiedBtn = document.getElementById('confirm-verified-btn');
const registerTitle = document.getElementById('register-title');
const registerDesc = document.getElementById('register-desc');
const errorMsg = document.getElementById('error-msg');
const verifyEmailSentTo = document.getElementById('verify-email-sent-to');

const emailInput = document.getElementById('reg-email');
const passwordInput = document.getElementById('reg-password');
const confirmPasswordInput = document.getElementById('confirm-password');

let registeredUser = null; // Holds the Firebase user object after account creation

// ─── Helpers ────────────────────────────────────────────────────────────────

function showError(message, isSuccess = false) {
    if (!errorMsg) return;
    errorMsg.innerText = message;
    errorMsg.style.display = 'flex';
    errorMsg.style.backgroundColor = isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    errorMsg.style.color = isSuccess ? '#10b981' : '#ef4444';
    errorMsg.style.borderColor = isSuccess ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
    // Reset button loading states
    if (sendVerificationBtn) { sendVerificationBtn.classList.remove('loading'); sendVerificationBtn.disabled = false; }
    if (confirmVerifiedBtn) { confirmVerifiedBtn.classList.remove('loading'); confirmVerifiedBtn.disabled = false; }
}

function clearError() {
    if (!errorMsg) return;
    errorMsg.innerText = '';
    errorMsg.style.display = 'none';
}

// ─── Step 1: Create Account & Send Email Verification ────────────────────────

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();

    // Validations
    if (!email || !password) {
        showError('Please fill in all fields.');
        return;
    }
    if (password !== confirmPassword) {
        showError('Passwords do not match!');
        return;
    }
    if (password.length < 6) {
        showError('Password must be at least 6 characters.');
        return;
    }

    try {
        sendVerificationBtn.classList.add('loading');
        sendVerificationBtn.disabled = true;

        // 1. Check if email is already in Firestore (best-effort, may fail if rules restrict)
        try {
            const emailCheck = await db.collection('users').where('email', '==', email).get();
            if (!emailCheck.empty) {
                showError('This email is already registered.');
                return;
            }
        } catch (dbError) {
            console.warn('Pre-registration Firestore check skipped:', dbError);
        }

        // 2. Create Firebase Auth account
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        registeredUser = userCredential.user;

        // 3. Send verification email
        await registeredUser.sendEmailVerification();

        // 4. Create Firestore profile (marked unverified until confirmed)
        await db.collection('users').doc(registeredUser.uid).set({
            email: email,
            role: 'user',
            isVerified: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 5. Sign out immediately — user must verify email before logging in
        await auth.signOut();

        // 6. Transition UI to step 2
        registerTitle.innerText = 'Verify your email';
        registerDesc.innerText = 'One last step — check your inbox.';
        if (verifyEmailSentTo) {
            verifyEmailSentTo.innerText = `We sent a verification link to ${email}`;
        }
        accountSection.style.display = 'none';
        verifyEmailSection.style.display = 'block';
        sendVerificationBtn.style.display = 'none';
        confirmVerifiedBtn.style.display = 'block';
        lucide.createIcons();

    } catch (error) {
        console.error('Registration Error:', error);
        let msg = 'Registration failed. Please try again.';

        switch (error.code) {
            case 'auth/email-already-in-use': msg = 'This email is already registered. Try logging in instead.'; break;
            case 'auth/invalid-email': msg = 'The email address is not valid.'; break;
            case 'auth/weak-password': msg = 'The password is too weak. Use at least 6 characters.'; break;
            case 'auth/network-request-failed': msg = 'Network error. Please check your internet connection.'; break;
            case 'auth/too-many-requests': msg = 'Too many attempts. Please wait a moment and try again.'; break;
            default:
                msg = error.message ? error.message.replace('Firebase: ', '').split(' (')[0] : 'An unexpected error occurred.';
        }

        showError(msg);
    }
});

// ─── Step 2: Confirm Email Was Verified ─────────────────────────────────────

confirmVerifiedBtn.addEventListener('click', async () => {
    clearError();

    try {
        confirmVerifiedBtn.classList.add('loading');
        confirmVerifiedBtn.disabled = true;

        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (!email || !password) {
            showError('Session lost. Please go back and register again.');
            confirmVerifiedBtn.classList.remove('loading');
            confirmVerifiedBtn.disabled = false;
            return;
        }

        // Re-sign in to get a fresh token and check emailVerified
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        await userCredential.user.reload(); // Ensure fresh data

        if (!userCredential.user.emailVerified) {
            await auth.signOut();
            showError('Your email has not been verified yet. Please click the link in the email we sent you. Don\'t forget to check your Spam or Junk folder!');
            confirmVerifiedBtn.classList.remove('loading');
            confirmVerifiedBtn.disabled = false;
            return;
        }

        // Update Firestore profile to verified
        await db.collection('users').doc(userCredential.user.uid).update({
            isVerified: true
        });

        // Redirect to dashboard
        window.location.href = '../dashboard/index.html';

    } catch (error) {
        console.error('Verification Confirm Error:', error);
        let msg = 'Could not confirm verification.';

        switch (error.code) {
            case 'auth/wrong-password':
            case 'auth/invalid-credential': msg = 'Incorrect password. Please try again.'; break;
            case 'auth/user-not-found': msg = 'Account not found. Please register again.'; break;
            case 'auth/too-many-requests': msg = 'Too many attempts. Please wait and try again.'; break;
            case 'auth/network-request-failed': msg = 'Network error. Please check your connection.'; break;
            default:
                msg = error.message ? error.message.replace('Firebase: ', '').split(' (')[0] : 'An unexpected error occurred.';
        }

        showError(msg);
    }
});

// ─── Resend Verification Email ───────────────────────────────────────────────

const resendEmailBtn = document.getElementById('resend-email-btn');
let resendCooldown = 0;

if (resendEmailBtn) {
    resendEmailBtn.addEventListener('click', async () => {
        if (resendCooldown > 0) return;
        clearError();

        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (!email || !password) {
            showError('Cannot resend — session information is missing. Please register again.');
            return;
        }

        try {
            resendEmailBtn.style.opacity = '0.5';
            resendEmailBtn.style.cursor = 'not-allowed';
            resendEmailBtn.innerText = 'Sending...';

            // Sign in temporarily to send verification
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            await userCredential.user.sendEmailVerification();
            await auth.signOut();

            showError('Verification email re-sent! Check your inbox and Spam/Junk folder.', true);

            // 60-second cooldown
            resendCooldown = 60;
            const timer = setInterval(() => {
                resendCooldown--;
                if (resendCooldown <= 0) {
                    clearInterval(timer);
                    resendEmailBtn.innerText = "Didn't receive it? Resend Email";
                    resendEmailBtn.style.opacity = '1';
                    resendEmailBtn.style.cursor = 'pointer';
                } else {
                    resendEmailBtn.innerText = `Resend available in ${resendCooldown}s`;
                }
            }, 1000);

        } catch (err) {
            console.error('Resend Email Error:', err);
            showError(err.message ? err.message.replace('Firebase: ', '') : 'Failed to resend verification email.');
            resendEmailBtn.innerText = "Didn't receive it? Resend Email";
            resendEmailBtn.style.opacity = '1';
            resendEmailBtn.style.cursor = 'pointer';
        }
    });
}

// ─── Password Visibility Toggle ─────────────────────────────────────────────

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

// ─── Real-time Weather Background Sync ──────────────────────────────────────

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
    let weatherType = 'sunny';

    if (currentRainRateVal >= 50.0) {
        weatherType = 'stormy';
    } else if (currentRainRateVal > 0.0) {
        weatherType = 'rainy';
    } else {
        const hour = new Date().getHours();
        const isDaytime = hour >= 5 && hour < 18;

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

    // Hide splash screen
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
