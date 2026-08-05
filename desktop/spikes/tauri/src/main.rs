use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SUPERVISOR_SCHEMA: &str = "nbook.desktop-supervisor/v1";
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(30);
const START_TIMEOUT: Duration = Duration::from_secs(45);
const DESKTOP_BRIDGE_SCHEMA: &str = "nbook.desktop-bridge/v1";
const DESKTOP_SETTINGS_SCHEMA: &str = "nbook.desktop-settings/v1";
const TAURI_BRIDGE_SCRIPT: &str = r#"
(() => {
    const tauri = window.__TAURI__;
    if (!tauri?.core?.invoke) return;
    const listeners = new Set();
    if (tauri.event?.listen) {
        void tauri.event.listen("neurobook:menu", (event) => {
            for (const listener of listeners) listener(event.payload);
        });
        void tauri.event.listen("neurobook:close-requested", () => {
            const quit = window.confirm("关闭 NeuroBook？点击“确定”退出，点击“取消”隐藏到托盘。");
            void tauri.core.invoke("desktop_close_decision", {quit});
        });
    }
    window.neuroBookDesktop = {
        schema: "nbook.desktop-bridge/v1",
        status: async () => {
            const status = await tauri.core.invoke("desktop_status");
            if (status.connection === "remote") {
                const response = await fetch(new URL("/api/app/desktop-capability", status.origin + "/"));
                if (!response.ok) throw new Error("远端 Desktop capability 请求失败：HTTP " + response.status);
                const capability = await response.json();
                if (capability.schema !== "nbook.desktop-capability/v1"
                    || capability.supportsRemoteDesktop !== true
                    || !Array.isArray(capability.bridgeSchemas)
                    || capability.bridgeSchemas.length !== 1
                    || capability.bridgeSchemas[0] !== "nbook.desktop-bridge/v1"
                    || typeof capability.productVersion !== "string"
                    || !capability.productVersion.trim()) {
                    throw new Error("远端 Desktop capability 不支持 DesktopBridge v1");
                }
                status.version = capability.productVersion;
            }
            return status;
        },
        settings: () => tauri.core.invoke("desktop_settings"),
        updateSettings: (patch) => tauri.core.invoke("desktop_update_settings", {patch}),
        window: (command) => tauri.core.invoke("desktop_window", {command}),
        menu: (command) => tauri.core.invoke("desktop_menu", {command}),
        onMenuCommand: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
})();
"#;

#[derive(Clone)]
struct Config {
    image_root: PathBuf,
    application_root: PathBuf,
    state_root: PathBuf,
    cache_root: PathBuf,
    desktop_root: PathBuf,
    manager: PathBuf,
    bun: PathBuf,
    port: u16,
    remote_url: Option<String>,
}

#[derive(Deserialize)]
struct RuntimeLocator {
    base: String,
    path: String,
}

#[derive(Deserialize)]
struct RuntimeLocators {
    state: RuntimeLocator,
    cache: RuntimeLocator,
    desktop: RuntimeLocator,
}

struct SupervisorState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    request_id: String,
    connection: String,
    origin: String,
    version: String,
    desktop_root: PathBuf,
    allow_window_close: Mutex<bool>,
    close_dialog_pending: Mutex<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    schema: String,
    envelope: String,
    connection: String,
    version: String,
    origin: String,
    insecure_remote: bool,
    native_window_controls: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopSettings {
    schema: String,
    zoom_factor: f64,
    tray_enabled: bool,
    close_behavior: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopSettingsPatch {
    zoom_factor: Option<f64>,
    tray_enabled: Option<bool>,
    close_behavior: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
    fullscreen: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            x: 80,
            y: 80,
            width: 1280,
            height: 840,
            maximized: false,
            fullscreen: false,
        }
    }
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            schema: DESKTOP_SETTINGS_SCHEMA.to_string(),
            zoom_factor: 1.0,
            tray_enabled: true,
            close_behavior: "ask".to_string(),
        }
    }
}

impl Drop for SupervisorState {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = force_kill(child);
            }
        }
    }
}

fn env_path(key: &str) -> Result<PathBuf, String> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| format!("Tauri spike 缺少绝对路径环境变量：{key}"))
}

