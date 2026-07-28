use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder, MenuItemKind, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: u64,
    #[serde(default)]
    pub private: bool,
}

fn default_opacity() -> f64 { 1.0 }
fn default_theme() -> String { "dark".to_string() }
fn default_tab_position() -> String { "top".to_string() }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    #[serde(default = "AppSettings::default_storage_path")]
    pub storage_path: String,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_tab_position")]
    pub tab_position: String,
    #[serde(default)]
    pub last_import_export_dir: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            storage_path: Self::default_storage_path(),
            always_on_top: false,
            opacity: 1.0,
            theme: "dark".to_string(),
            tab_position: "top".to_string(),
            last_import_export_dir: None,
        }
    }
}

impl AppSettings {
    fn default_storage_path() -> String {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{}/ScratchPad/notes.json", home)
    }
}

#[derive(Default)]
pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub active_note_title: Mutex<String>,
}

// Notes are stored one-file-per-note under a `notes/` directory next to
// `storage_path`, so a save/rename/delete only ever touches the one file it
// changed instead of rewriting every note's content. Older installs have a
// single JSON array at `storage_path` — migrate_legacy_if_needed splits that
// into per-note files (keeping the old file as a `.bak`) the first time any
// notes command runs.
fn notes_dir(storage_path: &str) -> PathBuf {
    match PathBuf::from(storage_path).parent() {
        Some(parent) => parent.join("notes"),
        None => PathBuf::from("notes"),
    }
}

fn note_file_path(storage_path: &str, id: &str) -> PathBuf {
    notes_dir(storage_path).join(format!("{}.json", id))
}

fn migrate_legacy_if_needed(storage_path: &str) {
    let dir = notes_dir(storage_path);
    if dir.exists() {
        return;
    }
    let legacy_path = PathBuf::from(storage_path);
    let Ok(contents) = fs::read_to_string(&legacy_path) else { return };
    let Ok(notes) = serde_json::from_str::<Vec<Note>>(&contents) else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    for note in &notes {
        if let Ok(json) = serde_json::to_string_pretty(note) {
            let _ = fs::write(dir.join(format!("{}.json", note.id)), json);
        }
    }
    let _ = fs::rename(&legacy_path, legacy_path.with_extension("json.bak"));
}

fn load_notes(path: &str) -> Vec<Note> {
    migrate_legacy_if_needed(path);
    let mut notes: Vec<Note> = fs::read_dir(notes_dir(path))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            fs::read_to_string(&p)
                .ok()
                .and_then(|c| serde_json::from_str::<Note>(&c).ok())
        })
        .collect();
    notes.sort_by_key(|n| n.created_at);
    notes
}

fn write_note(path: &str, note: &Note) -> Result<(), String> {
    migrate_legacy_if_needed(path);
    let dir = notes_dir(path);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {}", e))?;
    let json = serde_json::to_string_pretty(note).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{}.json", note.id)), json)
        .map_err(|e| format!("Failed to write note: {}", e))
}

fn delete_note_file(path: &str, id: &str) -> Result<(), String> {
    match fs::remove_file(note_file_path(path, id)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete note: {}", e)),
    }
}

#[tauri::command]
fn get_notes(settings: State<AppState>) -> Result<Vec<Note>, String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    Ok(load_notes(&s.storage_path))
}

#[tauri::command]
fn save_note(note: Note, settings: State<AppState>) -> Result<(), String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    write_note(&s.storage_path, &note)
}

#[tauri::command]
fn delete_note(note_id: String, settings: State<AppState>) -> Result<(), String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    delete_note_file(&s.storage_path, &note_id)
}

#[tauri::command]
fn create_new_note(title: String, settings: State<AppState>) -> Result<Note, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        content: String::new(),
        created_at: now,
        private: false,
    };

    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    write_note(&s.storage_path, &note)?;
    Ok(note)
}

#[tauri::command]
fn rename_note(note_id: String, new_title: String, settings: State<AppState>) -> Result<(), String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    let path = note_file_path(&s.storage_path, &note_id);
    let Ok(contents) = fs::read_to_string(&path) else { return Ok(()) };
    let Ok(mut note) = serde_json::from_str::<Note>(&contents) else { return Ok(()) };
    note.title = new_title;
    write_note(&s.storage_path, &note)
}

