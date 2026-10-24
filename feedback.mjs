const SOUNDS = {
  move: [420, 270, .04, .025], warning: [620, 790, .10, .04],
  hit: [150, 55, .15, .11], tick: [650, 650, .06, .04],
  finish: [520, 780, .25, .055], record: [660, 1120, .35, .065],
};

export class GameFeedback {
  constructor({ host = window, storage, onChange = () => {} }) {
    this.host = host; this.storage = storage; this.onChange = onChange;
    this.muted = storage.get('lambda.electron.muted', false);
    this.vibrationEnabled = storage.get('lambda.electron.vibration', true);
    this.soundSupported = Boolean(host.AudioContext || host.webkitAudioContext);
    this.vibrationSupported = typeof host.navigator?.vibrate === 'function';
    this.voices = new Set(); this.lastVibration = {}; this.activated = false;
  }

  // Call directly from a click, before any network await loses the gesture.
  unlock() {
    this.activated = true;
    if (this.muted || !this.soundSupported) return Promise.resolve(false);
    // Supported Safari versions distinguish game playback from ambient audio.
    try {
      const session = this.host.navigator.audioSession;
      if (session) {
        this.previousSessionType ??= session.type;
        session.type = 'playback';
      }
    } catch { /* AudioSession is optional; Web Audio still works without it. */ }
    try {
      if (!this.audio || this.audio.state === 'closed') {
        const Audio = this.host.AudioContext || this.host.webkitAudioContext;
        this.audio = new Audio({ latencyHint: 'interactive' });
        this.master = this.audio.createGain(); this.master.gain.value = 1;
        this.master.connect(this.audio.destination); this.wind = null;
        this.audio.onstatechange = () => this.onChange();
      }
      const audio = this.audio;
      if (audio.state === 'running') return Promise.resolve(true);
      const resumed = audio.resume(); // Synchronous invocation matters on phones.
      const silent = audio.createBufferSource();
      silent.buffer = audio.createBuffer(1, 1, audio.sampleRate);
      silent.connect(this.master); silent.onended = () => silent.disconnect(); silent.start();
      return Promise.resolve(resumed).then(() => {
        this.onChange(); return audio.state === 'running';
      }, () => { this.onChange(); return false; });
    } catch { this.onChange(); return Promise.resolve(false); }
  }

  setMuted(value) {
    this.muted = Boolean(value); this.storage.set('lambda.electron.muted', this.muted);
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.audio.currentTime, .008);
    if (this.muted) this.stop();
    this.onChange();
    if (!this.muted) return this.unlock().then(ready => { if (ready) this.tone('move'); });
    return Promise.resolve();
  }

  setVibrationEnabled(value) {
    this.vibrationEnabled = Boolean(value);
    this.storage.set('lambda.electron.vibration', this.vibrationEnabled);
    if (!this.vibrationEnabled) this.cancelVibration();
    this.onChange();
  }

  tone(type) {
    if (this.muted || this.host.document?.hidden || this.audio?.state !== 'running' || !SOUNDS[type]) return;
    try {
      const [start, end, length, volume] = SOUNDS[type], audio = this.audio, at = audio.currentTime;
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = type === 'hit' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(start, at); osc.frequency.exponentialRampToValueAtTime(end, at + length);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(volume, at + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, at + length);
      osc.connect(gain); gain.connect(this.master); this.voices.add(osc);
      osc.onended = () => { this.voices.delete(osc); osc.disconnect(); gain.disconnect(); };
      osc.start(at); osc.stop(at + length + .02);
    } catch { /* The visual cue remains available. */ }
  }

  updateWind(ratio, active) {
    if (this.muted || !active || this.host.document?.hidden || this.audio?.state !== 'running') {
      if (this.wind) this.wind.gain.gain.setTargetAtTime(.0001, this.audio.currentTime, .025);
      return;
    }
    try {
      const audio = this.audio;
      if (!this.wind) {
        const buffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate), samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
        source.buffer = buffer; source.loop = true; filter.type = 'bandpass'; filter.Q.value = .55;
        source.connect(filter); filter.connect(gain); gain.connect(this.master);
        gain.gain.value = .0001; source.start(); this.wind = { source, filter, gain };
      }
      ratio = Math.max(0, Math.min(1, ratio));
      this.wind.filter.frequency.setTargetAtTime(220 + ratio * 1500, audio.currentTime, .12);
      this.wind.gain.gain.setTargetAtTime(.045 * ratio ** 2, audio.currentTime, .055);
    } catch { /* Speed is also represented by the trail. */ }
  }

  vibrate(type) {
    if (!this.vibrationSupported || !this.vibrationEnabled || !this.activated || this.host.document?.hidden) return;
    const pattern = type === 'hit' ? 32 : type === 'record' ? [12, 45, 20] : null;
    if (!pattern) return;
    const now = this.host.performance.now(), interval = type === 'hit' ? 120 : 1000;
    if (now - (this.lastVibration[type] ?? -Infinity) < interval) return;
    this.lastVibration[type] = now;
    try { this.host.navigator.vibrate(pattern); } catch { /* Unsupported devices keep visual feedback. */ }
  }

  cancelVibration() {
    if (this.vibrationSupported) try { this.host.navigator.vibrate(0); } catch { /* Optional hardware. */ }
  }

  stop() {
    if (this.wind) {
      this.wind.gain.gain.cancelScheduledValues(this.audio.currentTime);
      this.wind.gain.gain.setValueAtTime(.0001, this.audio.currentTime);
      this.wind.source.stop(); this.wind.source.disconnect(); this.wind.filter.disconnect(); this.wind.gain.disconnect();
      this.wind = null;
    }
    for (const voice of this.voices) try { voice.stop(); } catch { /* Already ended. */ }
    this.voices.clear(); this.cancelVibration();
    if (this.previousSessionType !== undefined) {
      try { this.host.navigator.audioSession.type = this.previousSessionType; } catch { /* Optional API. */ }
      this.previousSessionType = undefined;
    }
  }
}
