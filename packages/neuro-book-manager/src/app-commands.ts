import {randomBytes} from "node:crypto";
import {isAbsolute, join, relative, resolve, sep} from "node:path";
import {Type, type Static} from "typebox";
import {Value} from "typebox/value";
import {spawnOwnedProcess, type OwnedProcessStdio} from "@notnotype/owned-process";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
    PRODUCT_STARTUP_NONCE_ENVIRONMENT,
    type ProductRuntimeCommandId,
} from "nbook/shared/product-runtime-contract";
import {shutdownNativeProduct} from "nbook/shared/product-runtime-shutdown";
import {
    productRuntimeReceiptEnvironment,
    type ProductRuntimeReceiptAuthorization,
} from "nbook/shared/product-runtime-receipt";

import {enableAuthentication, ensureWritableRuntimeRoots, loadStateEnv} from "#manager/config";
import {createProductRuntimeEnvironment} from "nbook/shared/product-runtime-environment";
import {containerComposeOptions, runDockerApplicationCommand, startDocker, stopDockerContainer, verifyRunningDockerApplication} from "#manager/docker";
import {pathExists} from "#manager/files";
import {assertInstallationHostCompatible} from "#manager/platform";
import {commandAvailable, run, runCapture, runWithInput} from "#manager/process";
import {resolveInstallationRoots} from "#manager/root-locators";
import {activateManagedTools} from "#manager/tools";
import type {CommandInspection, InstallationManifest} from "#manager/types";
import {formatStateRootIntegrityWarning, inspectInstallationStateIntegrity, stateRootIntegrityFailed} from "#manager/state-integrity";
import {verifyApplicationExecution} from "#manager/application-execution";