fn config() -> Result<Config, String> {
    let explicit = [
        "T140_PRODUCT_IMAGE_ROOT",
        "T140_APPLICATION_ROOT",
        "T140_STATE_ROOT",
        "T140_CACHE_ROOT",
        "T140_DESKTOP_ROOT",
        "T140_MANAGER",
        "T140_BUN_EXECUTABLE",
        "T140_PORT",
    ]
    .iter()
    .any(|key| std::env::var_os(key).is_some());
    if explicit {
        let port = std::env::var("T140_PORT")
            .map_err(|_| "Tauri spike 缺少 T140_PORT".to_string())?
            .parse::<u16>()
            .map_err(|_| "Tauri spike T140_PORT 无效".to_string())?;
        let remote_url = std::env::var("T140_REMOTE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| validate_remote_origin(&value, true))
            .transpose()?;
        return Ok(Config {
            image_root: env_path("T140_PRODUCT_IMAGE_ROOT")?,
            application_root: env_path("T140_APPLICATION_ROOT")?,
            state_root: env_path("T140_STATE_ROOT")?,
            cache_root: env_path("T140_CACHE_ROOT")?,
            desktop_root: env_path("T140_DESKTOP_ROOT")?,
            manager: env_path("T140_MANAGER")?,
            bun: env_path("T140_BUN_EXECUTABLE")?,
            port,
            remote_url,
        });
    }

    // Portable Tauri 位于 <portable>/desktop；路径不依赖 cwd，也不写入 Product image。
    let executable = std::env::current_exe()
        .map_err(|error| format!("读取 Tauri 可执行文件路径失败：{error}"))?;
    let portable_root = executable
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "Tauri spike 无法定位 portable root".to_string())?;
    let state_root = runtime_root(&portable_root, "state", portable_root.join("data"))?;
    let cache_root = runtime_root(&portable_root, "cache", portable_root.join(".cache"))?;
    let desktop_root = runtime_root(
        &portable_root,
        "desktop",
        portable_root.join("data").join(".desktop"),
    )?;
    let remote_url = read_remote_url(&desktop_root)?;
    Ok(Config {
        image_root: portable_root.join(".output"),
        application_root: portable_root.to_path_buf(),
        state_root,
        cache_root,
        desktop_root,
        manager: portable_root.join("manager").join("neuro-book.mjs"),
        bun: portable_root.join("runtime").join("bun.exe"),
        port: 0,
        remote_url,
    })
}

/** 读取 Manager 写入的相对 locator；Portable 没有该文件时使用安装根内目录。 */
fn runtime_root(root: &Path, key: &str, fallback: PathBuf) -> Result<PathBuf, String> {
    let path = root.join("desktop").join("runtime-locators.json");
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(fallback),
        Err(error) => return Err(format!("读取 Desktop runtime locator 失败：{error}")),
    };
    let locators = serde_json::from_str::<RuntimeLocators>(&text)
        .map_err(|error| format!("解析 Desktop runtime locator 失败：{error}"))?;
    let locator = match key {
        "state" => &locators.state,
        "cache" => &locators.cache,
        "desktop" => &locators.desktop,
        _ => return Ok(fallback),
    };
    if !safe_locator_path(&locator.path) {
        return Err(format!(
            "Desktop runtime locator 路径非法：{}",
            locator.path
        ));
    }
    if locator.base == "installation-root" {
        return Ok(root.join(&locator.path));
    }
    if locator.base == "local-app-data" {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|value| PathBuf::from(value).join("AppData").join("Local"))
            });
        if let Some(base) = base {
            return Ok(base.join(&locator.path));
        }
    }
    if locator.base == "user-app-data" {
        if let Some(home) = std::env::var_os("HOME") {
            return Ok(PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(&locator.path));
        }
    }
    if locator.base == "user-cache" {
        if let Some(home) = std::env::var_os("HOME") {
            return Ok(PathBuf::from(home)
                .join("Library")
                .join("Caches")
                .join(&locator.path));
        }
    }
    Err(format!(
        "Desktop runtime locator base 不受支持：{}",
        locator.base
    ))
}

