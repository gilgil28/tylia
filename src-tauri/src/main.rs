// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by Git or ssh as their askpass helper: answer the prompt and exit before
    // anything of the app starts (ARCHITECTURE §5.13).
    if let Some(code) = tylia_lib::askpass::client::run_if_helper() {
        std::process::exit(code);
    }
    tylia_lib::run();
}
