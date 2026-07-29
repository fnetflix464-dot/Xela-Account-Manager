// Shared "now, as an RFC3339 string" used everywhere the JS models called
// `new Date().toISOString()` - same format (millisecond precision, `Z`
// suffix, e.g. "2026-07-29T22:16:11.312Z").

use chrono::{SecondsFormat, Utc};

pub fn now_iso8601() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_millisecond_precision_with_z_suffix() {
        let ts = now_iso8601();
        assert!(ts.ends_with('Z'));
        assert!(chrono::DateTime::parse_from_rfc3339(&ts).is_ok());
        // e.g. "2026-07-29T22:16:11.312Z" - exactly 24 chars.
        assert_eq!(ts.len(), 24);
    }
}
