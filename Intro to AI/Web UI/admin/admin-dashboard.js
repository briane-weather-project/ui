// Global Configuration & Baselines
let alertThresholdVal = 50.0;
let currentGraphTension = 0.3;
let currentGraphWindow = 12;
let modelWeights = { pres: 40, hum: 20, light: 20, rain: 20 };
let sensorOffsets = { temp: 0, water: 0 };
let physicalMountHeight = 200;
let maxClearSkyLux = 65000;
let standardBasePressure = 1013;
let lastSeenTimestamp = null;
let currentSensorData = {
    temp: NaN,
    rainRate: 0,
    water: -1,
    light: -1
};
let isFetchingForecast = false;
let cachedForecastData = null;
let lastForecastFetch = 0;

// Initialize Lucide Icons
lucide.createIcons();

// Firebase is initialized by firebase-config.js

// UI Elements
const userTableBody = document.getElementById('user-table-body');
const totalUsersCount = document.getElementById('total-users-count');
const adminLiveDateText = document.getElementById('admin-live-date-text');

// Live Date & Time Clock
function updateAdminLiveDateTime() {
    if (!adminLiveDateText) return;
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-US', options);
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    adminLiveDateText.textContent = `${dateStr} • ${timeStr}`;
}
updateAdminLiveDateTime();
setInterval(updateAdminLiveDateTime, 1000);

// Date/Time label helper for clean graph tooltips & x-axis ticks
function formatDateTimeLabel(date) {
    if (!date || isNaN(date.getTime())) date = new Date();
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateStr}, ${timeStr}`;
}

// Charts Initialization
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
                        autoSkip: true,
                        font: { size: 10, weight: '600' }
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

let weeklyRainChart = null;
let hourlyPrecipChart = null;
let currentLatitude = 0.0;
let currentLongitude = 0.0;
let loadedForecastLatitude = null;
let loadedForecastLongitude = null;

async function loadOpenMeteoForecast(lat, lng) {
    if (lat === 0 || lng === 0) return;

    // Don't re-fetch if we already have data for this approximate location
    if (loadedForecastLatitude === lat.toFixed(3) && loadedForecastLongitude === lng.toFixed(3)) return;

    loadedForecastLatitude = lat.toFixed(3);
    loadedForecastLongitude = lng.toFixed(3);

    const container = document.getElementById('forecast-days-container');
    const locLabel = document.getElementById('forecast-location-label');

    // Start both requests in parallel for maximum speed
    const weatherPromise = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weathercode&hourly=temperature_2m,precipitation,precipitation_probability,weathercode&timezone=auto`);

    const geoPromise = fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`, {
        headers: { 'User-Agent': 'BRIANE-Admin-Dashboard/1.0' }
    }).catch(e => null); // Ignore geo errors for the sake of the weather data

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

        let dailyCount = data.daily.time.length;

        for (let i = 0; i < dailyCount; i++) {
            const date = new Date(data.daily.time[i]);
            const dayName = days[date.getDay()];
            const maxTemp = data.daily.temperature_2m_max[i];
            const minTemp = data.daily.temperature_2m_min[i];
            const rainProb = data.daily.precipitation_probability_max[i];
            const code = data.daily.weathercode[i];
            const iconName = weatherIcons[code] || 'cloud';

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

        // Render weekly precipitation chart
        renderWeeklyForecastChart(data.daily);

        // Populate Today's Hourly Temperature Timeline
        populateHourlyTempTimeline();

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

    // Render immediately with whatever we have (Now card + cached forecast)
    renderTimeline(cachedForecastData);

    const nowTime = Date.now();
    // Cache forecast data for 30 minutes to improve performance and prevent rendering lag
    if (cachedForecastData && (nowTime - lastForecastFetch < 30 * 60 * 1000)) {
        return;
    }

    if (isFetchingForecast) return;
    isFetchingForecast = true;

    try {
        const lat = currentLatitude || 14.5995;
        const lng = currentLongitude || 120.9842;
        const forecastRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weathercode,is_day&timezone=auto&forecast_hours=24`
        ).catch(err => {
            console.error("Timeline: Open-Meteo fetch error:", err);
            return null;
        });

        cachedForecastData = forecastRes ? await forecastRes.json() : null;
        lastForecastFetch = nowTime;
        renderTimeline(cachedForecastData);
    } catch (err) {
        console.error("Error loading hourly timeline:", err);
    } finally {
        isFetchingForecast = false;
    }
}

function renderTimeline(forecastData) {
    const container = document.getElementById('hourly-temp-timeline');
    if (!container) return;

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

    container.innerHTML = '';

    // "Now" card using global sensor data
    const currentTemp = currentSensorData.temp || 0;
    const currentTempDisplay = (isNaN(currentSensorData.temp)) ? "--" : Math.round(currentSensorData.temp);

    let currentIcon = 'sun';
    const rainRate = currentSensorData.rainRate || 0;
    const water = currentSensorData.water || 0;
    const lightVal = currentSensorData.light || 0;
    const maxCapacity = physicalMountHeight * 0.8;

    if (water >= maxCapacity || rainRate >= 15.0) {
        currentIcon = 'cloud-lightning';
    } else if (rainRate > 0.0) {
        currentIcon = 'cloud-rain';
    } else {
        const hour = new Date().getHours();
        const isDaytime = hour >= 5 && hour < 18;
        if (hour >= 18 || hour < 5) {
            currentIcon = 'moon';
        } else if (isDaytime && lightVal >= 0 && lightVal < 6000) {
            currentIcon = 'cloudy';
        } else {
            currentIcon = 'sun';
        }
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

    futureEntries.forEach(entry => {
        const label = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const iconConfig = weatherCodeIcons[entry.weatherCode];
        let iconName = 'sun';
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
    container.scrollLeft = 0;
}

async function loadWeeklyData() {
    const canvas = document.getElementById('weeklyRainChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

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
                // Lily board sends cumulative totalRainfall, so we take the max of each day
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

        // Update Summary Stats
        const totalRain = data.reduce((a, b) => a + b, 0);
        const peakRain = Math.max(...data, 0);
        const rainDays = data.filter(d => d > 0.1).length; // Count days with more than 0.1mm
        const avgTemp = tempCount > 0 ? (totalTempSum / tempCount) : 0;

        if (document.getElementById('weekly-total-rain')) document.getElementById('weekly-total-rain').innerText = totalRain.toFixed(1) + " mm";
        if (document.getElementById('weekly-peak-rain')) document.getElementById('weekly-peak-rain').innerText = peakRain.toFixed(1) + " mm";
        if (document.getElementById('weekly-rain-days')) document.getElementById('weekly-rain-days').innerText = rainDays;
        if (document.getElementById('weekly-avg-temp')) document.getElementById('weekly-avg-temp').innerText = avgTemp > 0 ? avgTemp.toFixed(1) + " °C" : "-- °C";

    } catch (error) {
        console.error("Error loading weekly data:", error);
    }
}

// Add Atmospheric Chart (Dual Dataset) for Admin Overview
const initAtmosphericChart = () => {
    const canvas = document.getElementById('atmosphericChart');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    return new Chart(ctx, {
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
                legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10, weight: '700' } } },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#ffffff',
                    padding: 10,
                    cornerRadius: 8
                }
            },
            scales: {
                y: { type: 'linear', display: true, position: 'left', ticks: { font: { size: 10 } } },
                y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } },
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true, font: { size: 10 } }
                }
            }
        }
    });
};

