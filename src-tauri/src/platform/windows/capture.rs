//! Capture WASAPI en mode partagé, un thread par source, par sondage court (10 ms).
//!
//! - Micro : périphérique d'entrée par défaut, rôle « communications » (celui des apps d'appel),
//!   à défaut le rôle « console ».
//! - Son de l'ordinateur : loopback du périphérique de SORTIE par défaut (`eRender` initialisé en
//!   capture : `wasapi` ajoute `AUDCLNT_STREAMFLAGS_LOOPBACK`).
//!
//! On demande des flottants 32 bits au format de mixage du périphérique (fréquence et canaux) avec
//! conversion automatique ; la conversion en mono 16 kHz est faite ensuite par [`SourcePipeline`].
//! Le sondage (plutôt que les événements) est volontaire : en loopback, l'événement n'est pas
//! signalé de façon fiable selon les versions de Windows quand rien ne joue.
//!
//! Si le périphérique disparaît (débranché), le thread logue l'erreur, vide ce qu'il a, puis tente
//! chaque seconde de rouvrir le périphérique par défaut (ex. casque débranché → haut-parleurs).
//! Pendant ce temps, le mixeur complète par du silence : l'enregistrement continue.

use super::dsp::TARGET_RATE;
use super::mixer::Source;
use super::timeline::{Chunk, SourcePipeline};
use anyhow::{anyhow, Result};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use wasapi::{
    AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, Role, SampleType, StreamMode,
    WasapiError, WaveFormat,
};

/// Intervalle de sondage des paquets.
const POLL: Duration = Duration::from_millis(10);
/// Tampon WASAPI demandé (100 ns) : 200 ms, large devant le sondage.
const BUFFER_HNS: i64 = 2_000_000;
/// Délai entre deux tentatives de reconnexion.
const RETRY: Duration = Duration::from_secs(1);

const AUDCLNT_E_DEVICE_INVALIDATED: u32 = 0x8889_0004;
const AUDCLNT_E_SERVICE_NOT_RUNNING: u32 = 0x8889_0010;
const E_ACCESSDENIED: u32 = 0x8007_0005;
const E_NOTFOUND: u32 = 0x8007_0490;

/// Message envoyé par un thread de capture au démarrage : nom du périphérique, ou erreur lisible.
pub type Ready = (Source, std::result::Result<String, String>);

/// Lance le thread de capture d'une source.
pub fn spawn(
    source: Source,
    t0: Instant,
    stop: Arc<AtomicBool>,
    data: Sender<(Source, Chunk)>,
    ready: Sender<Ready>,
) -> std::io::Result<JoinHandle<()>> {
    let name = match source {
        Source::Mic => "sordulo-capture-micro",
        Source::System => "sordulo-capture-systeme",
    };
    thread::Builder::new().name(name.into()).spawn(move || {
        // COM en MTA, propre à ce thread.
        let com = wasapi::initialize_mta().is_ok();
        capture_loop(source, t0, &stop, &data, ready);
        // Tous les objets COM ont été libérés à la sortie de `capture_loop`.
        if com {
            wasapi::deinitialize();
        }
    })
}

fn capture_loop(
    source: Source,
    t0: Instant,
    stop: &AtomicBool,
    data: &Sender<(Source, Chunk)>,
    ready: Sender<Ready>,
) {
    let mut ready = Some(ready);
    while !stop.load(Ordering::Relaxed) {
        match Stream::open(source) {
            Ok(mut stream) => {
                match ready.take() {
                    Some(tx) => {
                        let _ = tx.send((source, Ok(stream.device_name.clone())));
                    }
                    None => log::info!(
                        "Enregistrement : {} reconnecté sur « {} »",
                        source.label(),
                        stream.device_name
                    ),
                }
                log::info!(
                    "Enregistrement : {} = « {} » ({} Hz, {} canal(aux))",
                    source.label(),
                    stream.device_name,
                    stream.rate,
                    stream.channels
                );
                match stream.run(t0, stop, data) {
                    Ok(Exit::Stopped) => return,
                    Ok(Exit::MixerGone) => return,
                    Err(err) => log::error!("{}", runtime_error_message(source, &err)),
                }
            }
            Err(err) => {
                if let Some(tx) = ready.take() {
                    let _ = tx.send((source, Err(err.to_string())));
                    return;
                }
                log::debug!("Reconnexion ({}) impossible : {err}", source.label());
            }
        }
        sleep_unless_stopped(RETRY, stop);
    }
}