/** locator 只允许不含 dot segment 的相对路径，防止被篡改后越过 root。 */
fn safe_locator_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.contains(':')
        && !path.contains('\0')
        && path
            .split(['/', '\\'])
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/** 读取安装清单的远端 origin；清单损坏时 fail closed，不回退本地 Product。 */
fn read_remote_url(desktop_root: &Path) -> Result<Option<String>, String> {
    let path = desktop_root.join("desktop-installation.json");
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取 Desktop Installation Manifest 失败：{error}")),
    };
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| format!("解析 Desktop Installation Manifest 失败：{error}"))?;
    let connection = value.get("connection").and_then(Value::as_object);
    match connection
        .and_then(|item| item.get("mode"))
        .and_then(Value::as_str)
    {
        Some("local") => Ok(None),
        Some("remote") => {
            let url = connection
                .and_then(|item| item.get("baseUrl"))
                .and_then(Value::as_str)
                .ok_or_else(|| "远端 Desktop Installation Manifest 缺少 baseUrl".to_string())?;
            let accepted = connection
                .and_then(|item| item.get("insecureHttpAccepted"))
                .and_then(Value::as_bool)
                .ok_or_else(|| {
                    "远端 Desktop Installation Manifest 缺少 HTTP 风险确认".to_string()
                })?;
            Ok(Some(validate_remote_origin(url, accepted)?))
        }
        _ => Err("Desktop Installation Manifest connection 无效".to_string()),
    }
}

/** Tauri 侧复用 Desktop Remote 的 HTTPS/私网 HTTP 边界，拒绝凭据和路径注入。 */
fn validate_remote_origin(value: &str, insecure_http_accepted: bool) -> Result<String, String> {
    let url =
        url::Url::parse(value).map_err(|error| format!("远端 Desktop origin 无效：{error}"))?;
    if url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("远端地址只能包含 origin，不能携带凭据、路径、query 或 hash".to_string());
    }
    if url.scheme() == "https" {
        return Ok(url.to_string());
    }
    if url.scheme() != "http" || !insecure_http_accepted {
        return Err("局域网 HTTP 远端必须记录二次确认".to_string());
    }
    let host = url.host_str().unwrap_or_default();
    let allowed = host == "localhost"
        || host == "::1"
        || host
            .parse::<std::net::Ipv4Addr>()
            .map(is_private_ipv4)
            .unwrap_or(false);
    if !allowed {
        return Err("远端地址必须使用 HTTPS；HTTP 只允许 loopback 或私有 IPv4".to_string());
    }
    Ok(url.to_string())
}

fn is_private_ipv4(address: std::net::Ipv4Addr) -> bool {
    let [first, second, _, _] = address.octets();
    first == 10
        || first == 127
        || (first == 192 && second == 168)
        || (first == 172 && (16..=31).contains(&second))
}

/** 让系统选择一个 loopback 端口，交给本次 Supervisor 生命周期独占。 */
fn select_port(requested: u16) -> Result<u16, String> {
    if requested != 0 {
        return Ok(requested);
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("选择动态 loopback 端口失败：{error}"))
}