const initRainfallChart = () => {
    const canvas = document.getElementById('mainRainfallChart');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    return new Chart(ctx, {
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
                y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Plus Jakarta Sans', size: 10, weight: '600' } } },
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true, font: { family: 'Plus Jakarta Sans', size: 10, weight: '600' } }
                }
            }
        }
    });
};

const atmosphericChart = initAtmosphericChart();
const chartRain = initRainfallChart();

const resizeObserver = new ResizeObserver(() => {
    [detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart, detailedWaterChart, detailedLightChart, atmosphericChart, chartRain, weeklyRainChart, hourlyPrecipChart].forEach(c => {
        if (c && c.canvas && c.canvas.offsetParent !== null) {
            c.resize();
        }
    });
});

const scrollArea = document.querySelector('.scroll-area');
if (scrollArea) resizeObserver.observe(scrollArea);

let historyInitialized = false;
let lastProcessedTime = null;

async function initializeChartHistory() {
    const allCharts = [detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart, detailedWaterChart, detailedLightChart, atmosphericChart, chartRain];

    allCharts.forEach(c => {
        if (c) {
            c.data.labels = [];
            c.data.datasets.forEach(d => {
                d.data = [];
                d.tension = currentGraphTension;
            });
        }
    });

    // Assume 1 data point per minute, so window hours * 60
    const limitPoints = currentGraphWindow * 60;

    try {
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
                const w = !isNaN(parseFloat(data.waterLevel)) ? parseFloat(data.waterLevel) : 0;
                const l = !isNaN(parseFloat(data.lightLevel)) ? parseFloat(data.lightLevel) : 0;

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
                if (atmosphericChart) {
                    atmosphericChart.data.labels.push(timeLabel);
                    atmosphericChart.data.datasets[0].data.push(t);
                    atmosphericChart.data.datasets[1].data.push(h);
                }
                if (chartRain) {
                    chartRain.data.labels.push(timeLabel);
                    chartRain.data.datasets[0].data.push(r);
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
    const maxPoints = currentGraphWindow * 60;

    const updateChartData = (chart, value, label) => {
        if (!chart) return;
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);
        if (chart.data.labels.length > maxPoints) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update('none');
    };

    updateChartData(detailedTempChart, temp, timeLabel);
    updateChartData(detailedHumChart, hum, timeLabel);
    updateChartData(detailedPresChart, pres, timeLabel);
    updateChartData(detailedRainChart, rain, timeLabel);
    updateChartData(detailedWaterChart, water, timeLabel);
    updateChartData(detailedLightChart, light, timeLabel);
    updateChartData(chartRain, rain, timeLabel);

    // Update Overview Dual Chart
    if (atmosphericChart) {
        atmosphericChart.data.labels.push(timeLabel);
        atmosphericChart.data.datasets[0].data.push(temp);
        atmosphericChart.data.datasets[1].data.push(hum);
        if (atmosphericChart.data.labels.length > maxPoints) {
            atmosphericChart.data.labels.shift();
            atmosphericChart.data.datasets[0].data.shift();
            atmosphericChart.data.datasets[1].data.shift();
        }
        atmosphericChart.update('none');
    }
}

function updatePredictions(temp, hum, pres, rain, light, water, pressureTrend, cloudCover, waterRiseRate = 0) {
    let prediction = "Stable";
    let desc = "Atmospheric conditions are normal.";
    let icon = "sun";
    let rainProb = 5;
    let floodRisk = 0;

    // Apply Sensor Offsets
    temp += sensorOffsets.temp;
    water += sensorOffsets.water;

    // Advanced Local Mathematical Model: Multi-Factor Weighted Scoring (0-10)
    // Normalize weights to 10 points total
    const wPres = modelWeights.pres / 10;
    const wHum = modelWeights.hum / 10;
    const wLight = modelWeights.light / 10;
    const wRain = modelWeights.rain / 10;

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

    // Display Factor Breakdown
    const fPres = document.getElementById('factor-pressure');
    const fHum = document.getElementById('factor-humidity');
    const fLight = document.getElementById('factor-light');
    const fRain = document.getElementById('factor-rain');

    if (fPres) fPres.innerText = `${pressureScore.toFixed(1)} / ${wPres.toFixed(1)}`;
    if (fHum) fHum.innerText = `${humidityScore.toFixed(1)} / ${wHum.toFixed(1)}`;
    if (fLight) fLight.innerText = light >= 10 ? `${lightScore.toFixed(1)} / ${wLight.toFixed(1)}` : 'Night';
    if (fRain) fRain.innerText = `${rainScore.toFixed(1)} / ${wRain.toFixed(1)}`;

    if (pressureTrend < -1.5 && hum > 85) {
        prediction = "Storm Imminent";
        desc = "Rapid pressure drop and high humidity suggest storm.";
        icon = "cloud-lightning";
        rainProb = Math.max(rainProb, 95);
    } else if (pres < 1008 && hum > 78) {
        prediction = "Rain Expected";
        desc = "Unstable atmospheric system producing precipitation.";
        icon = "cloud-rain";
        rainProb = Math.max(rainProb, 80);
    } else if (light !== undefined && light >= 0 && light < 6000) {
        prediction = "Mostly Overcast";
        desc = "Heavy cloud cover or reduced light level detected.";
        icon = "cloud";
        rainProb = Math.max(rainProb, 45);
    } else if (temp > 33 && hum < 55) {
        prediction = "Hot & Clear";
        desc = "Clear dry conditions.";
        icon = "sun";
        rainProb = 5;
    }

    // Advanced Flood Risk Computation
    // Factor 1: Rainfall saturation relative to admin threshold
    const rainRisk = (rain / alertThresholdVal) * 100;

    // Factor 2: Local water level relative to mounting height
    const maxCapacity = physicalMountHeight * 0.8; // Assume 80% of height is critical capacity
    const waterLevelRisk = water >= 0 ? (water / maxCapacity) * 100 : 0;

    // Combine and add momentum if water is rising
    let combinedRisk = Math.max(rainRisk, waterLevelRisk);
    if (waterRiseRate > 0) {
        combinedRisk += (waterRiseRate * 2.5); // Add significant weight to rising water
    }

    floodRisk = Math.min(100, combinedRisk);

    // Water level specific risk (Visual Gauge)
    const maxCapacityGauge = physicalMountHeight * 0.8;
    const waterGaugeRisk = water >= 0 ? Math.min(100, (water / maxCapacityGauge) * 100) : 0;

    const pTitle = document.getElementById('prediction-title');
    const pDesc = document.getElementById('prediction-desc');
    const pIconBox = document.getElementById('prediction-icon-box');
    const pRain = document.getElementById('prob-rain');
    const pFlood = document.getElementById('prob-flood');
    const pWater = document.getElementById('prob-water');
    const pScore = document.getElementById('prediction-value-summary');

    if (pTitle) pTitle.innerText = prediction;
    if (pDesc) pDesc.innerText = desc;
    if (pIconBox) pIconBox.innerHTML = `<i data-lucide="${icon}"></i>`;
    if (pRain) pRain.style.width = rainProb + "%";
    if (pFlood) pFlood.style.width = floodRisk + "%";
    if (pWater) pWater.style.width = waterGaugeRisk + "%";
    if (pScore) pScore.innerText = predictionScore.toFixed(1);

    const pRainValue = document.getElementById('rain-prob-value');
    const pFloodValue = document.getElementById('flood-risk-value');
    if (pRainValue) pRainValue.innerText = rainProb + "%";
    if (pFloodValue) pFloodValue.innerText = Math.round(floodRisk) + "%";

    lucide.createIcons();
}

const deviceStatusValue = document.getElementById('device-status-value');
const deviceStatusValueDesktop = document.getElementById('device-status-value-desktop');
const deviceStatusSummary = document.getElementById('device-status-summary');
const headerStatusDot = document.getElementById('header-status-dot');
const headerStatusDotDesktop = document.getElementById('header-status-dot-desktop');

const thresholdInput = document.getElementById('threshold-input-settings');
const currentThresholdDisplay = document.getElementById('current-threshold-display');
const updateThresholdBtn = document.getElementById('update-threshold-btn-settings');

const alertMsgInput = document.getElementById('alert-msg-input-settings');
const saveMsgBtn = document.getElementById('save-msg-btn-settings');

// Sim Elements
const pushSimBtn = document.getElementById('push-sim-data');
const simDateTime = document.getElementById('sim-datetime');
const setNowSimBtn = document.getElementById('set-now-sim');
const simRain = document.getElementById('sim-rain');
const simRainRate = document.getElementById('sim-rain-rate');
const simTemp = document.getElementById('sim-temp');
const simHum = document.getElementById('sim-hum');
const simPres = document.getElementById('sim-pres');
const simLight = document.getElementById('sim-light');
const simWater = document.getElementById('sim-water');

// Chart Config Elements
const graphWindowSelect = document.getElementById('graph-window-select');
const graphTensionSlider = document.getElementById('graph-tension-slider');
const saveChartSettingsBtn = document.getElementById('save-chart-settings-btn');

// New Config Elements
const paramAInput = document.getElementById('param-a-input');
const paramBInput = document.getElementById('param-b-input');
const weightPresInput = document.getElementById('weight-pres');
const weightHumInput = document.getElementById('weight-hum');
const weightLightInput = document.getElementById('weight-light');
const weightRainInput = document.getElementById('weight-rain');
const saveModelBtn = document.getElementById('save-model-config-btn');

const tempOffsetInput = document.getElementById('temp-offset-input');
const waterOffsetInput = document.getElementById('water-offset-input');
const mountHeightInput = document.getElementById('mount-height-input');
const normalIntervalInput = document.getElementById('normal-interval-input');
const emergencyIntervalInput = document.getElementById('emergency-interval-input');
const radiusInput = document.getElementById('radius-input');
const wifiSsidInput = document.getElementById('wifi-ssid-input');
const wifiPassInput = document.getElementById('wifi-pass-input');
const maxLuxInput = document.getElementById('max-lux-input');
const basePresInput = document.getElementById('base-pres-input');
const saveHwBtn = document.getElementById('save-hw-config-btn');

const alertCooldownInput = document.getElementById('alert-cooldown-input');
const maintenanceToggle = document.getElementById('maintenance-toggle');
const saveAlertBtn = document.getElementById('save-alert-config-btn');
const triggerManualSmsBtn = document.getElementById('trigger-manual-sms-btn');



const logsContainer = document.getElementById('logs-container');
const clearLogsBtn = document.getElementById('clear-logs-btn');
const adminEmailDisplay = document.getElementById('admin-display-email');

// SIM Elements
const simResponseText = document.getElementById('sim-response');
const simLastCheckText = document.getElementById('sim-last-check');
const simExpiryAlert = document.getElementById('sim-expiry-alert');

// Navigation Logic (Unified for Sidebar and Bottom Nav)
const navLinks = document.querySelectorAll('.nav-item, .nav-btn');
const sections = document.querySelectorAll('.view-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        if (link.id === 'admin-logout-btn') return;
        e.preventDefault();

        const sectionId = link.getAttribute('data-section');
        if (!sectionId) return;

        // Update Active States
        navLinks.forEach(l => l.classList.remove('active'));
        // Find all links for the same section (sidebar and mobile nav)
        document.querySelectorAll(`[data-section="${sectionId}"]`).forEach(l => l.classList.add('active'));

        // Switch View
        sections.forEach(s => s.classList.remove('active'));
        const activeSection = document.getElementById(`section-${sectionId}`);
        if (activeSection) activeSection.classList.add('active');

        // Update Title
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.innerText = link.querySelector('span').innerText;

        // Force chart resize and reload weekly data
        if (sectionId === 'analytics' || sectionId === 'reports') {
            if (sectionId === 'reports') {
                loadWeeklyData();
                if (currentLatitude !== 0 && currentLongitude !== 0) {
                    loadOpenMeteoForecast(currentLatitude, currentLongitude);
                } else {
                    // Fallback to Manila
                    loadOpenMeteoForecast(14.5995, 120.9842);
                }
            }
            setTimeout(() => {
                const charts = [detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart, detailedWaterChart, detailedLightChart, weeklyRainChart, chartRain, hourlyPrecipChart];
                charts.forEach(c => {
                    if (c) {
                        c.resize();
                        c.update('none');
                    }
                });
            }, 400);
        }
    });
});

