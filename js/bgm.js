/* v40 — One background-music player shared by all exhibition chapters. */
(function () {
  'use strict';

  const STORAGE_KEY = 'stone-traces-bgm-enabled';
  const NORMAL_VOLUME = 0.27;
  const VIDEO_DUCK_RATIO = 0.20;
  const FADE_MS = 520;
  const AUDIO_PATH = 'assets/audio/stone-memory-mystic-v2-4min.wav';

  function storedPreference() {
    try { return localStorage.getItem(STORAGE_KEY) !== 'false'; }
    catch (_) { return true; }
  }
  function rememberPreference(enabled) {
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); }
    catch (_) { /* Private storage may be unavailable. */ }
  }

  const manager = {
    audio: null,
    button: null,
    enabled: storedPreference(),
    initialized: false,
    ducked: false,
    opening: false,
    fadeId: 0,
    fadeFrame: 0,
    playSerial: 0,
    video: null,

    init() {
      if (this.initialized) return;
      this.initialized = true;
      this.audio = new Audio(AUDIO_PATH);
      this.audio.loop = true;
      this.audio.preload = 'auto';
      this.audio.volume = 0;
      this.button = document.getElementById('siteBgmButton');
      this.video = document.getElementById('chapter05Video');
      this.button?.addEventListener('click', () => this.toggle());
      ['play', 'playing', 'pause', 'ended', 'error'].forEach(type => {
        this.audio.addEventListener(type, () => this.updateUI());
      });
      if (this.video) {
        ['play', 'playing', 'pause', 'ended', 'emptied', 'error'].forEach(type => {
          this.video.addEventListener(type, () => this.updateVideoDucking());
        });
        window.addEventListener('exhibition:pagechange', () => this.updateVideoDucking());
      }
      this.updateUI();
      if (this.button) this.button.hidden = false;
    },

    targetVolume() {
      return NORMAL_VOLUME * (this.ducked ? VIDEO_DUCK_RATIO : 1);
    },

    stopFade() {
      this.fadeId += 1;
      if (this.fadeFrame) cancelAnimationFrame(this.fadeFrame);
      this.fadeFrame = 0;
    },

    fadeTo(target, {duration = FADE_MS, complete = null} = {}) {
      if (!this.audio) return;
      this.stopFade();
      const id = this.fadeId;
      const from = this.audio.volume;
      const dest = Math.max(0, Math.min(1, target));
      const start = performance.now();
      const tick = now => {
        if (id !== this.fadeId) return;
        const p = Math.min(1, (now - start) / Math.max(1, duration));
        const eased = p * p * (3 - 2 * p);
        this.audio.volume = from + (dest - from) * eased;
        if (p < 1) this.fadeFrame = requestAnimationFrame(tick);
        else { this.fadeFrame = 0; if (complete) complete(); }
      };
      this.fadeFrame = requestAnimationFrame(tick);
    },

    async play({duringOpening = false} = {}) {
      if (!this.initialized) this.init();
      if (!this.enabled) return false;
      this.opening = duringOpening;
      const serial = ++this.playSerial;
      this.stopFade();
      // A real start-screen / BGM-button gesture must call HTMLMediaElement.play
      // directly before any async work, to comply with autoplay policies.
      if (this.audio.paused) this.audio.volume = 0;
      let promise;
      try { promise = this.audio.play(); }
      catch (_) { this.updateUI(); return false; }
      this.updateUI();
      try {
        await promise;
        if (serial !== this.playSerial || !this.enabled) {
          // An intervening explicit OFF action wins over this async play result.
          if (!this.enabled && !this.audio.paused) this.audio.pause();
          this.updateUI();
          return false;
        }
        if (!this.opening) this.fadeTo(this.targetVolume());
        this.updateUI();
        return true;
      } catch (_) {
        // User gestures on the BGM button can retry if autoplay was blocked.
        this.updateUI();
        return false;
      }
    },

    startFromOpeningGesture() {
      if (!this.enabled) return;
      // Must be invoked synchronously within the start button's click/keydown.
      void this.play({duringOpening: true});
    },

    openingFinished() {
      this.opening = false;
      if (!this.audio || !this.enabled || this.audio.paused) return;
      this.fadeTo(this.targetVolume(), {duration: 900});
    },

    tryDirectPageAutoplay() {
      if (!this.enabled || !this.audio?.paused) return;
      // Best effort once only. Browser policy can reject it; the button remains usable.
      void this.play({duringOpening: false});
    },

    toggle() {
      if (!this.initialized) this.init();
      // When autoplay was blocked but preference is ON, the visible button
      // shows 'off'; its next click must start playback instead of turning off.
      if (!this.enabled || this.audio.paused) {
        this.enabled = true;
        rememberPreference(true);
        void this.play({duringOpening: false});
        return;
      }
      this.enabled = false;
      rememberPreference(false);
      ++this.playSerial;
      this.opening = false;
      this.fadeTo(0, {
        duration: 450,
        complete: () => { if (!this.enabled) { this.audio.pause(); this.updateUI(); } }
      });
      // Button reflects the user's OFF intent immediately, before fade finishes.
      this.updateUI();
    },

    updateVideoDucking() {
      if (!this.video) return;
      const active = !!document.getElementById('chapter-05')?.classList.contains('active');
      const ducked = active && !this.video.paused && !this.video.ended;
      if (ducked === this.ducked) return;
      this.ducked = ducked;
      if (this.audio && !this.audio.paused && this.enabled && !this.opening) {
        this.fadeTo(this.targetVolume(), {duration: 450});
      }
    },

    updateUI() {
      if (!this.button || !this.audio) return;
      const playing = this.enabled && !this.audio.paused;
      this.button.dataset.playing = String(playing);
      this.button.setAttribute('aria-label', playing ? '배경음악 끄기' : '배경음악 켜기');
      this.button.setAttribute('title', playing ? '배경음악 끄기' : '배경음악 켜기');
      this.button.setAttribute('aria-pressed', String(playing));
      this.button.querySelector('.bgm-on-icon')?.setAttribute('aria-hidden', String(!playing));
      this.button.querySelector('.bgm-off-icon')?.setAttribute('aria-hidden', String(playing));
    }
  };

  window.exhibitionBgm = manager;
})();
