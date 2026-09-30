#!/usr/bin/env bun
/**
 * G0 生产侧验证：用 Manager 的真实就绪探测（waitForApplicationReady）与停止客户端
 * （shutdownNativeProduct）驱动自有入口构建出的 Product，并验证 WebSocket 鉴权与 SIGTERM。
 *
 * 用法：bun g0-harness/prod-harness.ts <prepare|manager|sigterm> <stateRoot> <port>
 */
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync, readFileSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";
import {spawnOwnedProcess} from "../packages/owned-process/src/index";
import {applicationEnvironment, waitForApplicationReady} from "../packages/neuro-book-manager/src/app-commands";
import {shutdownNativeProduct} from "../packages/neuro-book-manager/src/product-shutdown";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
    PRODUCT_STARTUP_NONCE_ENVIRONMENT,
} from "../packages/neuro-book-contracts/src/product-runtime";

const [mode, stateRootArg, portArg] = process.argv.slice(2);
if (!mode || !stateRootArg || !portArg) throw new Error("usage: prod-harness <prepare|manager|sigterm> <stateRoot> <port>");
const root = resolve(import.meta.dirname, "..");
const imageRoot = join(root, ".output");
const stateRoot = resolve(stateRootArg);
const cacheRoot = join(stateRoot, "cache");
const port = Number(portArg);
const eventLog = join(stateRoot, "g0-events.jsonl");
const bootstrap = join(imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
const serverPackage = JSON.parse(readFileSync(join(imageRoot, "server", "package.json"), "utf8")) as {version?: string};
const expectedVersion = serverPackage.version ?? "unknown";
const adminPassword = "g0-admin-password-123";
const leaseLock = join(stateRoot, "workspace", ".nbook", "agent", "migrations", "runtime.lease.lock");

function log(label: string, value: unknown): void {
    console.log(`[harness ${new Date().toISOString()}] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function baseEnv(): Promise<NodeJS.ProcessEnv> {
    return {
        ...await applicationEnvironment(root, stateRoot, false, cacheRoot),
        BUN: process.execPath,
        G0_EVENT_LOG: eventLog,
    };
}

function runCommand(args: string[], env: NodeJS.ProcessEnv, stdin?: string): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, ...args], {
            cwd: root,
            env,
            stdio: [stdin === undefined ? "ignore" : "pipe", "inherit", "inherit"],
        });
        if (stdin !== undefined) child.stdin?.end(stdin);
        child.once("error", rejectPromise);
        child.once("exit", (code) => resolvePromise(code ?? 1));
    });
}

async function prepare(): Promise<void> {
    rmSync(stateRoot, {recursive: true, force: true});
    const env = await baseEnv();
    for (const args of [
        ["command", "migrate-database"],
        ["command", "migrate-application-state", "--apply"],
    ]) {
        const code = await runCommand(args, env);
        log(`product-command ${args.join(" ")}`, {code});
        if (code !== 0) process.exit(code);
    }
    const code = await runCommand(["command", "create-admin", "admin", "--password-stdin"], env, adminPassword);
    log("product-command command create-admin", {code});
    if (code !== 0) process.exit(code);
}

async function login(): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/auth/login`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({username: "admin", password: adminPassword}),
    });
    const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    log("login", {status: response.status, cookieNames: response.headers.getSetCookie().map((cookie) => cookie.split("=")[0])});
    if (response.status !== 200 || !cookies) throw new Error("login failed");
    return cookies;
}

