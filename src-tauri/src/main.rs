// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

use tylia_lib::launch::{self, Command};

fn main() -> ExitCode {
    // Started by Git or ssh as their askpass helper: answer the prompt and exit before
    // anything of the app starts (ARCHITECTURE §5.13).
    if let Some(code) = tylia_lib::askpass::client::run_if_helper() {
        std::process::exit(code);
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    match launch::parse(std::env::args_os().skip(1), &cwd) {
        Command::Open(paths) => {
            tylia_lib::run(paths);
            ExitCode::SUCCESS
        }
        // On Windows the release build has no console; `tylia.cmd` (added to PATH by the
        // installer) pipes this output to the caller's console.
        Command::Help => {
            print!("{}", launch::HELP);
            ExitCode::SUCCESS
        }
        Command::Version => {
            println!("Tylia {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Command::Unknown(option) => {
            eprintln!("tylia: unknown option {option}\n\n{}", launch::HELP);
            ExitCode::from(2)
        }
    }
}
