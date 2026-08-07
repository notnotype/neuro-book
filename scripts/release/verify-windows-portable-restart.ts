import {readFile, stat, writeFile, mkdir} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {parse as parseDotenv} from "dotenv";
import {parse as parseYaml, stringify as stringifyYaml} from "yaml";

import {readInstallationManifest} from "nbook/packages/neuro-book-manager/src/manifest-store";
import {installationPaths} from "nbook/packages/neuro-book-manager/src/paths";
import type {InstallationManifest} from "nbook/packages/neuro-book-manager/src/types";
import {acquireAgentSessionStoreExclusiveLease} from "nbook/server/agent/session/agent-session-store";

const PORT = 39_123;
// Manager正式启动合同允许120秒；外层Verifier必须更长，才能观察Manager自己的ready或失败终态。
const STARTUP_TIMEOUT_MS = 150_000;
const SHUTDOWN_TIMEOUT_MS = 40_000;
const BROWSER_SMOKE_TIMEOUT_MS = 120_000;
const BROWSER_SMOKE_SCRIPT = fileURLToPath(new URL("../deploy/product-browser-smoke.ts", import.meta.url));
const ADMIN_USERNAME = "release-smoke-admin";
const ADMIN_PASSWORD = "release-auth-smoke-password";

type RestartOptions = {
    portableRoot: string;
    browserExecutable: string;
};

type LoginPayload = {
    authEnabled: boolean;
    user: {username: string; role: string};
};

const options = parseOptions(process.argv.slice(2));
await verifyWindowsPortableRestart(options);

/**
 * 用包内Manager完成两次连续启动，证明浏览器、鉴权与State Root lease生命周期属于同一发行合同。
 */
