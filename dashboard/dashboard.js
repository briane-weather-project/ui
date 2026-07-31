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
const rainfallValue = document.getElementById('rainfall-value');
const rainRateValue = document.getElementById('rain-rate-value');
const rainIntensityBadge = document.getElementById('rain-intensity-badge');
const maxRainfall = document.getElementById('max-rainfall');
const alertBadge = document.getElementById('alert-badge');
const userEmailDisplay = document.getElementById('user-display-email');
const lastUpdate = document.getElementById('last-update');
const riskLevelText = document.getElementById('risk-level-text');
const locationNameDisplay = document.getElementById('location-name-display');
const mapLinkSidebar = document.getElementById('map-link-sidebar');
const mapLinkMobile = document.getElementById('map-link-mobile');
const mapLinkBtn = document.getElementById('map-link-btn');
const systemStatusText = document.getElementById('system-status-text');
const systemStatusDot = document.getElementById('system-status-dot');
const systemStatusTextDesktop = document.getElementById('system-status-text-desktop');
const systemStatusDotDesktop = document.getElementById('system-status-dot-desktop');

const tempEl = document.getElementById('temp-value');
const humidityEl = document.getElementById('humidity-value');
const pressureEl = document.getElementById('pressure-value');
const pressureTrendBadge = document.getElementById('pressure-trend-badge');
const lightEl = document.getElementById('light-value');
const cloudCoverEl = document.getElementById('cloud-cover-value');
const waterLevelEl = document.getElementById('water-level-value');
const waterRiseRateEl = document.getElementById('water-rise-rate-value');
const dewPointEl = document.getElementById('dew-point-value');
const heatIndexEl = document.getElementById('heat-index-value');

const adminMessageDisplay = document.getElementById('admin-message-display');
const liveDateText = document.getElementById('live-date-text');

// Live Date & Time Clock
function updateLiveDateTime() {
    if (!liveDateText) return;
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-US', options);
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    liveDateText.textContent = `${dateStr} • ${timeStr}`;
}
updateLiveDateTime();
setInterval(updateLiveDateTime, 1000);

// Navigation Logic
const navLinks = document.querySelectorAll('.nav-item[data-section], .bottom-nav-item[data-section]');
const sections = document.querySelectorAll('.dashboard-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = link.getAttribute('data-section');

        // Update Active Nav States
        navLinks.forEach(l => l.classList.remove('active'));
        document.querySelectorAll(`[data-section="${sectionId}"]`).forEach(l => l.classList.add('active'));

        // Switch View
        sections.forEach(s => s.classList.remove('active'));
        document.getElementById(`section-${sectionId}`).classList.add('active');

        // Fix for Chart.js layout bugs: force resize when section becomes visible
        if (sectionId === 'forecast') {
            triggerForecastLoad();
            loadWeeklyData();
        }

        setTimeout(() => {
            const allCharts = [
                chartRain, chartAtmo,
                detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart,
                detailedWaterChart, detailedLightChart,
                hourlyPrecipChart, weeklyRainChart
            ];
            allCharts.forEach(c => {
                if (c) {
                    c.resize();
                    c.update();
                }
            });
        }, 400);

        // Refresh icons for new view
        lucide.createIcons();
    });
});

// Date/Time label helper for clean graph tooltips & x-axis ticks
function formatDateTimeLabel(date) {
    if (!date || isNaN(date.getTime())) date = new Date();
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateStr}, ${timeStr}`;
}

// Charts Logic
const ctxRain = document.getElementById('mainRainfallChart').getContext('2d');
const chartRain = new Chart(ctxRain, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Rainfall (mm)',
            data: [],
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 8,
            pointHitRadius: 14,
            pointBackgroundColor: '#6366f1',
            borderWidth: 3
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'nearest',
            intersect: false
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                enabled: true,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#ffffff',
                padding: 10,
                cornerRadius: 8
            }
        },
        scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Plus Jakarta Sans', weight: '600' } } },
            x: {
                grid: { display: false },
                ticks: {
                    maxTicksLimit: 6,
                    maxRotation: 0,
                    autoSkip: true,
                    font: { family: 'Plus Jakarta Sans', weight: '600' }
                }
            }
        }
    }
});

const ctxAtmo = document.getElementById('atmosphericChart').getContext('2d');
const chartAtmo = new Chart(ctxAtmo, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Temp (°C)',
                data: [],
                borderColor: '#f97316',
                tension: 0.4,
                yAxisID: 'y',
                pointRadius: 3,
                pointHoverRadius: 7,
                pointHitRadius: 12
            },
            {
                label: 'Hum (%)',
                data: [],
                borderColor: '#06b6d4',
                tension: 0.4,
                yAxisID: 'y1',
                pointRadius: 3,
                pointHoverRadius: 7,
                pointHitRadius: 12
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'nearest',
            intersect: false
        },
        plugins: {
            legend: { position: 'top', labels: { font: { family: 'Plus Jakarta Sans', weight: '700' } } },
            tooltip: {
                enabled: true,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#ffffff',
                padding: 10,
                cornerRadius: 8
            }
        },
        scales: {
            y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Temp' } },
            y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Hum' } },
            x: {
                grid: { display: false },
                ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true }
            }
        }
    }
});

// Detailed Charts Initialization
const createDetailedChart = (id, label, color, bgColor) => {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: label,
                data: [],
                borderColor: color,
                backgroundColor: bgColor,
                fill: true,
                tension: 0.3,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 7,
                pointHitRadius: 12,
                pointBackgroundColor: color
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 0,
            interaction: {
                mode: 'nearest',
                intersect: false
            },
            plugins: {
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#cbd5e1',
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: true
                }
            },
            scales: {
                y: { grid: { color: 'rgba(0,0,0,0.05)' } },
                x: {
                    grid: { display: false },
                    ticks: {
                        maxTicksLimit: 6,
                        maxRotation: 0,
                        autoSkip: true
                    }
                }
            }
        }
    });
};

const detailedTempChart = createDetailedChart('detailedTempChart', 'Temperature (°C)', '#f97316', 'rgba(249, 115, 22, 0.05)');
const detailedHumChart = createDetailedChart('detailedHumChart', 'Humidity (%)', '#06b6d4', 'rgba(6, 182, 212, 0.05)');
const detailedPresChart = createDetailedChart('detailedPresChart', 'Pressure (hPa)', '#a855f7', 'rgba(168, 85, 247, 0.05)');
const detailedRainChart = createDetailedChart('detailedRainChart', 'Rainfall (mm)', '#6366f1', 'rgba(99, 102, 241, 0.05)');
const detailedWaterChart = createDetailedChart('detailedWaterChart', 'Water Level (cm)', '#0d9488', 'rgba(13, 148, 136, 0.05)');
const detailedLightChart = createDetailedChart('detailedLightChart', 'Light Intensity (lux)', '#eab308', 'rgba(234, 179, 8, 0.05)');

let hourlyPrecipChart = null;
let weeklyRainChart = null;
let currentLatitude = 0.0;
let currentLongitude = 0.0;
let loadedForecastLatitude = null;
let loadedForecastLongitude = null;

let lastFetchedLocationNameLat = null;
let lastFetchedLocationNameLng = null;

async function updateLocationName(lat, lng) {
    if (lat === 0 || lng === 0) return;
    if (lastFetchedLocationNameLat === lat && lastFetchedLocationNameLng === lng) return;

    try {
        if (locationNameDisplay) locationNameDisplay.innerText = 'Resolving location...';
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`, {
            headers: { 'User-Agent': 'ULAN-User-Dashboard/1.0' }
        });
        const data = await response.json();

        let placeName = 'Unknown Location';
        if (data && data.address) {
            const addr = data.address;
            const place = addr.city || addr.town || addr.village || addr.county || addr.state || 'Unknown Location';
            const country = addr.country || '';
            placeName = country ? `${place}, ${country}` : place;
        } else if (data && data.display_name) {
            placeName = data.display_name.split(',')[0];
        }

        if (locationNameDisplay) locationNameDisplay.innerText = placeName;
        lastFetchedLocationNameLat = lat;
        lastFetchedLocationNameLng = lng;
    } catch (e) {
        console.error("Error fetching location name:", e);
        if (locationNameDisplay) locationNameDisplay.innerText = 'Location lookup failed';
    }
}

