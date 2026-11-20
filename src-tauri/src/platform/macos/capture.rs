//! macOS — capture Core Audio, un thread par source. Même interface que `windows/capture.rs`
//! (`spawn`, `Ready`) : le reste de la chaîne (ligne de temps, mix, MP3, orchestration) est le code
//! partagé de `windows/` (voir `macos/mod.rs`).
//!
//! - Micro : périphérique d'entrée par défaut, lu par un IOProc du HAL.
//! - Son de l'ordinateur : « process tap » global de Core Audio (macOS 14.2+), placé dans un périphérique
//!   agrégé privé dont l'horloge est celle de la sortie par défaut, lu par un IOProc. Les sons de Sordulo
//!   OS elle-même sont exclus.
//!
//! L'IOProc (thread temps réel de Core Audio) ne fait que réduire chaque bloc en mono et l'ajouter à un
//! tampon ; le thread de la source le vide toutes les 10 ms, mesure le niveau et pousse les échantillons
//! dans [`SourcePipeline`] (16 kHz, position sur l'horloge), comme sous Windows.
//!
//! Le périphérique par défaut est surveillé chaque seconde : s'il change (AirPods connectés…) ou
//! disparaît, la source est rouverte sur le nouveau ; entre-temps le mixeur complète par du silence.
//!
//! Autorisations : micro (`NSMicrophoneUsageDescription`) et enregistrement du son du système
//! (`NSAudioCaptureUsageDescription`), demandées par macOS au premier enregistrement. En dev, elles sont
//! demandées au nom du terminal qui a lancé l'app.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject};
use objc2::msg_send;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSUUID};

use super::dsp::{rms, LevelMeter, LIVE_LEVELS, TARGET_RATE};
use super::mixer::Source;
use super::timeline::{Chunk, SourcePipeline};

/// Message envoyé par un thread de capture au démarrage : nom du périphérique, ou erreur lisible.
pub type Ready = (Source, std::result::Result<String, String>);

/// Période de vidage du tampon de l'IOProc.
const POLL: Duration = Duration::from_millis(10);
/// Vérification du périphérique par défaut.
const DEVICE_CHECK: Duration = Duration::from_secs(1);
/// Pause avant une nouvelle tentative d'ouverture.
const RETRY: Duration = Duration::from_secs(1);
/// Capacité réservée du tampon de l'IOProc (≈ 1 s à 48 kHz) : pas d'allocation en temps réel.
const BUFFER_CAPACITY: usize = 48_000;

// ---------------------------------------------------------------------------
// Core Audio (C)
// ---------------------------------------------------------------------------

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[repr(C)]
struct AudioBuffer {
    channels: u32,
    byte_size: u32,
    data: *mut c_void,
}

#[repr(C)]
struct AudioBufferList {
    count: u32,
    buffers: [AudioBuffer; 1],
}

type IoProc = unsafe extern "C" fn(
    device: u32,
    now: *const c_void,
    input: *const AudioBufferList,
    input_time: *const c_void,
    output: *mut AudioBufferList,
    output_time: *const c_void,
    client: *mut c_void,
) -> i32;

const fn fourcc(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
}

const SYSTEM_OBJECT: u32 = 1;
const SCOPE_GLOBAL: u32 = fourcc(b"glob");
const ELEMENT_MAIN: u32 = 0;
const DEFAULT_INPUT_DEVICE: u32 = fourcc(b"dIn ");
const DEFAULT_OUTPUT_DEVICE: u32 = fourcc(b"dOut");
const TRANSLATE_PID_TO_PROCESS: u32 = fourcc(b"id2p");
const DEVICE_UID: u32 = fourcc(b"uid ");
const OBJECT_NAME: u32 = fourcc(b"lnam");
const NOMINAL_SAMPLE_RATE: u32 = fourcc(b"nsrt");
const DEVICE_IS_ALIVE: u32 = fourcc(b"livn");
/// `kAudioHardwareIllegalOperationError` ('nope'), rendu entre autres quand l'autorisation est refusée.
const ILLEGAL_OPERATION: i32 = fourcc(b"nope") as i32;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        io_size: *mut u32,
        out_data: *mut c_void,
    ) -> i32;
    fn AudioHardwareCreateAggregateDevice(description: *const c_void, out_device: *mut u32) -> i32;
    fn AudioHardwareDestroyAggregateDevice(device: u32) -> i32;
    fn AudioDeviceCreateIOProcID(
        device: u32,
        proc_: IoProc,
        client: *mut c_void,
        out_id: *mut *mut c_void,
    ) -> i32;
    fn AudioDeviceDestroyIOProcID(device: u32, proc_id: *mut c_void) -> i32;
    fn AudioDeviceStart(device: u32, proc_id: *mut c_void) -> i32;
    fn AudioDeviceStop(device: u32, proc_id: *mut c_void) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const std::ffi::c_char) -> *mut c_void;
}

