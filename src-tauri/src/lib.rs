use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub storage_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            storage_path: Self::default_storage_path(),
        }
    }
}

impl AppSettings {
    fn default_storage_path() -> String {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{}/ScratchPad/notes.json", home)
    }
}

#[derive(Default)]
pub struct AppState {
    pub settings: Mutex<AppSettings>,
}

#[tauri::command]
fn get_notes(settings: State<AppState>) -> Result<Vec<Note>, String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    let path = &s.storage_path;
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|e| e.to_string()),
        Err(_) => Ok(vec![]),
    }
}

#[tauri::command]
fn save_note(note: Note, settings: State<AppState>) -> Result<(), String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    let path = &s.storage_path;

    let notes_path = PathBuf::from(path);
    if let Some(parent) = notes_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let mut notes: Vec<Note> = match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => vec![],
    };

    if let Some(pos) = notes.iter().position(|n| n.id == note.id) {
        notes[pos] = note;
    } else {
        notes.push(note);
    }

    let json = serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("Failed to write notes: {}", e))?;

    Ok(())
}

#[tauri::command]
fn delete_note(note_id: String, settings: State<AppState>) -> Result<(), String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    let path = &s.storage_path;

    let notes: Vec<Note> = match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => vec![],
    };

    let notes: Vec<Note> = notes.into_iter().filter(|n| n.id != note_id).collect();
    let json = serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?;

    fs::write(path, json).map_err(|e| format!("Failed to write notes: {}", e))?;

    Ok(())
}

#[tauri::command]
fn purge_all_notes(settings: State<AppState>) -> Result<(), String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    let path = &s.storage_path;
    fs::write(path, "[]").map_err(|e| format!("Failed to clear notes: {}", e))?;
    Ok(())
}

#[tauri::command]
fn create_new_note(settings: State<AppState>) -> Result<Note, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        title: format!("Notepad {}", chrono::Local::now().format("%b %-d, %H:%M")),
        content: String::new(),
        created_at: now,
    };

    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    let path = &s.storage_path;

    let notes_path = PathBuf::from(path);
    if let Some(parent) = notes_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let mut notes: Vec<Note> = match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => vec![],
    };

    notes.push(note.clone());

    let json = serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("Failed to write notes: {}", e))?;

    Ok(note)
}

#[tauri::command]
fn rename_note(note_id: String, new_title: String, settings: State<AppState>) -> Result<(), String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    let path = &s.storage_path;

    let mut notes: Vec<Note> = match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => vec![],
    };

    if let Some(note) = notes.iter_mut().find(|n| n.id == note_id) {
        note.title = new_title;
    }

    let json = serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("Failed to write notes: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            let settings_state: State<AppState> = app.state();
            let mut settings = settings_state.settings.lock().map_err(|e| e.to_string())?;

            let settings_path = format!(
                "{}/ScratchPad/settings.json",
                std::env::var("HOME").unwrap_or_else(|_| ".".to_string())
            );

            if std::path::Path::new(&settings_path).exists() {
                if let Ok(contents) = fs::read_to_string(&settings_path) {
                    if let Ok(parsed) = serde_json::from_str::<AppSettings>(&contents) {
                        *settings = parsed;
                    }
                }
            }

            let about = MenuItemBuilder::with_id("about", "About ScratchPad").build(app)?;
            let check_updates = MenuItemBuilder::with_id("check_updates", "Check for Updates...").build(app)?;
            let app_submenu = SubmenuBuilder::new(app, "ScratchPad")
                .item(&about)
                .item(&check_updates)
                .separator()
                .quit()
                .build()?;

            let file_submenu = SubmenuBuilder::new(app, "File")
                .close_window()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let app_menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&file_submenu)
                .item(&edit_submenu)
                .build()?;

            app.set_menu(app_menu)?;

            app.on_menu_event(|app, event| {
                if event.id() == "about" {
                    app.dialog()
                        .message("ScratchPad\nVersion 0.1.0\n\nA lightweight tabbed notepad.\n\nhttps://dima0.com")
                        .title("About ScratchPad")
                        .blocking_show();
                }
                if event.id() == "check_updates" {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let Ok(updater) = handle.updater() else {
                            let _ = handle.dialog()
                                .message("Updater is not configured.")
                                .title("Error")
                                .blocking_show();
                            return;
                        };
                        match updater.check().await {
                            Ok(Some(update)) => {
                                let _ = handle.dialog()
                                    .message(format!("Version {} is available. Download now?", update.version))
                                    .title("Update Available")
                                    .blocking_show();

                            }
                            Ok(None) => {
                                let _ = handle.dialog()
                                    .message("You're on the latest version.")
                                    .title("No Updates")
                                    .blocking_show();
                            }
                            Err(e) => {
                                let _ = handle.dialog()
                                    .message(format!("Failed to check for updates: {}", e))
                                    .title("Error")
                                    .blocking_show();
                            }
                        }
                    });
                }
            });

            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("ScratchPad")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let shortcut = Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyS);
            app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })?;

            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = app_handle.get_webview_window("main").map(|w| w.minimize());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_notes,
            save_note,
            delete_note,
            purge_all_notes,
            create_new_note,
            rename_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