async function verifyWindowsPortableRestart(input: RestartOptions): Promise<void> {
    if (process.platform !== "win32") throw new Error("Windows Portable restart verifier仅支持Windows。" );
    const root = resolve(input.portableRoot);
    const manifestPath = join(root, ".deploy", "installation.json");
    const manifest = await readInstallationManifest(manifestPath);
    if (!manifest || manifest.profile !== "windows-portable") {
        throw new Error(`目标不是Manifest v5 Windows Portable：${manifestPath}`);
    }
    const stateRoot = installationPaths(root, manifest.roots).state;
    const shadowWorkspace = join(root, "workspace");
    const databasePath = join(stateRoot, "workspace", ".nbook", "neuro-book.sqlite");
    await configurePort(stateRoot, PORT);
    await assertMissing(shadowWorkspace, "Portable浏览器验收前存在Installation Root影子workspace");

    await withManagedPortable(root, stateRoot, manifest, "release-browser-smoke", async (baseUrl) => {
        await runBrowserSmokeWithNode(baseUrl, manifest.appVersion, input.browserExecutable,
            join(stateRoot, "logs", "release-browser-smoke-failure.png"));
    });

    await createAdmin(root, manifest);
    await assertFile(databasePath, "Portable App SQLite没有位于data/workspace/.nbook");
    await assertMissing(shadowWorkspace, "Portable创建管理员后在Installation Root产生了影子workspace");

    await withManagedPortable(root, stateRoot, manifest, "release-auth-smoke", async (baseUrl) => {
        const response = await fetch(new URL("/api/auth/login", baseUrl), {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({username: ADMIN_USERNAME, password: ADMIN_PASSWORD}),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Portable login返回HTTP ${String(response.status)}`);
        // HTTP JSON是外部运行时输入，只在这里以unknown读取并立即收窄。
        const payload: unknown = await response.json();
        if (!isLoginPayload(payload)
            || !payload.authEnabled
            || payload.user.username !== ADMIN_USERNAME
            || payload.user.role !== "admin") {
            throw new Error("Portable login payload不符合管理员合同。" );
        }
        if (!response.headers.get("set-cookie")) throw new Error("Portable login没有写入session cookie。" );
        await assertMissing(shadowWorkspace, "Portable登录后在Installation Root产生了影子workspace");
    });
}

/**
 * Windows上的Bun 1.3.14无法可靠连接Playwright Chromium调试pipe；浏览器探针固定交给Node，
 * Portable、Manager和Product生命周期仍由候选包内Bun执行。
 */
async function runBrowserSmokeWithNode(
    url: string,
    expectedVersion: string,
    browserExecutable: string,
    screenshot: string,
): Promise<void> {
    const child = Bun.spawn([
        "node",
        "--import",
        "tsx",
        BROWSER_SMOKE_SCRIPT,
        "--url",
        url,
        "--expected-version",
        expectedVersion,
        "--browser-executable",
        browserExecutable,
        "--screenshot",
        screenshot,
    ], {
        cwd: process.cwd(),
        env: {...process.env, NO_COLOR: "1"},
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
    });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    let exitCode: number;
    try {
        exitCode = await withTimeout(child.exited, BROWSER_SMOKE_TIMEOUT_MS, "Windows Playwright smoke");
    } catch (error) {
        child.kill();
        await child.exited.catch(() => undefined);
        const [output, diagnostic] = await Promise.all([stdout, stderr]);
        throw new Error(`Windows Playwright smoke未完成。\n${output}\n${diagnostic}`, {cause: error});
    }
    const [output, diagnostic] = await Promise.all([stdout, stderr]);
    if (exitCode !== 0) {
        throw new Error(`Windows Playwright smoke退出码异常：${String(exitCode)}\n${output}\n${diagnostic}`);
    }
    if (output.trim()) console.log(output.trim());
    if (diagnostic.trim()) console.error(diagnostic.trim());
}

/**
 * 启动候选包中的真实Manager；action结束后通过stdin协议完整收口，并立即证明runtime lease可重取。
 */
async function withManagedPortable(
    root: string,
    stateRoot: string,
    manifest: InstallationManifest,
    logName: string,
    action: (baseUrl: string) => Promise<void>,
): Promise<void> {
    const managerRuntime = manifest.components.managerRuntime;
    if (!("path" in managerRuntime)) throw new Error("Windows Portable Manifest缺少受管Manager Runtime路径。" );
    const runtimePath = join(root, managerRuntime.path);
    const managerPath = join(root, manifest.components.manager.path);
    const logsRoot = join(stateRoot, "logs");
    await mkdir(logsRoot, {recursive: true});
    const child = Bun.spawn([
        runtimePath,
        managerPath,
        "--root",
        root,
        "start",
        "--shutdown-on-stdin-end",
    ], {
        cwd: root,
        env: {...process.env, NO_COLOR: "1"},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
    });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    let actionFailure: Error | null = null;
    try {
        const baseUrl = `http://127.0.0.1:${String(PORT)}`;
        await waitForVersion(child, baseUrl, manifest.appVersion);
        await action(baseUrl);
        if (child.exitCode !== null) throw new Error(`Candidate Manager在验收完成前退出：${String(child.exitCode)}`);
    } catch (error) {
        actionFailure = asError(error);
    }

    const lifecycleFailures: Error[] = [];
    try {
        await child.stdin.end();
        const exitCode = await withTimeout(child.exited, SHUTDOWN_TIMEOUT_MS, "Candidate Manager正式shutdown");
        if (exitCode !== 0) lifecycleFailures.push(new Error(`Candidate Manager正式shutdown退出码异常：${String(exitCode)}`));
    } catch (error) {
        lifecycleFailures.push(asError(error));
        child.kill();
        await child.exited.catch(() => undefined);
    }
    const [output, diagnostic] = await Promise.all([stdout, stderr]);
    await Promise.all([
        writeFile(join(logsRoot, `${logName}.stdout.log`), output, "utf8"),
        writeFile(join(logsRoot, `${logName}.stderr.log`), diagnostic, "utf8"),
    ]);
    try {
        await assertAgentStoreLeaseAvailable(join(stateRoot, "workspace"));
    } catch (error) {
        lifecycleFailures.push(asError(error));
    }

    if (actionFailure || lifecycleFailures.length > 0) {
        if (output) console.error(output);
        if (diagnostic) console.error(diagnostic);
        const failures = [...(actionFailure ? [actionFailure] : []), ...lifecycleFailures];
        throw failures.length === 1 ? failures[0] : new AggregateError(failures, `${logName}验收与生命周期收口失败。`);
    }
}

/** 使用Manager正式管理员命令启用鉴权，stdin密码不会进入参数或日志。 */
async function createAdmin(root: string, manifest: InstallationManifest): Promise<void> {
    const managerRuntime = manifest.components.managerRuntime;
    if (!("path" in managerRuntime)) throw new Error("Windows Portable Manifest缺少受管Manager Runtime路径。" );
    const child = Bun.spawn([
        join(root, managerRuntime.path),
        join(root, manifest.components.manager.path),
        "--root",
        root,
        "admin",
        "create",
        ADMIN_USERNAME,
        "--password-stdin",
    ], {
        cwd: root,
        env: {...process.env, NO_COLOR: "1", AUTH_ADMIN_PASSWORD: undefined},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
    });
    await child.stdin.write(new TextEncoder().encode(ADMIN_PASSWORD));
    await child.stdin.end();
    const [exitCode, output, diagnostic] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(`Portable create admin失败：exit=${String(exitCode)}\n${output}\n${diagnostic}`);
}

/** 等待版本端点ready，并拒绝Manager提前退出或返回错误Product代次。 */
async function waitForVersion(
    child: ReturnType<typeof Bun.spawn>,
    baseUrl: string,
    expectedVersion: string,
): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const expectedLabel = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
    let lastError = "尚未收到HTTP响应";
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Candidate Manager在Product ready前退出：${String(child.exitCode)}`);
        try {
            const response = await fetch(new URL("/api/app/version", baseUrl), {signal: AbortSignal.timeout(1_000)});
            if (response.ok) {
                // HTTP JSON是外部运行时输入，只在这里以unknown读取并立即收窄。
                const payload: unknown = await response.json();
                if (isVersionPayload(payload) && payload.versionLabel === expectedLabel) return;
                throw new Error(`版本接口未返回期望代次：${expectedLabel}`);
            }
            lastError = `HTTP ${String(response.status)}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await Bun.sleep(200);
    }
    throw new Error(`Candidate Product在${String(STARTUP_TIMEOUT_MS)}ms内未ready：${lastError}`);
}

/** 正常shutdown后立即取得同一把Agent Session Store独占lease，拒绝只以端口释放作为完成证明。 */
async function assertAgentStoreLeaseAvailable(workspaceRoot: string): Promise<void> {
    const release = await acquireAgentSessionStoreExclusiveLease(workspaceRoot);
    await release();
}

/** 用结构化解析修改Portable测试State Root端口。 */
async function configurePort(stateRoot: string, port: number): Promise<void> {
    const envPath = join(stateRoot, ".env");
    const environment = parseDotenv(await readFile(envPath, "utf8"));
    environment.NUXT_PORT = String(port);
    environment.PORT = String(port);
    await writeFile(envPath, `${Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");

    const configPath = join(stateRoot, "config.yaml");
    const config = parseYaml(await readFile(configPath, "utf8")) as {
        server?: {host?: string; port?: number};
        database?: {kind?: string; url?: string};
        auth?: {enabled?: boolean};
    };
    config.server = {...config.server, port};
    await writeFile(configPath, stringifyYaml(config), "utf8");
}

/** 对有界异步生命周期施加超时，并在提前完成时清理timer。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolvePromise, rejectPromise) => {
                timer = setTimeout(() => rejectPromise(new Error(`${label}在${String(timeoutMs)}ms内未完成。`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** 校验必须存在的普通文件。 */
async function assertFile(path: string, message: string): Promise<void> {
    const entry = await stat(path).catch(() => null);
    if (!entry?.isFile()) throw new Error(`${message}：${path}`);
}

/** 校验不允许出现的路径。 */
async function assertMissing(path: string, message: string): Promise<void> {
    const entry = await stat(path).catch(() => null);
    if (entry) throw new Error(`${message}：${path}`);
}

/** 收窄登录HTTP响应。 */
function isLoginPayload(value: unknown): value is LoginPayload {
    if (!value || typeof value !== "object" || !("authEnabled" in value) || !("user" in value)) return false;
    const user = value.user;
    return typeof value.authEnabled === "boolean"
        && !!user
        && typeof user === "object"
        && "username" in user
        && "role" in user
        && typeof user.username === "string"
        && typeof user.role === "string";
}

/** 收窄版本HTTP响应。 */
function isVersionPayload(value: unknown): value is {versionLabel: string} {
    return !!value && typeof value === "object" && "versionLabel" in value && typeof value.versionLabel === "string";
}

/** 保留非Error异常的可读诊断。 */
function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/** 解析发布workflow传入的绝对候选目录与浏览器路径。 */
function parseOptions(args: string[]): RestartOptions {
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith("--") || !value) throw new Error(`无效参数：${args.slice(index).join(" ")}`);
        values.set(key, value);
    }
    const portableRoot = values.get("--portable-root");
    const browserExecutable = values.get("--browser-executable");
    if (!portableRoot || !browserExecutable) {
        throw new Error("用法：bun scripts/release/verify-windows-portable-restart.ts --portable-root <path> --browser-executable <path>" );
    }
    return {portableRoot: resolve(portableRoot), browserExecutable: resolve(browserExecutable)};
}