fn random_text(bytes: usize) -> Result<String, String> {
    let mut data = vec![0_u8; bytes];
    getrandom::fill(&mut data).map_err(|error| format!("无法生成 Supervisor 随机值：{error}"))?;
    Ok(data.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn supervisor_line(request_id: &str, kind: &str, startup_nonce: Option<&str>, port: u16) -> String {
    let value = match kind {
        "start" => json!({
            "schema": SUPERVISOR_SCHEMA,
            "requestId": request_id,
            "type": "start",
            "startupNonce": startup_nonce.expect("start requires nonce"),
            "port": port,
        }),
        _ => json!({"schema": SUPERVISOR_SCHEMA, "requestId": request_id, "type": kind}),
    };
    format!("{}\n", value)
}

fn spawn_supervisor(
    config: &Config,
) -> Result<
    (
        Child,
        ChildStdin,
        u16,
        String,
        String,
        mpsc::Receiver<String>,
    ),
    String,
> {
    if !config.image_root.is_dir() {
        return Err(format!(
            "Product Runtime Image 不存在：{}",
            config.image_root.display()
        ));
    }
    let port = select_port(config.port)?;
    let startup_nonce = random_text(32)?;
    let request_id = random_text(16)?;
    let mut command = Command::new(&config.bun);
    command
        .args(["--no-install", "--no-env-file"])
        .arg(&config.manager)
        .arg("--root")
        .arg(&config.application_root)
        .args(["desktop", "supervise"])
        .current_dir(&config.application_root)
        .env("T140_BUN_EXECUTABLE", &config.bun)
        .env("NEURO_BOOK_APPLICATION_ROOT", &config.application_root)
        .env("NEURO_BOOK_STATE_ROOT", &config.state_root)
        .env("NEURO_BOOK_CACHE_ROOT", &config.cache_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 Manager Supervisor 失败：{error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Manager Supervisor 缺少 stdin pipe".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Manager Supervisor 缺少 stdout pipe".to_string())?;
    let (sender, receiver) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = sender.send(format!(
                        "{{\"type\":\"reader-error\",\"message\":{}}}",
                        json!(error.to_string())
                    ));
                    break;
                }
            }
        }
    });
    stdin
        .write_all(supervisor_line(&request_id, "start", Some(&startup_nonce), port).as_bytes())
        .map_err(|error| format!("发送 Supervisor start 失败：{error}"))?;
    Ok((child, stdin, port, request_id, startup_nonce, receiver))
}

fn wait_ready(
    child: &mut Child,
    receiver: &mpsc::Receiver<String>,
    request_id: &str,
    startup_nonce: &str,
    expected_port: u16,
) -> Result<String, String> {
    let deadline = Instant::now() + START_TIMEOUT;
    let mut ready = false;
    let mut verified = false;
    let mut version = String::new();
    while Instant::now() < deadline {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("读取 Manager Supervisor 终态失败：{error}"))?
        {
            return Err(format!("Manager Supervisor 在 ready 前退出：{status}"));
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let line = match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(line) => line,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Manager Supervisor stdout 已关闭".to_string())
            }
        };
        let value: Value = serde_json::from_str(&line).map_err(|error| {
            let snippet = line.chars().take(200).collect::<String>();
            format!("Supervisor 输出不是 JSON：{error}；原始行={snippet}")
        })?;
        if value.get("schema").and_then(Value::as_str) != Some(SUPERVISOR_SCHEMA)
            || value.get("requestId").and_then(Value::as_str) != Some(request_id)
        {
            continue;
        }
        match value.get("type").and_then(Value::as_str) {
            Some("ready") => {
                let observed_nonce = value
                    .get("startupNonce")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let observed_origin = value
                    .get("origin")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if observed_nonce != startup_nonce {
                    return Err("Supervisor ready nonce 与本次启动不一致".to_string());
                }
                if observed_origin != format!("http://127.0.0.1:{expected_port}") {
                    return Err("Supervisor ready origin 与动态端口不一致".to_string());
                }
                version = value
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if version.is_empty() {
                    return Err("Supervisor ready 缺少 Product version".to_string());
                }
                ready = true;
            }
            Some("verified")
                if value.get("verification").and_then(Value::as_str) == Some("full") =>
            {
                verified = true
            }
            Some("failure") => {
                return Err(format!(
                    "Manager Supervisor 失败：{} {}",
                    value
                        .get("code")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    value
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                ));
            }
            _ => {}
        }
        if ready && verified {
            return Ok(version);
        }
    }
    Err("Manager Supervisor ready 超时".to_string())
}

