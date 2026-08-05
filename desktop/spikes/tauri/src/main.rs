use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

const SHUTDOWN_PATH: &str = "/__nbook/control/shutdown";
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct Config {
    image_root: PathBuf,
    application_root: PathBuf,
    state_root: PathBuf,
    cache_root: PathBuf,
    launcher: PathBuf,
    bun: PathBuf,
    port: u16,
}

struct ProductState {
    child: Mutex<Option<Child>>,
    token: String,
    config: Config,
}

struct InstanceLock {
    path: PathBuf,
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
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
        "T140_LAUNCHER",
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
        return Ok(Config {
            image_root: env_path("T140_PRODUCT_IMAGE_ROOT")?,
            application_root: env_path("T140_APPLICATION_ROOT")?,
            state_root: env_path("T140_STATE_ROOT")?,
            cache_root: env_path("T140_CACHE_ROOT")?,
            launcher: env_path("T140_LAUNCHER")?,
            bun: env_path("T140_BUN_EXECUTABLE")?,
            port,
        });
    }

    // Portable Tauri 位于 <portable>/desktop；所有资源从可执行文件反推，不能依赖 cwd。
    let executable = std::env::current_exe()
        .map_err(|error| format!("读取 Tauri 可执行文件路径失败：{error}"))?;
    let portable_root = executable
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "Tauri spike 无法定位 portable root".to_string())?;
    Ok(Config {
        image_root: portable_root.join("app").join(".output"),
        application_root: portable_root.join("app"),
        state_root: portable_root.join("data"),
        cache_root: portable_root.join(".cache"),
        launcher: portable_root.join("desktop").join("product-launcher.mjs"),
        bun: portable_root.join("runtime").join("bun.exe"),
        port: 0,
    })
}

/** 让系统选择一个 loopback 端口，交给本次 Product 生命周期独占。 */
fn select_port(requested: u16) -> Result<u16, String> {
    if requested != 0 {
        return Ok(requested);
    }
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("选择动态 loopback 端口失败：{error}"))
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("无法生成 shutdown token：{error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn acquire_instance_lock(state_root: &Path) -> Result<InstanceLock, String> {
    fs::create_dir_all(state_root)
        .map_err(|error| format!("创建 Desktop lock 目录失败：{error}"))?;
    let path = state_root.join(".t140-desktop-instance.lock");
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("Tauri 单实例锁已存在或无法创建：{error}"))?;
    Ok(InstanceLock { path })
}

/** 在启动长期 Product 前执行一次幂等的 Product-owned migration。 */
fn prepare_product(config: &Config) -> Result<(), String> {
    let mut command = Command::new(&config.bun);
    command
        .args(["--no-install", "--no-env-file"])
        .arg(&config.launcher)
        .arg("prepare")
        .args([
            "--image-root",
            config
                .image_root
                .to_str()
                .ok_or("Product image 路径不是 UTF-8")?,
            "--application-root",
            config
                .application_root
                .to_str()
                .ok_or("Application Root 路径不是 UTF-8")?,
            "--state-root",
            config
                .state_root
                .to_str()
                .ok_or("State Root 路径不是 UTF-8")?,
            "--cache-root",
            config
                .cache_root
                .to_str()
                .ok_or("Cache Root 路径不是 UTF-8")?,
            "--port",
            &config.port.to_string(),
            "--bun",
            config.bun.to_str().ok_or("Bun 路径不是 UTF-8")?,
        ])
        .current_dir(&config.application_root)
        .env("T140_BUN_EXECUTABLE", &config.bun)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    let status = command
        .status()
        .map_err(|error| format!("启动 Product migration 失败：{error}"))?;
    if !status.success() {
        return Err(format!("Product migration 退出码异常：{status}"));
    }
    Ok(())
}

fn spawn_product(config: &Config, token: &str) -> Result<Child, String> {
    fs::create_dir_all(&config.state_root)
        .map_err(|error| format!("创建 State Root 失败：{error}"))?;
    fs::create_dir_all(&config.cache_root)
        .map_err(|error| format!("创建 Cache Root 失败：{error}"))?;
    let mut command = Command::new(&config.bun);
    command
        .args(["--no-install", "--no-env-file"])
        .arg(&config.launcher)
        .arg("start")
        .args([
            "--image-root",
            config
                .image_root
                .to_str()
                .ok_or("Product image 路径不是 UTF-8")?,
            "--application-root",
            config
                .application_root
                .to_str()
                .ok_or("Application Root 路径不是 UTF-8")?,
            "--state-root",
            config
                .state_root
                .to_str()
                .ok_or("State Root 路径不是 UTF-8")?,
            "--cache-root",
            config
                .cache_root
                .to_str()
                .ok_or("Cache Root 路径不是 UTF-8")?,
            "--port",
            &config.port.to_string(),
            "--bun",
            config.bun.to_str().ok_or("Bun 路径不是 UTF-8")?,
        ])
        .current_dir(&config.application_root)
        .env("NEURO_BOOK_SHUTDOWN_TOKEN", token)
        .env("T140_BUN_EXECUTABLE", &config.bun)
        .env("NITRO_HOST", "127.0.0.1")
        .env("HOST", "127.0.0.1")
        .env("NITRO_PORT", config.port.to_string())
        .env("PORT", config.port.to_string())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    command
        .spawn()
        .map_err(|error| format!("启动 Product launcher 失败：{error}"))
}

