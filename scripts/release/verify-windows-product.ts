import {randomBytes, randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, rmdir, stat, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {dirname, join, parse, resolve} from "node:path";
import {parseArgs} from "node:util";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    PRODUCT_RUNTIME_CHECK_IDS,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
    readProductRuntimeContract,
} from "nbook/shared/product-runtime-contract";
import {parseInstallationManifest} from "nbook/packages/neuro-book-manager/src/schema";
import {verifyInstalledProductRuntimeImage} from "nbook/packages/neuro-book-manager/src/product";
import {openVerifiedExtractedProduct} from "nbook/scripts/release/verify-extracted-product";

type ProductProcess = ReturnType<typeof Bun.spawn>;

type ProductProcessLog = {
    stdout: Promise<string>;
    stderr: Promise<string>;
};

type AppVersionResponse = {
    versionLabel: string;
};

type ProfileCompileResponse = {
    ok: boolean;
    stale: boolean;
    compiledCount: number;
    profiles: Array<{
        profileKey: string;
        fileName: string;
        loadStatus: string;
    }>;
    issues: Array<{message: string}>;
};

/** Windows 最终归档必须逐项通过的 Product release checks。 */
export const WINDOWS_PRODUCT_RELEASE_CHECKS = PRODUCT_RUNTIME_CHECK_IDS;

/** hostile Product 环境中通过真实 HTTP 编译的最小合法 Profile。 */
export const WINDOWS_PRODUCT_HTTP_PROFILE_SOURCE = [
    "/** @jsxImportSource nbook/profile-sdk */",
    "import {ProfilePrompt, System, Type, defineAgentProfile, toolset} from \"nbook/profile-sdk\";",
    "export default defineAgentProfile({",
    "    manifest: {key: \"release.http-worker\", name: \"Release HTTP Worker\"},",
    "    initialSchema: Type.Object({}),",
    "    tools: toolset(),",
    "    context() { return <ProfilePrompt><System>Product worker only.</System></ProfilePrompt>; },",
    "});",
    "",
].join("\n");