/// `RTLD_DEFAULT` sur macOS.
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

type CreateProcessTap = unsafe extern "C" fn(description: *mut c_void, out_tap: *mut u32) -> i32;
type DestroyProcessTap = unsafe extern "C" fn(tap: u32) -> i32;

/// Fonction de Core Audio absente des macOS anciens : cherchée à l'exécution (pas de lien fort, qui
/// empêcherait l'app de démarrer avant macOS 14.2).
fn symbol(name: &std::ffi::CStr) -> Option<*mut c_void> {
    // SAFETY : recherche d'un symbole dans les bibliothèques déjà chargées.
    let pointer = unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) };
    (!pointer.is_null()).then_some(pointer)
}

fn address(selector: u32) -> PropertyAddress {
    PropertyAddress {
        selector,
        scope: SCOPE_GLOBAL,
        element: ELEMENT_MAIN,
    }
}

/// Propriété scalaire, avec un qualificatif facultatif.
fn read<T: Copy + Default>(object: u32, selector: u32, qualifier: Option<&i32>) -> Option<T> {
    let address = address(selector);
    let mut value = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    let (qualifier_size, qualifier) = match qualifier {
        Some(q) => (std::mem::size_of::<i32>() as u32, (q as *const i32).cast()),
        None => (0, std::ptr::null()),
    };
    // SAFETY : `value` est un tampon de `size` octets ; le qualificatif vit pendant l'appel.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &address,
            qualifier_size,
            qualifier,
            &mut size,
            (&mut value as *mut T).cast(),
        )
    };
    (status == 0 && size as usize == std::mem::size_of::<T>()).then_some(value)
}

/// Propriété CFString (UID, nom), relâchée après copie.
fn read_string(object: u32, selector: u32) -> Option<String> {
    let pointer = read::<usize>(object, selector, None).filter(|p| *p != 0)? as *mut NSString;
    // SAFETY : CFString rendue par Core Audio (pont gratuit avec NSString), possédée par nous : on la
    // retient le temps de la copier puis on rend la référence reçue.
    let text = unsafe {
        let text = (*pointer).to_string();
        CFRelease(pointer.cast());
        text
    };
    Some(text)
}

fn default_device(source: Source) -> u32 {
    let selector = match source {
        Source::Mic => DEFAULT_INPUT_DEVICE,
        Source::System => DEFAULT_OUTPUT_DEVICE,
    };
    read::<u32>(SYSTEM_OBJECT, selector, None).unwrap_or(0)
}

fn device_name(device: u32) -> String {
    read_string(device, OBJECT_NAME).unwrap_or_else(|| "périphérique sans nom".into())
}

fn is_alive(device: u32) -> bool {
    read::<u32>(device, DEVICE_IS_ALIVE, None).is_none_or(|alive| alive != 0)
}

// ---------------------------------------------------------------------------
// IOProc
// ---------------------------------------------------------------------------

/// Tampon partagé entre l'IOProc (écrivain) et le thread de la source (lecteur) : échantillons mono à la
/// fréquence du périphérique.
struct Shared {
    samples: Mutex<Vec<f32>>,
}

