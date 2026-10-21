//! Main window creation: title bar style per platform and a flash-free start.
//!
//! The window is created hidden with its background set to the theme's `--bg-app`, and the
//! settings are injected before any page script runs (`window.__TYLIA_BOOT__`), so
//! `public/boot.js` can set `data-theme` before the first paint. The frontend shows the
//! window once it has rendered.

use std::time::Duration;

use serde::Serialize;
use tauri::window::Color;
use tauri::{AppHandle, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use ts_rs::TS;

use crate::settings::{Settings, ThemePreference};

/// `--bg-app` for each theme (docs/DESIGN.md §4.2).
const BG_DARK: Color = Color(0x0F, 0x11, 0x15, 0xFF);
const BG_LIGHT: Color = Color(0xFF, 0xFF, 0xFF, 0xFF);

/// Shows the window anyway if the frontend has not done so by then.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

/// Injected into the page as `window.__TYLIA_BOOT__`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BootInfo {
    pub platform: String,
    pub settings: Settings,
}

pub fn create_main(app: &AppHandle, settings: &Settings) -> tauri::Result<WebviewWindow> {
    let boot = BootInfo {
        platform: std::env::consts::OS.to_owned(),
        settings: settings.clone(),
    };
    let boot_json = serde_json::to_string(&boot).expect("BootInfo serializes");

    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Tylia")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .visible(false)
        .theme(native_theme(settings.theme))
        .initialization_script(format!("window.__TYLIA_BOOT__ = {boot_json};"));

    #[cfg(target_os = "macos")]
    let builder = if settings.native_title_bar {
        builder
    } else {
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(14.0, 19.0))
    };
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(settings.native_title_bar);

    let window = builder.build()?;
    apply_theme(&window, settings.theme);

    let fallback = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_FALLBACK);
        if !fallback.is_visible().unwrap_or(true) {
            let _ = fallback.show();
        }
    });
    Ok(window)
}

/// Sets the native theme (window frame, menus) and the background shown before and
/// between paints.
pub fn apply_theme(window: &WebviewWindow, preference: ThemePreference) {
    let _ = window.set_theme(native_theme(preference));
    let dark = match preference {
        ThemePreference::Dark => true,
        ThemePreference::Light => false,
        ThemePreference::System => window.theme().is_ok_and(|t| t == Theme::Dark),
    };
    let _ = window.set_background_color(Some(if dark { BG_DARK } else { BG_LIGHT }));
}

fn native_theme(preference: ThemePreference) -> Option<Theme> {
    match preference {
        ThemePreference::System => None,
        ThemePreference::Light => Some(Theme::Light),
        ThemePreference::Dark => Some(Theme::Dark),
    }
}