fn graceful_shutdown(state: &SupervisorState) -> Result<&'static str, String> {
    if state
        .child
        .lock()
        .map_err(|_| "Manager child lock poisoned".to_string())?
        .is_none()
    {
        return Ok("graceful");
    }
    if let Ok(mut stdin) = state.stdin.lock() {
        if let Some(mut writer) = stdin.take() {
            writer
                .write_all(supervisor_line(&state.request_id, "stop", None, 0).as_bytes())
                .map_err(|error| format!("发送 Supervisor stop 失败：{error}"))?;
            let _ = writer.flush();
        }
    }
    let mut child_guard = state
        .child
        .lock()
        .map_err(|_| "Manager child lock poisoned".to_string())?;
    let child = child_guard
        .as_mut()
        .ok_or_else(|| "Manager Supervisor 已收口".to_string())?;
    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("读取 Manager Supervisor 终态失败：{error}"))?
            .is_some()
        {
            *child_guard = None;
            return Ok("graceful");
        }
        if Instant::now() >= deadline {
            force_kill(child)?;
            *child_guard = None;
            return Ok("forced");
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn shutdown_with_fallback(state: &SupervisorState) -> Result<&'static str, String> {
    match graceful_shutdown(state) {
        Ok(result) => Ok(result),
        Err(error) => {
            eprintln!("graceful shutdown 失败，转为 forced：{error}");
            let mut child_guard = state
                .child
                .lock()
                .map_err(|_| "Manager child lock poisoned".to_string())?;
            if let Some(child) = child_guard.as_mut() {
                force_kill(child)?;
                *child_guard = None;
            }
            Ok("forced")
        }
    }
}

fn force_kill(child: &mut Child) -> Result<(), String> {
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status()
            .map_err(|error| format!("taskkill 启动失败：{error}"))?;
        if !status.success() {
            return Err(format!("taskkill 退出码异常：{status}"));
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    child
        .kill()
        .map_err(|error| format!("强制终止 Manager Supervisor 失败：{error}"))
}

/** 只允许当前 Product loopback 页面调用 Desktop Bridge。 */
fn assert_bridge_origin(window: &WebviewWindow, state: &SupervisorState) -> Result<(), String> {
    let current = window
        .url()
        .map_err(|error| format!("读取 Desktop 页面地址失败：{error}"))?;
    let expected =
        url::Url::parse(&state.origin).map_err(|error| format!("Desktop origin 无效：{error}"))?;
    if current.scheme() != expected.scheme()
        || current.host_str() != expected.host_str()
        || current.port() != expected.port()
    {
        return Err("Desktop Bridge 拒绝非当前 Product origin 的请求。".to_string());
    }
    Ok(())
}

fn validate_settings(settings: &DesktopSettings) -> Result<(), String> {
    if settings.schema != DESKTOP_SETTINGS_SCHEMA {
        return Err("Desktop Settings schema 不受支持。".to_string());
    }
    if !settings.zoom_factor.is_finite() || !(0.75..=2.0).contains(&settings.zoom_factor) {
        return Err("zoomFactor 必须位于 0.75 到 2 之间。".to_string());
    }
    if !matches!(settings.close_behavior.as_str(), "ask" | "tray" | "quit") {
        return Err("closeBehavior 不受支持。".to_string());
    }
    Ok(())
}

fn settings_path(state: &SupervisorState) -> PathBuf {
    state.desktop_root.join("settings.json")
}

fn window_state_path(desktop_root: &Path) -> PathBuf {
    desktop_root.join("window-state.json")
}

fn read_window_state(desktop_root: &Path) -> WindowState {
    fs::read_to_string(window_state_path(desktop_root))
        .ok()
        .and_then(|text| serde_json::from_str::<WindowState>(&text).ok())
        .filter(|state| {
            state.width >= 640
                && state.height >= 480
                && state.width <= 10000
                && state.height <= 10000
        })
        .unwrap_or_default()
}

fn save_window_state(window: &WebviewWindow, desktop_root: &Path) {
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    if maximized || fullscreen {
        return;
    }
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
        fullscreen,
    };
    if fs::create_dir_all(desktop_root).is_ok() {
        if let Ok(text) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(window_state_path(desktop_root), format!("{text}\n"));
        }
    }
}

/** 把保存的窗口位置钳制到当前仍可见的显示器工作区。 */
fn restore_window_state(window: &WebviewWindow, state: &WindowState) {
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    let monitor = monitors
        .iter()
        .find(|monitor| {
            let area = monitor.work_area();
            state.x >= area.position.x && state.x < area.position.x + area.size.width as i32
        })
        .or_else(|| monitors.first());
    let Some(monitor) = monitor else {
        return;
    };
    let area = monitor.work_area();
    let width = state.width.min(area.size.width.max(640));
    let height = state.height.min(area.size.height.max(480));
    let x = state
        .x
        .max(area.position.x - width as i32 + 80)
        .min(area.position.x + area.size.width as i32 - 80);
    let y = state
        .y
        .max(area.position.y - 36)
        .min(area.position.y + area.size.height as i32 - 80);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = window.set_size(tauri::PhysicalSize::new(width, height));
    if state.maximized {
        let _ = window.maximize();
    }
    if state.fullscreen {
        let _ = window.set_fullscreen(true);
    }
}

