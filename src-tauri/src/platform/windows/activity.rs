//! Indices qu'un navigateur est en appel (le registre dit seulement « Arc utilise le micro », pas quel onglet) :
//! - les processus qui jouent du son en ce moment (session audio active sur la sortie par défaut) ;
//! - les titres des fenêtres visibles (« Meet – abc-defg-hij - Google Chrome »).

use anyhow::Context;
use wasapi::{DeviceEnumerator, Direction, SessionState};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
};

/// Noms d'exécutables (minuscules, sans `.exe`) qui ont une session audio active sur la sortie par défaut.
pub fn processes_playing_audio() -> anyhow::Result<Vec<String>> {
    let _ = wasapi::initialize_mta();
    let device = DeviceEnumerator::new()
        .context("énumération des périphériques audio")?
        .get_default_device(Direction::Render)
        .context("sortie audio par défaut")?;
    let sessions = device
        .get_iaudiosessionmanager()?
        .get_audiosessionenumerator()?;
    let mut names = Vec::new();
    for i in 0..sessions.get_count()? {
        let Ok(session) = sessions.get_session(i) else {
            continue;
        };
        if !matches!(session.get_state(), Ok(SessionState::Active)) {
            continue;
        }
        if let Some(name) = session.get_process_id().ok().and_then(exe_stem) {
            names.push(name);
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

fn exe_stem(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    // SAFETY : handle fermé avant de sortir ; le tampon est dimensionné par `len`.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]).to_ascii_lowercase();
        let file = path.rsplit(['\\', '/']).next()?.to_owned();
        Some(file.strip_suffix(".exe").unwrap_or(&file).to_owned())
    }
}

/// Titres des fenêtres visibles.
pub fn visible_window_titles() -> Vec<String> {
    let mut titles: Vec<String> = Vec::new();
    // SAFETY : `collect` ne vit que pendant EnumWindows, qui est synchrone.
    unsafe {
        EnumWindows(Some(collect), &mut titles as *mut Vec<String> as LPARAM);
    }
    titles
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let titles = &mut *(lparam as *mut Vec<String>);
    if IsWindowVisible(hwnd) != 0 {
        let len = GetWindowTextLengthW(hwnd);
        if len > 0 {
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if n > 0 {
                titles.push(String::from_utf16_lossy(&buf[..n as usize]));
            }
        }
    }
    1
}

#[cfg(test)]
mod tests {
    /// Diagnostic manuel : `cargo test print_call_hints -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn print_call_hints() {
        println!("son joué par : {:?}", super::processes_playing_audio());
        let titles: Vec<String> = super::visible_window_titles()
            .into_iter()
            .filter(|t| crate::call_apps::is_call_title(t))
            .collect();
        println!("titres d'appel : {titles:?}");
    }
}