async function probe(cookie?: string): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/g0/probe`, cookie ? {headers: {cookie}} : undefined);
    const body = await response.text();
    log(`GET /api/g0/probe ${cookie ? "with cookie" : "without cookie"}`, {status: response.status, body: body.slice(0, 600)});
}

function wsRoundTrip(cookie?: string): Promise<unknown> {
    return new Promise((resolvePromise) => {
        const received: string[] = [];
        const client = new WebSocket(`ws://127.0.0.1:${String(port)}/__g0/ws`, cookie ? {headers: {cookie}} as never : undefined);
        const timer = setTimeout(() => resolvePromise({ok: false, error: "timeout", received}), 10_000);
        client.onmessage = (message) => {
            received.push(String(message.data));
            if (received.length === 1) client.send("ping-from-harness");
            else {
                clearTimeout(timer);
                client.close(1000);
                resolvePromise({ok: true, received});
            }
        };
        client.onerror = (error) => {
            clearTimeout(timer);
            resolvePromise({ok: false, error: (error as ErrorEvent).message ?? String(error.type), received});
        };
        client.onclose = (event) => {
            if (received.length < 2) {
                clearTimeout(timer);
                resolvePromise({ok: false, closeCode: event.code, received});
            }
        };
    });
}

async function rawUpgradeStatus(cookie?: string): Promise<string> {
    // 直接读取拒绝时的 HTTP 状态行，确认是鉴权拒绝而不是其它失败。
    const {connect} = await import("node:net");
    return await new Promise((resolvePromise) => {
        const socket = connect(port, "127.0.0.1", () => {
            socket.write([
                "GET /__g0/ws HTTP/1.1",
                `Host: 127.0.0.1:${String(port)}`,
                "Connection: Upgrade",
                "Upgrade: websocket",
                "Sec-WebSocket-Version: 13",
                `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
                ...(cookie ? [`Cookie: ${cookie}`] : []),
                "",
                "",
            ].join("\r\n"));
        });
        socket.once("data", (chunk) => {
            resolvePromise(chunk.toString("utf8").split("\r\n")[0] ?? "");
            socket.destroy();
        });
        socket.once("error", (error) => resolvePromise(`error: ${error.message}`));
    });
}

async function exercise(): Promise<void> {
    await probe();
    const cookie = await login();
    await probe(cookie);
    log("ws without cookie (raw status line)", await rawUpgradeStatus());
    log("ws with cookie (raw status line)", await rawUpgradeStatus(cookie));
    log("ws round trip without cookie", await wsRoundTrip());
    log("ws round trip with cookie", await wsRoundTrip(cookie));
    log("ws round trip with forged cookie", await wsRoundTrip("nuxt-session=Fe26.2**forged"));
}

function slowRequest(ms: number): Promise<unknown> {
    const started = Date.now();
    return fetch(`http://127.0.0.1:${String(port)}/api/g0/slow?ms=${String(ms)}`, {headers: {cookie: currentCookie}})
        .then(async (response) => ({status: response.status, body: await response.text(), elapsedMs: Date.now() - started}))
        .catch((error: unknown) => ({error: String(error), elapsedMs: Date.now() - started}));
}
let currentCookie = "";

async function managerScenario(): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const env: NodeJS.ProcessEnv = {
        ...await baseEnv(),
        [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: token,
        [PRODUCT_STARTUP_NONCE_ENVIRONMENT]: nonce,
        PORT: String(port),
        NUXT_PORT: String(port),
        NITRO_PORT: String(port),
    };
    delete env.NODE_PATH;
    const started = Date.now();
    // 与 Manager launchApplication 相同：bun <PRODUCT_BUN_RUNTIME_ARGS> product-command.mjs command start
    const lease = spawnOwnedProcess({
        command: process.execPath,
        args: [...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, "command", "start"],
        cwd: root,
        env,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
        graceMs: 2_000,
        hardKillWaitMs: 5_000,
    });
    const completion = lease.completion.then((result) => ({code: result.exitCode, signal: result.signal}));
    try {
        await waitForApplicationReady(port, expectedVersion, completion, 120_000, nonce);
        log("waitForApplicationReady", {ok: true, elapsedMs: Date.now() - started, expectedVersion});
        currentCookie = await login();
        await exercise();
        const inflight = slowRequest(3_000);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
        const shutdownStarted = Date.now();
        const result = await shutdownNativeProduct({port, token, completion, forceTerminate: async () => {
            log("forceTerminate", "called");
            await lease.terminate("shutdown");
        }});
        log("shutdownNativeProduct", {result, elapsedMs: Date.now() - shutdownStarted});
        log("in-flight slow request", await inflight);
        log("completion", await completion);
    } catch (error) {
        log("scenario failed", String(error instanceof Error ? error.stack : error));
        await lease.terminate("startup-failure").catch(() => undefined);
        process.exitCode = 1;
    }
    log("lease lock exists after exit", existsSync(leaseLock));
}

async function sigtermScenario(): Promise<void> {
    // 与 product-start-command.mjs 相同的最终进程：bun <PRODUCT_BUN_RUNTIME_ARGS> .output/server/index.mjs
    const env: NodeJS.ProcessEnv = {
        ...await baseEnv(),
        NEURO_BOOK_RUNTIME_ASSET_MODE: "install",
        PORT: String(port),
        NITRO_PORT: String(port),
    };
    delete env.NODE_PATH;
    const child = spawn(process.execPath, [...PRODUCT_BUN_RUNTIME_ARGS, join(imageRoot, "server", "index.mjs")], {
        cwd: root,
        env,
        stdio: ["ignore", "inherit", "inherit"],
    });
    const completion = new Promise<{code: number | null; signal: string | null}>((resolvePromise) => {
        child.once("exit", (code, signal) => resolvePromise({code, signal}));
    });
    try {
        await waitForApplicationReady(port, expectedVersion, completion, 120_000);
        log("waitForApplicationReady (direct index.mjs)", {ok: true});
        currentCookie = await login();
        await probe(currentCookie);
        const inflight = slowRequest(3_000);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
        const signalAt = Date.now();
        child.kill("SIGTERM");
        log("sent SIGTERM", {pid: child.pid});
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
        const during = await fetch(`http://127.0.0.1:${String(port)}/api/app/version`)
            .then((response) => ({status: response.status}))
            .catch((error: unknown) => ({error: String(error)}));
        log("new request during drain", during);
        log("in-flight slow request", await inflight);
        log("completion", {...await completion, elapsedMs: Date.now() - signalAt});
    } catch (error) {
        log("scenario failed", String(error instanceof Error ? error.stack : error));
        child.kill("SIGKILL");
        process.exitCode = 1;
    }
    log("lease lock exists after exit", existsSync(leaseLock));
}

/** Manager 在 HTTP 停止失败时的强制收口：Owned Process 向进程组发 SIGTERM，graceMs 后 SIGKILL。 */
async function forceScenario(): Promise<void> {
    const nonce = randomBytes(32).toString("base64url");
    const env: NodeJS.ProcessEnv = {
        ...await baseEnv(),
        [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: randomBytes(32).toString("base64url"),
        [PRODUCT_STARTUP_NONCE_ENVIRONMENT]: nonce,
        PORT: String(port),
        NUXT_PORT: String(port),
        NITRO_PORT: String(port),
    };
    delete env.NODE_PATH;
    const lease = spawnOwnedProcess({
        command: process.execPath,
        args: [...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, "command", "start"],
        cwd: root,
        env,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
        graceMs: 2_000,
        hardKillWaitMs: 5_000,
    });
    const completion = lease.completion.then((result) => ({code: result.exitCode, signal: result.signal}));
    await waitForApplicationReady(port, expectedVersion, completion, 120_000, nonce);
    log("waitForApplicationReady", {ok: true});
    const started = Date.now();
    const result = await lease.terminate("shutdown");
    log("lease.terminate(shutdown)", {...result, elapsedMs: Date.now() - started});
    log("lease lock exists after exit", existsSync(leaseLock));
}

if (mode === "prepare") await prepare();
else if (mode === "force") await forceScenario();
else if (mode === "manager") await managerScenario();
else if (mode === "sigterm") await sigtermScenario();
else throw new Error(`unknown mode ${mode}`);