fn import_file_impl(path: String, settings: &Mutex<AppSettings>) -> Result<Note, String> {
    let file_path = PathBuf::from(&path);
    let bytes = fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let content = String::from_utf8(bytes).map_err(|_| "Could not read file as text".to_string())?;
    let title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        content,
        created_at: now,
        private: false,
    };

    let mut s = settings.lock().map_err(|e| e.to_string())?;
    write_note(&s.storage_path, &note)?;

    if let Some(parent) = file_path.parent() {
        s.last_import_export_dir = Some(parent.to_string_lossy().into_owned());
    }

    Ok(note)
}

// import_file_impl never touches settings.json on disk (it only mutates the
// in-memory AppSettings) so unit tests exercising it can't clobber the
// developer's real ~/ScratchPad/settings.json — only the real command below,
// which unit tests never call, persists via save_settings.
#[tauri::command]
fn import_file(path: String, settings: State<AppState>) -> Result<Note, String> {
    let note = import_file_impl(path, &settings.settings)?;
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    save_settings(&s);
    Ok(note)
}

fn save_settings(settings: &AppSettings) {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = format!("{}/ScratchPad", home);
    let path = format!("{}/settings.json", dir);
    let _ = fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(&path, json);
    }
}

// Strips characters unsafe/awkward in filenames, trims whitespace, and
// falls back to "Untitled" so Export never offers an empty filename.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| *c != '/' && *c != '\\' && !c.is_control())
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.chars().take(100).collect()
    }
}

fn default_export_filename(title: &str) -> String {
    format!("{}.md", sanitize_filename(title))
}

#[tauri::command]
fn export_note(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| format!("Failed to export note: {}", e))
}

#[tauri::command]
fn get_settings(settings: State<AppState>) -> Result<AppSettings, String> {
    let s = settings.settings.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

fn set_menu_check(app: &tauri::AppHandle, id: &str, checked: bool) {
    if let Some(menu) = app.menu() {
        if let Some(MenuItemKind::Check(item)) = menu.get(id) {
            let _ = item.set_checked(checked);
        }
    }
}

#[tauri::command]
fn set_privacy_menu_state(is_private: bool, app: tauri::AppHandle) {
    set_menu_check(&app, "toggle_privacy", is_private);
}

#[tauri::command]
fn set_active_note_context(title: String, state: State<AppState>) {
    *state.active_note_title.lock().unwrap() = title;
}

// Triggered by the "New Release" button. Re-checks (the Update handle isn't kept
// around), then downloads, installs, and restarts into the new version.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

// --- Screenshots ---------------------------------------------------------
// Native macOS capture (`screencapture -i`) into ~/ScratchPad/screenshots,
// copied to the clipboard via osascript. No extra crates: PNGs are returned
// to the UI as base64 data URLs.

#[derive(Serialize, Clone, Debug)]
pub struct Screenshot {
    pub name: String,
    pub data_url: String,
}

fn screenshots_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join("ScratchPad").join("screenshots")
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(TABLE[(n >> 18 & 63) as usize] as char);
        out.push(TABLE[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn read_screenshot(path: &std::path::Path) -> Option<Screenshot> {
    let bytes = fs::read(path).ok()?;
    Some(Screenshot {
        name: path.file_name()?.to_string_lossy().into_owned(),
        data_url: format!("data:image/png;base64,{}", base64_encode(&bytes)),
    })
}

// Put a PNG file on the macOS clipboard. No-op (Err) elsewhere.
fn copy_png_to_clipboard(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "set the clipboard to (read (POSIX file \"{}\") as «class PNGf»)",
            path.display()
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Clipboard image copy is only supported on macOS".into())
    }
}

// `screencapture -i` blocks until the user drags a selection or presses Esc --
// anywhere from instant to indefinite. Run it on a blocking-pool thread via
// spawn_blocking rather than inline in the command, so waiting on the user
// can't stall the async runtime and freeze the rest of the app (the whole
// window would beachball for as long as the user took to select a region).
#[tauri::command]
async fn take_screenshot() -> Result<Option<Screenshot>, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let dir = screenshots_dir();
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis();
            let path = dir.join(format!("shot-{}.png", now));
            // -i: interactive region/window selection. User can press Esc to cancel.
            std::process::Command::new("screencapture")
                .args(["-i", &path.to_string_lossy()])
                .status()
                .map_err(|e| e.to_string())?;
            if !path.exists() {
                return Ok(None); // cancelled
            }
            copy_png_to_clipboard(&path)?;
            Ok(read_screenshot(&path))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Screenshots are only supported on macOS".into())
    }
}

