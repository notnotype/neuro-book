#!/usr/bin/env bun
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {mkdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
    readProductRuntimeContract,
    resolveProductRuntimeCommand,
} from "nbook/shared/product-runtime-contract";
import {createProductRuntimeEnvironment} from "nbook/shared/product-runtime-environment";

type LauncherOptions = {
    mode: "start" | "prepare";
    imageRoot: string;
    applicationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    port: number;
    bunExecutable: string;
};

/**
 * 解析 Desktop spike 的受限参数。路径必须由外层 Envelope 显式传入，不能猜 cwd。
 */
function parseOptions(argv: readonly string[]): LauncherOptions {
    const mode = argv[0];
    if (mode !== "start" && mode !== "prepare") throw new Error(`launcher mode 无效：${String(mode)}`);
    const values = new Map<string, string>();
    for (let index = 1; index < argv.length; index += 1) {
        const key = argv[index];
        if (!key?.startsWith("--")) throw new Error(`未知 launcher 参数：${String(key)}`);
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`launcher 参数缺少值：${key}`);
        if (values.has(key)) throw new Error(`launcher 参数重复：${key}`);
        values.set(key, value);
        index += 1;
    }
    const required = ["--image-root", "--application-root", "--state-root", "--cache-root", "--port"];
    for (const key of required) {
        if (!values.has(key)) throw new Error(`launcher 缺少参数：${key}`);
    }
    const port = Number(values.get("--port"));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(`launcher 端口无效：${String(values.get("--port"))}`);
    }
    return {
        mode,
        imageRoot: resolve(values.get("--image-root")!),
        applicationRoot: resolve(values.get("--application-root")!),
        stateRoot: resolve(values.get("--state-root")!),
        cacheRoot: resolve(values.get("--cache-root")!),
        port,
        bunExecutable: values.get("--bun")?.trim() || process.env.T140_BUN_EXECUTABLE?.trim() || process.execPath,
    };
}

/** 从 State Root 读取可选环境，不生成或修改任何 Application Root 文件。 */
async function readStateEnvironment(stateRoot: string): Promise<NodeJS.ProcessEnv> {
    const text = await readFile(resolve(stateRoot, ".env"), "utf8").catch(() => "");
    const environment: NodeJS.ProcessEnv = {};
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf("=");
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "");
        environment[key] = value;
    }
    return environment;
}

/**
 * 由两个 Envelope 共用的 Product 启动适配器。
 * 它只解析现有 Runtime Contract 并启动 contract 的 start 命令，不拥有业务生命周期。
 */
async function createEnvironment(options: LauncherOptions, token?: string): Promise<NodeJS.ProcessEnv> {
    const stateEnvironment = await readStateEnvironment(options.stateRoot);
    stateEnvironment.NUXT_SESSION_PASSWORD ??= randomBytes(32).toString("hex");
    const environment = createProductRuntimeEnvironment({
        applicationRoot: options.applicationRoot,
        productImageRoot: options.imageRoot,
        stateRoot: options.stateRoot,
        cacheRoot: options.cacheRoot,
        development: false,
        inheritedEnvironment: {
            ...process.env,
            DATABASE_KIND: process.env.DATABASE_KIND ?? "sqlite",
            DATABASE_URL: process.env.DATABASE_URL ?? "file:./workspace/.nbook/neuro-book.sqlite",
            HOST: "127.0.0.1",
            NITRO_HOST: "127.0.0.1",
            PORT: String(options.port),
            NITRO_PORT: String(options.port),
            ...(token ? {[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: token} : {}),
        },
        stateEnvironment,
        host: "127.0.0.1",
        runtimeExecutable: options.bunExecutable,
    });
    return environment;
}

async function runCommand(
    options: LauncherOptions,
    environment: NodeJS.ProcessEnv,
    id: "migrate-database" | "migrate-application-state",
    additionalArgs: string[] = [],
): Promise<void> {
    const contract = await readProductRuntimeContract(options.imageRoot);
    const invocation = resolveProductRuntimeCommand(contract, id, additionalArgs);
    const bootstrap = resolve(options.imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(options.bunExecutable, [
            ...PRODUCT_BUN_RUNTIME_ARGS,
            bootstrap,
            "command",
            id,
            ...additionalArgs,
        ], {cwd: options.applicationRoot, env: environment, stdio: "inherit", windowsHide: true});
        child.once("error", rejectPromise);
        child.once("exit", (code, signal) => {
            if (signal || code !== 0) rejectPromise(new Error(`Product ${id} 失败：${signal ?? code ?? 1}`));
            else resolvePromise();
        });
    });
}

/** 由 smoke 明确执行 Manager 负责的两步 migration；这里只编排 Product Contract。 */
async function prepare(options: LauncherOptions): Promise<void> {
    await Promise.all([
        mkdir(options.stateRoot, {recursive: true}),
        mkdir(options.cacheRoot, {recursive: true}),
    ]);
    const environment = await createEnvironment(options);
    await runCommand(options, environment, "migrate-database");
    await runCommand(options, environment, "migrate-application-state", ["--apply"]);
}

async function start(options: LauncherOptions): Promise<void> {
    await Promise.all([
        mkdir(options.stateRoot, {recursive: true}),
        mkdir(options.cacheRoot, {recursive: true}),
    ]);
    const contract = await readProductRuntimeContract(options.imageRoot);
    const invocation = resolveProductRuntimeCommand(contract, "start");
    const token = process.env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]?.trim();
    if (!token || !/^[a-f0-9]{64}$/u.test(token)) {
        throw new Error("Desktop launcher 缺少内存中的 256-bit shutdown token。");
    }
    const environment = await createEnvironment(options, token);
    const bootstrap = resolve(options.imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
    const child = spawn(options.bunExecutable, [
        ...PRODUCT_BUN_RUNTIME_ARGS,
        bootstrap,
        "command",
        "start",
        ...invocation.fixedArgs,
    ], {
        cwd: options.applicationRoot,
        env: environment,
        stdio: "inherit",
        windowsHide: true,
    });
    let signal: NodeJS.Signals | undefined;
    for (const candidate of ["SIGINT", "SIGTERM"] as const) {
        process.once(candidate, () => {
            signal = candidate;
            if (child.exitCode === null && child.signalCode === null) child.kill(candidate);
        });
    }
    await new Promise<void>((resolvePromise, rejectPromise) => {
        child.once("error", rejectPromise);
        child.once("exit", (code, childSignal) => {
            if (signal) {
                resolvePromise();
                return;
            }
            if (childSignal) {
                rejectPromise(new Error(`Product launcher 子进程收到信号：${childSignal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`Product launcher 子进程退出码异常：${String(code ?? 1)}`));
                return;
            }
            resolvePromise();
        });
    });
}

const options = parseOptions(process.argv.slice(2));
if (options.mode === "prepare") await prepare(options);
else await start(options);