// Hard-kill fallback: always dismiss splash after 6s even if auth is slow
setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 500);
    }
}, 6000);

// Check Auth
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists && userDoc.data().role === 'admin') {
                // Null-safe: display email or fallback
                if (adminEmailDisplay) {
                    adminEmailDisplay.innerText = user.email || (userDoc.exists ? userDoc.data().email : 'Admin');
                }
                loadWeeklyData();
                loadDashboardData();

                // Immediate forecast load with fallback location for speed
                loadOpenMeteoForecast(14.5995, 120.9842);

                // Initialize background based on time immediately
                if (typeof updateBackgroundByTime === 'function') updateBackgroundByTime();
            } else {
                window.location.href = "index.html";
            }
        } catch (e) {
            console.error("Admin auth check failed:", e);
            // On error, still dismiss splash and redirect to login
            const splash = document.getElementById('splash-screen');
            if (splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 500); }
            window.location.href = "index.html";
        }
    } else {
        window.location.href = "index.html";
    }
});


let currentRainfallVal = 0.0;
let currentRainRateVal = 0.0;
let currentWaterVal = -1.0;
let currentCloudCoverVal = 0.0;
let currentLightVal = -1.0;

function updateWeatherBackground(rainRate, water, light) {
    let weatherType = "sunny";

    if (rainRate !== undefined && rainRate >= 50.0) {
        weatherType = "stormy";
    } else if (rainRate !== undefined && rainRate > 0.0) {
        weatherType = "rainy";
    } else {
        const hour = new Date().getHours();
        const isDaytime = hour >= 5 && hour < 18; // 5:00 AM to 6:00 PM

        if (hour >= 18 || hour < 5) {
            weatherType = 'night';
        } else if (isDaytime && light !== undefined && light >= 0 && light < 6000) {
            weatherType = 'cloudy';
        } else {
            weatherType = 'sunny';
        }
    }

    if (typeof setWeatherBackground === 'function') {
        setWeatherBackground(weatherType);
    }
}