/// Appelé par Core Audio sur son thread temps réel : moyenne de tous les canaux de tous les tampons
/// d'entrée (flottants 32 bits, format des IOProc du HAL), ajoutée au tampon partagé.
unsafe extern "C" fn io_proc(
    _device: u32,
    _now: *const c_void,
    input: *const AudioBufferList,
    _input_time: *const c_void,
    _output: *mut AudioBufferList,
    _output_time: *const c_void,
    client: *mut c_void,
) -> i32 {
    if input.is_null() || client.is_null() {
        return 0;
    }
    // SAFETY : `client` est le `Shared` enregistré avec cet IOProc, qui vit tant que l'IOProc existe ;
    // `input` est la liste de tampons fournie par Core Audio pour la durée de l'appel.
    let (shared, buffers) = unsafe {
        let list = &*input;
        let buffers = std::slice::from_raw_parts(list.buffers.as_ptr(), list.count as usize);
        (&*client.cast::<Shared>(), buffers)
    };
    // Sans allocation (thread temps réel) : on parcourt les tampons valides à chaque trame.
    let valid = || buffers.iter().filter(|b| !b.data.is_null() && b.channels > 0);
    let samples_of = |b: &AudioBuffer| -> &[f32] {
        let len = b.byte_size as usize / std::mem::size_of::<f32>();
        // SAFETY : `data` pointe sur `byte_size` octets de flottants alignés (format des IOProc du HAL).
        unsafe { std::slice::from_raw_parts(b.data.cast::<f32>(), len) }
    };
    let Some(frames) = valid()
        .map(|b| samples_of(b).len() / b.channels as usize)
        .min()
    else {
        return 0;
    };
    let total: usize = valid().map(|b| b.channels as usize).sum();
    if frames == 0 || total == 0 {
        return 0;
    }
    let Ok(mut out) = shared.samples.lock() else {
        return 0;
    };
    let scale = 1.0 / total as f32;
    out.extend((0..frames).map(|frame| {
        let sum: f32 = valid()
            .map(|b| {
                let c = b.channels as usize;
                samples_of(b)[frame * c..frame * c + c].iter().sum::<f32>()
            })
            .sum();
        sum * scale
    }));
    0
}

// ---------------------------------------------------------------------------
// Ouverture d'une source
// ---------------------------------------------------------------------------

/// Tap et périphérique agrégé du son de l'ordinateur, détruits avec la source.
struct SystemTap {
    tap: u32,
    aggregate: u32,
}

impl Drop for SystemTap {
    fn drop(&mut self) {
        // SAFETY : objets créés par `SystemTap::create`, détruits une seule fois ici.
        unsafe {
            AudioHardwareDestroyAggregateDevice(self.aggregate);
        }
        if let Some(destroy) = symbol(c"AudioHardwareDestroyProcessTap") {
            // SAFETY : signature de AudioHardwareDestroyProcessTap (AudioObjectID → OSStatus).
            unsafe { std::mem::transmute::<*mut c_void, DestroyProcessTap>(destroy)(self.tap) };
        }
    }
}