function triggerForecastLoad() {
    if (currentLatitude !== 0.0 && currentLongitude !== 0.0) {
        loadOpenMeteoForecast(currentLatitude, currentLongitude);
    } else {
        // Fallback to Manila coordinates if GPS is not yet loaded
        loadOpenMeteoForecast(14.5995, 120.9842);
    }
}

async function loadWeeklyData() {
    const canvas = document.getElementById('weeklyRainChart');
    const ctx = canvas ? canvas.getContext('2d') : null;

    // Fetch data for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    try {
        const snapshot = await db.collection('weather_history')
            .where('timestamp', '>=', sevenDaysAgo)
            .orderBy('timestamp', 'asc')
            .get();

        const dailyTotals = {};
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const labels = [];
        const data = [];

        let totalTempSum = 0;
        let tempCount = 0;

        // Initialize last 7 days with 0
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dayName = days[d.getDay()];
            dailyTotals[dayName] = 0;
            labels.push(dayName);
        }

        snapshot.forEach(doc => {
            const entry = doc.data();
            const date = entry.timestamp ? (entry.timestamp.toDate ? entry.timestamp.toDate() : new Date(entry.timestamp)) : new Date();
            const dayName = days[date.getDay()];

            if (dailyTotals.hasOwnProperty(dayName)) {
                dailyTotals[dayName] = Math.max(dailyTotals[dayName], parseFloat(entry.rainfall) || 0);
            }

            // Track temperature for weekly average
            const t = parseFloat(entry.temperature);
            if (!isNaN(t) && t !== 0) {
                totalTempSum += t;
                tempCount++;
            }
        });

        labels.forEach(label => data.push(dailyTotals[label]));

        if (ctx) {
            if (weeklyRainChart) {
                weeklyRainChart.data.labels = labels;
                weeklyRainChart.data.datasets[0].data = data;
                weeklyRainChart.update();
            } else {
                weeklyRainChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Daily Rainfall (mm)',
                            data: data,
                            backgroundColor: 'rgba(99, 102, 241, 0.5)',
                            borderColor: '#6366f1',
                            borderWidth: 2,
                            borderRadius: 8
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                            x: { grid: { display: false } }
                        }
                    }
                });
            }
        }

        // Update Summary Stats
        const totalRain = data.reduce((a, b) => a + b, 0);
        const peakRain = Math.max(...data, 0);
        const rainDays = data.filter(d => d > 0.1).length;
        const avgTemp = tempCount > 0 ? (totalTempSum / tempCount) : 0;

        if (document.getElementById('weekly-total-rain')) document.getElementById('weekly-total-rain').innerText = totalRain.toFixed(1) + " mm";
        if (document.getElementById('weekly-peak-rain')) document.getElementById('weekly-peak-rain').innerText = peakRain.toFixed(1) + " mm";
        if (document.getElementById('weekly-rain-days')) document.getElementById('weekly-rain-days').innerText = rainDays;
        if (document.getElementById('weekly-avg-temp')) document.getElementById('weekly-avg-temp').innerText = avgTemp > 0 ? avgTemp.toFixed(1) + " °C" : "-- °C";

    } catch (error) {
        console.error("Error loading weekly data:", error);
    }
}