function loadDashboardData() {
    // 0. Initialize History once on load
    if (!historyInitialized) {
        historyInitialized = true;
        initializeChartHistory();
    }

    // Safety timeout for splash screen
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => splash.remove(), 500);
        }
    }, 5000);

    // 1. Device Heartbeat
    db.collection('weather').doc('current').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            const lastSeen = data.lastSeen;
            currentRainfallVal = data.rainfall !== undefined ? parseFloat(data.rainfall) : 0.0;
            const tempVal = data.temperature !== undefined ? parseFloat(data.temperature) : NaN;
            const humidityVal = data.humidity !== undefined ? parseFloat(data.humidity) : NaN;
            const pressureVal = data.pressure !== undefined ? parseFloat(data.pressure) : NaN;

            let lastSeenStr = "";
            const lastSeenDate = lastSeen && lastSeen.toDate ? lastSeen.toDate() : (lastSeen ? new Date(lastSeen) : null);
            lastSeenTimestamp = lastSeenDate;

            if (lastSeenDate && !isNaN(lastSeenDate.getTime())) {
                lastSeenStr = lastSeenDate.toISOString();
                const diffMinutes = (new Date() - lastSeenDate) / 1000 / 60;

                // 15-minute threshold accounts for 10-minute deep sleep interval without false "OFFLINE" warnings
                if (diffMinutes < 15) {
                    updateStatusUI("ONLINE", "#10b981", true);
                } else {
                    updateStatusUI("OFFLINE", "#ef4444", false);
                }
            } else {
                updateStatusUI("NO DATA", "#94a3b8", false);
            }

            // Set Displays
            const tempEl = document.getElementById('temp-summary');
            const humidityEl = document.getElementById('humidity-summary');
            const pressureEl = document.getElementById('pressure-summary');
            if (tempEl) tempEl.innerText = !isNaN(tempVal) ? tempVal.toFixed(1) : "--.-";
            if (humidityEl) humidityEl.innerText = !isNaN(humidityVal) ? humidityVal.toFixed(0) : "--";
            if (pressureEl) pressureEl.innerText = !isNaN(pressureVal) ? pressureVal.toFixed(1) : "----";

            // Location update
            const lat = parseFloat(data.lat) || 0.0;
            const lng = parseFloat(data.lng) || 0.0;
            currentLatitude = lat;
            currentLongitude = lng;

            // Auto load/update forecast if board location changed and coordinates are valid
            if (lat !== 0 && lng !== 0 && (lat.toFixed(3) !== loadedForecastLatitude || lng.toFixed(3) !== loadedForecastLongitude)) {
                loadOpenMeteoForecast(lat, lng);
            }

            updateAdminLocationName(lat, lng);

            const mapLinkAdmin = document.getElementById('map-link-btn-admin');
            if (mapLinkAdmin && lat !== 0 && lng !== 0) {
                mapLinkAdmin.href = `https://www.google.com/maps?q=${lat},${lng}`;
            }

            // Heartbeat & Sensor Data Update
            const lightVal = data.lightLevel !== undefined ? parseFloat(data.lightLevel) : -1.0;
            const waterVal = data.waterLevel !== undefined ? parseFloat(data.waterLevel) : -1.0;
            const pressureTrend = data.pressureTrend !== undefined ? parseFloat(data.pressureTrend) : 0.0;
            const cloudCover = data.cloudCover !== undefined ? parseFloat(data.cloudCover) : 0.0;
            const waterRiseRate = data.waterRiseRate !== undefined ? parseFloat(data.waterRiseRate) : 0.0;

            const lightEl = document.getElementById('light-summary');
            const waterEl = document.getElementById('water-summary');
            const rainEl = document.getElementById('rain-summary');
            const rainRateEl = document.getElementById('rain-rate-summary');
            const adminAlertBadge = document.getElementById('admin-alert-badge');
            const adminRainIntensityBadge = document.getElementById('admin-rain-intensity-badge');

            if (lightEl) lightEl.innerText = lightVal >= 0 ? lightVal.toFixed(0) : "--";
            if (waterEl) waterEl.innerText = waterVal >= 0 ? waterVal.toFixed(1) : "--";
            if (rainEl) rainEl.innerText = currentRainfallVal.toFixed(2);

            const rainRateVal = data.rainRate !== undefined ? parseFloat(data.rainRate) : 0.0;
            if (rainRateEl) rainRateEl.innerText = rainRateVal.toFixed(1);

            // Update Admin Current Rain Risk Badge
            if (adminAlertBadge) {
                const dangerThreshold = alertThresholdVal;
                const warningThreshold = alertThresholdVal * 0.5;
                if (currentRainfallVal >= dangerThreshold) {
                    adminAlertBadge.innerText = "CRITICAL";
                    adminAlertBadge.className = "risk-badge danger";
                } else if (currentRainfallVal >= warningThreshold) {
                    adminAlertBadge.innerText = "WARNING";
                    adminAlertBadge.className = "risk-badge warning";
                } else if (currentRainfallVal > 0) {
                    adminAlertBadge.innerText = "ALERT";
                    adminAlertBadge.className = "risk-badge alert-level";
                } else {
                    adminAlertBadge.innerText = "Safe";
                    adminAlertBadge.className = "risk-badge safe";
                }
            }

            // Update Admin Rain Rate Intensity Badge
            if (adminRainIntensityBadge) {
                const intensityStr = data.rainIntensity || (rainRateVal >= 50.0 ? 'Violent' : rainRateVal >= 7.5 ? 'Heavy' : rainRateVal >= 2.5 ? 'Moderate' : rainRateVal > 0 ? 'Light' : 'None');
                adminRainIntensityBadge.innerText = intensityStr;
                adminRainIntensityBadge.className = intensityStr === 'None' ? 'risk-badge safe' : (intensityStr === 'Heavy' || intensityStr === 'Violent') ? 'risk-badge danger' : 'risk-badge warning';
            }

            // Update charts when we have a valid and new reading
            if (lastSeenStr && lastSeenStr !== lastProcessedTime) {
                lastProcessedTime = lastSeenStr;
                updateCharts(currentRainfallVal, tempVal, humidityVal, pressureVal, waterVal, lightVal);
            }

            let cloudCoverVal = data.cloudCover !== undefined ? parseFloat(data.cloudCover) : 0.0;
            if ((data.cloudCover === undefined || cloudCoverVal === 0) && lightVal >= 0) {
                const ratio = Math.min(1.0, lightVal / maxClearSkyLux);
                cloudCoverVal = (1.0 - ratio) * 100.0;
            }
            // Store globally so config snapshot can re-use them
            currentRainRateVal = rainRateVal;
            currentWaterVal = waterVal;
            currentCloudCoverVal = cloudCoverVal;
            currentLightVal = lightVal;
            updateWeatherBackground(rainRateVal, waterVal, lightVal);

            // Call updatePredictions to refresh the Weather Outlook card
            updatePredictions(
                tempVal, humidityVal, pressureVal, currentRainfallVal,
                lightVal, waterVal, pressureTrend, cloudCoverVal, waterRiseRate
            );

            // Update reactive global state and refresh timeline
            currentSensorData = { temp: tempVal, rainRate: rainRateVal, water: waterVal, light: lightVal };
            populateHourlyTempTimeline();
        } else {
            updateStatusUI("OFFLINE", "#ef4444", false);
            // Default background based on time if no data
            if (typeof updateBackgroundByTime === 'function') updateBackgroundByTime();
        }

        // Hide splash screen AFTER background is determined
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => splash.remove(), 500);
        }
    }, err => {
        console.error("Dashboard Snapshot Error:", err);
        updateStatusUI("ERROR", "#ef4444", false);
    });

    let lastFetchedAdminLocationNameLat = null;
    let lastFetchedAdminLocationNameLng = null;
    const locationNameDisplayAdmin = document.getElementById('location-name-display-admin');

    async function updateAdminLocationName(lat, lng) {
        if (lat === 0 || lng === 0) return;
        if (lastFetchedAdminLocationNameLat === lat && lastFetchedAdminLocationNameLng === lng) return;

        try {
            if (locationNameDisplayAdmin) locationNameDisplayAdmin.innerText = 'Resolving location...';
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`, {
                headers: { 'User-Agent': 'BRIANE-Admin-Dashboard/1.0' }
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

            if (locationNameDisplayAdmin) locationNameDisplayAdmin.innerText = placeName;
            lastFetchedAdminLocationNameLat = lat;
            lastFetchedAdminLocationNameLng = lng;
        } catch (e) {
            console.error("Error fetching admin location name:", e);
            if (locationNameDisplayAdmin) locationNameDisplayAdmin.innerText = 'Location lookup failed';
        }
    }

    // 2. Load Config
    db.collection('weather').doc('config').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            const threshold = data.alertThreshold || 50;
            alertThresholdVal = parseFloat(threshold);
            if (thresholdInput) thresholdInput.value = threshold;
            if (currentThresholdDisplay) currentThresholdDisplay.innerText = threshold;
            if (alertMsgInput) alertMsgInput.value = data.alertMessage || "FLOOD ALERT! Potential flooding in your area.";

            // Populate New Model Fields
            if (paramAInput) paramAInput.value = data.paramA || 200;
            if (paramBInput) paramBInput.value = data.paramB || 1.6;
            if (weightPresInput) weightPresInput.value = data.weightPres || 40;
            if (weightHumInput) weightHumInput.value = data.weightHum || 20;
            if (weightLightInput) weightLightInput.value = data.weightLight || 20;
            if (weightRainInput) weightRainInput.value = data.weightRain || 20;

            // Populate New HW Fields
            if (tempOffsetInput) tempOffsetInput.value = data.tempOffset || 0;
            if (waterOffsetInput) waterOffsetInput.value = data.waterOffset || 0;
            if (mountHeightInput) mountHeightInput.value = data.mountHeight || 200;
            if (normalIntervalInput) normalIntervalInput.value = data.normalInterval || 10;
            if (emergencyIntervalInput) emergencyIntervalInput.value = data.emergencyInterval || 1;
            if (radiusInput) radiusInput.value = data.coverageRadius || 5.0;
            if (wifiSsidInput) wifiSsidInput.value = data.wifiSSID || "";
            if (wifiPassInput) wifiPassInput.value = data.wifiPass || "";
            if (maxLuxInput) maxLuxInput.value = data.maxClearLux || 65000;
            if (basePresInput) basePresInput.value = data.basePressure || 1013;

            // Populate New Alert/Cooldown Fields
            if (alertCooldownInput) alertCooldownInput.value = data.alertCooldown || 5;
            if (maintenanceToggle) maintenanceToggle.checked = data.maintenanceMode === true;

            // Update global settings for live calculations
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
                if (graphTensionSlider) graphTensionSlider.value = currentGraphTension * 100;
            }
            if (data.graphWindow !== undefined) {
                const oldWindow = currentGraphWindow;
                currentGraphWindow = data.graphWindow;
                if (graphWindowSelect) graphWindowSelect.value = currentGraphWindow;

                // If window increased, reload history to fill the gap
                if (currentGraphWindow > oldWindow && historyInitialized) {
                    initializeChartHistory();
                }
            }

            // Update Report Param Labels
            const paramZr = document.getElementById('param-zr');
            if (paramZr) paramZr.innerText = `a=${data.paramA || 200}, b=${data.paramB || 1.6}`;

            const paramSaturation = document.getElementById('param-saturation');
            if (paramSaturation && currentRainfallVal !== undefined) {
                const saturation = Math.min(1.0, currentRainfallVal / alertThresholdVal);
                paramSaturation.innerText = saturation.toFixed(2);
            }

            const allCharts = [detailedTempChart, detailedHumChart, detailedPresChart, detailedRainChart, detailedWaterChart, detailedLightChart, atmosphericChart, chartRain];
            allCharts.forEach(c => {
                if (c) {
                    c.data.datasets.forEach(ds => ds.tension = currentGraphTension);
                    c.update('none');
                }
            });

            updateWeatherBackground(currentRainRateVal, currentWaterVal, currentLightVal);
        }
    });

    // 3. SIM Status
    db.collection('weather').doc('sim').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            const statusStr = data.status || "No report";
            if (simResponseText) simResponseText.innerText = statusStr;
            if (simLastCheckText) simLastCheckText.innerText = data.lastCheck || "--";

            const lowerStatus = statusStr.toLowerCase();
            if (simExpiryAlert) {
                simExpiryAlert.style.display = (lowerStatus.includes("expired") || lowerStatus.includes("0.00")) ? 'flex' : 'none';
            }
        }
    });

    // 4. Load Users
    db.collection('users').onSnapshot(snapshot => {
        if (!userTableBody) return;
        userTableBody.innerHTML = '';
        let subscriberCount = 0;

        snapshot.forEach(doc => {
            const userData = doc.data();
            if (userData.role === 'admin') return;
            subscriberCount++;

            const isDisabled = userData.disabled === true;
            const statusColor = isDisabled ? '#f59e0b' : (userData.phoneNumber ? '#10b981' : '#ef4444');
            const statusText = isDisabled ? 'Disabled' : (userData.phoneNumber ? 'Verified' : 'Pending');

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div style="font-weight: 700;">${userData.email}</div>
                    <div style="font-size: 0.7rem; color: #94a3b8;">${doc.id.substring(0, 10)}</div>
                </td>
                <td>${userData.phoneNumber || 'N/A'}</td>
                <td>
                    <span style="color: ${statusColor}; font-weight: 700; font-size: 0.8rem;">
                        ${statusText}
                    </span>
                </td>
                <td>
                    <button class="text-btn ${isDisabled ? 'success' : 'warning'}" onclick="toggleUserStatus('${doc.id}', ${isDisabled})">
                        ${isDisabled ? 'Enable' : 'Disable'}
                    </button>
                </td>
            `;
            userTableBody.appendChild(row);
        });
        if (totalUsersCount) totalUsersCount.innerText = subscriberCount;
    });

    // 5. System Logs
    db.collection('logs').orderBy('timestamp', 'desc').limit(15).onSnapshot(snapshot => {
        if (!logsContainer) return;
        if (snapshot.empty) {
            logsContainer.innerHTML = '<div class="terminal-placeholder">No recent events.</div>';
            return;
        }
        logsContainer.innerHTML = '';
        snapshot.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp ? (log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp)).toLocaleTimeString() : '---';

            const logEl = document.createElement('div');
            logEl.style.cssText = "padding: 8px 0; border-bottom: 1px solid #1e293b; color: #e2e8f0; font-size: 0.8rem; font-family: monospace;";
            logEl.innerHTML = `
                <span style="color: #64748b;">[${time}]</span>
                <span style="color: ${log.type === 'Error' ? '#f43f5e' : '#fbbf24'}; font-weight: 800;">${log.type || 'SYS'}:</span>
                ${log.message}
            `;
            logsContainer.appendChild(logEl);
        });
    });
}