/** 在仓库外验证 Windows Product 的命令、HTTP 与文件句柄生命周期。 */
export async function verifyWindowsProduct(
    productRootInput: string,
    scratchRootInput: string,
    bunRuntimeInput: string,
    installationManifestInput?: string,
): Promise<void> {
    if (process.platform !== "win32") {
        throw new Error("Windows Product smoke 只能在 Windows 上执行。");
    }
    const productRoot = resolve(productRootInput);
    const scratchRoot = resolve(scratchRootInput);
    const bunRuntime = resolve(bunRuntimeInput);
    await assertProductIsolation(productRoot);
    await assertVacant(scratchRoot);
    await stat(bunRuntime);

    const outputRoot = join(productRoot, ".output");
    if (installationManifestInput) {
        const manifest = parseInstallationManifest(JSON.parse(await readFile(resolve(installationManifestInput), "utf8")));
        const product = manifest.components.product;
        if (!product || product.provider === "container") {
            throw new Error("Installation Manifest 缺少可验证的原生 Product。" );
        }
        await verifyInstalledProductRuntimeImage(productRoot, product);
    } else {
        await openVerifiedExtractedProduct(productRoot);
    }
    const rootNodeModules = join(productRoot, "node_modules");
    const bootstrap = join(outputRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
    const contract = await readProductRuntimeContract(outputRoot);
    await stat(bootstrap);
    await assertMissingProductWorkspace(productRoot);
    await mkdir(scratchRoot);

    const stateRoot = join(scratchRoot, "state");
    const cacheRoot = join(scratchRoot, "cache");
    const logRoot = join(stateRoot, "logs");
    await mkdir(join(stateRoot, "workspace"), {recursive: true});
    await mkdir(cacheRoot, {recursive: true});
    await mkdir(logRoot, {recursive: true});
    await writeFile(join(stateRoot, "config.yaml"), "auth:\n  enabled: false\n", "utf8");

    const port = await freeLoopbackPort();
    const shutdownToken = randomBytes(32).toString("hex");
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        NEURO_BOOK_APPLICATION_ROOT: productRoot,
        NEURO_BOOK_STATE_ROOT: stateRoot,
        NEURO_BOOK_CACHE_ROOT: cacheRoot,
        BUN_INSTALL_CACHE_DIR: join(cacheRoot, "bun", "install"),
        LLMLINT_HOME: join(stateRoot, "tool-state", "llmlint"),
        LLMLINT_CACHE_DIR: join(cacheRoot, "llmlint"),
        DATABASE_KIND: "sqlite",
        DATABASE_URL: "file:./workspace/.nbook/neuro-book.sqlite",
        BUN: bunRuntime,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: String(port),
        NUXT_PORT: String(port),
        NUXT_SESSION_PASSWORD: randomBytes(32).toString("hex"),
        [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: shutdownToken,
        NODE_PATH: join(rootNodeModules, "missing-runtime-dependencies"),
    };
    delete environment.AUTH_ADMIN_PASSWORD;

    const command = async (args: string[], stdin?: Uint8Array): Promise<string> => {
        return await runProductCommand(bunRuntime, bootstrap, productRoot, environment, args, stdin);
    };
    const commandAt = async (cwd: string, ...args: string[]): Promise<string> => {
        return await runProductCommand(bunRuntime, bootstrap, cwd, environment, args);
    };

    let product: ProductProcess | undefined;
    let logs: ProductProcessLog | undefined;
    try {
        await mkdir(rootNodeModules);
        await command(["command", "migrate-database"]);
        await command(["command", "migrate-application-state", "--apply"]);
        for (const check of WINDOWS_PRODUCT_RELEASE_CHECKS) {
            await command(["check", check]);
        }
        const adminPassword = new TextEncoder().encode(randomBytes(24).toString("base64url"));
        await command(
            ["command", "create-admin", "product-smoke-admin", "--password-stdin"],
            adminPassword,
        );

        const launched = launchProduct(bunRuntime, bootstrap, productRoot, environment);
        product = launched.product;
        logs = launched.logs;
        const baseUrl = `http://127.0.0.1:${port}`;
        const version = await waitForVersion(product, `${baseUrl}/api/app/version`, 90_000);
        await assertHttpProfileCompile(baseUrl, stateRoot);

        const wrongToken = await fetch(`${baseUrl}${contract.shutdown.path}`, {
            method: "POST",
            redirect: "manual",
            headers: {authorization: "Bearer invalid-token"},
            signal: AbortSignal.timeout(10_000),
        });
        if (wrongToken.status !== 401 || product.exitCode !== null) {
            throw new Error(`错误 shutdown token 合同失败：status=${wrongToken.status} exitCode=${product.exitCode}`);
        }

        const shutdown = await fetch(`${baseUrl}${contract.shutdown.path}`, {
            method: "POST",
            redirect: "manual",
            headers: {authorization: `Bearer ${shutdownToken}`},
            signal: AbortSignal.timeout(10_000),
        });
        if (shutdown.status !== 202) {
            throw new Error(`正确 shutdown token 返回 ${shutdown.status}，预期 202。`);
        }
        const exitCode = await withTimeout(product.exited, contract.shutdown.timeoutMs, "Product shutdown");
        if (exitCode !== 0) {
            throw new Error(`Product shutdown 退出码异常：${exitCode}`);
        }
        await assertPortClosed(`${baseUrl}/api/app/version`);

        await command(["command", "workspace", "project", "create", "product-smoke", "--title", "Product Smoke", "--json"]);
        const projectWorkspaceRoot = join(stateRoot, "workspace", "product-smoke");
        const nodeRoot = join(projectWorkspaceRoot, "manuscript", "smoke-chapter");
        await commandAt(projectWorkspaceRoot, "command", "workspace", "node", "new", "manuscript/smoke-chapter", "--type", "chapter", "--title", "Smoke Chapter");
        await commandAt(projectWorkspaceRoot, "command", "workspace", "node", "validate", "manuscript/smoke-chapter", "--json");
        await assertMissingProductWorkspace(productRoot);

        const movedStateRoot = join(scratchRoot, `state-released-${randomUUID()}`);
        await rename(stateRoot, movedStateRoot);
        await rm(movedStateRoot, {recursive: true});
        await rm(cacheRoot, {recursive: true});
        await rmdir(scratchRoot);
        await rm(rootNodeModules, {recursive: true});

        console.log(JSON.stringify({
            ok: true,
            productRoot,
            version: version.versionLabel,
            checks: [
                "migrate-database",
                "migrate-application-state",
                ...WINDOWS_PRODUCT_RELEASE_CHECKS,
                "create-admin",
                "http-profile-compile-with-hostile-node-path",
                "invalid-shutdown-token",
                "authenticated-shutdown",
                "workspace-node",
                "state-root-move-delete",
            ],
        }, null, 4));
    } catch (error) {
        if (product?.exitCode === null) {
            product.kill();
            await withTimeout(product.exited, 10_000, "Product forced cleanup").catch(() => undefined);
        }
        const stdout = logs ? await logs.stdout.catch(() => "") : "";
        const stderr = logs ? await logs.stderr.catch(() => "") : "";
        throw new Error([
            error instanceof Error ? error.message : String(error),
            `Windows Product smoke scratch 保留在：${scratchRoot}`,
            stdout ? `stdout:\n${stdout}` : "",
            stderr ? `stderr:\n${stderr}` : "",
        ].filter(Boolean).join("\n"), {cause: error});
    } finally {
        await rm(rootNodeModules, {recursive: true, force: true});
    }
}

/** 通过公开 HTTP 入口验证 Product 只使用镜像内预编译 Profile worker。 */
async function assertHttpProfileCompile(baseUrl: string, stateRoot: string): Promise<void> {
    const fileName = "release/http-worker.profile.tsx";
    const profileRoot = join(stateRoot, "workspace", ".nbook", "agent", "profiles");
    const sourcePath = join(profileRoot, ...fileName.split("/"));
    await mkdir(dirname(sourcePath), {recursive: true});
    await writeFile(sourcePath, WINDOWS_PRODUCT_HTTP_PROFILE_SOURCE, "utf8");
    const response = await fetch(`${baseUrl}/api/agent/profiles/compile`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({fileName, dryRun: false, preview: false}),
        signal: AbortSignal.timeout(90_000),
    });
    const value: unknown = await response.json();
    const compiled = isProfileCompileResponse(value)
        ? value.profiles.find((profile) => profile.fileName === fileName)
        : undefined;
    if (!response.ok || !isProfileCompileResponse(value) || !value.ok || value.stale
        || value.compiledCount < 1
        || compiled?.profileKey !== "release.http-worker"
        || compiled.loadStatus !== "loaded") {
        throw new Error(`Product HTTP Profile 编译失败：status=${response.status} body=${JSON.stringify(value)}`);
    }
}