async function loadOpenMeteoForecast(lat, lng) {
    // Don't re-fetch if we already have data for this approximate location
    if (loadedForecastLatitude === lat.toFixed(3) && loadedForecastLongitude === lng.toFixed(3)) return;

    loadedForecastLatitude = lat.toFixed(3);
    loadedForecastLongitude = lng.toFixed(3);
    const container = document.getElementById('forecast-days-container');
    const locLabel = document.getElementById('forecast-location-label');

    // Start weather and geo requests in parallel for maximum speed
    const weatherPromise = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weathercode&hourly=temperature_2m,precipitation,precipitation_probability,weathercode,is_day&timezone=auto`);

    const geoPromise = fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`, {
        headers: { 'User-Agent': 'ULAN-User-Dashboard/1.0' }
    }).catch(e => null);

    // Handle Geo Lookup whenever it finishes
    geoPromise.then(res => res ? res.json() : null).then(geoData => {
        if (locLabel && geoData) {
            let placeName = 'Unknown Location';
            if (geoData.address) {
                const addr = geoData.address;
                placeName = `Location: ${addr.city || addr.town || addr.village || addr.county || 'Unknown'}`;
            }
            locLabel.innerText = placeName;
        }
    }).catch(e => console.error("Geo lookup failed:", e));

    try {
        const res = await weatherPromise;
        const data = await res.json();

        if (!data || !data.daily) throw new Error("Invalid API response");

        if (container) {
            container.innerHTML = '';
        }

        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const weatherIcons = {
            0: 'sun', // Clear sky
            1: 'cloudy', 2: 'cloudy', 3: 'cloudy', // Mainly clear, partly cloudy, and overcast
            45: 'cloud', 48: 'cloud', // Fog and depositing rime fog
            51: 'cloud-drizzle', 53: 'cloud-drizzle', 55: 'cloud-drizzle', // Drizzle
            61: 'cloud-rain', 63: 'cloud-rain', 65: 'cloud-rain', // Rain
            71: 'snowflake', 73: 'snowflake', 75: 'snowflake', // Snow
            80: 'cloud-rain', 81: 'cloud-rain', 82: 'cloud-rain', // Rain showers
            95: 'cloud-lightning', 96: 'cloud-lightning', 99: 'cloud-lightning' // Thunderstorm
        };

        let maxRainProb = 0;
        let maxRainDay = '';
        let totalTemps = 0;
        let dailyCount = data.daily.time.length;

        for (let i = 0; i < dailyCount; i++) {
            const date = new Date(data.daily.time[i]);
            const dayName = days[date.getDay()];
            const maxTemp = data.daily.temperature_2m_max[i];
            const minTemp = data.daily.temperature_2m_min[i];
            const rainProb = data.daily.precipitation_probability_max[i];
            const code = data.daily.weathercode[i];
            const iconName = weatherIcons[code] || 'cloud';

            totalTemps += (maxTemp + minTemp) / 2;

            if (rainProb > maxRainProb) {
                maxRainProb = rainProb;
                maxRainDay = dayName;
            }

            const card = document.createElement('div');
            card.className = 'forecast-day-card';
            card.innerHTML = `
                <div class="forecast-day-name">${dayName.substring(0, 3)}</div>
                <div class="forecast-day-icon"><i data-lucide="${iconName}"></i></div>
                <div class="forecast-day-temps">
                    <span class="max">${maxTemp.toFixed(0)}°</span>
                    <span class="min">${minTemp.toFixed(0)}°</span>
                </div>
                <div class="forecast-day-rain">
                    <i data-lucide="droplet" style="width:12px;height:12px;color:#3b82f6;"></i>
                    <span>${rainProb}%</span>
                </div>
            `;
            if (container) {
                container.appendChild(card);
            }
        }

        // Update summaries
        const avgTemp = totalTemps / dailyCount;
        if (document.getElementById('forecast-risk-day')) {
            document.getElementById('forecast-risk-day').innerText = maxRainProb > 30 ? `${maxRainDay} (${maxRainProb}%)` : 'Low Risk';
        }
        if (document.getElementById('forecast-avg-temp')) {
            document.getElementById('forecast-avg-temp').innerText = `${avgTemp.toFixed(1)} °C`;
        }

        // Render weekly precipitation chart
        renderWeeklyForecastChart(data.daily);

        lucide.createIcons();
    } catch (err) {
        console.error("Open-Meteo API load failed: ", err);
        if (container) {
            container.innerHTML = `<div class="forecast-error">Failed to load weather forecast: ${err.message}</div>`;
        }
    }
}

function renderWeeklyForecastChart(dailyData) {
    const canvas = document.getElementById('hourlyPrecipChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = [];
    const probData = [];
    const precipData = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 0; i < dailyData.time.length; i++) {
        const date = new Date(dailyData.time[i]);
        labels.push(days[date.getDay()]);
        probData.push(dailyData.precipitation_probability_max[i]);
        precipData.push(dailyData.precipitation_sum ? dailyData.precipitation_sum[i] : 0);
    }

    if (hourlyPrecipChart) {
        hourlyPrecipChart.data.labels = labels;
        hourlyPrecipChart.data.datasets[0].data = probData;
        hourlyPrecipChart.data.datasets[1].data = precipData;
        hourlyPrecipChart.update();
    } else {
        hourlyPrecipChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Rain Prob (%)',
                        data: probData,
                        backgroundColor: 'rgba(59, 130, 246, 0.5)',
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Expected (mm)',
                        data: precipData,
                        type: 'line',
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.05)',
                        fill: true,
                        tension: 0.4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        title: { display: true, text: 'Prob (%)', font: { size: 10 } }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'Amount (mm)', font: { size: 10 } }
                    },
                    x: { grid: { display: false } }
                },
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } }
                }
            }
        });
    }
}

// Helper to safely parse any Firestore timestamp format (native, serialized JSON, string, etc.)
function parseFirestoreTimestamp(timestamp) {
    if (!timestamp) return new Date();
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
    if (timestamp.seconds !== undefined) return new Date(timestamp.seconds * 1000);
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? new Date() : date;
}