function updateStatusUI(text, color, isOnline) {
    if (deviceStatusValue) {
        deviceStatusValue.innerText = text;
        deviceStatusValue.parentElement.style.color = color;
    }
    if (deviceStatusValueDesktop) {
        deviceStatusValueDesktop.innerText = text;
        deviceStatusValueDesktop.parentElement.style.color = color;
    }
    if (deviceStatusSummary) {
        deviceStatusSummary.innerText = isOnline ? "Active" : "Offline";
        deviceStatusSummary.style.color = color;
    }
    if (headerStatusDot) {
        headerStatusDot.className = isOnline ? 'pulse-dot dot-online' : 'pulse-dot';
        headerStatusDot.style.background = color;
    }
    if (headerStatusDotDesktop) {
        headerStatusDotDesktop.className = isOnline ? 'pulse-dot dot-online' : 'pulse-dot';
        headerStatusDotDesktop.style.background = color;
    }
}

// Heartbeat Monitor - Force status check every 30 seconds
setInterval(() => {
    if (!lastSeenTimestamp) return;
    const diffMinutes = (new Date() - lastSeenTimestamp) / 1000 / 60;
    if (diffMinutes >= 15) {
        updateStatusUI("OFFLINE", "#ef4444", false);
    } else {
        updateStatusUI("ONLINE", "#10b981", true);
    }
}, 30000);

