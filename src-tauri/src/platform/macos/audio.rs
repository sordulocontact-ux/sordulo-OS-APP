//! macOS — qui utilise le micro, qui joue du son : objets « processus » de Core Audio (macOS 14+).
//!
//! `kAudioHardwarePropertyProcessObjectList` donne un objet par processus client de Core Audio, avec son
//! PID, son bundle id et deux drapeaux : entrée en cours (micro) et sortie en cours (son joué). Aucune
//! autorisation n'est demandée : on lit l'état des flux, jamais le son.
//!
//! Les apps font souvent l'audio dans un processus annexe (`com.google.Chrome.helper`, `com.apple.WebKit.GPU`
//! pour Safari, `com.microsoft.teams2.modulehost`…). Chaque processus est rattaché à l'app qui en est
//! « responsable » (le même mécanisme que macOS utilise pour attribuer l'accès au micro), puis à son bundle
//! `.app` : on obtient le bundle id de l'app (`company.thebrowser.Browser` pour Arc) et son nom.
//!
//! Sordulo OS elle-même est exclue (son processus et ceux dont elle est responsable, comme sa vue web).

use std::ffi::{c_char, c_void, CStr};
use std::sync::atomic::{AtomicBool, Ordering};

use objc2_foundation::{NSBundle, NSString};

use crate::platform::MicApp;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

const fn fourcc(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
}

const SYSTEM_OBJECT: u32 = 1;
const SCOPE_GLOBAL: u32 = fourcc(b"glob");
const ELEMENT_MAIN: u32 = 0;
const PROCESS_OBJECT_LIST: u32 = fourcc(b"prs#");
const PROCESS_PID: u32 = fourcc(b"ppid");
const PROCESS_BUNDLE_ID: u32 = fourcc(b"pbid");
const PROCESS_IS_RUNNING_INPUT: u32 = fourcc(b"piri");
const PROCESS_IS_RUNNING_OUTPUT: u32 = fourcc(b"piro");

/// `kCFStringEncodingUTF8`.
const UTF8: u32 = 0x0800_0100;
/// `PROC_PIDPATHINFO_MAXSIZE`.
const PATH_MAX_SIZE: usize = 4096;
/// `RTLD_DEFAULT` sur macOS.
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyDataSize(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        out_size: *mut u32,
    ) -> i32;
    fn AudioObjectGetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        io_size: *mut u32,
        out_data: *mut c_void,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetCString(string: *const c_void, buffer: *mut c_char, size: isize, encoding: u32)
        -> bool;
    fn CFRelease(cf: *const c_void);
}

extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut c_void, size: u32) -> i32;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

/// Sens du flux audio cherché.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Micro (entrée).
    Input,
    /// Son joué (sortie).
    Output,
}

fn address(selector: u32) -> PropertyAddress {
    PropertyAddress {
        selector,
        scope: SCOPE_GLOBAL,
        element: ELEMENT_MAIN,
    }
}

/// Valeur scalaire `T` d'une propriété (`None` si absente ou en erreur).
fn scalar<T: Copy + Default>(object: u32, selector: u32) -> Option<T> {
    let address = address(selector);
    let mut value = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    // SAFETY : `value` est un tampon de `size` octets valide pour l'écriture.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            (&mut value as *mut T).cast(),
        )
    };
    (status == 0 && size as usize == std::mem::size_of::<T>()).then_some(value)
}

/// Objets « processus » de Core Audio. Erreur sur macOS < 14 (propriété inconnue).
fn process_objects() -> anyhow::Result<Vec<u32>> {
    let address = address(PROCESS_OBJECT_LIST);
    let mut size: u32 = 0;
    // SAFETY : lecture de la taille, `size` valide.
    let status = unsafe {
        AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &address, 0, std::ptr::null(), &mut size)
    };
    anyhow::ensure!(status == 0, "liste des processus audio indisponible ({status})");
    let mut objects = vec![0u32; size as usize / std::mem::size_of::<u32>()];
    if objects.is_empty() {
        return Ok(objects);
    }
    let mut size = (objects.len() * std::mem::size_of::<u32>()) as u32;
    // SAFETY : `objects` a la place annoncée par `size`.
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            objects.as_mut_ptr().cast(),
        )
    };
    anyhow::ensure!(status == 0, "liste des processus audio illisible ({status})");
    objects.truncate(size as usize / std::mem::size_of::<u32>());
    Ok(objects)
}

/// Bundle id annoncé par Core Audio pour un processus (peut être vide).
fn process_bundle_id(object: u32) -> String {
    let Some(string) = scalar::<usize>(object, PROCESS_BUNDLE_ID).filter(|p| *p != 0) else {
        return String::new();
    };
    let string = string as *const c_void;
    let mut buffer = [0 as c_char; 512];
    // SAFETY : `string` est une CFString rendue par Core Audio, à relâcher par l'appelant.
    let text = unsafe {
        let ok = CFStringGetCString(string, buffer.as_mut_ptr(), buffer.len() as isize, UTF8);
        CFRelease(string);
        ok.then(|| CStr::from_ptr(buffer.as_ptr()).to_string_lossy().into_owned())
    };
    text.unwrap_or_default()
}