/** 收窄 Profile HTTP 编译响应。 */
function isProfileCompileResponse(value: unknown): value is ProfileCompileResponse {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const result = value as Partial<ProfileCompileResponse>;
    return typeof result.ok === "boolean"
        && typeof result.stale === "boolean"
        && Array.isArray(result.issues)
        && typeof result.compiledCount === "number"
        && Array.isArray(result.profiles)
        && result.profiles.every((profile) => profile
            && typeof profile === "object"
            && typeof profile.profileKey === "string"
            && typeof profile.fileName === "string"
            && typeof profile.loadStatus === "string");
}

/** Product 命令不得在 Installation Root 生成影子 workspace。 */
async function assertMissingProductWorkspace(productRoot: string): Promise<void> {
    try {
        await stat(join(productRoot, "workspace"));
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
        throw error;
    }
    throw new Error(`Product Runtime 在 Installation Root 创建了影子 workspace：${join(productRoot, "workspace")}`);
}

/** 拒绝位于任何 root node_modules 下方的 Product，避免 smoke 向上借用开发依赖。 */
async function assertProductIsolation(productRoot: string): Promise<void> {
    const info = await stat(productRoot);
    if (!info.isDirectory()) throw new Error(`Product Root 不是目录：${productRoot}`);
    let cursor = productRoot;
    while (true) {
        try {
            const modules = await stat(join(cursor, "node_modules"));
            if (modules.isDirectory()) throw new Error(`Product Root 祖先存在 node_modules：${cursor}`);
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        const parent = dirname(cursor);
        if (parent === cursor || parse(cursor).root === cursor) return;
        cursor = parent;
    }
}

/** Scratch Root 必须由本次 smoke 独占，拒绝覆盖已有状态。 */
async function assertVacant(path: string): Promise<void> {
    try {
        await stat(path);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
        throw error;
    }
    throw new Error(`Windows Product smoke scratch 已存在：${path}`);
}

/** 运行一个逻辑 Product 命令，并完整报告 stdout/stderr。 */
export async function runProductCommand(
    bunRuntime: string,
    bootstrap: string,
    cwd: string,
    environment: NodeJS.ProcessEnv,
    args: string[],
    stdin?: Uint8Array,
): Promise<string> {
    const childEnvironment = {...environment};
    delete childEnvironment.AUTH_ADMIN_PASSWORD;
    const child = Bun.spawn([bunRuntime, ...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, ...args], {
        cwd,
        env: childEnvironment,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
    });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    if (stdin) await child.stdin.write(stdin);
    await child.stdin.end();
    const [exitCode, output, diagnostic] = await Promise.all([child.exited, stdout, stderr]);
    if (exitCode !== 0) {
        throw new Error(`Product command 失败：${args.join(" ")} exit=${exitCode}\n${output}\n${diagnostic}`);
    }
    return output;
}

/** 启动长期运行 Product，并立即消费输出 pipe，避免缓冲区阻塞关闭。 */
function launchProduct(
    bunRuntime: string,
    bootstrap: string,
    productRoot: string,
    environment: NodeJS.ProcessEnv,
): {product: ProductProcess; logs: ProductProcessLog} {
    const product = Bun.spawn([bunRuntime, ...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, "command", "start"], {
        cwd: productRoot,
        env: environment,
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
    });
    return {
        product,
        logs: {
            stdout: new Response(product.stdout).text(),
            stderr: new Response(product.stderr).text(),
        },
    };
}

/** 等待版本端点 ready，并严格校验公开版本字段。 */
async function waitForVersion(product: ProductProcess, url: string, timeoutMs: number): Promise<AppVersionResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (product.exitCode !== null) throw new Error(`Product 在 health ready 前退出：${product.exitCode}`);
        try {
            const response = await fetch(url, {signal: AbortSignal.timeout(2_000)});
            if (response.ok) {
                // HTTP JSON 是外部运行时输入，必须先以 unknown 读取并收窄。
                const value: unknown = await response.json();
                if (isVersionResponse(value)) return value;
                throw new Error("Product version 响应缺少有效 versionLabel。");
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes("versionLabel")) throw error;
        }
        await Bun.sleep(200);
    }
    throw new Error(`Product health 超时：${url}`);
}