// Actions
if (updateThresholdBtn) {
    updateThresholdBtn.addEventListener('click', async () => {
        const val = parseFloat(thresholdInput.value);
        if (isNaN(val)) return;
        try {
            await db.collection('weather').doc('config').set({ alertThreshold: val }, { merge: true });
            showToast("Threshold Updated");
        } catch (e) { alert(e.message); }
    });
}

if (saveMsgBtn) {
    saveMsgBtn.addEventListener('click', async () => {
        try {
            await db.collection('weather').doc('config').set({ alertMessage: alertMsgInput.value }, { merge: true });
            showToast("Message Saved");
        } catch (e) { alert(e.message); }
    });
}

if (saveModelBtn) {
    saveModelBtn.addEventListener('click', async () => {
        try {
            await db.collection('weather').doc('config').set({
                paramA: parseFloat(paramAInput.value),
                paramB: parseFloat(paramBInput.value),
                weightPres: parseInt(weightPresInput.value),
                weightHum: parseInt(weightHumInput.value),
                weightLight: parseInt(weightLightInput.value),
                weightRain: parseInt(weightRainInput.value)
            }, { merge: true });
            showToast("Model Parameters Updated");
        } catch (e) { alert(e.message); }
    });
}

if (saveHwBtn) {
    saveHwBtn.addEventListener('click', async () => {
        try {
            await db.collection('weather').doc('config').set({
                tempOffset: parseFloat(tempOffsetInput.value),
                waterOffset: parseFloat(waterOffsetInput.value),
                mountHeight: parseFloat(mountHeightInput.value),
                normalInterval: parseInt(normalIntervalInput.value),
                emergencyInterval: parseInt(emergencyIntervalInput.value),
                coverageRadius: parseFloat(radiusInput.value),
                maxClearLux: parseFloat(maxLuxInput.value),
                basePressure: parseFloat(basePresInput.value),
                wifiSSID: wifiSsidInput.value,
                wifiPass: wifiPassInput.value
            }, { merge: true });
            showToast("Hardware & WiFi Config Saved");
        } catch (e) { alert(e.message); }
    });
}