impl SystemTap {
    /// Tap global (tous les processus sauf Sordulo OS) dans un agrégé privé calé sur la sortie `output`.
    fn create(output: u32) -> Result<Self> {
        let create = symbol(c"AudioHardwareCreateProcessTap")
            .ok_or_else(|| anyhow!("Le son de l'ordinateur s'enregistre à partir de macOS 14.2"))?;
        let class = AnyClass::get(c"CATapDescription")
            .ok_or_else(|| anyhow!("Le son de l'ordinateur s'enregistre à partir de macOS 14.2"))?;
        let output_uid = read_string(output, DEVICE_UID)
            .ok_or_else(|| anyhow!("Sortie audio sans identifiant"))?;

        let own_pid = std::process::id() as i32;
        let excluded: Vec<Retained<NSNumber>> =
            read::<u32>(SYSTEM_OBJECT, TRANSLATE_PID_TO_PROCESS, Some(&own_pid))
                .filter(|object| *object != 0)
                .map(|object| NSNumber::new_u32(object))
                .into_iter()
                .collect();
        let excluded = NSArray::from_retained_slice(&excluded);

        // SAFETY : API documentée de CATapDescription (CoreAudio/CATapDescription.h).
        let description: Retained<AnyObject> = unsafe {
            let allocated: Allocated<AnyObject> = msg_send![class, alloc];
            let description: Option<Retained<AnyObject>> =
                msg_send![allocated, initStereoGlobalTapButExcludeProcesses: &*excluded];
            description.ok_or_else(|| anyhow!("Description du tap audio refusée"))?
        };
        // SAFETY : propriétés `privateTap` (setter setPrivate:) et `name` de CATapDescription.
        let tap_uuid = unsafe {
            let _: () = msg_send![&*description, setPrivate: true];
            let _: () = msg_send![&*description, setName: &*NSString::from_str("Sordulo OS")];
            let uuid: Retained<NSUUID> = msg_send![&*description, UUID];
            uuid.UUIDString()
        };

        let mut tap = 0u32;
        // SAFETY : signature de AudioHardwareCreateProcessTap ; `description` vit pendant l'appel.
        let status = unsafe {
            std::mem::transmute::<*mut c_void, CreateProcessTap>(create)(
                Retained::as_ptr(&description).cast_mut().cast(),
                &mut tap,
            )
        };
        if status != 0 || tap == 0 {
            bail!(
                "Enregistrement du son de l'ordinateur refusé ({status}). Autorisez Sordulo OS dans \
                 Réglages Système > Confidentialité et sécurité > Enregistrement audio du système."
            );
        }
        let mut guard = SystemTap { tap, aggregate: 0 };

        let key = |k: &str| NSString::from_str(k);
        let string = |s: &str| -> Retained<AnyObject> { NSString::from_str(s).into() };
        let number = |n: i32| -> Retained<AnyObject> { NSNumber::new_i32(n).into() };
        let dictionary = |pairs: Vec<(&str, Retained<AnyObject>)>| -> Retained<AnyObject> {
            let keys: Vec<Retained<NSString>> = pairs.iter().map(|(k, _)| key(k)).collect();
            let keys: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
            let values: Vec<&AnyObject> = pairs.iter().map(|(_, v)| &**v).collect();
            NSDictionary::<NSString, AnyObject>::from_slices(&keys, &values).into()
        };
        let array = |items: Vec<Retained<AnyObject>>| -> Retained<AnyObject> {
            NSArray::from_retained_slice(&items).into()
        };
        let aggregate_uid = NSUUID::new().UUIDString().to_string();
        let description = dictionary(vec![
            ("name", string("Sordulo OS (son de l'ordinateur)")),
            ("uid", string(&aggregate_uid)),
            ("master", string(&output_uid)),
            ("private", number(1)),
            ("stacked", number(0)),
            ("tapautostart", number(1)),
            ("subdevices", array(vec![dictionary(vec![("uid", string(&output_uid))])])),
            (
                "taps",
                array(vec![dictionary(vec![
                    ("uid", string(&tap_uuid.to_string())),
                    ("drift", number(1)),
                ])]),
            ),
        ]);
        let mut aggregate = 0u32;
        // SAFETY : NSDictionary et CFDictionary sont interchangeables (pont gratuit).
        let status = unsafe {
            AudioHardwareCreateAggregateDevice(Retained::as_ptr(&description).cast(), &mut aggregate)
        };
        if status != 0 || aggregate == 0 {
            bail!("Périphérique d'enregistrement du son de l'ordinateur impossible à créer ({status})");
        }
        guard.aggregate = aggregate;
        Ok(guard)
    }
}

/// Une source ouverte : IOProc démarré sur `device`.
struct Stream {
    source: Source,
    /// Périphérique par défaut au moment de l'ouverture (surveillé).
    default: u32,
    /// Périphérique lu (le micro, ou l'agrégé du tap).
    device: u32,
    proc_id: *mut c_void,
    shared: Box<Shared>,
    rate: u32,
    device_name: String,
    // Détruit après l'arrêt de l'IOProc (ordre des champs = ordre de destruction après `drop`).
    _tap: Option<SystemTap>,
}

impl Drop for Stream {
    fn drop(&mut self) {
        // SAFETY : IOProc créé par `Stream::open` sur `device` ; arrêté et détruit avant que `shared`
        // (son client) ne soit libéré.
        unsafe {
            AudioDeviceStop(self.device, self.proc_id);
            AudioDeviceDestroyIOProcID(self.device, self.proc_id);
        }
    }
}