fn sleep_unless_stopped(total: Duration, stop: &AtomicBool) {
    let start = Instant::now();
    while start.elapsed() < total && !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(20));
    }
}

enum Exit {
    Stopped,
    MixerGone,
}

struct Stream {
    source: Source,
    client: AudioClient,
    capture: AudioCaptureClient,
    device_name: String,
    rate: u32,
    channels: usize,
}

impl Stream {
    fn open(source: Source) -> Result<Self> {
        let enumerator = DeviceEnumerator::new()
            .map_err(|e| anyhow!("Service audio de Windows indisponible ({e})"))?;
        let device = match source {
            Source::Mic => enumerator
                .get_default_device_for_role(Direction::Capture, Role::Communications)
                .or_else(|_| enumerator.get_default_device(Direction::Capture)),
            Source::System => enumerator.get_default_device(Direction::Render),
        }
        .map_err(|e| anyhow!(open_error_message(source, &e)))?;
        let device_name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "périphérique sans nom".into());

        let init = |device: &wasapi::Device| -> std::result::Result<_, WasapiError> {
            let mut client = device.get_iaudioclient()?;
            let mix = client.get_mixformat()?;
            let rate = mix.get_samplespersec();
            let channels = usize::from(mix.get_nchannels().max(1));
            let format = WaveFormat::new(32, 32, SampleType::Float, rate as usize, channels, None);
            let mode = StreamMode::PollingShared {
                autoconvert: true,
                buffer_duration_hns: BUFFER_HNS,
            };
            client.initialize_client(&format, Direction::Capture, mode, None)?;
            let capture = client.get_audiocaptureclient()?;
            Ok((client, capture, rate, channels))
        };
        let (client, capture, rate, channels) =
            init(&device).map_err(|e| anyhow!(open_error_message(source, &e)))?;

        Ok(Self {
            source,
            client,
            capture,
            device_name,
            rate,
            channels,
        })
    }

    /// Lit les paquets jusqu'à l'arrêt ou une erreur, en envoyant les blocs 16 kHz au mixeur.
    fn run(
        &mut self,
        t0: Instant,
        stop: &AtomicBool,
        data: &Sender<(Source, Chunk)>,
    ) -> std::result::Result<Exit, WasapiError> {
        let mut pipeline = match SourcePipeline::new(self.rate, self.channels) {
            Ok(p) => p,
            Err(err) => {
                log::error!("Enregistrement ({}) : {err}", self.source.label());
                return Err(WasapiError::UnsupportedFormat);
            }
        };
        self.client.start_stream()?;

        let mut bytes: VecDeque<u8> = VecDeque::new();
        let mut samples: Vec<f32> = Vec::new();
        let result = loop {
            if stop.load(Ordering::Relaxed) {
                break Ok(Exit::Stopped);
            }
            if let Err(err) = self.read_available(&mut bytes) {
                break Err(err);
            }
            if !bytes.is_empty() {
                samples.clear();
                append_f32(&mut samples, bytes.make_contiguous());
                bytes.clear();
                let clock_end = t0.elapsed().as_secs_f64() * f64::from(TARGET_RATE);
                match pipeline.push(&samples, clock_end) {
                    Ok(chunks) => {
                        if !send_all(self.source, chunks, data) {
                            break Ok(Exit::MixerGone);
                        }
                    }
                    Err(err) => log::warn!("Enregistrement ({}) : {err}", self.source.label()),
                }
            }
            thread::sleep(POLL);
        };

        let _ = self.client.stop_stream();
        // Ce qui reste dans le rééchantillonneur (arrêt normal OU périphérique perdu).
        match pipeline.finish() {
            Ok(chunks) => {
                send_all(self.source, chunks, data);
            }
            Err(err) => log::warn!("Enregistrement ({}) : {err}", self.source.label()),
        }
        result
    }

    fn read_available(&self, bytes: &mut VecDeque<u8>) -> std::result::Result<(), WasapiError> {
        while let Some(frames) = self.capture.get_next_packet_size()? {
            if frames == 0 {
                break;
            }
            self.capture.read_from_device_to_deque(bytes)?;
        }
        Ok(())
    }
}

