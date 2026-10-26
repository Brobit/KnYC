//! Chromium for the UI checks (#89, design/06 H4): KnYC's runner (`ui-runner/run.mjs` in the
//! app's resources, `packages/ui-runner` of the repo in development) and the folder Chromium is
//! downloaded into, `browsers/` in the app's data folder. Nothing downloads without the learner
//! asking: the app shows the size first (`browser_size`), then calls `browser_install`.

use knyc_runner::ui::{UiRunner, find_runner};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

static RESOURCES: OnceLock<PathBuf> = OnceLock::new();

/// Called once at start-up with the app's resource folder.
pub fn set_resources(app: &AppHandle) {
    if let Ok(dir) = app.path().resource_dir() {
        let _ = RESOURCES.set(dir);
    }
}

/// The runner, and `browsers/` under the app's data folder `data`.
pub fn ui_runner(data: &Path) -> Result<UiRunner, String> {
    let script = find_runner(
        RESOURCES.get().map(PathBuf::as_path),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    )
    .ok_or("KnYC's UI runner is missing from this installation")?;
    Ok(UiRunner {
        script,
        browsers: data.join("browsers"),
    })
}

fn runner(app: &AppHandle) -> Result<UiRunner, String> {
    ui_runner(&app.path().app_data_dir().map_err(|e| e.to_string())?)
}

async fn browser(app: AppHandle, action: &'static str) -> Result<serde_json::Value, String> {
    let runner = runner(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        knyc_runner::ui::browser(&runner, action).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `{"installed": bool, "revision": "1243"}`
#[tauri::command]
pub async fn browser_status(app: AppHandle) -> Result<serde_json::Value, String> {
    browser(app, "status").await
}

/// `{"bytes": n, "urls": [...]}`: what downloading Chromium takes.
#[tauri::command]
pub async fn browser_size(app: AppHandle) -> Result<serde_json::Value, String> {
    browser(app, "size").await
}

/// Downloads Chromium into the app's data folder: `{"installed": bool, "error"?: string}`.
#[tauri::command]
pub async fn browser_install(app: AppHandle) -> Result<serde_json::Value, String> {
    browser(app, "install").await
}