fn http_request(
    config: &Config,
    method: &str,
    path: &str,
    token: Option<&str>,
) -> Result<u16, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", config.port))
        .map_err(|error| format!("连接 Product loopback 失败：{error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| format!("设置 HTTP read timeout 失败：{error}"))?;
    let mut request =
        format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n");
    if let Some(token) = token {
        request.push_str(&format!("Authorization: Bearer {token}\r\n"));
    }
    request.push_str("Content-Length: 0\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("发送 Product HTTP 请求失败：{error}"))?;
    let mut response = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|error| format!("读取 Product HTTP 响应失败：{error}"))?;
        if read == 0 {
            break;
        }
        response.extend_from_slice(&buffer[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if response.len() > 64 * 1024 {
            return Err("Product HTTP 响应头超过 64 KiB".to_string());
        }
    }
    String::from_utf8_lossy(&response)
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Product HTTP 响应缺少状态码".to_string())?
        .parse::<u16>()
        .map_err(|error| format!("Product HTTP 状态码无效：{error}"))
}

fn wait_health(config: &Config, child: &mut Child) -> Result<(), String> {
    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("读取 Product launcher 终态失败：{error}"))?
        {
            return Err(format!("Product 在 health 前退出：{status}"));
        }
        if let Ok(200) = http_request(config, "GET", "/api/app/version", None) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("Product health 超时".to_string());
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn graceful_shutdown(state: &ProductState) -> Result<&'static str, String> {
    let status = http_request(&state.config, "POST", SHUTDOWN_PATH, Some(&state.token))?;
    if status != 202 {
        return Err(format!("Product shutdown 返回 HTTP {status}"));
    }
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "Product child lock poisoned".to_string())?;
    let child = guard
        .as_mut()
        .ok_or_else(|| "Product child 已收口".to_string())?;
    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("读取 Product 终态失败：{error}"))?
            .is_some()
        {
            *guard = None;
            return Ok("graceful");
        }
        if Instant::now() >= deadline {
            force_kill(child)?;
            *guard = None;
            return Ok("forced");
        }
        thread::sleep(Duration::from_millis(100));
    }
}

/** 控制通道失败时仍收口整个 launcher 树，并把本次结果标成 forced。 */
fn shutdown_with_fallback(state: &ProductState) -> Result<&'static str, String> {
    match graceful_shutdown(state) {
        Ok(result) => Ok(result),
        Err(error) => {
            eprintln!("graceful shutdown 失败，转为 forced：{error}");
            let mut guard = state
                .child
                .lock()
                .map_err(|_| "Product child lock poisoned".to_string())?;
            if let Some(child) = guard.as_mut() {
                force_kill(child)?;
                *guard = None;
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
        .map_err(|error| format!("强制终止 Product 失败：{error}"))
}

fn run_headless(mut config: Config, _instance: InstanceLock) -> Result<(), String> {
    config.port = select_port(config.port)?;
    prepare_product(&config)?;
    let token = random_token()?;
    let mut child = spawn_product(&config, &token)?;
    if let Err(error) = wait_health(&config, &mut child) {
        let _ = force_kill(&mut child);
        return Err(error);
    }
    let state = ProductState {
        child: Mutex::new(Some(child)),
        token,
        config,
    };
    let port = state.config.port;
    if let Ok(value) = std::env::var("T140_HOLD_MS") {
        if let Ok(milliseconds) = value.parse::<u64>() {
            thread::sleep(Duration::from_millis(milliseconds));
        }
    }
    let result = shutdown_with_fallback(&state)?;
    println!(
        "{{\"kind\":\"tauri-headless-ready\",\"port\":{},\"shutdown\":\"{result}\"}}",
        port
    );
    Ok(())
}

fn main() {
    let mut config = match config() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    config.port = match select_port(config.port) {
        Ok(port) => port,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let instance = match acquire_instance_lock(&config.state_root) {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    if std::env::args().any(|argument| argument == "--t140-headless" || argument == "--headless") {
        if let Err(error) = run_headless(config, instance) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if let Err(error) = prepare_product(&config) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    let token = match random_token() {
        Ok(token) => token,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let child = match spawn_product(&config, &token) {
        Ok(mut child) => {
            if let Err(error) = wait_health(&config, &mut child) {
                let _ = force_kill(&mut child);
                eprintln!("{error}");
                std::process::exit(1);
            }
            child
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let state = Arc::new(ProductState {
        child: Mutex::new(Some(child)),
        token,
        config: config.clone(),
    });
    let state_for_setup = Arc::clone(&state);
    let builder = tauri::Builder::default()
        .manage(instance)
        .manage(state)
        .setup(move |app| {
            let url = url::Url::parse(&format!("http://127.0.0.1:{}/", config.port))
                .map_err(|error| format!("Product loopback URL 无效：{error}"))?;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("NeuroBook Tauri Envelope Spike")
                .inner_size(1280.0, 840.0)
                .build()?;
            let state_for_close = Arc::clone(&state_for_setup);
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                    if let Err(error) = shutdown_with_fallback(&state_for_close) {
                        eprintln!("Tauri close fallback 失败：{error}");
                    }
                }
            });
            let _ = app.emit("t140-ready", config.port);
            Ok(())
        });
    if let Err(error) = builder.run(tauri::generate_context!()) {
        eprintln!("Tauri runtime 退出异常：{error}");
        std::process::exit(1);
    }
}