/// Convertit des octets (f32 little-endian) en échantillons ; un reste de moins de 4 octets est ignoré.
fn append_f32(out: &mut Vec<f32>, bytes: &[u8]) {
    out.extend((0..bytes.len() / 4).map(|i| {
        f32::from_le_bytes([
            bytes[4 * i],
            bytes[4 * i + 1],
            bytes[4 * i + 2],
            bytes[4 * i + 3],
        ])
    }));
}

fn send_all(source: Source, chunks: Vec<Chunk>, data: &Sender<(Source, Chunk)>) -> bool {
    chunks
        .into_iter()
        .all(|chunk| data.send((source, chunk)).is_ok())
}

fn hresult(err: &WasapiError) -> Option<u32> {
    match err {
        WasapiError::Windows(e) | WasapiError::RegisterNotifications(e) => Some(e.code().0 as u32),
        _ => None,
    }
}

/// Message d'erreur (français) quand une source ne peut pas démarrer.
fn open_error_message(source: Source, err: &WasapiError) -> String {
    let code = hresult(err);
    let detail = format!("({err})");
    match (source, code) {
        (_, Some(AUDCLNT_E_SERVICE_NOT_RUNNING)) => {
            format!("Le service audio de Windows ne fonctionne pas {detail}")
        }
        (Source::Mic, Some(E_ACCESSDENIED)) => format!(
            "Windows bloque l'accès au micro. Autorisez les applications de bureau à utiliser le micro \
             (Paramètres > Confidentialité et sécurité > Microphone) {detail}"
        ),
        (Source::Mic, Some(E_NOTFOUND)) | (Source::Mic, None) => format!(
            "Aucun micro détecté. Branchez un micro ou vérifiez qu'il est activé dans les paramètres \
             de son de Windows {detail}"
        ),
        (Source::System, Some(E_NOTFOUND)) | (Source::System, None) => format!(
            "Aucun périphérique de sortie audio (haut-parleurs ou casque) détecté : impossible \
             d'enregistrer le son de l'ordinateur {detail}"
        ),
        (Source::Mic, _) => format!("Impossible d'ouvrir le micro {detail}"),
        (Source::System, _) => {
            format!("Impossible d'enregistrer le son de l'ordinateur {detail}")
        }
    }
}

/// Message d'erreur (français) quand une source s'interrompt pendant l'enregistrement.
fn runtime_error_message(source: Source, err: &WasapiError) -> String {
    let what = match source {
        Source::Mic => "Le micro a été débranché ou désactivé",
        Source::System => "Le périphérique de sortie audio a été débranché ou désactivé",
    };
    if hresult(err) == Some(AUDCLNT_E_DEVICE_INVALIDATED) {
        format!(
            "{what} pendant l'enregistrement : silence à la place, reconnexion au périphérique par \
             défaut dès que possible"
        )
    } else {
        format!(
            "Enregistrement ({}) interrompu ({err}) : silence à la place, nouvelle tentative",
            source.label()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_to_f32() {
        let values = [0.5f32, -0.25, 1.0];
        let mut bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let mut out = Vec::new();
        append_f32(&mut out, &bytes);
        assert_eq!(out, values);
        // Octets en trop (trame incomplète) : ignorés.
        bytes.push(0);
        out.clear();
        append_f32(&mut out, &bytes);
        assert_eq!(out, values);
    }

    #[test]
    fn error_messages_are_french_and_specific() {
        let no_device = WasapiError::DeviceNotFound("x".into());
        assert!(open_error_message(Source::Mic, &no_device).starts_with("Aucun micro"));
        assert!(open_error_message(Source::System, &no_device)
            .starts_with("Aucun périphérique de sortie"));
        assert!(runtime_error_message(Source::Mic, &WasapiError::EventTimeout).contains("micro"));
    }
}
