//! The desktop's light / dark preference on Linux.
//!
//! WebKitGTK's `prefers-color-scheme` only goes by the GTK theme's name, so a dark KDE (GTK
//! theme "Breeze") reads as light. The XDG desktop portal's `color-scheme`, which KDE, GNOME
//! and others implement, is read instead, and followed while Tylia runs. Elsewhere, and
//! without a portal, this answers `None` and the webview's own media query is used.

use tauri::AppHandle;

/// Emitted with `Option<bool>` (dark) when the desktop's preference changes.
#[cfg(target_os = "linux")]
pub const CHANGED_EVENT: &str = "system-theme-changed";

/// `Some(true)` when the desktop prefers dark, `Some(false)` light, `None` when unknown.
pub fn is_dark() -> Option<bool> {
    #[cfg(target_os = "linux")]
    {
        portal::read()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Follows the desktop's preference on a thread of its own: re-applies the window theme
/// and tells the frontend.
pub fn watch(app: AppHandle) {
    #[cfg(target_os = "linux")]
    std::thread::spawn(move || portal::watch(&app));
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[cfg(target_os = "linux")]
mod portal {
    use std::sync::OnceLock;

    use tauri::{AppHandle, Emitter, Manager};
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{OwnedValue, Value};

    use crate::state::AppState;
    use crate::window;

    const DESTINATION: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";
    const INTERFACE: &str = "org.freedesktop.portal.Settings";
    const NAMESPACE: &str = "org.freedesktop.appearance";
    const KEY: &str = "color-scheme";

    fn proxy() -> Option<Proxy<'static>> {
        static CONNECTION: OnceLock<Option<Connection>> = OnceLock::new();
        let connection = CONNECTION
            .get_or_init(|| Connection::session().ok())
            .as_ref()?;
        Proxy::new(connection, DESTINATION, PATH, INTERFACE).ok()
    }

    pub fn read() -> Option<bool> {
        let proxy = proxy()?;
        // `ReadOne` since portal version 2; `Read` (deprecated) wraps the value once more.
        let value: OwnedValue = proxy
            .call("ReadOne", &(NAMESPACE, KEY))
            .or_else(|_| proxy.call("Read", &(NAMESPACE, KEY)))
            .ok()?;
        scheme_is_dark(&value)
    }

    pub fn watch(app: &AppHandle) {
        let Some(proxy) = proxy() else {
            return;
        };
        let Ok(signals) = proxy.receive_signal("SettingChanged") else {
            return;
        };
        for message in signals {
            let Ok((namespace, key, value)) =
                message.body().deserialize::<(String, String, OwnedValue)>()
            else {
                continue;
            };
            if namespace != NAMESPACE || key != KEY {
                continue;
            }
            let dark = scheme_is_dark(&value);
            if let (Some(state), Some(main)) =
                (app.try_state::<AppState>(), app.get_webview_window("main"))
            {
                window::apply_theme(&main, state.settings.load().theme);
            }
            let _ = app.emit(super::CHANGED_EVENT, dark);
        }
    }

    /// The portal's `color-scheme`: 1 prefers dark, 2 prefers light, 0 has no preference.
    fn scheme_is_dark(value: &Value<'_>) -> Option<bool> {
        match value {
            Value::Value(inner) => scheme_is_dark(inner),
            Value::U32(1) => Some(true),
            Value::U32(2) => Some(false),
            _ => None,
        }
    }

    #[cfg(test)]
    mod tests {
        use zbus::zvariant::Value;

        use super::scheme_is_dark;

        #[test]
        fn reads_the_portal_color_scheme() {
            assert_eq!(scheme_is_dark(&Value::U32(1)), Some(true));
            assert_eq!(scheme_is_dark(&Value::U32(2)), Some(false));
            assert_eq!(scheme_is_dark(&Value::U32(0)), None);
            assert_eq!(scheme_is_dark(&Value::Str("dark".into())), None);
            // The deprecated `Read` answers with the value wrapped in another variant.
            assert_eq!(
                scheme_is_dark(&Value::Value(Box::new(Value::U32(1)))),
                Some(true)
            );
        }
    }
}