impl Stream {
    fn open(source: Source) -> Result<Self> {
        let default = default_device(source);
        if default == 0 {
            bail!(match source {
                Source::Mic => "Aucun micro disponible",
                Source::System => "Aucune sortie audio disponible",
            });
        }
        let device_name = device_name(default);
        let tap = match source {
            Source::Mic => None,
            Source::System => Some(SystemTap::create(default)?),
        };
        let device = tap.as_ref().map_or(default, |t| t.aggregate);
        let rate = read::<f64>(device, NOMINAL_SAMPLE_RATE, None)
            .filter(|r| r.is_finite() && *r >= 8_000.0)
            .ok_or_else(|| anyhow!("Fréquence du périphérique « {device_name} » illisible"))?
            .round() as u32;

        let shared = Box::new(Shared {
            samples: Mutex::new(Vec::with_capacity(BUFFER_CAPACITY)),
        });
        let mut proc_id: *mut c_void = std::ptr::null_mut();
        let client = (&*shared as *const Shared).cast_mut().cast::<c_void>();
        // SAFETY : `shared` est en tas et vit au moins autant que l'IOProc (détruit dans `Drop`).
        let status = unsafe { AudioDeviceCreateIOProcID(device, io_proc, client, &mut proc_id) };
        if status != 0 || proc_id.is_null() {
            bail!("Lecture de « {device_name} » impossible ({status})");
        }
        // Construit tout de suite : l'IOProc sera détruit même si le démarrage échoue.
        let stream = Self {
            source,
            default,
            device,
            proc_id,
            shared,
            rate,
            device_name,
            _tap: tap,
        };
        // SAFETY : IOProc créé ci-dessus.
        let status = unsafe { AudioDeviceStart(device, proc_id) };
        if status != 0 {
            let hint = match (source, status) {
                (Source::Mic, ILLEGAL_OPERATION) => {
                    " Autorisez le micro dans Réglages Système > Confidentialité et sécurité > Micro."
                }
                _ => "",
            };
            bail!("Démarrage de « {} » impossible ({status}).{hint}", stream.device_name);
        }
        Ok(stream)
    }

    /// Le périphérique par défaut a changé ou a disparu : rouvrir.
    fn device_changed(&self) -> bool {
        default_device(self.source) != self.default || !is_alive(self.default)
    }

    fn run(&mut self, t0: Instant, stop: &AtomicBool, data: &Sender<(Source, Chunk)>) -> Exit {
        let mut pipeline = match SourcePipeline::new(self.rate, 1) {
            Ok(pipeline) => pipeline,
            Err(err) => {
                log::error!("Enregistrement ({}) : {err}", self.source.label());
                return Exit::Changed;
            }
        };
        let mut samples: Vec<f32> = Vec::with_capacity(BUFFER_CAPACITY);
        let mut meter = LevelMeter::default();
        let mut last_check = Instant::now();
        let exit = loop {
            if stop.load(Ordering::Relaxed) {
                break Exit::Stopped;
            }
            if last_check.elapsed() >= DEVICE_CHECK {
                last_check = Instant::now();
                if self.device_changed() {
                    break Exit::Changed;
                }
            }
            samples.clear();
            if let Ok(mut shared) = self.shared.samples.lock() {
                samples.extend(shared.drain(..));
            }
            if samples.is_empty() {
                LIVE_LEVELS.publish(self.source, meter.update(0.0));
            } else {
                LIVE_LEVELS.publish(self.source, meter.update(rms(&samples)));
                let clock_end = t0.elapsed().as_secs_f64() * f64::from(TARGET_RATE);
                match pipeline.push(&samples, clock_end) {
                    Ok(chunks) => {
                        if !send_all(self.source, chunks, data) {
                            break Exit::MixerGone;
                        }
                    }
                    Err(err) => log::warn!("Enregistrement ({}) : {err}", self.source.label()),
                }
            }
            thread::sleep(POLL);
        };
        LIVE_LEVELS.publish(self.source, 0.0);
        match pipeline.finish() {
            Ok(chunks) => {
                send_all(self.source, chunks, data);
            }
            Err(err) => log::warn!("Enregistrement ({}) : {err}", self.source.label()),
        }
        exit
    }
}

enum Exit {
    Stopped,
    MixerGone,
    Changed,
}

fn send_all(source: Source, chunks: Vec<Chunk>, data: &Sender<(Source, Chunk)>) -> bool {
    chunks
        .into_iter()
        .all(|chunk| data.send((source, chunk)).is_ok())
}

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
    thread::Builder::new()
        .name(name.into())
        .spawn(move || capture_loop(source, t0, &stop, &data, ready))
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
                    "Enregistrement : {} = « {} » ({} Hz)",
                    source.label(),
                    stream.device_name,
                    stream.rate
                );
                match stream.run(t0, stop, data) {
                    Exit::Stopped | Exit::MixerGone => return,
                    Exit::Changed => log::info!(
                        "Enregistrement : {} « {} » changé ou débranché",
                        source.label(),
                        stream.device_name
                    ),
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