fn read_desktop_settings(state: &SupervisorState) -> Result<DesktopSettings, String> {
    let path = settings_path(state);
    let settings = match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<DesktopSettings>(&text)
            .map_err(|error| format!("读取 Desktop Settings 失败：{error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => DesktopSettings::default(),
        Err(error) => return Err(format!("读取 Desktop Settings 失败：{error}")),
    };
    validate_settings(&settings)?;
    Ok(settings)
}

fn write_desktop_settings(
    state: &SupervisorState,
    settings: &DesktopSettings,
) -> Result<(), String> {
    validate_settings(settings)?;
    fs::create_dir_all(&state.desktop_root)
        .map_err(|error| format!("创建 Desktop Local Root 失败：{error}"))?;
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("编码 Desktop Settings 失败：{error}"))?;
    fs::write(settings_path(state), format!("{text}\n"))
        .map_err(|error| format!("写入 Desktop Settings 失败：{error}"))
}

#[tauri::command]
fn desktop_status(
    window: WebviewWindow,
    state: State<'_, Arc<SupervisorState>>,
) -> Result<DesktopStatus, String> {
    assert_bridge_origin(&window, state.as_ref())?;
    Ok(DesktopStatus {
        schema: DESKTOP_BRIDGE_SCHEMA.to_string(),
        envelope: "tauri".to_string(),
        connection: state.connection.clone(),
        version: state.version.clone(),
        origin: state.origin.clone(),
        insecure_remote: state.connection == "remote" && state.origin.starts_with("http://"),
        native_window_controls: true,
    })
}

#[tauri::command]
fn desktop_settings(
    window: WebviewWindow,
    state: State<'_, Arc<SupervisorState>>,
) -> Result<DesktopSettings, String> {
    assert_bridge_origin(&window, state.as_ref())?;
    read_desktop_settings(state.as_ref())
}

#[tauri::command]
fn desktop_update_settings(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SupervisorState>>,
    patch: DesktopSettingsPatch,
) -> Result<DesktopSettings, String> {
    assert_bridge_origin(&window, state.as_ref())?;
    let mut settings = read_desktop_settings(state.as_ref())?;
    if let Some(zoom_factor) = patch.zoom_factor {
        settings.zoom_factor = zoom_factor;
    }
    if let Some(tray_enabled) = patch.tray_enabled {
        settings.tray_enabled = tray_enabled;
    }
    if let Some(close_behavior) = patch.close_behavior {
        settings.close_behavior = close_behavior;
    }
    write_desktop_settings(state.as_ref(), &settings)?;
    apply_tray_setting(&app, settings.tray_enabled)?;
    Ok(settings)
}

