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
        } catch(e) { console.error("Log error:", e); }

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
let currentRainfallVal = 0.0;

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
            currentRainfallVal = parseFloat(doc.data().rainfall) || 0.0;
            updateWeatherBackground();
        } else {
            updateWeatherBackground();
        }
    });
}

function updateWeatherBackground() {
    let weatherType = "sunny";
    const dangerThreshold = alertThresholdVal;
    const warningThreshold = alertThresholdVal * 0.5;

    if (currentRainfallVal >= dangerThreshold) {
        weatherType = "stormy";
    } else if (currentRainfallVal >= warningThreshold) {
        weatherType = "rainy";
    } else if (currentRainfallVal > 0) {
        weatherType = "cloudy";
    } else {
        const hour = new Date().getHours();
        weatherType = (hour >= 19 || hour < 5) ? 'night' : 'sunny';
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

