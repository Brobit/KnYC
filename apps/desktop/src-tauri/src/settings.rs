//! settings.json and workspaces.json in the app's config folder (design/03-data-model.md). Rust only
//! stores the text; the frontend validates it with the schemas from @knyc/core.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn config_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

/// Reads the file, or None on first launch.
pub fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read {}: {e}", path.display())),
    }
}

/// Writes next to the target then renames, so a crash never leaves half a file.
pub fn write(path: &Path, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_read(app: AppHandle) -> Result<Option<String>, String> {
    read(&config_file(&app, "settings.json")?)
}

#[tauri::command]
pub fn settings_write(app: AppHandle, json: String) -> Result<(), String> {
    write(&config_file(&app, "settings.json")?, &json)
}

/// Recent workspaces (Home screen), or None before the first folder is opened.
#[tauri::command]
pub fn workspaces_read(app: AppHandle) -> Result<Option<String>, String> {
    read(&config_file(&app, "workspaces.json")?)
}

#[tauri::command]
pub fn workspaces_write(app: AppHandle, json: String) -> Result<(), String> {
    write(&config_file(&app, "workspaces.json")?, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_first_launch() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(&dir.path().join("settings.json")).unwrap(), None);
    }

    #[test]
    fn writes_atomically_and_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        write(&path, r#"{"schemaVersion":1}"#).unwrap();
        assert_eq!(
            read(&path).unwrap().as_deref(),
            Some(r#"{"schemaVersion":1}"#)
        );
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn refuses_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert!(write(&path, "{not json").is_err());
        assert!(!path.exists());
    }
}