const ApplicationMigrationStepSchema = Type.Object({
    id: Type.String({pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"}),
    runId: Type.String({pattern: "^[A-Za-z0-9_-]+$"}),
    status: Type.Union([
        Type.Literal("planned"),
        Type.Literal("applied"),
        Type.Literal("skipped"),
        Type.Literal("rolled_back"),
        Type.Literal("not_started"),
    ]),
    changedItems: Type.Integer({minimum: 0}),
    reviewItems: Type.Integer({minimum: 0}),
}, {additionalProperties: false});

const ApplicationMigrationReportSchema = Type.Object({
    version: Type.Literal(1),
    catalogVersion: Type.Integer({minimum: 1}),
    runId: Type.String({minLength: 1}),
    action: Type.Union([Type.Literal("plan"), Type.Literal("apply"), Type.Literal("resume"), Type.Literal("rollback")]),
    status: Type.Union([
        Type.Literal("planned"),
        Type.Literal("complete"),
        Type.Literal("already_current"),
        Type.Literal("manual_required"),
        Type.Literal("rolled_back"),
        Type.Literal("not_started"),
    ]),
    steps: Type.Array(ApplicationMigrationStepSchema),
    guide: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

type ApplicationMigrationReport = Static<typeof ApplicationMigrationReportSchema>;

export type ApplicationMigrationPlan = {
    runId: string;
    status: "planned" | "already_current";
    steps: ApplicationMigrationReport["steps"];
};

export type StartApplicationOptions = {
    /** Windows Portable是否等待HTTP健康检查通过并自动打开浏览器；默认启用。 */
    healthCheck?: boolean;
    /** 仅真实Windows Portable start在ready后打开浏览器；验证型launch不设置。 */
    openBrowser?: boolean;
    /** Source Dev候选worktree验证时仍使用Installation的真实State Root。 */
    stateRoot?: string;
    /** 嵌入宿主结束自身生命周期时请求Manager完整关闭Product。 */
    shutdownSignal?: AbortSignal;
    /** Desktop Supervisor 为本次候选注入的启动关联 nonce。 */
    startupNonce?: string;
    /** Desktop 候选的动态 loopback 端口；不写回 State Root。 */
    port?: number;
    /** 宿主拥有机器可读 stdout 时，Product 的普通启动输出必须转移到指定 stdio。 */
    productStdout?: OwnedProcessStdio;
    /** ready 后由宿主消费的结构化回调。 */
    onReady?: (ready: {port: number; startupNonce?: string}) => Promise<void>;
    /** Desktop Supervisor 在当前 Installation Manifest 下批准的只读 Product 回执。 */
    productRuntimeReceipt?: ProductRuntimeReceiptAuthorization;
};

export type PortableForegroundOptions = StartApplicationOptions & {
    /** 健康检查总时长，缺省120秒；只有测试需要缩短，生产不传。 */
    startupTimeoutMs?: number;
};

const AGENT_SESSION_STORE_LEASE_COMPROMISED_MESSAGE =
    "NeuroBook 服务因运行租约失去所有权而退出。可能有另一个 NeuroBook 实例或迁移程序正在使用同一工作区，也可能是当前进程或系统长时间暂停。"
    + "请关闭其他实例或迁移程序后重试；不要手动删除 runtime.lease.lock。";

export type ProductExitResult = {
    code: number | null;
    signal: string | null;
};

/** 将Product跨进程退出结果转换为Manager用户可执行的错误提示。 */
export function productExitErrorMessage(
    result: ProductExitResult,
    fallback: string,
): string {
    if (result.signal === null && result.code === PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED) {
        return AGENT_SESSION_STORE_LEASE_COMPROMISED_MESSAGE;
    }
    return `${fallback}：${result.signal ?? result.code}`;
}

/** 统一判断Application是否以可接受的结果结束；容器ready-only completion允许null/null。 */
export function assertProductExit(result: ProductExitResult, fallback: string): void {
    if (result.signal !== null || result.code !== null && result.code !== 0) {
        throw new Error(productExitErrorMessage(result, fallback));
    }
}

/** Native Product与Portable必须报告具体的0退出码；75等专用码仍使用同一诊断文案。 */
export function assertConcreteProductExit(result: ProductExitResult, fallback: string): void {
    if (result.signal !== null || result.code !== 0) {
        throw new Error(productExitErrorMessage(result, fallback));
    }
}

/** 事务调用方持久化候选容器所有权所需的生命周期回调。 */
export type ApplicationLaunchOptions = PortableForegroundOptions & {
    /** Compose 即将进入可能创建候选容器的阶段。 */
    onContainerStarting?: () => Promise<void>;
    /** 健康检查前发布本次候选的精确容器身份。 */
    onContainerStarted?: (containerId: string) => Promise<void>;
    /** 精确候选停止后发布可继续回滚的 checkpoint。 */
    onContainerStopped?: (containerId: string) => Promise<void>;
};

/** Manager 持有的候选应用启动所有权。 */
export interface ApplicationLaunch {
    readonly ready: Promise<void>;
    readonly completion: Promise<{code: number | null; signal: string | null}>;
    readonly port: number;
    readonly startupNonce?: string;
    /** 正常关闭先请求 Product 收口资源；超时或协议失败后终止 Owned Process。 */
    shutdown(): Promise<void>;
    /** 启动、更新或迁移失败时立即终止候选 Owned Process。 */
    terminate(): Promise<void>;
}

/**
 * 在状态回滚前终止本次候选 launch。
 *
 * 终止失败时把原始操作错误与终止错误一起抛出，调用方必须保留 Operation Journal，
 * 不能在仍可能运行的候选进程或容器旁边继续恢复持久化状态。
 */
export async function terminateFailedLaunch(launch: ApplicationLaunch, failure: unknown): Promise<void> {
    try {
        await launch.terminate();
    } catch (terminationError) {
        throw new AggregateError(
            [failure, terminationError],
            "Manager 操作失败，且候选 Application 无法确认终止；已保留 Operation Journal，未执行状态回滚。",
        );
    }
}

/** 创建 native/container 启动句柄；调用方决定 ready 后提交还是继续等待。 */
export async function launchApplication(
    root: string,
    manifest: InstallationManifest,
    options: ApplicationLaunchOptions = {},
): Promise<ApplicationLaunch> {
    if (options.healthCheck === false && manifest.profile !== "windows-portable") {
        throw new Error("--no-health-check仅支持Windows Portable。");
    }
    assertInstallationHostCompatible(manifest);
    const roots = resolveInstallationRoots(root, manifest.roots);
    const stateRoot = options.stateRoot ?? roots.state;
    await ensureWritableRuntimeRoots(stateRoot, roots.cache);
    const stateIntegrity = await inspectInstallationStateIntegrity(root, stateRoot);
    if (stateRootIntegrityFailed(stateIntegrity)) {
        console.warn(`\n警告：${formatStateRootIntegrityWarning(stateIntegrity)}\n`);
    }
    activateManagedTools(root, manifest.components.tools);
    const execution = await verifyApplicationExecution(root, manifest, {
        productRuntimeReceipt: options.productRuntimeReceipt,
    });
    if (execution.kind === "container-product") {
        let terminated = false;
        let candidateContainerId: string | null = null;
        const containerEnvironment = await loadStateEnv(stateRoot);
        const containerPort = Number(containerEnvironment.NUXT_PORT ?? containerEnvironment.PORT ?? "3000");
        if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
            throw new Error(`Container Application 端口非法：${String(containerPort)}`);
        }
        const ready = startDocker(
            execution.image,
            root,
            stateRoot,
            manifest.profile,
            manifest.appVersion,
            options.onContainerStarting,
            async (containerId) => {
                candidateContainerId = containerId;
                await options.onContainerStarted?.(containerId);
            },
        );
        const completion = ready.then(() => ({code: null, signal: null}));
        // ready 失败是启动路径的主错误；内部观察派生 Promise，避免未等待 completion 时触发进程级 unhandled rejection。
        void completion.catch(() => undefined);
        const stop = async (): Promise<void> => {
            if (terminated) return;
            terminated = true;
            await ready.catch(() => undefined);
            if (candidateContainerId) {
                await stopDockerContainer(
                    execution.engine,
                    root,
                    candidateContainerId,
                );
                await options.onContainerStopped?.(candidateContainerId);
            }
        };
        return {
            ready,
            completion,
            port: containerPort,
            shutdown: stop,
            terminate: stop,
        };
    }
    const shutdownToken = randomBytes(32).toString("base64url");
    const startupNonce = options.startupNonce;
    const bun = resolveBun(root, manifest);
    const env: NodeJS.ProcessEnv = {
        ...await applicationEnvironment(root, stateRoot, manifest.profile === "source-dev", roots.cache),
        [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: shutdownToken,
        ...(startupNonce ? {[PRODUCT_STARTUP_NONCE_ENVIRONMENT]: startupNonce} : {}),
        ...(options.port ? {PORT: String(options.port), NUXT_PORT: String(options.port), NITRO_PORT: String(options.port)} : {}),
        ...(options.productRuntimeReceipt ? productRuntimeReceiptEnvironment(options.productRuntimeReceipt) : {}),
        BUN: bun,
    };
    if (execution.kind === "native-product") delete env.NODE_PATH;
    const command = bun;
    const args = manifest.profile === "source-dev"
        ? ["--no-install", "run", "dev:runtime"]
        : productCommandArgs(root, "start");
    if (manifest.profile !== "source-dev" && !await pathExists(productCommandPath(root))) {
        throw new Error("当前安装缺少 Product 启动入口，请执行 neuro-book update；应用更新始终按Profile原子执行。" );
    }
    const lease = spawnOwnedProcess({
        command,
        args,
        cwd: root,
        env,
        // Manager独占宿主stdin；Windows上同时读取并继承同一pipe会阻塞Product启动。
        stdin: "ignore",
        stdout: options.productStdout ?? "inherit",
        stderr: "inherit",
        windowsHide: manifest.profile !== "windows-portable",
        graceMs: 2_000,
        hardKillWaitMs: 5_000,
    });
    const completion = lease.completion.then((result) => ({
        code: result.exitCode,
        signal: result.signal,
    }));
    const healthCheck = options.healthCheck !== false;
    const port = options.port ?? Number(env.NUXT_PORT ?? env.PORT ?? "3000");
    const ready = healthCheck
        ? waitForApplicationReady(
            port,
            manifest.appVersion,
            completion,
            options.startupTimeoutMs ?? 120_000,
            startupNonce,
        )
        : Promise.resolve();
    if (manifest.profile === "windows-portable" && healthCheck && options.openBrowser) {
        void ready.then(() => run("cmd.exe", ["/c", "start", "", `http://127.0.0.1:${String(port)}`], {
            cwd: root,
            stdio: "ignore",
        })).catch(() => undefined);
    }
    let shutdownPromise: Promise<void> | null = null;
    return {
        ready,
        completion,
        port,
        startupNonce,
        shutdown: () => {
            if (!shutdownPromise) {
                shutdownPromise = shutdownNativeProduct({
                    port,
                    token: shutdownToken,
                    completion,
                    forceTerminate: async () => {
                        await lease.terminate("shutdown");
                    },
                }).then(() => undefined);
            }
            return shutdownPromise;
        },
        terminate: async () => {
            await lease.terminate("startup-failure");
        },
    };
}

/** 只读规划 Product catalog；始终保留 already_current 结果供启动策略判断。 */
export async function planApplicationStateMigration(
    root: string,
    manifest: InstallationManifest,
    runId: string,
    applicationRoot = root,
    containerComposePath?: string,
    containerStateRoot?: string,
    productRuntimeReceipt?: ProductRuntimeReceiptAuthorization,
): Promise<ApplicationMigrationPlan> {
    const args = applicationMigrationArgs(applicationRoot, manifest, ["--plan", "--run-id", runId]);
    const runner = manifest.profile === "source-dev"
        ? join(applicationRoot, "scripts", "db", "migrate-application-state.ts")
        : productCommandPath(applicationRoot);
    if (manifest.components.applicationRuntime.provider !== "container" && !await pathExists(runner)) {
        throw new Error(`Product 缺少 Application State migration runner：${runner}`);
    }
    const report = await runApplicationMigrationCommand(
        root,
        manifest,
        args,
        applicationRoot,
        containerComposePath,
        containerStateRoot,
        productRuntimeReceipt,
    );
    if (report.action !== "plan" || report.runId !== runId) {
        throw new Error("Application State migration plan 返回了不一致的报告。");
    }
    if (report.status === "manual_required") {
        throw new Error(`Application State migration 需要人工处理：${report.guide ?? "Product 未提供迁移说明。"}`);
    }
    if (report.status !== "already_current" && report.status !== "planned") {
        throw new Error(`Application State migration plan 状态非法：${report.status}`);
    }
    return {runId, status: report.status, steps: report.steps};
}

/** 使用预先写入 Operation Journal 的 runId 执行完整 Product catalog。 */
export async function applyApplicationStateMigration(
    root: string,
    manifest: InstallationManifest,
    runId: string,
    applicationRoot = root,
): Promise<ApplicationMigrationPlan> {
    const report = await runApplicationMigrationCommand(
        root,
        manifest,
        applicationMigrationArgs(applicationRoot, manifest, ["--apply", "--run-id", runId]),
        applicationRoot,
    );
    if (report.action !== "apply" || report.status !== "complete" || report.runId !== runId) {
        throw new Error("Application State migration apply 返回了不一致的报告。");
    }
    return {runId, status: "planned", steps: report.steps};
}

/** 在数据库与 Product 恢复前，由 Product runner 反序撤销 catalog。 */
export async function rollbackApplicationStateMigration(
    root: string,
    manifest: InstallationManifest,
    runId: string,
    allowNotStarted = false,
    applicationRoot = root,
): Promise<void> {
    const report = await runApplicationMigrationCommand(
        root,
        manifest,
        applicationMigrationArgs(applicationRoot, manifest, ["--rollback", "--run-id", runId]),
        applicationRoot,
    );
    if (report.action !== "rollback" || report.runId !== runId) throw new Error("Application State migration rollback 返回了错误报告。");
    if (report.status === "not_started" && !allowNotStarted) {
        throw new Error("Application State migration 已记录为 applied，但 rollback 报告 not_started；拒绝恢复旧 Product。" );
    }
    if (report.status !== "not_started" && report.status !== "rolled_back") throw new Error(`Application State rollback 状态非法：${report.status}`);
}

/** 创建或重置管理员；自动密码只在显式传入时经 stdin 交给 Product。 */
export async function createAdmin(root: string, manifest: InstallationManifest, username?: string, passwordOverride?: string): Promise<void> {
    assertInstallationHostCompatible(manifest);
    activateManagedTools(root, manifest.components.tools);
    const roots = resolveInstallationRoots(root, manifest.roots);
    const stateRoot = roots.state;
    const password = passwordOverride !== undefined ? passwordOverride : process.env.AUTH_ADMIN_PASSWORD;
    const passwordInput = password === undefined ? null : new TextEncoder().encode(password);
    const passwordArgs = passwordInput ? ["--password-stdin"] : [];
    const execution = await verifyApplicationExecution(root, manifest);
    if (execution.kind === "container-product") {
        await verifyRunningDockerApplication(execution.image, root, stateRoot);
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const composeArgs = ["compose", "--env-file", join(stateRoot, ".env"), "-f", compose];
        const execOptions = [
            ...(!process.stdin.isTTY || passwordInput ? ["-T"] : []),
        ];
        const args = [
            ...composeArgs,
            "exec",
            ...execOptions,
            "app",
            "bun",
            ...PRODUCT_BUN_RUNTIME_ARGS,
            `.output/${PRODUCT_RUNTIME_COMMAND_BOOTSTRAP}`,
            "command",
            "create-admin",
            ...(username ? [username] : []),
            ...passwordArgs,
        ];
        const options = withoutAdminPassword(await containerComposeOptions(execution.engine, root));
        if (passwordInput) await runWithInput(execution.engine, args, passwordInput, options);
        else await run(execution.engine, args, options);
        return;
    }
    if (execution.kind === "source-dev") {
        const bun = resolveBun(root, manifest);
        const args = [
            ...PRODUCT_BUN_RUNTIME_ARGS,
            "run",
            "auth:create-admin",
            ...(username ? [username] : []),
            ...passwordArgs,
        ];
        const options = {
            cwd: root,
            env: withoutAdminPasswordEnvironment({...await applicationEnvironment(root, stateRoot, false, roots.cache), BUN: bun}),
        };
        if (passwordInput) await runWithInput(bun, args, passwordInput, options);
        else await run(bun, args, options);
        return;
    }
    const args = productCommandArgs(root, "create-admin", [...(username ? [username] : []), ...passwordArgs]);
    const bootstrap = productCommandPath(root);
    if (!await pathExists(bootstrap)) {
        throw new Error(`Product 缺少 Runtime Contract bootstrap：${bootstrap}`);
    }
    const bun = resolveBun(root, manifest);
    const options = {
        cwd: root,
        env: withoutAdminPasswordEnvironment({...await applicationEnvironment(root, stateRoot, false, roots.cache), BUN: bun}),
    };
    delete options.env.NODE_PATH;
    if (passwordInput) await runWithInput(bun, args, passwordInput, options);
    else await run(bun, args, options);
    if (manifest.profile === "windows-portable") {
        await enableAuthentication(stateRoot);
        console.log("管理员创建成功，Windows Portable 鉴权已启用；请重启 NeuroBook。" );
    }
}

/** 生成状态/doctor 所需的命令版本；args允许检查docker compose等子命令。 */
export async function commandStatus(command: string, args = ["--version"]): Promise<CommandInspection> {
    const available = await commandAvailable(command, args);
    if (!available) {
        return {available: false};
    }
    try {
        const version = (await runCapture(command, args)).split(/\r?\n/u)[0]?.trim();
        return {available: true, ...(version ? {version} : {})};
    } catch {
        return {available: false};
    }
}

/**
 * 构造受管Product与CLI的根环境。
 *
 * Cache Root可由Desktop/Portable locator显式传入；未传时保留源码部署的
 * State Root/cache默认值。四个托管工具变量在读取`.env`后覆盖，用户配置不能把
 * durable state或可重建cache重定向到未受Manager管理的位置。
 */
export async function applicationEnvironment(
    root: string,
    stateRoot: string,
    development: boolean,
    cacheRoot = join(stateRoot, "cache"),
): Promise<NodeJS.ProcessEnv> {
    const productImageRoot = resolveProductImageRoot(root);
    return createProductRuntimeEnvironment({
        applicationRoot: root,
        productImageRoot,
        stateRoot,
        cacheRoot,
        development,
        inheritedEnvironment: process.env,
        stateEnvironment: await loadStateEnv(stateRoot),
        host: "127.0.0.1",
    });
}

/** 从子进程环境删除Manager消费过的自动密码。 */
function withoutAdminPasswordEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const projected = {...env};
    delete projected.AUTH_ADMIN_PASSWORD;
    return projected;
}

/** 保留Compose Adapter的cwd等选项，同时清除Docker/Podman CLI子进程中的secret。 */
function withoutAdminPassword(options: {cwd: string; env?: NodeJS.ProcessEnv}): {cwd: string; env?: NodeJS.ProcessEnv} {
    if (options.env) return {...options, env: withoutAdminPasswordEnvironment(options.env)};
    if (process.env.AUTH_ADMIN_PASSWORD !== undefined) {
        return {...options, env: withoutAdminPasswordEnvironment(process.env)};
    }
    return options;
}

export function resolveBun(root: string, manifest: InstallationManifest): string {
    const runtime = manifest.components.applicationRuntime;
    if (runtime.provider === "managed") return resolve(root, runtime.path);
    if (runtime.provider === "system") return runtime.executable;
    throw new Error("Container Application Runtime 不能执行宿主 Product 命令。" );
}

/** 根据 Profile 选择 Source runner 或 Product Runtime Contract 逻辑命令。 */
function applicationMigrationArgs(
    root: string,
    manifest: InstallationManifest,
    args: string[],
): string[] {
    if (manifest.profile === "source-dev") {
        return [
            ...PRODUCT_BUN_RUNTIME_ARGS,
            join(root, "scripts", "db", "migrate-application-state.ts"),
            ...args,
        ];
    }
    if (manifest.components.applicationRuntime.provider === "container") {
        return [
            ...PRODUCT_BUN_RUNTIME_ARGS,
            `.output/${PRODUCT_RUNTIME_COMMAND_BOOTSTRAP}`,
            "command",
            "migrate-application-state",
            ...args,
        ];
    }
    return productCommandArgs(root, "migrate-application-state", args);
}

/** Manager 只传逻辑命令 ID；bundle 文件名只由 Product Runtime Contract 解释。 */
function productCommandArgs(root: string, id: ProductRuntimeCommandId, args: string[] = []): string[] {
    return [...PRODUCT_BUN_RUNTIME_ARGS, productCommandPath(root), "command", id, ...args];
}

/** Runtime Contract bootstrap 的唯一磁盘位置；CLI flag 不参与路径存在性判断。 */
function productCommandPath(root: string): string {
    return join(resolveProductImageRoot(root), ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
}

function resolveProductImageRoot(root: string): string {
    const override = process.env.NEURO_BOOK_PRODUCT_EXECUTION_IMAGE_ROOT?.trim();
    if (!override) return join(root, ".output");
    const imageRoot = resolve(override);
    const cacheRoot = process.env.NEURO_BOOK_CACHE_ROOT?.trim();
    if (!isAbsolute(imageRoot) || (cacheRoot && !isWithin(resolve(cacheRoot), imageRoot))) {
        throw new Error(`Product Runtime execution image 必须位于 Cache Root：${imageRoot}`);
    }
    return imageRoot;
}

function isWithin(root: string, target: string): boolean {
    const relativePath = relative(resolve(root), resolve(target));
    return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

/** 执行并严格解析 Product runner 的唯一 JSON 报告。 */
async function runApplicationMigrationCommand(
    root: string,
    manifest: InstallationManifest,
    args: string[],
    applicationRoot: string,
    containerComposePath?: string,
    containerStateRoot?: string,
    productRuntimeReceipt?: ProductRuntimeReceiptAuthorization,
): Promise<ApplicationMigrationReport> {
    const output = await runApplicationCommand(
        root,
        manifest,
        args,
        applicationRoot,
        containerComposePath,
        containerStateRoot,
        productRuntimeReceipt,
    );
    // podman-compose 会在 compose run 的 stdout 前输出 pod ID；只从首个 JSON 行开始解析报告。
    const jsonStart = output.search(/(?:^|\r?\n)[\t ]*\{/u);
    const jsonOutput = jsonStart >= 0 ? output.slice(jsonStart).trimStart() : output;
    const value: unknown = JSON.parse(jsonOutput);
    if (!Value.Check(ApplicationMigrationReportSchema, value)) {
        throw new Error("Application State migration 返回了无效报告。");
    }
    const report = value as ApplicationMigrationReport;
    const ids = report.steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) {
        throw new Error("Application State migration 报告包含重复 step id。");
    }
    return report;
}

/** 原生Profile使用Application Bun，容器Profile使用Compose一次性app容器。 */
async function runApplicationCommand(
    root: string,
    manifest: InstallationManifest,
    args: string[],
    applicationRoot = root,
    containerComposePath?: string,
    containerStateRoot?: string,
    productRuntimeReceipt?: ProductRuntimeReceiptAuthorization,
): Promise<string> {
    const roots = resolveInstallationRoots(root, manifest.roots);
    const stateRoot = containerStateRoot ?? roots.state;
    const execution = await verifyApplicationExecution(applicationRoot, manifest, {
        productRuntimeReceipt,
    });
    if (execution.kind === "container-product") {
        return runDockerApplicationCommand(
            execution.image,
            root,
            stateRoot,
            ["bun", ...args],
            containerComposePath,
        );
    }
    const bun = resolveBun(root, manifest);
    const env: NodeJS.ProcessEnv = {
        ...await applicationEnvironment(
            applicationRoot,
            stateRoot,
            execution.kind === "source-dev",
            containerStateRoot ? join(containerStateRoot, ".cache") : roots.cache,
        ),
        ...(productRuntimeReceipt ? productRuntimeReceiptEnvironment(productRuntimeReceipt) : {}),
        BUN: bun,
    };
    if (execution.kind === "native-product") delete env.NODE_PATH;
    return runCapture(bun, args, {
        cwd: applicationRoot,
        env,
    });
}

/** 等待候选 HTTP 与版本就绪；ready 前任何进程终态都视为启动失败。 */
/** 等待候选 HTTP 与版本就绪；导出供 Desktop Supervisor 的协议回归测试复用。 */
export async function waitForApplicationReady(
    port: number,
    expectedVersion: string,
    completion: Promise<{code: number | null; signal: string | null}>,
    timeoutMs: number,
    expectedStartupNonce?: string,
): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Application 端口非法：${String(port)}`);
    const completionState: {
        terminal?: {code: number | null; signal: string | null};
        error?: unknown;
    } = {};
    void completion.then(
        (result) => completionState.terminal = result,
        (error: unknown) => completionState.error = error,
    );
    const deadline = Date.now() + timeoutMs;
    let lastError = "服务尚未响应";
    let nextProgressAt = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (completionState.error) throw completionState.error;
        if (completionState.terminal) {
            throw new Error(productExitErrorMessage(completionState.terminal, "Product 在 ready 前退出"));
        }
        try {
            const response = await fetch(`http://127.0.0.1:${String(port)}/api/app/version`, {
                signal: AbortSignal.timeout(1_000),
                ...(expectedStartupNonce ? {headers: {"x-neuro-book-startup-nonce": expectedStartupNonce}} : {}),
            });
            if (response.ok) {
                const value = await response.json() as {versionLabel?: string; startupNonce?: string};
                const expected = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
                if (value.versionLabel !== expected) {
                    throw new Error(`Product 版本接口返回 ${value.versionLabel ?? "<missing>"}，期望 ${expected}。`);
                }
                if (expectedStartupNonce && value.startupNonce !== expectedStartupNonce) {
                    throw new Error("Product 启动 nonce 与本次候选不一致。");
                }
                return;
            }
            lastError = `HTTP ${String(response.status)}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        if (Date.now() >= nextProgressAt) {
            // Desktop Supervisor 的 stdout 是 NDJSON 控制通道；等待日志只能进入 stderr。
            console.error(`Product健康检查仍在等待：${lastError}`);
            nextProgressAt = Date.now() + 10_000;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    throw new Error(`Product HTTP 健康检查超时：${lastError}`);
}

export async function runPortableForeground(
    bun: string,
    entry: string,
    root: string,
    env: NodeJS.ProcessEnv,
    port: number,
    options: PortableForegroundOptions = {},
): Promise<void> {
    const startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    const lease = spawnOwnedProcess({
        command: bun,
        args: [...PRODUCT_BUN_RUNTIME_ARGS, entry],
        cwd: root,
        env,
        // 前台Adapter同样由Manager拥有stdin，Product生命周期走控制面与Owned Process。
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
        windowsHide: false,
        graceMs: 2_000,
        hardKillWaitMs: 5_000,
    });
    let exited = false;
    let completionError: unknown;
    const completion = lease.completion.then(
        (result) => {
            exited = true;
            return result;
        },
        (error: unknown) => {
            exited = true;
            completionError = error;
            return null;
        },
    );
    const url = `http://127.0.0.1:${port}`;
    const healthCheck = options.healthCheck !== false;
    let opened = false;
    // healthCheck 关闭时不做 HTTP 探测、不自动开浏览器，只等 Product 自己结束。
    if (healthCheck) {
        const deadline = Date.now() + startupTimeoutMs;
        let nextProgressAt = Date.now() + 10_000;
        while (Date.now() < deadline && !exited) {
            try {
                const response = await fetch(`${url}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
                if (response.ok) {
                    await run("cmd.exe", ["/c", "start", "", url], {cwd: root, stdio: "ignore"});
                    opened = true;
                    break;
                }
            } catch {
                // 服务启动期间连接失败属于预期状态。
            }
            if (Date.now() >= nextProgressAt) {
                console.log(`Windows Portable仍在启动：${url}`);
                nextProgressAt = Date.now() + 10_000;
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        }
        if (!opened && !exited) {
            await lease.terminate("startup-failure");
            throw new Error(`Windows Portable 启动后 ${startupTimeoutMs / 1000} 秒内未通过健康检查：${url}`);
        }
    }
    const result = await completion;
    if (completionError) throw completionError;
    if (!result) throw new Error("Windows Portable Product没有返回进程终态。");
    if (healthCheck && !opened && !result.signal && result.exitCode === 0) {
        throw new Error("Windows Portable Product在通过健康检查前以退出码0结束。");
    }
    assertConcreteProductExit({code: result.exitCode, signal: result.signal}, "NeuroBook 服务退出");
}
