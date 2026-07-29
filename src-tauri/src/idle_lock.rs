// Rust port of src/services/IdleLockService.js. Polls real OS idle time
// (via the `user-idle` crate - X11/XScreenSaver on Linux, matching what
// Electron's powerMonitor.getSystemIdleTime() covers on Windows/macOS/
// Linux) rather than resetting a timer on every IPC call, for the same
// reasons the JS version gives: periodic IPC calls would mask genuine
// idleness, and a long renderer-only interaction with no IPC calls could
// incorrectly auto-lock.

#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use user_idle::UserIdle;

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(5000);

/// Pure decision logic, kept separate from the polling thread/real OS
/// idle-time query specifically so it's unit-testable without a display
/// server (this sandbox has none) - mirrors IdleLockService.js's
/// `if (!thresholdSeconds || thresholdSeconds <= 0) return; if (idleSeconds >= thresholdSeconds) ...`.
fn should_lock(idle_seconds: u64, threshold_seconds: u64) -> bool {
    threshold_seconds > 0 && idle_seconds >= threshold_seconds
}

fn minutes_to_threshold_seconds(minutes: f64) -> u64 {
    if minutes > 0.0 {
        (minutes * 60.0) as u64
    } else {
        0
    }
}

/// Shared handle a background poll thread reads from; `start`/`stop` just
/// flip the threshold, the thread itself is spawned once and lives for
/// the app's lifetime.
#[derive(Clone)]
pub struct IdleLockController {
    threshold_seconds: Arc<AtomicU64>, // 0 = disabled
}

impl IdleLockController {
    /// Spawns the background poll thread. `on_timeout` runs (on the poll
    /// thread) whenever real OS idle time meets/exceeds the current
    /// threshold; it's responsible for checking whether the vault is
    /// still unlocked and actually locking it.
    pub fn spawn(on_timeout: impl Fn() + Send + 'static) -> Self {
        Self::spawn_with_interval(on_timeout, DEFAULT_POLL_INTERVAL)
    }

    fn spawn_with_interval(on_timeout: impl Fn() + Send + 'static, poll_interval: Duration) -> Self {
        let threshold_seconds = Arc::new(AtomicU64::new(0));
        let threshold_for_thread = threshold_seconds.clone();

        std::thread::spawn(move || loop {
            std::thread::sleep(poll_interval);
            let threshold = threshold_for_thread.load(Ordering::Relaxed);
            if threshold == 0 {
                continue;
            }
            let Ok(idle) = UserIdle::get_time() else { continue };
            if should_lock(idle.as_seconds(), threshold) {
                threshold_for_thread.store(0, Ordering::Relaxed); // mirrors JS's stop() before firing
                on_timeout();
            }
        });

        Self { threshold_seconds }
    }

    /// (Re)starts polling with the given threshold. 0 (or negative)
    /// minutes stops polling (auto-lock disabled).
    pub fn start(&self, minutes: f64) {
        self.threshold_seconds.store(minutes_to_threshold_seconds(minutes), Ordering::Relaxed);
    }

    pub fn stop(&self) {
        self.threshold_seconds.store(0, Ordering::Relaxed);
    }

    #[cfg(test)]
    fn threshold(&self) -> u64 {
        self.threshold_seconds.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_lock_requires_a_positive_threshold_and_idle_at_least_meeting_it() {
        assert!(!should_lock(100, 0)); // disabled
        assert!(!should_lock(4, 5)); // not idle long enough
        assert!(should_lock(5, 5)); // exactly at threshold
        assert!(should_lock(10, 5)); // well past threshold
    }

    #[test]
    fn minutes_to_threshold_seconds_converts_and_disables_on_non_positive() {
        assert_eq!(minutes_to_threshold_seconds(5.0), 300);
        assert_eq!(minutes_to_threshold_seconds(0.0), 0);
        assert_eq!(minutes_to_threshold_seconds(-1.0), 0);
    }

    #[test]
    fn start_and_stop_flip_the_shared_threshold() {
        let controller = IdleLockController::spawn_with_interval(|| {}, Duration::from_secs(3600));
        controller.start(5.0);
        assert_eq!(controller.threshold(), 300);
        controller.stop();
        assert_eq!(controller.threshold(), 0);
    }

    /// Not a correctness test of real OS idle time (no display server
    /// runs in this sandbox, so UserIdle::get_time() will error and the
    /// poll loop harmlessly skips every tick) - just confirms spawning
    /// and driving the controller doesn't panic.
    #[test]
    fn spawn_start_stop_does_not_panic_without_a_display_server() {
        let controller = IdleLockController::spawn_with_interval(|| {}, Duration::from_millis(10));
        controller.start(0.01);
        std::thread::sleep(Duration::from_millis(50));
        controller.stop();
    }
}
