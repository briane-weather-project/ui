/**
 * Weather Background Manager — Enhanced
 * Switches the dashboard background with smooth transitions
 * and optional particle effects for rain/storm/night.
 */

(function () {
    'use strict';

    /* ── Rain / Storm Particle System ────────────────────────── */
    class RainRenderer {
        constructor(container, config = {}) {
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'rain-canvas';
            this.canvas.style.cssText = `
                position: absolute; inset: 0;
                width: 100%; height: 100%;
                pointer-events: none; z-index: 1;
            `;
            container.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
            this.drops = [];
            this.splashes = [];
            this.running = false;
            this.config = Object.assign({
                dropCount: 180,
                speed: 18,
                wind: 4,
                length: 22,
                opacity: 0.25,
                color: '180, 210, 230',
                splash: true,
            }, config);
            this._resize = this._resize.bind(this);
            this._frame = this._frame.bind(this);
            window.addEventListener('resize', this._resize);
        }

        start() {
            if (this.running) return;
            this.running = true;
            this._resize();
            this._initDrops();
            this._raf = requestAnimationFrame(this._frame);
        }

        stop() {
            this.running = false;
            cancelAnimationFrame(this._raf);
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        destroy() {
            this.stop();
            window.removeEventListener('resize', this._resize);
            this.canvas.remove();
        }

        _resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }

        _initDrops() {
            this.drops = [];
            const { dropCount } = this.config;
            for (let i = 0; i < dropCount; i++) {
                this.drops.push(this._newDrop(true));
            }
        }

        _newDrop(randomY = false) {
            const w = this.canvas.width;
            const h = this.canvas.height;
            const { speed, wind, length } = this.config;
            return {
                x: Math.random() * (w + 200) - 100,
                y: randomY ? Math.random() * h : -Math.random() * 80,
                len: length * (0.6 + Math.random() * 0.8),
                speed: speed * (0.7 + Math.random() * 0.6),
                wind: wind * (0.8 + Math.random() * 0.4),
                alpha: 0.1 + Math.random() * 0.2,
                width: 1 + Math.random() * 0.8,
            };
        }

        _frame() {
            if (!this.running) return;
            const { ctx, canvas, drops, splashes, config } = this;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw drops
            for (let i = drops.length - 1; i >= 0; i--) {
                const d = drops[i];
                d.x += d.wind;
                d.y += d.speed;

                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x + d.wind * 0.6, d.y + d.len);
                ctx.strokeStyle = `rgba(${config.color}, ${d.alpha})`;
                ctx.lineWidth = d.width;
                ctx.stroke();

                // Reset if off-screen
                if (d.y > canvas.height) {
                    // Splash effect
                    if (config.splash && Math.random() > 0.7) {
                        splashes.push({
                            x: d.x + d.wind * 0.6,
                            y: canvas.height - 2,
                            radius: 1,
                            maxRadius: 3 + Math.random() * 3,
                            alpha: 0.3,
                        });
                    }
                    drops[i] = this._newDrop(false);
                }
            }

            // Draw splashes
            for (let i = splashes.length - 1; i >= 0; i--) {
                const s = splashes[i];
                s.radius += 0.3;
                s.alpha -= 0.015;
                if (s.alpha <= 0 || s.radius > s.maxRadius) {
                    splashes.splice(i, 1);
                    continue;
                }
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.radius, Math.PI, 2 * Math.PI);
                ctx.strokeStyle = `rgba(${config.color}, ${s.alpha})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }

            this._raf = requestAnimationFrame(this._frame);
        }
    }

    /* ── Firefly / Star Particle System (night) ──────────────── */
    class StarfieldRenderer {
        constructor(container) {
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'star-canvas';
            this.canvas.style.cssText = `
                position: absolute; inset: 0;
                width: 100%; height: 100%;
                pointer-events: none; z-index: 1;
            `;
            container.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
            this.stars = [];
            this.running = false;
            this._resize = this._resize.bind(this);
            this._frame = this._frame.bind(this);
            window.addEventListener('resize', this._resize);
        }

        start() {
            if (this.running) return;
            this.running = true;
            this._resize();
            this._initStars();
            this._raf = requestAnimationFrame(this._frame);
        }

        stop() {
            this.running = false;
            cancelAnimationFrame(this._raf);
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        destroy() {
            this.stop();
            window.removeEventListener('resize', this._resize);
            this.canvas.remove();
        }

        _resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }

        _initStars() {
            this.stars = [];
            const count = Math.floor((this.canvas.width * this.canvas.height) / 6000);
            for (let i = 0; i < count; i++) {
                this.stars.push({
                    x: Math.random() * this.canvas.width,
                    y: Math.random() * this.canvas.height * 0.8,
                    radius: 0.3 + Math.random() * 1.2,
                    alpha: 0.2 + Math.random() * 0.8,
                    twinkleSpeed: 0.005 + Math.random() * 0.02,
                    twinkleDir: Math.random() > 0.5 ? 1 : -1,
                });
            }
        }

        _frame() {
            if (!this.running) return;
            const { ctx, canvas, stars } = this;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            for (const s of stars) {
                s.alpha += s.twinkleSpeed * s.twinkleDir;
                if (s.alpha >= 1) { s.alpha = 1; s.twinkleDir = -1; }
                if (s.alpha <= 0.1) { s.alpha = 0.1; s.twinkleDir = 1; }

                ctx.beginPath();
                ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(230, 240, 255, ${s.alpha})`;
                ctx.fill();
            }

            this._raf = requestAnimationFrame(this._frame);
        }
    }

    /* ── Background Manager ──────────────────────────────────── */
    let currentType = null;
    let rainRenderer = null;
    let starRenderer = null;

    function getBgContainer() {
        let bgContainer = document.querySelector('.weather-bg-container');
        if (!bgContainer) {
            bgContainer = document.createElement('div');
            bgContainer.className = 'weather-bg-container';
            document.body.prepend(bgContainer);
        }
        return bgContainer;
    }

    function cleanupRenderers() {
        if (rainRenderer) { rainRenderer.destroy(); rainRenderer = null; }
        if (starRenderer) { starRenderer.destroy(); starRenderer = null; }
    }

    /**
     * Set the weather background type.
     * @param {'sunny'|'clear'|'rainy'|'rain'|'night'|'cloudy'|'clouds'|'stormy'|'storm'} type
     */
    window.setWeatherBackground = function (type) {
        const bgContainer = getBgContainer();
        const normalised = type.toLowerCase().trim();

        // Map aliases
        const typeMap = {
            sunny: 'sunny', clear: 'sunny',
            rainy: 'rainy', rain: 'rainy',
            night: 'night',
            cloudy: 'cloudy', clouds: 'cloudy',
            stormy: 'stormy', storm: 'stormy',
        };
        const resolved = typeMap[normalised] || 'sunny';

        if (resolved === currentType) return;
        currentType = resolved;

        // Cleanup old renderers
        cleanupRenderers();

        // Remove old classes
        const classes = ['bg-sunny', 'bg-rainy', 'bg-night', 'bg-cloudy', 'bg-stormy'];
        bgContainer.classList.remove(...classes);
        document.body.classList.remove(...classes);

        // Add new class
        const newClass = 'bg-' + resolved;
        bgContainer.classList.add(newClass);
        document.body.classList.add(newClass);

        // Check for reduced motion preference
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Start particle renderers
        if (!prefersReducedMotion) {
            if (resolved === 'rainy') {
                rainRenderer = new RainRenderer(bgContainer, {
                    dropCount: 160,
                    speed: 16,
                    wind: 3.5,
                    length: 18,
                    color: '174, 213, 232',
                });
                rainRenderer.start();
            } else if (resolved === 'stormy') {
                rainRenderer = new RainRenderer(bgContainer, {
                    dropCount: 300,
                    speed: 26,
                    wind: 7,
                    length: 28,
                    opacity: 0.35,
                    color: '200, 220, 240',
                    splash: true,
                });
                rainRenderer.start();
            } else if (resolved === 'night') {
                starRenderer = new StarfieldRenderer(bgContainer);
                starRenderer.start();
            }
        }

        // Dispatch custom event for other components to listen
        document.dispatchEvent(new CustomEvent('weatherBackgroundChanged', {
            detail: { type: resolved }
        }));
    };

    /**
     * Auto-switch background based on time of day.
     */
    window.updateBackgroundByTime = function () {
        const hour = new Date().getHours();
        if (hour >= 19 || hour < 5) {
            setWeatherBackground('night');
        } else if (hour >= 5 && hour < 7) {
            setWeatherBackground('cloudy'); // dawn → overcast feel
        } else {
            setWeatherBackground('sunny');
        }
    };

})();