#[tauri::command]
fn list_screenshots() -> Vec<Screenshot> {
    let mut names: Vec<PathBuf> = fs::read_dir(screenshots_dir())
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |e| e == "png"))
        .collect();
    names.sort(); // shot-<millis>.png sorts chronologically
    names.iter().rev().filter_map(|p| read_screenshot(p)).collect()
}

// Guard against path traversal: only a bare filename inside the dir is allowed.
fn screenshot_path(name: &str) -> Result<PathBuf, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid screenshot name".into());
    }
    Ok(screenshots_dir().join(name))
}

#[tauri::command]
fn copy_screenshot(name: String) -> Result<(), String> {
    copy_png_to_clipboard(&screenshot_path(&name)?)
}

#[tauri::command]
fn delete_screenshot(name: String) -> Result<(), String> {
    fs::remove_file(screenshot_path(&name)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_all_screenshots() -> Result<(), String> {
    let dir = screenshots_dir();
    for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "png") {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// Open a screenshot in the OS default viewer (Preview.app on macOS). No-op (Err) elsewhere.
#[tauri::command]
fn open_screenshot(name: String) -> Result<(), String> {
    let path = screenshot_path(&name)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Opening screenshots is only supported on macOS".into())
    }
}

// Copy arbitrary text to the clipboard via pbcopy. Fallback for when
// navigator.clipboard.writeText is unreliable in the packaged webview.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        let mut child = std::process::Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child
            .stdin
            .as_mut()
            .ok_or("Failed to open pbcopy stdin")?
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
        child.wait().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("Clipboard copy is only supported on macOS".into())
    }
}

