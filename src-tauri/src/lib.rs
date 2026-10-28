use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

/// Passed by the autostart entry so a login start stays in the tray and only
/// shows the morning briefing.
const AUTOSTART_FLAG: &str = "--autostart";

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
    let briefing = MenuItem::with_id(app, "briefing", "오늘 브리핑", true, None::<&str>)?;
    let sticky = MenuItem::with_id(app, "today-sticky", "오늘 할 일 스티커", true, None::<&str>)?;
    let note = MenuItem::with_id(app, "new-note", "새 메모", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &briefing, &sticky, &note, &separator, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("bundle icon").clone())
        .tooltip("Daily Planner")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "open" => show_main(app),
            // The rest is handled by the main window's background code.
            action => {
                let _ = app.emit_to("main", "tray", action);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Puts the calling window above all others, or back among them, straight
/// through Win32. The stickies share one owner window, and Windows takes
/// "always on top" from all of them when one gives it up; the toolkit then
/// skips a repeat set_always_on_top(true) because it believes nothing changed.
#[tauri::command]
fn set_topmost(window: tauri::Window, on: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let after = if on { HWND_TOPMOST } else { HWND_NOTOPMOST };
        // SAFETY: a plain Win32 call on a window handle owned by this process.
        let ok = unsafe {
            SetWindowPos(hwnd.0 as _, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
        };
        if ok == 0 {
            return Err("SetWindowPos failed".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        window.set_always_on_top(on).map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![set_topmost])
        .setup(|app| {
            // The main window starts hidden; show it unless this is a login start.
            if !std::env::args().any(|arg| arg == AUTOSTART_FLAG) {
                show_main(app.handle());
            }
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window keeps the app running in the tray so
            // reminders and the briefing keep working.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
