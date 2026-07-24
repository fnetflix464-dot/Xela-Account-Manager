/**
 * Locks the vault after the *real* OS-level idle time (Electron's
 * `powerMonitor.getSystemIdleTime()`) exceeds a configurable threshold -
 * replacing the old "reset a timer on every successful IPC call"
 * approach, which had two real bugs: periodic IPC calls masked genuine
 * idleness, and a long renderer-only interaction with no IPC calls could
 * incorrectly auto-lock. Polling true system idle time fixes both.
 *
 * `powerMonitor` is injected rather than imported directly: Electron's
 * 'electron' module isn't statically importable from an ES Module in
 * this Electron version (verified - only the CommonJS main process can
 * `require('electron')`), so the main process passes it in.
 * @param {Object} options
 * @param {Object} options.powerMonitor Electron's powerMonitor module
 * @param {number} [options.pollIntervalMs] how often to check idle time
 */
export function createIdleLockService({ powerMonitor, pollIntervalMs = 5000 }) {
  let timer = null;
  let thresholdSeconds = 0; // 0 = disabled
  let onTimeout = () => {};

  function check() {
    if (!thresholdSeconds || thresholdSeconds <= 0) return;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= thresholdSeconds) {
      stop();
      onTimeout();
    }
  }

  /**
   * (Re)starts polling with the given threshold. Passing 0/undefined
   * minutes stops polling (auto-lock disabled).
   * @param {number} minutes
   * @param {function(): void} onTimeoutCallback
   */
  function start(minutes, onTimeoutCallback) {
    stop();
    thresholdSeconds = minutes > 0 ? minutes * 60 : 0;
    onTimeout = onTimeoutCallback || (() => {});
    if (!thresholdSeconds) return;
    timer = setInterval(check, pollIntervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