if (saveAlertBtn) {
    saveAlertBtn.addEventListener('click', async () => {
        try {
            await db.collection('weather').doc('config').set({
                alertCooldown: parseFloat(alertCooldownInput.value),
                maintenanceMode: maintenanceToggle.checked
            }, { merge: true });
            showToast("System State Applied");
        } catch (e) { alert(e.message); }
    });
}

if (triggerManualSmsBtn) {
    triggerManualSmsBtn.addEventListener('click', async () => {
        if (!confirm("This will instantly send an emergency SMS to all registered users. Proceed?")) return;

        try {
            triggerManualSmsBtn.disabled = true;
            await db.collection('weather').doc('config').set({
                manualSmsTrigger: true,
                manualSmsTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            showToast("Manual Alert Signal Sent");
            setTimeout(() => { triggerManualSmsBtn.disabled = false; }, 5000);
        } catch (e) {
            alert(e.message);
            triggerManualSmsBtn.disabled = false;
        }
    });
}

// AI Help Modal Trigger
const infoAiBtn = document.getElementById('info-ai-btn');
if (infoAiBtn) {
    infoAiBtn.addEventListener('click', () => {
        const explanation = `
AI MODEL CALIBRATION GUIDE

1. Z-R Relationship (R = aZ^b):
Standard meteorological formula for Rainfall Intensity (R).
- 'a' constant: Typically 200 (Steady rain) to 300 (Tropical storms).
- 'b' constant: Typically 1.6. Lowering this makes the model more sensitive to heavy rain.

2. Prediction Weights:
Defines the "Intelligence" of the 0-10 risk score.
- Pressure: High weight enables "Anticipatory" warnings before it rains.
- Humidity: Weights the saturation level of the atmosphere.
- Light: Proxy for cloud cover; drops during storm entry.
- Rain: Weighted 'Reactive' reporting of actual sensor data.

Tuning these allows the network to be optimized for your specific city's climate.
        `;
        alert(explanation);
    });
}

const infoHwBtn = document.getElementById('info-hw-btn');
if (infoHwBtn) {
    infoHwBtn.addEventListener('click', () => {
        const explanation = `
HARDWARE & TRANSMISSION GUIDE

1. Sensor Calibration Offsets:
- Temperature: Adjust for internal board heat (e.g., -2.0 if board is inside a case).
- True Zero Adjustment: Small +/- correction so the dashboard shows exactly 0.0 cm when the ground is dry.

2. Sensor-to-Ground Distance:
- This is the total distance from the sensor face to the river bed/ground.
- It is used to convert sensor distance into actual water depth (Depth = Distance to Ground - Sensor Reading).

3. Transmission Intervals:
- Normal Mode: Upload frequency during clear weather (saves SIM data).
- Emergency Mode: Faster upload frequency during flood events for real-time tracking.

4. Deployment Radius:
- Defines the localized area (in km) that this specific sensor station protects.
        `;
        alert(explanation);
    });
}

if (saveChartSettingsBtn) {
    saveChartSettingsBtn.addEventListener('click', async () => {
        const tension = parseFloat(graphTensionSlider.value) / 100;
        const windowVal = parseInt(graphWindowSelect.value);

        try {
            await db.collection('weather').doc('config').set({
                graphTension: tension,
                graphWindow: windowVal
            }, { merge: true });
            showToast("Chart Settings Applied");
        } catch (e) {
            alert("Error saving chart settings: " + e.message);
        }
    });
}

if (setNowSimBtn) {
    setNowSimBtn.addEventListener('click', () => {
        const now = new Date();
        // Adjust for local time to match datetime-local input format
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
        simDateTime.value = localISOTime;
    });
}

if (pushSimBtn) {
    pushSimBtn.addEventListener('click', async () => {
        const temp = parseFloat(simTemp.value) || 0;
        const hum = parseFloat(simHum.value) || 0;
        const pres = parseFloat(simPres.value) || 0;
        const rain = parseFloat(simRain.value) || 0;
        const rainRate = parseFloat(simRainRate.value) || 0;
        const light = parseFloat(simLight.value) || 0;
        const water = parseFloat(simWater.value) || 0;
        const selectedDateTime = simDateTime.value ? new Date(simDateTime.value) : null;

        // Compute derived metrics (same formulas as Arduino code.ino)
        // Dew Point — Magnus formula
        let dewPoint = 0;
        if (hum > 0 && temp !== 0) {
            const a = 17.27, b = 237.7;
            const gamma = (a * temp) / (b + temp) + Math.log(hum / 100.0);
            dewPoint = (b * gamma) / (a - gamma);
        }

        // Heat Index — Rothfusz regression (only meaningful above 27°C)
        let heatIndex = temp;
        if (temp >= 27.0) {
            const T = temp * 9.0 / 5.0 + 32.0;
            const R = hum;
            const HI = -42.379 + 2.04901523 * T + 10.14333127 * R
                - 0.22475541 * T * R - 6.83783e-3 * T * T
                - 5.481717e-2 * R * R + 1.22874e-3 * T * T * R
                + 8.5282e-4 * T * R * R - 1.99e-6 * T * T * R * R;
            heatIndex = (HI - 32.0) * 5.0 / 9.0;
        }

        // Cloud cover from light
        const MAX_CLEAR_SKY_LUX = 65000.0;
        let cloudCover = 0;
        if (light >= 10) {
            const ratio = Math.min(1.0, light / MAX_CLEAR_SKY_LUX);
            cloudCover = (1.0 - ratio) * 100.0;
        }

        // Rain intensity (WMO classification based on rate)
        let rainIntensity = 'None';
        if (rainRate > 0 && rainRate < 2.5) rainIntensity = 'Light';
        else if (rainRate >= 2.5 && rainRate < 7.5) rainIntensity = 'Moderate';
        else if (rainRate >= 7.5 && rainRate < 50.0) rainIntensity = 'Heavy';
        else if (rainRate >= 50.0) rainIntensity = 'Violent';

        const data = {
            rainfall: rain,
            temperature: temp,
            humidity: hum,
            pressure: pres,
            lightLevel: light,
            waterLevel: water,
            dewPoint: parseFloat(dewPoint.toFixed(1)),
            heatIndex: parseFloat(heatIndex.toFixed(1)),
            rainRate: parseFloat(rainRate.toFixed(1)),
            rainIntensity: rainIntensity,
            cloudCover: parseFloat(cloudCover.toFixed(0)),
            pressureTrend: 0.0,
            waterRiseRate: 0.0,
            lastSeen: selectedDateTime || firebase.firestore.FieldValue.serverTimestamp(),
            isSimulated: true
        };

        try {
            pushSimBtn.disabled = true;
            // Update current state
            await db.collection('weather').doc('current').set(data, { merge: true });

            // ALSO push to history to populate the graphs
            const historyData = {
                ...data,
                timestamp: selectedDateTime || firebase.firestore.FieldValue.serverTimestamp()
            };
            delete historyData.lastSeen; // use timestamp for history
            await db.collection('weather_history').add(historyData);

            showToast("Test Data Pushed");

            // Immediately reload weekly data if on the reports section
            const activeSection = document.querySelector('.view-section.active');
            if (activeSection && (activeSection.id === 'section-reports' || activeSection.id === 'section-overview')) {
                loadWeeklyData();
            }

            // Log the simulation
            await db.collection('logs').add({
                type: "SIM",
                message: `Admin triggered simulation: R:${rain} T:${temp} H:${hum} DP:${dewPoint.toFixed(1)} HI:${heatIndex.toFixed(1)} RR:${rainRate.toFixed(1)}`,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            setTimeout(() => { pushSimBtn.disabled = false; }, 2000);
        } catch (e) {
            alert(e.message);
            pushSimBtn.disabled = false;
        }
    });
}

if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', async () => {
        if (!confirm("Clear all logs?")) return;
        const snip = await db.collection('logs').get();
        const batch = db.batch();
        snip.forEach(d => batch.delete(d.ref));
        await batch.commit();
    });
}

window.deleteUser = async function (uid) {
    if (confirm("Permanently remove this user?")) {
        await db.collection('users').doc(uid).delete();
    }
}

window.toggleUserStatus = async function (uid, isCurrentlyDisabled) {
    const action = isCurrentlyDisabled ? "enable" : "disable";
    if (confirm(`Are you sure you want to ${action} this account?`)) {
        try {
            await db.collection('users').doc(uid).update({
                disabled: !isCurrentlyDisabled
            });
            showToast(`Account ${action}d`);
        } catch (e) {
            showToast("Error updating status");
        }
    }
}

function showToast(msg) {
    let toast = document.querySelector('.toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.classList.add('show');

    if (toast.timeoutId) {
        clearTimeout(toast.timeoutId);
    }

    toast.timeoutId = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Logout Logic (Support both Desktop Sidebar and Mobile Header)
document.querySelectorAll('.logout-action-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
        if (confirm("Are you sure you want to sign out?")) {
            auth.signOut();
        }
    });
});
