//! Outils de date sans dépendance (UTC) : horodatage des fichiers, heure des logs, durée lisible.

use std::time::{SystemTime, UNIX_EPOCH};

/// Millisecondes depuis l'epoch Unix.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Date civile (année, mois, jour) depuis un nombre de jours depuis 1970-01-01 (algorithme de H. Hinnant).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Horodatage UTC pour un nom de fichier : `20261118-153012-042Z`.
pub fn file_timestamp(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    let sod = secs.rem_euclid(86_400);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}-{:03}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        ms % 1000
    )
}

/// Heure UTC `hh:mm:ss.mmm` pour les logs.
pub fn utc_clock() -> String {
    let ms = now_ms();
    let sod = (ms / 1000) % 86_400;
    format!(
        "{:02}:{:02}:{:02}.{:03}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        ms % 1000
    )
}

/// Durée lisible : `03:12`, ou `1:03:12` au-delà d'une heure.
pub fn format_duration(secs: u64) -> String {
    let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_is_utc_and_sortable() {
        // 2026-11-18T15:30:12.042Z
        assert_eq!(file_timestamp(1_795_015_812_042), "20261118-153012-042Z");
        assert_eq!(file_timestamp(0), "19700101-000000-000Z");
    }

    #[test]
    fn durations() {
        assert_eq!(format_duration(0), "00:00");
        assert_eq!(format_duration(192), "03:12");
        assert_eq!(format_duration(3792), "1:03:12");
    }
}
