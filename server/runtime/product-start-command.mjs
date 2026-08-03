#!/usr/bin/env bun
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    readProductRuntimeContract,
    resolveProductRuntimeInternal,
} from "nbook/shared/product-runtime-contract";
import {createProductRuntimeEnvironment} from "nbook/shared/product-runtime-environment";

const productRoot = resolveProductRoot();
const entry = resolve(productRoot, ".output", "server", "index.mjs");
const stateRoot = resolveStateRoot(productRoot);
const cacheRoot = resolveCacheRoot(productRoot, stateRoot);
const stateEnv = ensureProductEnv(stateRoot);
const productEnv = createProductRuntimeEnvironment({
    applicationRoot: productRoot,
    productImageRoot: resolve(productRoot, ".output"),
    stateRoot,
    cacheRoot,
    development: false,
    inheritedEnvironment: process.env,
    stateEnvironment: stateEnv,
    host: process.env.NITRO_HOST?.trim() || process.env.HOST?.trim(),
    runtimeExecutable: process.execPath,
});

await runInternal(productRoot, productEnv, "check-migrations");
await runInternal(productRoot, productEnv, "prepare-system-assets");

const child = spawn(process.execPath, [...PRODUCT_BUN_RUNTIME_ARGS, entry, ...process.argv.slice(2)], {
    cwd: productRoot,
    env: productEnv,
    stdio: "inherit",
    windowsHide: false,
});
let shutdownSignal;

/** Product启动器是容器PID 1时，必须把停止信号转发给真正的Nitro进程。 */
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        shutdownSignal = signal;
        if (child.exitCode === null && child.signalCode === null) {
            child.kill(signal);
        }
    });
}

/** Product wrapper 只按 Runtime Contract internal ID 执行启动前步骤。 */
async function runInternal(root, env, id) {
    const imageRoot = resolve(root, ".output");
    const contract = await readProductRuntimeContract(imageRoot);
    const invocation = resolveProductRuntimeInternal(contract, id);
    await run(process.execPath, [
        ...PRODUCT_BUN_RUNTIME_ARGS,
        resolve(imageRoot, ...invocation.entry.split("/")),
        ...invocation.fixedArgs,
    ], {
        cwd: root,
        env,
    });
}

child.on("error", (error) => {
    console.error(error);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (shutdownSignal) {
        process.exit(0);
    }
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});

/**
 * 从 Product command bundle 启动时，向上定位带 `.output/server/index.mjs` 的 Product Root。
 */
function resolveProductRoot() {
    let current = dirname(fileURLToPath(import.meta.url));
    while (true) {
        const candidateEntry = resolve(current, ".output", "server", "index.mjs");
        if (existsSync(candidateEntry)) {
            return current;
        }
        const parent = resolve(current, "..");
        if (parent === current) {
            throw new Error("无法定位 Product Root：缺少 .output/server/index.mjs。");
        }
        current = parent;
    }
}

/** Manager 可把运行状态放在 Product Root 外，例如 Windows Portable data/。 */
function resolveStateRoot(root) {
    const configured = process.env.NEURO_BOOK_STATE_ROOT?.trim();
    if (!configured) {
        return root;
    }
    return resolve(root, configured);
}

/** Cache Root 由启动 Adapter 显式决定；未设置时只回退到 State Root/cache。 */
function resolveCacheRoot(root, stateRoot) {
    const configured = process.env.NEURO_BOOK_CACHE_ROOT?.trim();
    return configured ? resolve(root, configured) : resolve(stateRoot, "cache");
}

/**
 * 加载 State Root `.env`，缺少 session password 时生成并持久化。
 * Application Root 与 Runtime Image 在整个 Product 生命周期内保持只读。
 */
function ensureProductEnv(root) {
    const envPath = resolve(root, ".env");
    const parsed = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
    if (!process.env.NUXT_SESSION_PASSWORD && !parsed.NUXT_SESSION_PASSWORD) {
        parsed.NUXT_SESSION_PASSWORD = randomBytes(32).toString("hex");
        writeEnv(envPath, parsed);
    }
    return parsed;
}

/**
 * 解析简单 KEY=VALUE `.env` 文件。
 */
function parseEnv(text) {
    const result = {};
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }
        const separator = line.indexOf("=");
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        result[key] = value.replace(/^['"]|['"]$/gu, "");
    }
    return result;
}

/**
 * 写回 Product Root `.env`。
 */
function writeEnv(path, values) {
    const lines = Object.entries(values)
        .map(([key, value]) => `${key}=${value}`);
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function run(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: "inherit",
            windowsHide: true,
        });
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`${command} 退出码：${code ?? 1}`));
                return;
            }
            resolvePromise();
        });
    });
}