/** 收窄版本端点响应，unknown 仅存在于 HTTP 解析点。 */
function isVersionResponse(value: unknown): value is AppVersionResponse {
    return typeof value === "object" && value !== null
        && "versionLabel" in value
        && typeof value.versionLabel === "string"
        && value.versionLabel.startsWith("v");
}

/** 正常退出后端口必须不可达，避免孤儿 listener 留在后台。 */
async function assertPortClosed(url: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            const response = await fetch(url, {signal: AbortSignal.timeout(500)});
            if (response) {
                await Bun.sleep(100);
                continue;
            }
        } catch {
            return;
        }
    }
    throw new Error(`Product 退出后端口仍可访问：${url}`);
}

/** 获取当前可用的 loopback 动态端口。 */
async function freeLoopbackPort(): Promise<number> {
    return await new Promise<number>((resolvePromise, rejectPromise) => {
        const server = createServer();
        server.once("error", rejectPromise);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                rejectPromise(new Error("无法分配 loopback 动态端口。"));
                return;
            }
            server.close((error) => error ? rejectPromise(error) : resolvePromise(address.port));
        });
    });
}

/** 为 Product 生命周期步骤提供显式超时。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} 超时：${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

if (import.meta.main) {
    const {values} = parseArgs({
        options: {
            "product-root": {type: "string"},
            "scratch-root": {type: "string"},
            "bun-runtime": {type: "string", default: process.execPath},
            "installation-manifest": {type: "string"},
        },
        strict: true,
    });
    if (!values["product-root"] || !values["scratch-root"] || !values["bun-runtime"]) {
        throw new Error("用法：bun scripts/release/verify-windows-product.ts --product-root <root> --scratch-root <empty> [--bun-runtime <bun.exe>] [--installation-manifest <path>]");
    }
    await verifyWindowsProduct(
        values["product-root"],
        values["scratch-root"],
        values["bun-runtime"],
        values["installation-manifest"],
    );
}