#[tauri::command]
fn desktop_close_decision(
    window: WebviewWindow,
    state: State<'_, Arc<SupervisorState>>,
    quit: bool,
) -> Result<(), String> {
    assert_bridge_origin(&window, state.as_ref())?;
    if let Ok(mut pending) = state.close_dialog_pending.lock() {
        *pending = false;
    }
    if quit {
        if let Ok(mut allow) = state.allow_window_close.lock() {
            *allow = true;
        }
        return window
            .close()
            .map_err(|error| format!("关闭 NeuroBook 失败：{error}"));
    }
    let settings = read_desktop_settings(state.as_ref())?;
    if settings.tray_enabled {
        window
            .hide()
            .map_err(|error| format!("隐藏 NeuroBook 失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_window(
    window: WebviewWindow,
    state: State<'_, Arc<SupervisorState>>,
    command: String,
) -> Result<(), String> {
    assert_bridge_origin(&window, state.as_ref())?;
    match command.as_str() {
        "show" => window.show(),
        "hide" => window.hide(),
        "minimize" => window.minimize(),
        "toggle-maximize" => {
            if window
                .is_maximized()
                .map_err(|error| format!("读取窗口状态失败：{error}"))?
            {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" | "quit" => window.close(),
        "open-logs" => Ok(()),
        _ => return Err("Desktop Window command 不受支持。".to_string()),
    }
    .map_err(|error| format!("执行 Desktop Window command 失败：{error}"))
}

#[tauri::command]
fn desktop_menu(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SupervisorState>>,
    command: String,
) -> Result<(), String> {
    assert_bridge_origin(&window, state.as_ref())?;
    const COMMANDS: &[&str] = &[
        "file.open",
        "file.settings",
        "file.quit",
        "edit.undo",
        "edit.redo",
        "edit.cut",
        "edit.copy",
        "edit.paste",
        "edit.select-all",
        "view.reload",
        "view.zoom-in",
        "view.zoom-out",
        "view.zoom-reset",
        "help.documentation",
        "help.about",
    ];
    if !COMMANDS.contains(&command.as_str()) {
        return Err("Desktop Menu command 不受支持。".to_string());
    }
    if command == "file.quit" {
        window
            .close()
            .map_err(|error| format!("关闭 NeuroBook 失败：{error}"))?;
    } else {
        app.emit("neurobook:menu", command)
            .map_err(|error| format!("发送 Desktop Menu event 失败：{error}"))?;
    }
    Ok(())
}

/** 建立最小系统托盘；托盘事件只提交白名单窗口/菜单行为。 */
fn build_tray(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, "tray.show", "显示 NeuroBook", true, None::<&str>)
        .map_err(|error| format!("创建托盘显示菜单失败：{error}"))?;
    let settings = MenuItem::with_id(app, "tray.settings", "设置", true, None::<&str>)
        .map_err(|error| format!("创建托盘设置菜单失败：{error}"))?;
    let quit = MenuItem::with_id(app, "tray.quit", "退出", true, None::<&str>)
        .map_err(|error| format!("创建托盘退出菜单失败：{error}"))?;
    let menu = Menu::with_items(app, &[&show, &settings, &quit])
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.ico"))
        .map_err(|error| format!("读取托盘图标失败：{error}"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("NeuroBook")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray.show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray.settings" => {
                let _ = app.emit("neurobook:menu", "file.settings");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray.quit" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                }
            }
            _ => {}
        })
        .build(app)
        .map(|_| ())
        .map_err(|error| format!("创建 NeuroBook 托盘失败：{error}"))
}

/** 根据设置即时创建或移除托盘，避免只在启动时读取一次配置。 */
fn apply_tray_setting(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        if app.tray_by_id("main").is_none() {
            build_tray(app)?;
        }
    } else {
        let _ = app.remove_tray_by_id("main");
    }
    Ok(())
}

fn start_headless(config: Config) -> Result<(), String> {
    if config.remote_url.is_some() {
        return Err("远端 Desktop 需要加载 WebView 后完成 capability smoke，不能使用本地 Product headless 模式。".to_string());
    }
    let (mut child, stdin, port, request_id, startup_nonce, receiver) = spawn_supervisor(&config)?;
    let version = wait_ready(&mut child, &receiver, &request_id, &startup_nonce, port)?;
    let state = SupervisorState {
        child: Mutex::new(Some(child)),
        stdin: Mutex::new(Some(stdin)),
        request_id,
        connection: "local".to_string(),
        origin: format!("http://127.0.0.1:{port}"),
        version,
        desktop_root: config.desktop_root,
        allow_window_close: Mutex::new(false),
        close_dialog_pending: Mutex::new(false),
    };
    let result = shutdown_with_fallback(&state)?;
    println!("{{\"kind\":\"tauri-headless-ready\",\"port\":{port},\"shutdown\":\"{result}\"}}");
    Ok(())
}

fn main() {
    let config = match config() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    if std::env::args().any(|argument| argument == "--t140-headless" || argument == "--headless") {
        if let Err(error) = start_headless(config) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    let (child, stdin, port, request_id, connection, origin, version, receiver) =
        if let Some(remote_url) = config.remote_url.clone() {
            let request_id = random_text(16).unwrap_or_else(|_| "remote".to_string());
            let (_sender, receiver) = mpsc::channel::<String>();
            (
                None,
                None,
                0,
                request_id,
                "remote".to_string(),
                remote_url,
                "remote".to_string(),
                receiver,
            )
        } else {
            let (mut child, stdin, port, request_id, startup_nonce, receiver) =
                match spawn_supervisor(&config) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                };
            let version = match wait_ready(&mut child, &receiver, &request_id, &startup_nonce, port)
            {
                Ok(version) => version,
                Err(error) => {
                    let _ = force_kill(&mut child);
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            };
            (
                Some(child),
                Some(stdin),
                port,
                request_id,
                "local".to_string(),
                format!("http://127.0.0.1:{port}"),
                version,
                receiver,
            )
        };
    if connection == "local" {
        // Manager Supervisor 的剩余事件由后台线程消费，避免 stdout pipe 填满。
        thread::spawn(move || {
            for line in receiver {
                eprintln!("[manager] {line}");
            }
        });
    }
    let state = Arc::new(SupervisorState {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        request_id,
        connection,
        origin,
        version,
        desktop_root: config.desktop_root.clone(),
        allow_window_close: Mutex::new(false),
        close_dialog_pending: Mutex::new(false),
    });
    let state_for_setup = Arc::clone(&state);
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            desktop_settings,
            desktop_update_settings,
            desktop_close_decision,
            desktop_window,
            desktop_menu
        ])
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let payload = json!({
                "args": args.into_iter().take(32).map(|value| value.chars().take(4096).collect::<String>()).collect::<Vec<_>>(),
                "cwd": cwd.chars().take(4096).collect::<String>(),
            });
            let _ = app.emit("neurobook:second-instance", payload);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(Arc::clone(&state))
        .setup(move |app| {
            let tray_enabled = read_desktop_settings(&state_for_setup)
                .map(|settings| settings.tray_enabled)
                .unwrap_or(true);
            apply_tray_setting(app.handle(), tray_enabled)
                .map_err(|error| tauri::Error::AssetNotFound(error))?;
            let target = if state_for_setup.connection == "remote" {
                format!("{}/", state_for_setup.origin)
            } else {
                format!("http://127.0.0.1:{port}/")
            };
            let url = url::Url::parse(&target)
                .map_err(|error| format!("Desktop Product URL 无效：{error}"))?;
            let saved_window_state = read_window_state(&state_for_setup.desktop_root);
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("NeuroBook Tauri Envelope Spike")
                .inner_size(saved_window_state.width as f64, saved_window_state.height as f64)
                .data_directory(state_for_setup.desktop_root.join("webview"))
                .initialization_script(TAURI_BRIDGE_SCRIPT)
                .build()?;
            restore_window_state(&window, &saved_window_state);
            let window_for_state = window.clone();
            let desktop_root_for_state = state_for_setup.desktop_root.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Destroyed) {
                    save_window_state(&window_for_state, &desktop_root_for_state);
                }
            });
            let state_for_close = Arc::clone(&state_for_setup);
            let window_for_close = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if state_for_close
                        .allow_window_close
                        .lock()
                        .map(|allow| *allow)
                        .unwrap_or(false)
                    {
                        return;
                    }
                    let settings = read_desktop_settings(&state_for_close).unwrap_or_default();
                    if settings.close_behavior == "ask" {
                        api.prevent_close();
                        if let Ok(mut pending) = state_for_close.close_dialog_pending.lock() {
                            if !*pending {
                                *pending = true;
                                let _ = window_for_close.emit("neurobook:close-requested", ());
                            }
                        }
                        return;
                    }
                    if settings.tray_enabled && settings.close_behavior == "tray" {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                        return;
                    }
                    if let Err(error) = shutdown_with_fallback(&state_for_close) {
                        eprintln!("Tauri close fallback 失败：{error}");
                    }
                }
            });
            Ok(())
        });
    if let Err(error) = builder.run(tauri::generate_context!()) {
        eprintln!("Tauri runtime 退出异常：{error}");
        let _ = shutdown_with_fallback(&state);
    }
}