// Short click played when a screenshot capture is activated (button/hotkey), so
// there's immediate audible feedback before the crosshair appears. Fire-and-forget.
#[tauri::command]
fn play_sound() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("afplay")
            .arg("/System/Library/Sounds/Pop.aiff")
            .spawn();
    }
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
                std::env::var("HOME")
                    .or_else(|_| std::env::var("USERPROFILE"))
                    .unwrap_or_else(|_| ".".to_string())
            );

            if std::path::Path::new(&settings_path).exists() {
                if let Ok(contents) = fs::read_to_string(&settings_path) {
                    if let Ok(parsed) = serde_json::from_str::<AppSettings>(&contents) {
                        *settings = parsed;
                    }
                }
            }

            let initial_aot = settings.always_on_top;
            let initial_opacity = settings.opacity;
            let initial_theme = settings.theme.clone();
            let initial_tab_position = settings.tab_position.clone();
            drop(settings);

            let aot_item = CheckMenuItemBuilder::with_id("always_on_top", "Always on Top")
                .checked(initial_aot)
                .build(app)?;

            let op100 = CheckMenuItemBuilder::with_id("opacity_100", "100%").checked(initial_opacity == 1.0).build(app)?;
            let op75  = CheckMenuItemBuilder::with_id("opacity_75",  "75%") .checked((initial_opacity - 0.75).abs() < 0.01).build(app)?;
            let op50  = CheckMenuItemBuilder::with_id("opacity_50",  "50%") .checked((initial_opacity - 0.5).abs()  < 0.01).build(app)?;
            let op25  = CheckMenuItemBuilder::with_id("opacity_25",  "25%") .checked((initial_opacity - 0.25).abs() < 0.01).build(app)?;
            let opacity_submenu = SubmenuBuilder::new(app, "Opacity")
                .item(&op100).item(&op75).item(&op50).item(&op25)
                .build()?;

            let th_dark  = CheckMenuItemBuilder::with_id("theme_dark",  "Dark") .checked(initial_theme == "dark") .build(app)?;
            let th_light = CheckMenuItemBuilder::with_id("theme_light", "Light").checked(initial_theme == "light").build(app)?;
            let theme_submenu = SubmenuBuilder::new(app, "Theme")
                .item(&th_dark).item(&th_light)
                .build()?;

            let tp_top   = CheckMenuItemBuilder::with_id("tabpos_top",   "Top")  .checked(initial_tab_position == "top").build(app)?;
            let tp_left  = CheckMenuItemBuilder::with_id("tabpos_left",  "Left") .checked(initial_tab_position == "left").build(app)?;
            let tp_right = CheckMenuItemBuilder::with_id("tabpos_right", "Right").checked(initial_tab_position == "right").build(app)?;
            let tab_position_submenu = SubmenuBuilder::new(app, "Tab Position")
                .item(&tp_top).item(&tp_left).item(&tp_right)
                .build()?;

            let privacy_item = CheckMenuItemBuilder::with_id("toggle_privacy", "Privacy Mode").checked(false).build(app)?;
            let help_item = MenuItemBuilder::with_id("quick_help", "Quick Help").build(app)?;

            let view_submenu = SubmenuBuilder::new(app, "View")
                .item(&aot_item)
                .separator()
                .item(&opacity_submenu)
                .separator()
                .item(&theme_submenu)
                .separator()
                .item(&tab_position_submenu)
                .separator()
                .item(&privacy_item)
                .separator()
                .item(&help_item)
                .build()?;

            let about = MenuItemBuilder::with_id("about", "About ScratchPad").build(app)?;
            let check_updates = MenuItemBuilder::with_id("check_updates", "Check for Updates...").build(app)?;
            let app_submenu = SubmenuBuilder::new(app, "ScratchPad")
                .item(&about)
                .item(&check_updates)
                .separator()
                .quit()
                .build()?;

            let import_file_item = MenuItemBuilder::with_id("import_file", "Import…").build(app)?;
            let export_note_item = MenuItemBuilder::with_id("export_note", "Export…").build(app)?;
            let open_notes_folder = MenuItemBuilder::with_id("open_notes_folder", "Open Notes Folder").build(app)?;
            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&import_file_item)
                .item(&export_note_item)
                .separator()
                .item(&open_notes_folder)
                .separator()
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
                .item(&view_submenu)
                .item(&edit_submenu)
                .build()?;

            app.set_menu(app_menu)?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(initial_aot);
            }

            app.on_menu_event(|app, event| {
                if event.id() == "about" {
                    app.dialog()
                        .message(&format!("ScratchPad\nVersion {}\n\nA lightweight tabbed notepad.\n\nhttps://dima0.com", app.package_info().version))
                        .title("About ScratchPad")
                        .blocking_show();
                }
                if event.id() == "open_notes_folder" {
                    let folder = std::env::var("HOME")
                        .or_else(|_| std::env::var("USERPROFILE"))
                        .map(|h| format!("{}/ScratchPad", h))
                        .unwrap_or_else(|_| "./ScratchPad".to_string());
                    let _ = std::fs::create_dir_all(&folder);
                    let _ = app.shell().open(&folder, None);
                }
                // blocking_save_file()/blocking_pick_file() must not run on the main
                // thread — it's also the UI event-loop thread, and blocking it here
                // deadlocks the whole app the moment the dialog needs to deliver its
                // result back. Do the dialog + resulting I/O on a spawned thread.
                if event.id() == "export_note" {
                    let state = app.state::<AppState>();
                    let default_name = {
                        let title = state.active_note_title.lock().unwrap().clone();
                        default_export_filename(&title)
                    };
                    let last_dir = state.settings.lock().unwrap().last_import_export_dir.clone();
                    let app_handle = app.clone();

                    std::thread::spawn(move || {
                        let mut dialog = app_handle.dialog().file().set_file_name(&default_name);
                        if let Some(dir) = &last_dir {
                            dialog = dialog.set_directory(dir);
                        }
                        if let Some(picked) = dialog.blocking_save_file() {
                            if let Ok(path) = picked.into_path() {
                                if let Some(parent) = path.parent() {
                                    let state = app_handle.state::<AppState>();
                                    let mut s = state.settings.lock().unwrap();
                                    s.last_import_export_dir = Some(parent.to_string_lossy().into_owned());
                                    save_settings(&s);
                                }
                                let _ = app_handle.emit("export-note-to", path.to_string_lossy().into_owned());
                            }
                        }
                    });
                }
                if event.id() == "import_file" {
                    let state = app.state::<AppState>();
                    let last_dir = state.settings.lock().unwrap().last_import_export_dir.clone();
                    let app_handle = app.clone();

                    std::thread::spawn(move || {
                        let mut dialog = app_handle
                            .dialog()
                            .file()
                            .add_filter("Text files", &["csv", "md", "txt", "json"]);
                        if let Some(dir) = &last_dir {
                            dialog = dialog.set_directory(dir);
                        }
                        if let Some(picked) = dialog.blocking_pick_file() {
                            if let Ok(path) = picked.into_path() {
                                match import_file(path.to_string_lossy().into_owned(), app_handle.state::<AppState>()) {
                                    Ok(note) => {
                                        let _ = app_handle.emit("note-imported", note);
                                    }
                                    Err(e) => {
                                        let _ = app_handle.dialog().message(e).title("Import Failed").blocking_show();
                                    }
                                }
                            }
                        }
                    });
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
                                let confirmed = handle.dialog()
                                    .message(format!("Version {} is available. Download and install now?", update.version))
                                    .title("Update Available")
                                    .buttons(MessageDialogButtons::OkCancel)
                                    .blocking_show();
                                if !confirmed {
                                    return;
                                }
                                match update.download_and_install(|_, _| {}, || {}).await {
                                    Ok(_) => {
                                        handle.dialog()
                                            .message("Update installed. ScratchPad will now restart.")
                                            .title("Update Complete")
                                            .blocking_show();
                                        handle.restart();
                                    }
                                    Err(e) => {
                                        let _ = handle.dialog()
                                            .message(format!("Failed to install update: {}", e))
                                            .title("Error")
                                            .blocking_show();
                                    }
                                }
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

                if event.id() == "always_on_top" {
                    let state = app.state::<AppState>();
                    let new_val = {
                        let mut s = state.settings.lock().unwrap();
                        s.always_on_top = !s.always_on_top;
                        let v = s.always_on_top;
                        save_settings(&s);
                        v
                    };
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_always_on_top(new_val);
                    }
                    set_menu_check(app, "always_on_top", new_val);
                }

                let opacity_val = match event.id().as_ref() {
                    "opacity_100" => Some(1.0f64),
                    "opacity_75"  => Some(0.75),
                    "opacity_50"  => Some(0.5),
                    "opacity_25"  => Some(0.25),
                    _ => None,
                };
                if let Some(opacity) = opacity_val {
                    let state = app.state::<AppState>();
                    {
                        let mut s = state.settings.lock().unwrap();
                        s.opacity = opacity;
                        save_settings(&s);
                    }
                    for id in &["opacity_100", "opacity_75", "opacity_50", "opacity_25"] {
                        set_menu_check(app, id, event.id().as_ref() == *id);
                    }
                    let _ = app.emit("settings-changed", serde_json::json!({ "opacity": opacity }));
                }

                if event.id() == "theme_dark" || event.id() == "theme_light" {
                    let theme = if event.id() == "theme_dark" { "dark" } else { "light" };
                    let state = app.state::<AppState>();
                    {
                        let mut s = state.settings.lock().unwrap();
                        s.theme = theme.to_string();
                        save_settings(&s);
                    }
                    set_menu_check(app, "theme_dark", theme == "dark");
                    set_menu_check(app, "theme_light", theme == "light");
                    let _ = app.emit("settings-changed", serde_json::json!({ "theme": theme }));
                }

                let tab_position_val = match event.id().as_ref() {
                    "tabpos_top"   => Some("top"),
                    "tabpos_left"  => Some("left"),
                    "tabpos_right" => Some("right"),
                    _ => None,
                };
                if let Some(tab_position) = tab_position_val {
                    let state = app.state::<AppState>();
                    {
                        let mut s = state.settings.lock().unwrap();
                        s.tab_position = tab_position.to_string();
                        save_settings(&s);
                    }
                    for id in &["tabpos_top", "tabpos_left", "tabpos_right"] {
                        set_menu_check(app, id, event.id().as_ref() == *id);
                    }
                    let _ = app.emit("settings-changed", serde_json::json!({ "tab_position": tab_position }));
                }

                if event.id() == "toggle_privacy" {
                    let _ = app.emit("toggle-privacy", ());
                }

                if event.id() == "quick_help" {
                    let _ = app.emit("show-help", ());
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
                            let _ = window.unminimize();
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
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            let shortcut = Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyS);
            #[cfg(not(target_os = "macos"))]
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);
            let _ = app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

            // Global screenshot hotkey (⌃⌘4). The UI listens for "take-screenshot"
            // and runs the same capture flow as the 📷 button.
            let screenshot_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::META), Code::Digit4);
            let _ = app.global_shortcut().on_shortcut(screenshot_shortcut, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = app.emit("take-screenshot", ());
                }
            });

            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        #[cfg(target_os = "macos")]
                        let _ = app_handle.get_webview_window("main").map(|w| w.minimize());
                        #[cfg(not(target_os = "macos"))]
                        let _ = app_handle.get_webview_window("main").map(|w| w.hide());
                    }
                });
            }

            // Poll for updates: first check shortly after launch, then every 5 min.
            // Emits "update-available" with the version so the UI can show a button.
            // ponytail: dedicated thread + block_on avoids pulling in a tokio timer.
            let updater_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut delay = std::time::Duration::from_secs(15);
                loop {
                    std::thread::sleep(delay);
                    delay = std::time::Duration::from_secs(300);
                    if let Ok(updater) = updater_handle.updater() {
                        if let Ok(Some(update)) = tauri::async_runtime::block_on(updater.check()) {
                            let _ = updater_handle.emit("update-available", update.version);
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_notes,
            save_note,
            delete_note,
            create_new_note,
            rename_note,
            get_settings,
            set_privacy_menu_state,
            install_update,
            take_screenshot,
            list_screenshots,
            copy_screenshot,
            delete_screenshot,
            delete_all_screenshots,
            open_screenshot,
            play_sound,
            copy_text,
            export_note,
            set_active_note_context,
            import_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let state = app_handle.state::<AppState>();
                        match import_file(path.to_string_lossy().into_owned(), state) {
                            Ok(note) => {
                                let _ = app_handle.emit("note-imported", note);
                            }
                            Err(e) => {
                                let _ = app_handle
                                    .dialog()
                                    .message(e)
                                    .title("Import Failed")
                                    .blocking_show();
                            }
                        }
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn settings_defaults_from_empty_json() {
        let s: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(!s.always_on_top);
        assert_eq!(s.opacity, 1.0);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.tab_position, "top");
        assert!(s.storage_path.contains("ScratchPad"), "storage_path should use platform default, got: {}", s.storage_path);
    }

    #[test]
    fn settings_partial_json_fills_defaults() {
        let json = r#"{"storage_path": "/tmp/notes.json"}"#;
        let s: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.storage_path, "/tmp/notes.json");
        assert!(!s.always_on_top);
        assert_eq!(s.opacity, 1.0);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.tab_position, "top");
    }

    #[test]
    fn tab_position_defaults_and_roundtrips() {
        // defaults to "top" from empty JSON
        let s: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.tab_position, "top");
        // roundtrips a non-default value
        let mut original = AppSettings::default();
        original.tab_position = "left".to_string();
        let json = serde_json::to_string_pretty(&original).unwrap();
        let loaded: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.tab_position, "left");
    }

    #[test]
    fn settings_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        let original = AppSettings {
            storage_path: "/tmp/notes.json".to_string(),
            always_on_top: true,
            opacity: 0.75,
            theme: "light".to_string(),
            tab_position: "right".to_string(),
            last_import_export_dir: None,
        };
        let json = serde_json::to_string_pretty(&original).unwrap();
        std::fs::write(&path, &json).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        let loaded: AppSettings = serde_json::from_str(&contents).unwrap();
        assert_eq!(loaded.storage_path, original.storage_path);
        assert_eq!(loaded.always_on_top, original.always_on_top);
        assert_eq!(loaded.opacity, original.opacity);
        assert_eq!(loaded.theme, original.theme);
        assert_eq!(loaded.tab_position, original.tab_position);
        assert_eq!(loaded.last_import_export_dir, original.last_import_export_dir);
    }

    #[test]
    fn note_private_defaults_false() {
        let json = r#"{"id":"abc","title":"Test","content":"hello","created_at":0}"#;
        let note: Note = serde_json::from_str(json).unwrap();
        assert!(!note.private);
    }

    #[test]
    fn note_full_roundtrip() {
        let original = Note {
            id: "test-id".to_string(),
            title: "Test Note".to_string(),
            content: "Some content".to_string(),
            created_at: 1_234_567_890,
            private: true,
        };
        let json = serde_json::to_string(&original).unwrap();
        let loaded: Note = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.id, original.id);
        assert_eq!(loaded.title, original.title);
        assert_eq!(loaded.content, original.content);
        assert_eq!(loaded.created_at, original.created_at);
        assert!(loaded.private);
    }

    #[test]
    fn base64_known_vectors() {
        // RFC 4648 test vectors + padding edge cases
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(&[0u8, 255, 128]), "AP+A");
    }

    #[test]
    fn screenshot_path_rejects_traversal() {
        assert!(screenshot_path("../secret.png").is_err());
        assert!(screenshot_path("a/b.png").is_err());
        assert!(screenshot_path("shot-123.png").is_ok());
    }

    #[test]
    fn storage_path_uses_platform_home() {
        // Calls the actual method to verify it produces a usable path on this platform
        let path = AppSettings::default_storage_path();
        assert!(path.ends_with("notes.json"), "should end with notes.json, got: {}", path);
        assert!(path.contains("ScratchPad"), "should contain ScratchPad dir, got: {}", path);
        // HOME or USERPROFILE must be set in any normal dev/test environment
        assert!(!path.starts_with("./ScratchPad"), "should not fall back to relative path, got: {}", path);
    }

    #[test]
    fn settings_default_last_import_export_dir_is_none() {
        let s: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.last_import_export_dir, None);
    }

    #[test]
    fn settings_last_import_export_dir_roundtrips() {
        let mut original = AppSettings::default();
        original.last_import_export_dir = Some("/Users/dima/Documents".to_string());
        let json = serde_json::to_string_pretty(&original).unwrap();
        let loaded: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.last_import_export_dir, original.last_import_export_dir);
    }

    #[test]
    fn sanitize_filename_strips_slashes_and_trims() {
        assert_eq!(sanitize_filename("Notepad Jul 3, 10:30"), "Notepad Jul 3, 10:30");
        assert_eq!(sanitize_filename("a/b/c"), "abc");
        assert_eq!(sanitize_filename("  padded  "), "padded");
        assert_eq!(sanitize_filename(""), "Untitled");
        assert_eq!(sanitize_filename("   "), "Untitled");
    }

    #[test]
    fn default_export_filename_always_uses_md() {
        assert_eq!(default_export_filename("My Note"), "My Note.md");
        assert_eq!(default_export_filename(""), "Untitled.md");
    }

    #[test]
    fn export_note_writes_exact_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.txt");
        export_note(path.to_string_lossy().into_owned(), "hello world".to_string()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello world");
    }

    #[test]
    fn export_note_overwrites_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.txt");
        std::fs::write(&path, "old").unwrap();
        export_note(path.to_string_lossy().into_owned(), "new".to_string()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    fn test_state_with_storage(path: &std::path::Path) -> AppState {
        let mut settings = AppSettings::default();
        settings.storage_path = path.to_string_lossy().into_owned();
        AppState {
            settings: Mutex::new(settings),
            ..Default::default()
        }
    }

    #[test]
    fn import_file_creates_note_with_filename_as_title() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("shopping-list.txt");
        std::fs::write(&file_path, "milk\neggs").unwrap();
        let notes_path = dir.path().join("notes.json");
        let state = test_state_with_storage(&notes_path);

        let note = import_file_impl(file_path.to_string_lossy().into_owned(), &state.settings)
            .unwrap();

        assert_eq!(note.title, "shopping-list");
        assert_eq!(note.content, "milk\neggs");
        assert!(!note.private);

        let stored = load_notes(&notes_path.to_string_lossy());
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, note.id);
    }

    #[test]
    fn import_file_updates_last_import_export_dir() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("data.csv");
        std::fs::write(&file_path, "a,b\n1,2").unwrap();
        let notes_path = dir.path().join("notes.json");
        let state = test_state_with_storage(&notes_path);

        import_file_impl(file_path.to_string_lossy().into_owned(), &state.settings).unwrap();

        let last_dir = state.settings.lock().unwrap().last_import_export_dir.clone();
        assert_eq!(last_dir, Some(dir.path().to_string_lossy().into_owned()));
    }

    #[test]
    fn import_file_rejects_non_utf8_bytes() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("binary.txt");
        std::fs::write(&file_path, [0xFF, 0xFE, 0x00, 0xFF]).unwrap();
        let notes_path = dir.path().join("notes.json");
        let state = test_state_with_storage(&notes_path);

        let err = import_file_impl(file_path.to_string_lossy().into_owned(), &state.settings)
            .unwrap_err();

        assert_eq!(err, "Could not read file as text");
    }

    #[test]
    fn migrates_legacy_single_file_notes_into_per_note_files() {
        let dir = TempDir::new().unwrap();
        let notes_path = dir.path().join("notes.json");
        let legacy = vec![
            Note { id: "a".into(), title: "A".into(), content: "one".into(), created_at: 1, private: false },
            Note { id: "b".into(), title: "B".into(), content: "two".into(), created_at: 2, private: true },
        ];
        std::fs::write(&notes_path, serde_json::to_string_pretty(&legacy).unwrap()).unwrap();

        let loaded = load_notes(&notes_path.to_string_lossy());

        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "a");
        assert_eq!(loaded[1].id, "b");
        assert!(dir.path().join("notes").join("a.json").exists());
        assert!(dir.path().join("notes").join("b.json").exists());
        // the legacy file is preserved as a backup, not deleted
        assert!(dir.path().join("notes.json.bak").exists());
        assert!(!notes_path.exists());
    }

    #[test]
    fn load_notes_orders_by_created_at_regardless_of_write_order() {
        let dir = TempDir::new().unwrap();
        let notes_path = dir.path().join("notes.json");
        let state = test_state_with_storage(&notes_path);

        let later = Note { id: "later".into(), title: "Later".into(), content: "".into(), created_at: 200, private: false };
        let earlier = Note { id: "earlier".into(), title: "Earlier".into(), content: "".into(), created_at: 100, private: false };
        write_note(&state.settings.lock().unwrap().storage_path, &later).unwrap();
        write_note(&state.settings.lock().unwrap().storage_path, &earlier).unwrap();

        let loaded = load_notes(&notes_path.to_string_lossy());
        assert_eq!(loaded.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), vec!["earlier", "later"]);
    }

    #[test]
    fn save_note_only_touches_its_own_file() {
        let dir = TempDir::new().unwrap();
        let notes_path = dir.path().join("notes.json");
        let path = notes_path.to_string_lossy().into_owned();

        let a = Note { id: "a".into(), title: "A".into(), content: "one".into(), created_at: 1, private: false };
        let b = Note { id: "b".into(), title: "B".into(), content: "two".into(), created_at: 2, private: false };
        write_note(&path, &a).unwrap();
        write_note(&path, &b).unwrap();

        let b_file = note_file_path(&path, "b");
        let before = std::fs::metadata(&b_file).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));

        let a_edited = Note { content: "one edited".into(), ..a.clone() };
        write_note(&path, &a_edited).unwrap();

        let after = std::fs::metadata(&b_file).unwrap().modified().unwrap();
        assert_eq!(before, after, "editing note a must not touch note b's file");

        let loaded = load_notes(&path);
        let stored_a = loaded.iter().find(|n| n.id == "a").unwrap();
        assert_eq!(stored_a.content, "one edited");
    }

    #[test]
    fn delete_note_removes_only_that_notes_file() {
        let dir = TempDir::new().unwrap();
        let notes_path = dir.path().join("notes.json");
        let path = notes_path.to_string_lossy().into_owned();

        let a = Note { id: "a".into(), title: "A".into(), content: "one".into(), created_at: 1, private: false };
        let b = Note { id: "b".into(), title: "B".into(), content: "two".into(), created_at: 2, private: false };
        write_note(&path, &a).unwrap();
        write_note(&path, &b).unwrap();

        delete_note_file(&path, "a").unwrap();

        let loaded = load_notes(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "b");
        // deleting an already-gone note is a no-op, not an error
        assert!(delete_note_file(&path, "a").is_ok());
    }
}
