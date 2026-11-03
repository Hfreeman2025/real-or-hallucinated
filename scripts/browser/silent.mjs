// Based on the authorised device-free pattern from listen-to-the-grid.
// OfflineAudioContext never opens a physical audio device.
export function silenceLiveAudio() {
  const Offline = window.OfflineAudioContext;
  if (!Offline) return;
  class DeviceFreeAudioContext extends Offline {
    constructor() {
      super(2, 128, 44100);
    }
    get currentTime() {
      return performance.now() / 1000;
    }
    get state() {
      return "running";
    }
    resume() {
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  window.AudioContext = DeviceFreeAudioContext;
  window.webkitAudioContext = DeviceFreeAudioContext;
}