async function populateHourlyTempTimeline() {
    const container = document.getElementById('hourly-temp-timeline');
    if (!container) return;

    console.log("Timeline: Starting update...");

    try {
        // ── PART 1: Fetch Future forecast ──
        console.log("Timeline: Fetching forecast...");

        const lat = currentLatitude || 14.5995;
        const lng = currentLongitude || 120.9842;
        const forecastRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weathercode,is_day&timezone=auto&forecast_hours=24`
        ).catch(err => {
            console.error("Timeline: Open-Meteo fetch error:", err);
            return null;
        });

        const forecastData = forecastRes ? await forecastRes.json() : null;

        console.log("Timeline: Processing forecast data...");

        // Process future entries
        const futureEntries = [];
        const weatherCodeIcons = {
            0: { day: 'sun', night: 'moon' },
            1: { day: 'cloudy', night: 'cloud-moon' },
            2: { day: 'cloudy', night: 'cloud-moon' },
            3: { day: 'cloudy', night: 'cloud-moon' },
            45: { day: 'cloud', night: 'cloud' },
            48: { day: 'cloud', night: 'cloud' },
            51: { day: 'cloud-drizzle', night: 'cloud-drizzle' },
            53: { day: 'cloud-drizzle', night: 'cloud-drizzle' },
            55: { day: 'cloud-drizzle', night: 'cloud-drizzle' },
            61: { day: 'cloud-rain', night: 'cloud-rain' },
            63: { day: 'cloud-rain', night: 'cloud-rain' },
            65: { day: 'cloud-rain', night: 'cloud-rain' },
            80: { day: 'cloud-rain', night: 'cloud-rain' },
            81: { day: 'cloud-rain', night: 'cloud-rain' },
            82: { day: 'cloud-rain', night: 'cloud-rain' },
            95: { day: 'cloud-lightning', night: 'cloud-lightning' },
            96: { day: 'cloud-lightning', night: 'cloud-lightning' },
            99: { day: 'cloud-lightning', night: 'cloud-lightning' }
        };

        if (forecastData && forecastData.hourly) {
            const now = new Date();
            for (let i = 0; i < forecastData.hourly.time.length; i++) {
                const forecastTime = new Date(forecastData.hourly.time[i]);
                if (forecastTime > now) {
                    futureEntries.push({
                        time: forecastTime,
                        temp: forecastData.hourly.temperature_2m[i],
                        weatherCode: forecastData.hourly.weathercode ? forecastData.hourly.weathercode[i] : 0,
                        isDay: forecastData.hourly.is_day ? forecastData.hourly.is_day[i] === 1 : true,
                        isPredicted: true
                    });
                    if (futureEntries.length >= 12) break;
                }
            }
        }
        console.log(`Timeline: Processed ${futureEntries.length} future predicted entries`);

        // ── BUILD THE TIMELINE ──
        container.innerHTML = '';

        // "Now" card - strictly rely on the current sensor value displayed in the UI
        const tempElText = document.getElementById('temp-value')?.innerText;
        const currentTempParsed = parseFloat(tempElText);
        const currentTempDisplay = isNaN(currentTempParsed) ? "--" : Math.round(currentTempParsed);

        let currentIcon = 'sun';
        const lightText = document.getElementById('light-value')?.innerText;
        const lightVal = parseFloat(lightText) || 0;
        if (lightVal >= 0 && lightVal < 10) currentIcon = 'moon';
        else {
            const hour = new Date().getHours();
            if (hour >= 19 || hour < 5) currentIcon = 'moon';
        }

        const nowCard = document.createElement('div');
        nowCard.className = 'hourly-item is-now';
        nowCard.id = 'timeline-now-card';
        nowCard.innerHTML = `
            <span class="hourly-time" style="color: #6366f1; font-weight: 800; display: inline-flex; align-items: center; gap: 6px;"><span class="timeline-pulse-dot"></span>Now</span>
            <div class="hourly-icon"><i data-lucide="${currentIcon}"></i></div>
            <span class="hourly-temp">${currentTempDisplay}°</span>
        `;
        container.appendChild(nowCard);

        // Render future predicted entries
        futureEntries.forEach(entry => {
            const label = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let iconName = 'sun';
            const iconConfig = weatherCodeIcons[entry.weatherCode];
            if (iconConfig) {
                iconName = entry.isDay ? iconConfig.day : iconConfig.night;
            }

            const card = document.createElement('div');
            card.className = 'hourly-item hourly-predicted';
            card.innerHTML = `
                <span class="hourly-time">${label}</span>
                <div class="hourly-icon"><i data-lucide="${iconName}"></i></div>
                <span class="hourly-temp">${Math.round(entry.temp)}°</span>
            `;
            container.appendChild(card);
        });

        lucide.createIcons();

        // Auto-scroll to "Now" card (first one)
        const nowEl = document.getElementById('timeline-now-card');
        if (nowEl) {
            container.scrollLeft = 0;
        }

        console.log("Timeline: Successfully loaded and updated UI");
    } catch (err) {
        console.error("Error loading hourly timeline:", err);
        container.innerHTML = '<div class="forecast-loading"><span>Failed to load timeline</span></div>';
    }
}

// Modern fix for container-based resizing
const resizeObserver = new ResizeObserver(() => {
    const allCharts = [
        chartRain, chartAtmo,
        detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart,
        detailedWaterChart, detailedLightChart,
        hourlyPrecipChart, weeklyRainChart
    ];
    allCharts.forEach(c => {
        if (c && c.canvas && c.canvas.offsetParent !== null) { // Only resize if visible
            c.resize();
        }
    });
});

// Observe the main content area for any size changes
const scrollArea = document.querySelector('.scroll-area');
if (scrollArea) resizeObserver.observe(scrollArea);

// Fallback for window resize
window.addEventListener('resize', () => {
    const allCharts = [
        chartRain, chartAtmo,
        detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart,
        detailedWaterChart, detailedLightChart,
        hourlyPrecipChart, weeklyRainChart
    ];
    allCharts.forEach(c => {
        if (c) c.resize();
    });
});

// Check Auth State
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists && userDoc.data().disabled === true) {
                await auth.signOut();
                window.location.href = "../index.html";
                return;
            }
        } catch (e) { console.error("Auth check failed:", e); }

        userEmailDisplay.innerText = user.email.split('@')[0].toUpperCase() + "'S DASHBOARD";
        startRealtimeUpdates();
        fetchAdminConfig();
        triggerForecastLoad();
        loadWeeklyData();
        populateHourlyTempTimeline(); // Render timeline immediately on startup
        if (typeof updateBackgroundByTime === 'function') updateBackgroundByTime();
    } else {
        window.location.href = "../index.html";
    }
});

let historyInitialized = false;
let lastProcessedTime = null;

function startRealtimeUpdates() {
    // 0. Initialize History once on load
    if (!historyInitialized) {
        historyInitialized = true;
        initializeChartHistory();
    }

    // Safety timeout
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => splash.remove(), 500);
        }
    }, 5000);

    db.collection('weather').doc('current').onSnapshot(doc => {
        if (!doc.exists) {
            updateStatusUI("No Data", "#94a3b8", false);
            populateHourlyTempTimeline(); // Make sure timeline is loaded/updated even if current doc doesn't exist
            if (typeof updateBackgroundByTime === 'function') updateBackgroundByTime();
        } else {
            const data = doc.data();
            const rain = parseFloat(data.rainfall) || 0.0;
            const lat = parseFloat(data.lat) || 0.0;
            const lng = parseFloat(data.lng) || 0.0;
            const temp = parseFloat(data.temperature) || 0.0;
            const hum = parseFloat(data.humidity) || 0.0;
            const pres = parseFloat(data.pressure) || 0.0;
            const light = data.lightLevel !== undefined ? parseFloat(data.lightLevel) : (data.light !== undefined ? parseFloat(data.light) : -1.0);
            const water = data.waterLevel !== undefined ? parseFloat(data.waterLevel) : -1.0;
            const dewPoint = data.dewPoint !== undefined ? parseFloat(data.dewPoint) : 0.0;
            const heatIndex = data.heatIndex !== undefined ? parseFloat(data.heatIndex) : 0.0;
            const rainRate = data.rainRate !== undefined ? parseFloat(data.rainRate) : 0.0;
            const rainIntensity = data.rainIntensity || 'None';
            let cloudCover = data.cloudCover !== undefined ? parseFloat(data.cloudCover) : 0.0;
            if ((data.cloudCover === undefined || cloudCover === 0) && light >= 0) {
                const ratio = Math.min(1.0, light / maxClearSkyLux);
                cloudCover = (1.0 - ratio) * 100.0;
            }
            const pressureTrend = data.pressureTrend !== undefined ? parseFloat(data.pressureTrend) : 0.0;
            const waterRiseRate = data.waterRiseRate !== undefined ? parseFloat(data.waterRiseRate) : 0.0;

            currentLatitude = lat;
            currentLongitude = lng;

            if (rainfallValue) rainfallValue.innerText = rain.toFixed(2);
            if (rainRateValue) rainRateValue.innerText = rainRate.toFixed(1);
            if (rainIntensityBadge) {
                rainIntensityBadge.innerText = rainIntensity;
                rainIntensityBadge.className = `risk-badge ${getRainIntensityClass(rainIntensity)}`;
            }

            updateLocationName(lat, lng);

            if (tempEl) tempEl.innerText = !isNaN(temp) ? temp.toFixed(1) : "--.-";
            if (humidityEl) humidityEl.innerText = hum !== 0 ? hum.toFixed(0) : "--";
            if (pressureEl) pressureEl.innerText = pres !== 0 ? pres.toFixed(1) : "----";

            if (pressureTrendBadge) {
                const trendStr = pressureTrend > 0.5 ? 'Rising' : (pressureTrend < -0.5 ? 'Falling' : 'Stable');
                pressureTrendBadge.innerText = `${trendStr} (${pressureTrend > 0 ? '+' : ''}${pressureTrend.toFixed(1)} hPa)`;
                pressureTrendBadge.className = `risk-badge ${pressureTrend < -1.0 ? 'warning' : 'safe'}`;
            }

            if (lightEl) lightEl.innerText = light >= 0 ? light.toFixed(0) : "--";
            if (cloudCoverEl) cloudCoverEl.innerText = light >= 10 ? `${cloudCover.toFixed(0)}%` : "Night";
            if (waterLevelEl) waterLevelEl.innerText = water >= 0 ? water.toFixed(1) : "--";
            if (waterRiseRateEl) waterRiseRateEl.innerText = waterRiseRate !== 0 ? `${waterRiseRate > 0 ? '+' : ''}${waterRiseRate.toFixed(1)} cm/h` : "0.0 cm/h";
            if (dewPointEl) dewPointEl.innerText = dewPoint !== 0 ? dewPoint.toFixed(1) : "--.-";
            if (heatIndexEl) heatIndexEl.innerText = heatIndex !== 0 ? heatIndex.toFixed(1) : "--.-";

            if (lat !== 0 && lng !== 0) {
                const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
                if (mapLinkSidebar) mapLinkSidebar.href = mapUrl;
                if (mapLinkMobile) mapLinkMobile.href = mapUrl;
                if (mapLinkBtn) {
                    mapLinkBtn.href = mapUrl;
                    mapLinkBtn.style.opacity = "1";
                    mapLinkBtn.style.pointerEvents = "auto";
                }
            }

            const lastSeen = data.lastSeen;
            const lastSeenDate = lastSeen ? (typeof lastSeen === 'string' ? new Date(lastSeen) : (lastSeen.toDate ? lastSeen.toDate() : new Date(lastSeen))) : new Date();
            const lastSeenStr = lastSeenDate.toISOString();
            const diffMinutes = (new Date() - lastSeenDate) / 1000 / 60;
            // Station sleeps for 10 minutes between uploads, so 15 min threshold prevents false "Device Offline" during sleep
            if (diffMinutes < 15) updateStatusUI("System Active", "#10b981", true);
            else updateStatusUI("Device Offline", "#ef4444", false);

            // Auto load/update forecast if board location changed and coordinates are valid
            if (lat !== 0 && lng !== 0 && (lat !== loadedForecastLatitude || lng !== loadedForecastLongitude)) {
                loadOpenMeteoForecast(lat, lng);
            }

            updateStatusAndRisk(rain, rainRate, water, cloudCover, light);
            updatePredictions(temp, hum, pres, rain, light, water, pressureTrend, cloudCover, waterRiseRate);
            lucide.createIcons();

            // Populate today's live forecast cards
            updateTodayForecastDisplay(temp, cloudCover, light, water);

            const currentMax = parseFloat(maxRainfall.innerText) || 0;
            if (rain > currentMax && maxRainfall) maxRainfall.innerText = rain.toFixed(2);

            const now = new Date();
            if (lastUpdate) lastUpdate.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            if (lastSeenStr && lastSeenStr !== lastProcessedTime) {
                lastProcessedTime = lastSeenStr;
                updateCharts(rain, temp, hum, pres, water, light);
                populateHourlyTempTimeline();
            }
        }

        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => splash.remove(), 500);
        }
    }, error => {
        updateStatusUI("Connection Error", "#ef4444", false);
    });
}

function getRainIntensityClass(intensity) {
    if (intensity === 'Light') return 'alert-level';
    if (intensity === 'Moderate') return 'warning';
    if (intensity === 'Heavy' || intensity === 'Violent') return 'danger';
    return 'safe';
}

function updateTodayForecastDisplay(temp, cloudCover, light, water) {
    const todayTemp = document.getElementById('today-temp');
    const todayClouds = document.getElementById('today-clouds');
    const todayWater = document.getElementById('today-water');

    if (todayTemp) todayTemp.innerText = `${temp.toFixed(1)}°C`;
    if (todayClouds) todayClouds.innerText = light >= 10 ? `${cloudCover.toFixed(0)}%` : "Night";
    if (todayWater) todayWater.innerText = water >= 0 ? `${water.toFixed(1)} cm` : "--";
}

function updatePredictions(temp, hum, pres, rain, light, water, pressureTrend, cloudCover, waterRiseRate) {
    let prediction = "Stable";
    let desc = "Atmospheric conditions are currently normal.";
    let icon = "sun";
    let rainProb = 5;
    let floodRisk = 0;

    // Apply Sensor Offsets
    temp += (sensorOffsets ? sensorOffsets.temp : 0);
    water += (sensorOffsets ? sensorOffsets.water : 0);

    // Advanced Local Mathematical Model: Multi-Factor Weighted Scoring (0-10)
    // Normalize weights to 10 points total
    const weights = modelWeights || { pres: 40, hum: 20, light: 20, rain: 20 };
    const wPres = weights.pres / 10;
    const wHum = weights.hum / 10;
    const wLight = weights.light / 10;
    const wRain = weights.rain / 10;

    // 1. Barometric Pressure Drop (Relative to weight)
    const baseScore = Math.max(0, (standardBasePressure - pres) * 0.4);
    const trendFactor = pressureTrend < 0 ? Math.min(2.0, Math.abs(pressureTrend) * 1.5) : 0;
    const pressureScore = Math.min(wPres, (baseScore + trendFactor) * (wPres / 4.0));

    // 2. Moisture Saturation (Relative to weight)
    const humidityScore = (hum / 100) * wHum;

    // 3. Solar Radiation Drop / Cloud Cover Proxy (Relative to weight)
    let lightScore = 0;
    if (light >= 10) {
        lightScore = (cloudCover / 100) * wLight;
    }

    // 4. Current Precipitation Intensity (Relative to weight)
    const rainScore = Math.min(wRain, (rain / alertThresholdVal) * wRain);

    let predictionScore = Math.min(10, pressureScore + humidityScore + lightScore + rainScore);

    // Dynamic Rain Probability based on multi-factor score
    rainProb = Math.max(5, Math.round(predictionScore * 10));

    // Display Factor Breakdown in prediction card
    const fPres = document.getElementById('factor-pressure');
    const fHum = document.getElementById('factor-humidity');
    const fLight = document.getElementById('factor-light');
    const fRain = document.getElementById('factor-rain');

    if (fPres) fPres.innerText = `${pressureScore.toFixed(1)} / ${wPres.toFixed(1)}`;
    if (fHum) fHum.innerText = `${humidityScore.toFixed(1)} / ${wHum.toFixed(1)}`;
    if (fLight) fLight.innerText = light >= 10 ? `${lightScore.toFixed(1)} / ${wLight.toFixed(1)}` : 'Night';
    if (fRain) fRain.innerText = `${rainScore.toFixed(1)} / ${wRain.toFixed(1)}`;

    // Local Forecast Determination logic
    if (pressureTrend < -1.5 && hum > 85) {
        prediction = "Storm Imminent";
        desc = "Rapid pressure drop and high humidity suggest heavy rainfall and wind.";
        icon = "cloud-lightning";
        rainProb = Math.max(rainProb, 95);
    } else if (pres < 1008 && hum > 78) {
        prediction = "Rain Expected";
        desc = "Unstable atmospheric system producing localized precipitation.";
        icon = "cloud-rain";
        rainProb = Math.max(rainProb, 80);
    } else if (light !== undefined && light >= 0 && light < 6000) {
        prediction = "Mostly Overcast";
        desc = "Heavy cloud cover or reduced light level detected.";
        icon = "cloud";
        rainProb = Math.max(rainProb, 45);
    } else if (temp > 33 && hum < 55) {
        prediction = "Hot & Clear";
        desc = "High temperature and dry atmosphere. Clear conditions.";
        icon = "sun";
        rainProb = 5;
    }

    // Advanced Flood Risk Computation (Combined Factors)
    const rainRisk = (rain / alertThresholdVal) * 100;
    const maxChannelCapacity = physicalMountHeight * 0.8; // Assume 80% is critical
    const waterLevelRisk = water >= 0 ? (water / maxChannelCapacity) * 100 : 0;

    let combinedFloodRisk = Math.max(rainRisk, waterLevelRisk);
    if (waterRiseRate > 0) {
        combinedFloodRisk += (waterRiseRate * 2.5); // Boost risk if rising fast
    }
    floodRisk = Math.min(100, combinedFloodRisk);

    // Water level specific risk (Visual Gauge)
    let waterGaugeRisk = water >= 0 ? Math.min(100, (water / maxChannelCapacity) * 100) : 0;

    // Update UI
    const pTitle = document.getElementById('prediction-title');
    const pDesc = document.getElementById('prediction-desc');
    const pIconBox = document.getElementById('prediction-icon-box');
    const pRain = document.getElementById('prob-rain');
    const pFlood = document.getElementById('prob-flood');
    const pWater = document.getElementById('prob-water');
    const pScore = document.getElementById('prediction-score-value');

    const todayRainChance = document.getElementById('today-rain-chance');
    if (todayRainChance) todayRainChance.innerText = `${rainProb}%`;

    // Update Today Forecast section main condition
    const todayCondition = document.getElementById('today-condition');
    const todayDetail = document.getElementById('today-detail');
    const todayWeatherIcon = document.getElementById('today-weather-icon');
    if (todayCondition) todayCondition.innerText = prediction;
    if (todayDetail) todayDetail.innerText = desc;
    if (todayWeatherIcon) todayWeatherIcon.innerHTML = `<i data-lucide="${icon}"></i>`;

    if (pTitle) pTitle.innerText = prediction;
    if (pDesc) pDesc.innerText = desc;
    if (pIconBox) pIconBox.innerHTML = `<i data-lucide="${icon}"></i>`;
    if (pRain) pRain.style.width = rainProb + "%";
    if (pFlood) pFlood.style.width = floodRisk + "%";
    if (pWater) pWater.style.width = waterGaugeRisk + "%";
    if (pScore) pScore.innerText = predictionScore.toFixed(1);

    // Update model guidance
    const guidanceText = document.getElementById('model-guidance-text');
    if (guidanceText) {
        if (waterRiseRate > 10.0) {
            guidanceText.innerText = `ALERT: Flood water is rising rapidly (+${waterRiseRate.toFixed(1)} cm/h). Drainage overflows could occur in less than 2 hours.`;
        } else if (pressureTrend < -2.0) {
            guidanceText.innerText = `WARNING: Sudden barometric drop detected (${pressureTrend.toFixed(1)} hPa). Highly unstable storm system incoming.`;
        } else if (rain > 0) {
            guidanceText.innerText = `Active rainfall detected. local water level is currently at ${water.toFixed(1)} cm. Monitoring rise rate.`;
        } else {
            guidanceText.innerText = "All atmospheric parameters and localized water levels are currently within safe limits.";
        }
    }

    lucide.createIcons();
}

async function initializeChartHistory() {
    const allCharts = [
        chartRain, chartAtmo,
        detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart,
        detailedWaterChart, detailedLightChart,
        weeklyRainChart
    ];

    allCharts.forEach(c => {
        if (c) {
            c.data.labels = [];
            c.data.datasets.forEach(d => {
                d.data = [];
                d.tension = currentGraphTension;
            });
        }
    });

    try {
        const limitPoints = (currentGraphWindow || 24) * 60;
        const snapshot = await db.collection('weather_history')
            .orderBy('timestamp', 'desc')
            .limit(limitPoints)
            .get();

        if (!snapshot.empty) {
            const history = snapshot.docs.map(doc => doc.data()).reverse();
            history.forEach(data => {
                const time = data.timestamp ? (data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp)) : new Date();
                const timeLabel = formatDateTimeLabel(time);

                const r = parseFloat(data.rainfall) || 0;
                const t = parseFloat(data.temperature) || 0;
                const h = parseFloat(data.humidity) || 0;
                const p = parseFloat(data.pressure) || 0;
                const w = (data.waterLevel !== undefined ? parseFloat(data.waterLevel) : (data.water !== undefined ? parseFloat(data.water) : 0.0)) || 0.0;
                const l = (data.lightLevel !== undefined ? parseFloat(data.lightLevel) : (data.light !== undefined ? parseFloat(data.light) : 0.0)) || 0.0;

                if (chartRain) {
                    chartRain.data.labels.push(timeLabel);
                    chartRain.data.datasets[0].data.push(r);
                }
                if (chartAtmo) {
                    chartAtmo.data.labels.push(timeLabel);
                    chartAtmo.data.datasets[0].data.push(t);
                    chartAtmo.data.datasets[1].data.push(h);
                }
                if (detailedTempChart) {
                    detailedTempChart.data.labels.push(timeLabel);
                    detailedTempChart.data.datasets[0].data.push(t);
                }
                if (detailedHumChart) {
                    detailedHumChart.data.labels.push(timeLabel);
                    detailedHumChart.data.datasets[0].data.push(h);
                }
                if (detailedPresChart) {
                    detailedPresChart.data.labels.push(timeLabel);
                    detailedPresChart.data.datasets[0].data.push(p);
                }
                if (detailedRainChart) {
                    detailedRainChart.data.labels.push(timeLabel);
                    detailedRainChart.data.datasets[0].data.push(r);
                }
                if (detailedWaterChart) {
                    detailedWaterChart.data.labels.push(timeLabel);
                    detailedWaterChart.data.datasets[0].data.push(w);
                }
                if (detailedLightChart) {
                    detailedLightChart.data.labels.push(timeLabel);
                    detailedLightChart.data.datasets[0].data.push(l);
                }
            });
        }
    } catch (error) {
        console.error("Error loading weather history:", error);
    }

    allCharts.forEach(c => {
        if (c) c.update();
    });
}

function updateCharts(rain, temp, hum, pres, water, light) {
    const now = new Date();
    const timeLabel = formatDateTimeLabel(now);
    const maxPoints = (currentGraphWindow || 24) * 60;

    const updateChartData = (chart, value, label) => {
        if (!chart) return;
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);
        if (chart.data.labels.length > maxPoints) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update('none'); // Update without animation for performance
    };

    updateChartData(chartRain, rain, timeLabel);
    updateChartData(detailedRainChart, rain, timeLabel);
    updateChartData(detailedTempChart, temp, timeLabel);
    updateChartData(detailedHumChart, hum, timeLabel);
    updateChartData(detailedPresChart, pres, timeLabel);
    updateChartData(detailedWaterChart, water, timeLabel);
    updateChartData(detailedLightChart, light, timeLabel);

    // Update Atmospheric Chart (Double Dataset)
    if (chartAtmo) {
        chartAtmo.data.labels.push(timeLabel);
        chartAtmo.data.datasets[0].data.push(temp);
        chartAtmo.data.datasets[1].data.push(hum);
        if (chartAtmo.data.labels.length > 20) {
            chartAtmo.data.labels.shift();
            chartAtmo.data.datasets[0].data.shift();
            chartAtmo.data.datasets[1].data.shift();
        }
        chartAtmo.update('none');
    }
}

function updateStatusUI(text, color, isOnline) {
    const dotClass = isOnline ? 'pulse-dot online' : 'pulse-dot';
    if (systemStatusText) systemStatusText.innerText = text;
    if (systemStatusDot) {
        systemStatusDot.className = dotClass;
        systemStatusDot.style.background = color;
    }
    if (systemStatusTextDesktop) systemStatusTextDesktop.innerText = text;
    if (systemStatusDotDesktop) {
        systemStatusDotDesktop.className = dotClass;
        systemStatusDotDesktop.style.background = color;
    }
}

// Dynamic Threshold from config
let alertThresholdVal = 50.0;
let currentGraphTension = 0.4;
let currentGraphWindow = 12;

// Model Weights & Offsets
let modelWeights = { pres: 40, hum: 20, light: 20, rain: 20 };
let sensorOffsets = { temp: 0, water: 0 };
let physicalMountHeight = 200;
let maxClearSkyLux = 65000;
let standardBasePressure = 1013;

async function fetchAdminConfig() {
    db.collection('weather').doc('config').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            if (adminMessageDisplay) {
                adminMessageDisplay.innerText = `"${data.alertMessage || 'Monitoring active.'}"`;
            }
            if (data.alertThreshold) {
                alertThresholdVal = parseFloat(data.alertThreshold);
            }

            // Apply Model Weights & Offsets
            modelWeights = {
                pres: data.weightPres || 40,
                hum: data.weightHum || 20,
                light: data.weightLight || 20,
                rain: data.weightRain || 20
            };
            sensorOffsets = {
                temp: data.tempOffset || 0,
                water: data.waterOffset || 0
            };
            physicalMountHeight = data.mountHeight || 200;
            maxClearSkyLux = data.maxClearLux || 65000;
            standardBasePressure = data.basePressure || 1013;

            // Apply Chart Settings
            if (data.graphTension !== undefined) {
                currentGraphTension = data.graphTension;
            }
            if (data.graphWindow !== undefined) {
                currentGraphWindow = data.graphWindow;
            }

            const allCharts = [
                chartRain, chartAtmo,
                detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart,
                detailedWaterChart, detailedLightChart,
                weeklyRainChart
            ];
            allCharts.forEach(c => {
                if (c) {
                    c.data.datasets.forEach(ds => ds.tension = currentGraphTension);
                    c.update('none');
                }
            });
        }
    });
}

function updateStatusAndRisk(dailyRain, rainRate, water, cloudCover, light) {
    let status = "Safe";
    let badgeClass = "risk-badge safe";
    let risk = "Conditions are stable. Sensors reporting normal levels.";
    let weatherType = "sunny";

    const dangerThreshold = alertThresholdVal;
    const warningThreshold = alertThresholdVal * 0.5;
    const maxChannelCapacity = physicalMountHeight * 0.8;

    // --- 1. Risk & Flood Alert Status (Based on dailyRain accum & water level) ---
    if (water >= maxChannelCapacity) {
        status = "FLOODING";
        badgeClass = "risk-badge danger";
        risk = `CRITICAL: Drainage overflow detected! Water level is at ${water.toFixed(1)} cm.`;
    } else if (water >= (maxChannelCapacity * 0.75)) {
        status = "HIGH RISK";
        badgeClass = "risk-badge danger";
        risk = `ALERT: Local water levels are extremely high (${water.toFixed(1)} cm). Overflow threat imminent.`;
    } else if (dailyRain >= dangerThreshold) {
        status = "CRITICAL";
        badgeClass = "risk-badge danger";
        risk = `Extreme danger: Daily rainfall threshold of ${dangerThreshold.toFixed(2)}mm reached! Seek higher ground.`;
    } else if (dailyRain >= warningThreshold) {
        status = "WARNING";
        badgeClass = "risk-badge warning";
        risk = `Heavy rain: Cumulative daily rainfall rising toward threshold of ${dangerThreshold.toFixed(2)}mm.`;
    } else if (dailyRain > 0) {
        status = "ALERT";
        badgeClass = "risk-badge alert-level";
        risk = `Precipitation recorded today (${dailyRain.toFixed(1)} mm). Monitoring conditions.`;
    }

    // --- 2. Visual Weather Background (Based on ACTIVE rainRate mm/h & Cloud Cover) ---
    if (water >= maxChannelCapacity || rainRate >= 15.0) {
        weatherType = "stormy";
    } else if (rainRate > 0.0) {
        weatherType = "rainy";
    } else {
        const hour = new Date().getHours();
        if (hour >= 19 || hour < 5) {
            weatherType = 'night';
        } else if (light !== undefined && light >= 0 && light < 6000) {
            weatherType = 'cloudy'; // Strictly when light level is under 6000 lux during daytime
        } else {
            weatherType = 'sunny';
        }
    }

    if (typeof setWeatherBackground === 'function') setWeatherBackground(weatherType);

    if (alertBadge) {
        alertBadge.innerText = status;
        alertBadge.className = badgeClass;
    }
    if (riskLevelText) riskLevelText.innerText = risk;
}

// Logout Logic (Unified for Sidebar and Mobile Header)
document.querySelectorAll('.logout-trigger').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (confirm("Are you sure you want to sign out?")) {
            try {
                await auth.signOut();
                window.location.href = "../index.html";
            } catch (error) {
                console.error("Logout failed:", error);
            }
        }
    });
});
