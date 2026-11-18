// Pas de console en plus de la fenêtre sous Windows en release. NE PAS SUPPRIMER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sordulo_os_lib::run()
}
