//! Petit logger vers stderr pour la façade `log` (aucune dépendance en plus).
//!
//! Niveau par défaut : `info`. `RUST_LOG=debug` (ou `trace`, `warn`, `error`, `off`) le change.
//! En release (`windows_subsystem = "windows"`), stderr n'est relié à rien : les logs servent en dev.

use log::{LevelFilter, Log, Metadata, Record};

use crate::time::utc_clock;

struct StderrLogger {
    level: LevelFilter,
}

impl Log for StderrLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            eprintln!(
                "[{} {:<5} {}] {}",
                utc_clock(),
                record.level(),
                record.target(),
                record.args()
            );
        }
    }

    fn flush(&self) {}
}

/// Installe le logger. Sans effet si un logger est déjà installé.
pub fn init() {
    let level = std::env::var("RUST_LOG")
        .ok()
        .and_then(|value| value.trim().parse::<LevelFilter>().ok())
        .unwrap_or(LevelFilter::Info);
    let logger: &'static StderrLogger = Box::leak(Box::new(StderrLogger { level }));
    if log::set_logger(logger).is_ok() {
        log::set_max_level(level);
    }
}