/// Processus « responsable » de `pid` (l'app qui a lancé un service XPC, un helper…), `pid` sinon.
fn responsible_pid(pid: i32) -> i32 {
    type Responsible = unsafe extern "C" fn(i32) -> i32;
    // SAFETY : symbole exporté par libSystem depuis macOS 10.14, cherché à l'exécution (absent : repli).
    let symbol = unsafe { dlsym(RTLD_DEFAULT, c"responsibility_get_pid_responsible_for_pid".as_ptr()) };
    if symbol.is_null() {
        return pid;
    }
    // SAFETY : signature connue de cette fonction (pid_t → pid_t).
    let responsible = unsafe { std::mem::transmute::<*mut c_void, Responsible>(symbol)(pid) };
    if responsible > 0 {
        responsible
    } else {
        pid
    }
}

/// Chemin de l'exécutable d'un processus.
fn process_path(pid: i32) -> Option<String> {
    let mut buffer = vec![0u8; PATH_MAX_SIZE];
    // SAFETY : `buffer` fait PATH_MAX_SIZE octets.
    let len = unsafe { proc_pidpath(pid, buffer.as_mut_ptr().cast(), PATH_MAX_SIZE as u32) };
    if len <= 0 {
        return None;
    }
    buffer.truncate(len as usize);
    String::from_utf8(buffer).ok()
}

/// Bundle `.app` le plus extérieur d'un chemin d'exécutable (les helpers sont dans `Contents/Frameworks`).
fn outer_app_bundle(path: &str) -> Option<&str> {
    path.find(".app/").map(|end| &path[..end + 4])
}

/// Nom affiché d'un bundle : nom du dossier sans `.app` (« Google Chrome »).
fn bundle_display_name(bundle: &str) -> String {
    let file = bundle.rsplit('/').next().unwrap_or(bundle);
    file.strip_suffix(".app").unwrap_or(file).to_owned()
}

fn bundle_identifier(bundle: &str) -> Option<String> {
    let bundle = NSBundle::bundleWithPath(&NSString::from_str(bundle))?;
    Some(bundle.bundleIdentifier()?.to_string())
}

/// Repli sans bundle `.app` : bundle id de Core Audio sans le suffixe de helper.
fn strip_helper(bundle_id: &str) -> &str {
    let lower = bundle_id.to_ascii_lowercase();
    match lower.find(".helper") {
        Some(index) if index > 0 => &bundle_id[..index],
        _ => bundle_id,
    }
}

/// App d'un processus audio, `None` pour Sordulo OS elle-même ou un processus sans identité.
fn app_of(pid: i32, core_audio_id: &str) -> Option<MicApp> {
    let own = std::process::id() as i32;
    if pid == own {
        return None;
    }
    let responsible = responsible_pid(pid);
    if responsible == own {
        return None;
    }
    if let Some(bundle) = process_path(responsible)
        .as_deref()
        .and_then(outer_app_bundle)
        .map(str::to_owned)
    {
        if let Some(id) = bundle_identifier(&bundle) {
            return Some(MicApp {
                id,
                display_name: bundle_display_name(&bundle),
            });
        }
    }
    let id = strip_helper(core_audio_id);
    (!id.is_empty()).then(|| MicApp {
        id: id.to_owned(),
        display_name: id.to_owned(),
    })
}

static UNSUPPORTED_LOGGED: AtomicBool = AtomicBool::new(false);

/// Apps (une fois chacune) qui ont un flux `direction` en cours. Vide sur macOS < 14 (signalé une fois).
pub fn apps_with_running(direction: Direction) -> Vec<MicApp> {
    let objects = match process_objects() {
        Ok(objects) => objects,
        Err(e) => {
            if !UNSUPPORTED_LOGGED.swap(true, Ordering::Relaxed) {
                log::warn!("détection audio par processus indisponible (macOS 14 requis) : {e:#}");
            }
            return Vec::new();
        }
    };
    let selector = match direction {
        Direction::Input => PROCESS_IS_RUNNING_INPUT,
        Direction::Output => PROCESS_IS_RUNNING_OUTPUT,
    };
    let mut apps: Vec<MicApp> = objects
        .into_iter()
        .filter(|&object| scalar::<u32>(object, selector).is_some_and(|running| running != 0))
        .filter_map(|object| {
            let pid = scalar::<i32>(object, PROCESS_PID)?;
            app_of(pid, &process_bundle_id(object))
        })
        .collect();
    apps.sort_by(|a, b| a.id.cmp(&b.id));
    apps.dedup_by(|a, b| a.id == b.id);
    apps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_belong_to_their_app() {
        let chrome = "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/131/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper";
        assert_eq!(outer_app_bundle(chrome), Some("/Applications/Google Chrome.app"));
        assert_eq!(bundle_display_name("/Applications/Google Chrome.app"), "Google Chrome");
        assert_eq!(outer_app_bundle("/usr/sbin/coreaudiod"), None);
        assert_eq!(strip_helper("com.hnc.Discord.helper.Renderer"), "com.hnc.Discord");
        assert_eq!(strip_helper("com.apple.WebKit.GPU"), "com.apple.WebKit.GPU");
        assert_eq!(fourcc(b"prs#"), 0x7072_7323);
    }

    /// Lecture réelle de Core Audio (sans autorisation) : ne doit ni planter ni lister Sordulo OS.
    #[test]
    fn reads_core_audio_without_crashing() {
        for direction in [Direction::Input, Direction::Output] {
            let apps = apps_with_running(direction);
            assert!(apps.iter().all(|a| !a.id.is_empty()));
        }
    }

    /// Manuel : `cargo test print_running_apps -- --ignored --nocapture` pendant un appel.
    #[test]
    #[ignore]
    fn print_running_apps() {
        println!("micro : {:?}", apps_with_running(Direction::Input));
        println!("son : {:?}", apps_with_running(Direction::Output));
    }
}
