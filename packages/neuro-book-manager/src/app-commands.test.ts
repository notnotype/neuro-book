import {mkdir, mkdtemp, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    applicationEnvironment,
    applyApplicationStateMigration,
    createAdmin,
    launchApplication,
    planApplicationStateMigration,
    productExitErrorMessage,
    rollbackApplicationStateMigration,
    runPortableForeground,
    waitForApplicationReady,
} from "#manager/app-commands";
import {TEST_RUNTIME_IMAGE_IDENTITY} from "#manager/fixtures/runtime-image";
import {currentProductPlatform} from "#manager/platform";
import {INSTALLATION_SCOPED_ROOT_LOCATORS} from "#manager/root-locators";
import type {ContainerEngine, InstallationManifest} from "#manager/types";
import {
    PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
    PRODUCT_SHUTDOWN_PATH,
    PRODUCT_SHUTDOWN_TIMEOUT_MS,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
} from "nbook/shared/product-runtime-contract";

const processCommands = vi.hoisted(() => ({
    capture: vi.fn(),
    run: vi.fn(),
    input: vi.fn(),
    available: vi.fn(),
}));
const docker = vi.hoisted(() => ({command: vi.fn(), start: vi.fn(), stopContainer: vi.fn(), options: vi.fn(), verifyRunning: vi.fn()}));
const ownedProcess = vi.hoisted(() => ({spawn: vi.fn()}));
const applicationExecution = vi.hoisted(() => ({verify: vi.fn()}));

vi.mock("#manager/process", () => ({
    runCapture: processCommands.capture,
    run: processCommands.run,
    runWithInput: processCommands.input,
    commandAvailable: processCommands.available,
}));
vi.mock("#manager/docker", () => ({
    containerComposeOptions: docker.options,
    runDockerApplicationCommand: docker.command,
    startDocker: docker.start,
    stopDockerContainer: docker.stopContainer,
    verifyRunningDockerApplication: docker.verifyRunning,
}));
vi.mock("@notnotype/owned-process", () => ({spawnOwnedProcess: ownedProcess.spawn}));
vi.mock("#manager/application-execution", () => ({verifyApplicationExecution: applicationExecution.verify}));

const roots: string[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    ownedProcess.spawn.mockReturnValue({
        completion: Promise.resolve({exitCode: 0, signal: null}),
        terminate: vi.fn(async () => ({exitCode: 0, signal: null, terminationReason: "shutdown"})),
    });
    docker.options.mockImplementation((engine: ContainerEngine, cwd: string) => engine === "podman"
        ? {cwd, env: {...process.env, PODMAN_COMPOSE_PROVIDER: "podman-compose"}}
        : {cwd});
    applicationExecution.verify.mockImplementation(async (root: string, manifest: InstallationManifest) => {
        if (manifest.profile === "source-dev") return {kind: "source-dev", applicationRoot: root};
        if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
            return {
                kind: "container-product",
                applicationRoot: root,
                engine: manifest.containerEngine,
                product: manifest.components.product,
                image: {engine: manifest.containerEngine},
            };
        }
        return {
            kind: "native-product",
            applicationRoot: root,
            imageRoot: join(root, ".output"),
            identity: {},
        };
    });
});
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Product exit diagnostics", () => {
    it("为Session Store lease compromised返回可执行提示", () => {
        expect(productExitErrorMessage({code: PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED, signal: null}, "NeuroBook 服务退出")).toContain(
            "不要手动删除 runtime.lease.lock",
        );
        expect(productExitErrorMessage({code: 17, signal: null}, "NeuroBook 服务退出")).toBe(
            "NeuroBook 服务退出：17",
        );
    });
});

describe("Product ready退出诊断", () => {
    it("健康检查等待日志写入stderr，不污染Supervisor的stdout协议", async () => {
        vi.useFakeTimers();
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 503}));
        const completion = new Promise<{code: number | null; signal: string | null}>(() => undefined);
        const ready = waitForApplicationReady(3000, "0.8.0-canary.1", completion, 10_500);
        const outcome = ready.then(
            () => null,
            (reason: unknown) => reason,
        );

        try {
            await vi.advanceTimersByTimeAsync(10_500);
            await expect(outcome).resolves.toMatchObject({message: expect.stringContaining("健康检查超时")});
            expect(log).not.toHaveBeenCalledWith(expect.stringContaining("健康检查仍在等待"));
            expect(error).toHaveBeenCalledWith(expect.stringContaining("健康检查仍在等待"));
        } finally {
            vi.useRealTimers();
            log.mockRestore();
            error.mockRestore();
            fetch.mockRestore();
        }
    });

    it("ready检查把启动nonce放入版本请求头，普通响应不公开nonce", async () => {
        const root = await nativeProductRoot();
        const terminal = deferred<{exitCode: number | null; signal: NodeJS.Signals | null}>();
        const nonce = "n".repeat(43);
        const terminate = vi.fn(async () => ({exitCode: 0, signal: null, terminationReason: "startup-failure" as const}));
        ownedProcess.spawn.mockReturnValue({completion: terminal.promise, terminate});
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
            const headers = new Headers(init?.headers);
            return Response.json({
                versionLabel: "v0.8.0-canary.1",
                ...(headers.get("x-neuro-book-startup-nonce") ? {startupNonce: nonce} : {}),
            });
        });

        try {
            const launch = await launchApplication(root, productManifest(), {startupNonce: nonce});
            await launch.ready;
            expect(fetch).toHaveBeenCalledWith(
                "http://127.0.0.1:3000/api/app/version",
                expect.objectContaining({headers: {"x-neuro-book-startup-nonce": nonce}}),
            );
            await launch.terminate();
            expect(terminate).toHaveBeenCalledWith("startup-failure");
        } finally {
            fetch.mockRestore();
        }
    });

    it("ready前以0退出仍立即报告Product提前退出", async () => {
        const root = await nativeProductRoot();
        ownedProcess.spawn.mockReturnValue({
            completion: Promise.resolve({exitCode: 0, signal: null}),
            terminate: vi.fn(),
        });
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 503}));

        try {
            const launch = await launchApplication(root, productManifest());
            await expect(launch.ready).rejects.toThrow("Product 在 ready 前退出：0");
        } finally {
            fetch.mockRestore();
        }
    });

    it("ready前以Session Store lease compromised退出时返回专用提示", async () => {
        const root = await nativeProductRoot();
        const terminate = vi.fn(async () => ({exitCode: 75, signal: null, terminationReason: "startup-failure" as const}));
        ownedProcess.spawn.mockReturnValue({
            completion: Promise.resolve({exitCode: PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED, signal: null}),
            terminate,
        });
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 503}));

        try {
            const launch = await launchApplication(root, productManifest());
            await expect(launch.ready).rejects.toThrow("运行租约失去所有权");
            await launch.terminate();
            expect(terminate).toHaveBeenCalledWith("startup-failure");
        } finally {
            fetch.mockRestore();
        }
    });
});

describe("Application State migration command", () => {
    it("Manager统一注入Product、llmlint与Bun的State/Cache Root", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-runtime-env-"));
        const stateRoot = join(root, "data");
        const cacheRoot = join(root, ".cache");
        roots.push(root);
        await mkdir(stateRoot, {recursive: true});
        await writeFile(join(stateRoot, ".env"), [
            "LLMLINT_HOME=outside-state",
            "LLMLINT_CACHE_DIR=outside-cache",
            "BUN_INSTALL_CACHE_DIR=outside-bun",
            "NEURO_BOOK_LOG_DIR=outside-logs",
        ].join("\n"), "utf8");

        const env = await applicationEnvironment(root, stateRoot, false, cacheRoot);

        expect(env).toMatchObject({
            NEURO_BOOK_APPLICATION_ROOT: root,
            NEURO_BOOK_STATE_ROOT: stateRoot,
            NEURO_BOOK_CACHE_ROOT: cacheRoot,
            NEURO_BOOK_LOG_DIR: join(stateRoot, "logs"),
            LLMLINT_HOME: join(stateRoot, "tool-state", "llmlint"),
            LLMLINT_CACHE_DIR: join(cacheRoot, "llmlint"),
            BUN_INSTALL_CACHE_DIR: join(cacheRoot, "bun", "install"),
        });
    });

    it("原生Product严格解析plan并使用同一runId执行apply/rollback", async () => {
        const root = await nativeProductRoot();
        const manifest = productManifest();
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            const action = args.includes("--rollback") ? "rollback" : args.includes("--apply") ? "apply" : "plan";
            const status = action === "rollback" ? "rolled_back" : action === "apply" ? "complete" : "planned";
            return JSON.stringify(applicationMigrationReport("operation", action, status, 2));
        });

        const plan = await planApplicationStateMigration(root, manifest, "operation");
        await applyApplicationStateMigration(root, manifest, plan!.runId);
        await rollbackApplicationStateMigration(root, manifest, plan!.runId);

        expect(plan?.runId).toBe("operation");
        expect(plan?.steps[0]).toMatchObject({id: "app-sqlite", changedItems: 0});
        expect(plan?.steps[1]).toMatchObject({id: "agent-attachment-v1", changedItems: 2});
        expect(plan?.steps).toHaveLength(4);
        expect(processCommands.capture).toHaveBeenCalledTimes(3);
        expect(processCommands.capture.mock.calls[0]?.[0]).toBe("bun");
        expect(processCommands.capture.mock.calls[0]?.[1]).toEqual([
            "--no-install",
            "--no-env-file",
            join(root, ".output", "server", "commands", "product-command.mjs"),
            "command",
            "migrate-application-state",
            "--plan",
            "--run-id",
            "operation",
        ]);
        expect(processCommands.capture.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["--apply", "--run-id", "operation"]));
        expect(processCommands.capture.mock.calls[2]?.[1]).toEqual(expect.arrayContaining(["--rollback", "--run-id", "operation"]));
    });

    it("Source运行分支同样禁止Bun隐式安装", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-source-migration-"));
        roots.push(root);
        await mkdir(join(root, "scripts", "db"), {recursive: true});
        await writeFile(join(root, "scripts", "db", "migrate-application-state.ts"), "", "utf8");
        processCommands.capture.mockResolvedValue(JSON.stringify(applicationMigrationReport("source-operation", "plan", "planned")));

        await planApplicationStateMigration(root, sourceManifest(), "source-operation");

        expect(processCommands.capture).toHaveBeenCalledWith("bun", [
            "--no-install",
            "--no-env-file",
            join(root, "scripts", "db", "migrate-application-state.ts"),
            "--plan",
            "--run-id",
            "source-operation",
        ], expect.objectContaining({
            cwd: root,
            env: expect.objectContaining({BUN: "bun"}),
        }));
    });

    it("当前catalog已完整时不创建migration plan", async () => {
        const root = await nativeProductRoot();
        processCommands.capture.mockResolvedValue(JSON.stringify(applicationMigrationReport("no-change", "plan", "already_current")));

        await expect(planApplicationStateMigration(root, productManifest(), "no-change"))
            .resolves.toMatchObject({status: "already_current", runId: "no-change"});
    });

    it("Product缺少migration脚本时fail closed", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-missing-migration-"));
        roots.push(root);

        await expect(planApplicationStateMigration(root, productManifest(), "missing-script"))
            .rejects.toThrow("缺少 Application State migration runner");
        expect(processCommands.capture).not.toHaveBeenCalled();
    });

    it("容器Profile通过Compose一次性app执行相同协议", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-container-migration-"));
        roots.push(root);
        docker.command.mockImplementation(async (_engine: string, _root: string, _stateRoot: string, args: string[]) => {
            const action = args.includes("--rollback") ? "rollback" : args.includes("--apply") ? "apply" : "plan";
            const status = action === "rollback" ? "rolled_back" : action === "apply" ? "complete" : "planned";
            return JSON.stringify(applicationMigrationReport("docker-state", action, status, 1));
        });
        const manifest = dockerManifest();

        const plan = await planApplicationStateMigration(root, manifest, "docker-state");
        await applyApplicationStateMigration(root, manifest, plan!.runId);
        await rollbackApplicationStateMigration(root, manifest, plan!.runId);

        expect(docker.command).toHaveBeenCalledTimes(3);
        expect(docker.command.mock.calls[0]?.[3]).toEqual([
            "bun",
            "--no-install",
            "--no-env-file",
            ".output/server/commands/product-command.mjs",
            "command",
            "migrate-application-state",
            "--plan",
            "--run-id",
            "docker-state",
        ]);
    });
    it("容忍Podman Compose在迁移报告前输出容器ID", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-podman-migration-noise-"));
        roots.push(root);
        docker.command.mockResolvedValue(`${"f".repeat(64)}\n${JSON.stringify(applicationMigrationReport("podman-state", "plan", "planned", 1))}`);

        await expect(planApplicationStateMigration(root, {...dockerManifest(), containerEngine: "podman"}, "podman-state"))
            .resolves.toMatchObject({runId: "podman-state", status: "planned"});
    });
    it("拒绝错误runId与宽松JSON报告", async () => {
        const root = await nativeProductRoot();
        processCommands.capture.mockResolvedValueOnce(JSON.stringify(applicationMigrationReport("other-run", "plan", "planned", 1)));
        await expect(planApplicationStateMigration(root, productManifest(), "expected-run"))
            .rejects.toThrow("不一致的报告");
        processCommands.capture.mockResolvedValueOnce(JSON.stringify({...applicationMigrationReport("expected-run", "plan", "planned", 1), extra: true}));
        await expect(planApplicationStateMigration(root, productManifest(), "expected-run"))
            .rejects.toThrow("无效报告");
    });

    it("applied状态拒绝not_started，只有planned恢复允许", async () => {
        const root = await nativeProductRoot();
        processCommands.capture.mockResolvedValue(JSON.stringify(applicationMigrationReport("rollback-run", "rollback", "not_started")));

        await expect(rollbackApplicationStateMigration(root, productManifest(), "rollback-run"))
            .rejects.toThrow("拒绝恢复旧 Product");
        await expect(rollbackApplicationStateMigration(root, productManifest(), "rollback-run", true))
            .resolves.toBeUndefined();
    });
});

describe("容器管理员命令", () => {
    it("启动前由Manager建立宿主用户拥有的Cache Root与tool-state", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-container-writable-roots-"));
        roots.push(root);
        docker.start.mockResolvedValue(undefined);

        const launch = await launchApplication(root, dockerManifest());
        await launch.ready;

        expect((await stat(join(root, ".cache"))).isDirectory()).toBe(true);
        expect((await stat(join(root, "data", "tool-state"))).isDirectory()).toBe(true);
    });

    it("launch handle 在ready失败后只终止回调发布的精确候选容器", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-container-launch-"));
        roots.push(root);
        const containerId = "c".repeat(64);
        docker.start.mockImplementation(async (
            _engine: ContainerEngine,
            _root: string,
            _stateRoot: string,
            _profile: string,
            _expectedVersion: string,
            onStarting?: () => Promise<void>,
            onStarted?: (id: string) => Promise<void>,
        ) => {
            await onStarting?.();
            await onStarted?.(containerId);
            throw new Error("health timeout");
        });

        const checkpoints: string[] = [];

        const launch = await launchApplication(root, dockerManifest(), {
            onContainerStarting: async () => {
                checkpoints.push("starting");
            },
            onContainerStarted: async (id) => {
                checkpoints.push(`started:${id}`);
            },
            onContainerStopped: async (id) => {
                checkpoints.push(`stopped:${id}`);
            },
        });
        await expect(launch.ready).rejects.toThrow("health timeout");
        await launch.terminate();

        expect(checkpoints).toEqual([
            "starting",
            `started:${containerId}`,
            `stopped:${containerId}`,
        ]);
        expect(docker.stopContainer).toHaveBeenCalledWith("docker", root, containerId);
    });

    it.each(["docker", "podman"] as const)("%s只使用Manifest固定engine和公共Compose参数", async (engine) => {
        const root = await mkdtemp(join(tmpdir(), "manager-container-admin-"));
        roots.push(root);
        const manifest = {...dockerManifest(), containerEngine: engine as ContainerEngine};

        await createAdmin(root, manifest, "admin");

        expect(processCommands.run).toHaveBeenCalledWith(engine, [
            "compose",
            "--env-file", join(root, "data", ".env"),
            "-f", join(root, ".deploy", "docker-compose.generated.yml"),
            "exec", "-T", "app", "bun", "--no-install", "--no-env-file", ".output/server/commands/product-command.mjs", "command", "create-admin", "admin",
        ], engine === "podman"
            ? {cwd: root, env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"})}
            : {cwd: root});
    });

    it("容器管理员密码只经stdin传递，argv和子进程env不含明文", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-container-admin-password-"));
        roots.push(root);
        const password = "测试-password\n";
        process.env.AUTH_ADMIN_PASSWORD = password;
        try {
            await createAdmin(root, dockerManifest(), "admin");
        } finally {
            delete process.env.AUTH_ADMIN_PASSWORD;
        }

        expect(processCommands.run).not.toHaveBeenCalled();
        expect(processCommands.input).toHaveBeenCalledOnce();
        const [command, args, input, options] = processCommands.input.mock.calls[0]!;
        expect(command).toBe("docker");
        expect(args).toEqual(expect.arrayContaining([
            "exec", "-T", "app", "bun", "--no-install", "--no-env-file",
            ".output/server/commands/product-command.mjs", "command", "create-admin", "admin", "--password-stdin",
        ]));
        expect(args.join(" ")).not.toContain(password);
        expect(new TextDecoder().decode(input)).toBe(password);
        expect(options.env.AUTH_ADMIN_PASSWORD).toBeUndefined();
    });
});

describe("原生 Product shutdown", () => {
    it("注入单次 token，接受 202 后等待 Product 自行退出且并发调用幂等", async () => {
        const root = await nativeProductRoot();
        const terminal = deferred<{exitCode: number | null; signal: NodeJS.Signals | null}>();
        const terminate = vi.fn(async () => ({exitCode: 0, signal: null, terminationReason: "shutdown" as const}));
        ownedProcess.spawn.mockReturnValue({completion: terminal.promise, terminate});
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith("/api/app/version")) return Response.json({versionLabel: "v0.8.0-canary.1"});
            if (url.endsWith(PRODUCT_SHUTDOWN_PATH)) return new Response(null, {status: 202});
            return new Response(null, {status: 404});
        });

        try {
            const launch = await launchApplication(root, productManifest());
            await launch.ready;
            const spec = ownedProcess.spawn.mock.calls[0]?.[0] as {
                command: string;
                args: string[];
                cwd: string;
                env: NodeJS.ProcessEnv;
                stdin: "inherit" | "ignore";
            };
            const token = spec.env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT];
            expect(spec.command).toBe("bun");
            expect(spec.args).toEqual([
                "--no-install",
                "--no-env-file",
                join(root, ".output", "server", "commands", "product-command.mjs"),
                "command",
                "start",
            ]);
            expect(spec.stdin).toBe("ignore");
            expect(spec.cwd).toBe(root);
            expect(spec.env.BUN).toBe("bun");
            expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
            expect(spec.env.HOST).toBe("127.0.0.1");
            expect(spec.env.NITRO_HOST).toBe("127.0.0.1");

            const first = launch.shutdown();
            const second = launch.shutdown();
            expect(second).toBe(first);
            terminal.resolve({exitCode: 0, signal: null});
            await first;

            expect(terminate).not.toHaveBeenCalled();
            expect(fetch).toHaveBeenCalledWith(
                `http://127.0.0.1:3000${PRODUCT_SHUTDOWN_PATH}`,
                expect.objectContaining({
                    method: "POST",
                    headers: {authorization: `Bearer ${token}`},
                }),
            );
        } finally {
            fetch.mockRestore();
        }
    });

    it("允许机器可读宿主隔离Product stdout", async () => {
        const root = await nativeProductRoot();
        const terminal = deferred<{exitCode: number | null; signal: NodeJS.Signals | null}>();
        ownedProcess.spawn.mockReturnValue({
            completion: terminal.promise,
            terminate: vi.fn(async () => ({exitCode: 0, signal: null, terminationReason: "shutdown" as const})),
        });
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({versionLabel: "v0.8.0-canary.1"}));

        try {
            const launch = await launchApplication(root, productManifest(), {productStdout: "ignore"});
            await launch.ready;
            expect(ownedProcess.spawn).toHaveBeenCalledWith(expect.objectContaining({stdout: "ignore", stderr: "inherit"}));
            terminal.resolve({exitCode: 0, signal: null});
            await launch.completion;
        } finally {
            fetch.mockRestore();
        }
    });

    it("shutdown HTTP 失败时使用 Owned Process fallback", async () => {
        const root = await nativeProductRoot();
        const terminal = deferred<{exitCode: number | null; signal: NodeJS.Signals | null}>();
        const terminate = vi.fn(async () => ({exitCode: null, signal: "SIGTERM" as const, terminationReason: "shutdown" as const}));
        ownedProcess.spawn.mockReturnValue({completion: terminal.promise, terminate});
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith("/api/app/version")) return Response.json({versionLabel: "v0.8.0-canary.1"});
            return new Response(null, {status: 500});
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        try {
            const launch = await launchApplication(root, productManifest());
            await launch.ready;
            await launch.shutdown();

            expect(terminate).toHaveBeenCalledOnce();
            expect(terminate).toHaveBeenCalledWith("shutdown");
        } finally {
            warn.mockRestore();
            fetch.mockRestore();
        }
    });

    it("202 后 Product 非零退出时使用 Owned Process fallback", async () => {
        const root = await nativeProductRoot();
        const terminal = deferred<{exitCode: number | null; signal: NodeJS.Signals | null}>();
        const terminate = vi.fn(async () => ({exitCode: null, signal: "SIGTERM" as const, terminationReason: "shutdown" as const}));
        ownedProcess.spawn.mockReturnValue({completion: terminal.promise, terminate});
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith("/api/app/version")) return Response.json({versionLabel: "v0.8.0-canary.1"});
            if (url.endsWith(PRODUCT_SHUTDOWN_PATH)) return new Response(null, {status: 202});
            return new Response(null, {status: 404});
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        try {
            const launch = await launchApplication(root, productManifest());
            await launch.ready;
            const shutdown = launch.shutdown();
            terminal.resolve({exitCode: 17, signal: null});
            await shutdown;
            expect(terminate).toHaveBeenCalledWith("shutdown");
        } finally {
            warn.mockRestore();
            fetch.mockRestore();
        }
    });

    it("202 后 Product 未在合同窗口退出时强制收口", async () => {
        vi.useFakeTimers();
        const root = await nativeProductRoot();
        const terminal = deferred<{exitCode: number | null; signal: NodeJS.Signals | null}>();
        const terminate = vi.fn(async () => ({exitCode: null, signal: "SIGTERM" as const, terminationReason: "shutdown" as const}));
        ownedProcess.spawn.mockReturnValue({completion: terminal.promise, terminate});
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith("/api/app/version")) return Response.json({versionLabel: "v0.8.0-canary.1"});
            return new Response(null, {status: 202});
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        try {
            const launch = await launchApplication(root, productManifest());
            await launch.ready;
            const shutdown = launch.shutdown();
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(PRODUCT_SHUTDOWN_TIMEOUT_MS);
            await shutdown;

            expect(terminate).toHaveBeenCalledWith("shutdown");
        } finally {
            vi.useRealTimers();
            warn.mockRestore();
            fetch.mockRestore();
        }
    });
});

describe("Windows Portable前台启动", () => {
    it("以Session Store lease compromised退出时返回专用提示", async () => {
        ownedProcess.spawn.mockReturnValue({
            completion: Promise.resolve({exitCode: PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED, signal: null}),
            terminate: vi.fn(),
        });

        await expect(runPortableForeground(process.execPath, "--version", process.cwd(), process.env, 3000, {
            healthCheck: false,
        })).rejects.toThrow("不要手动删除 runtime.lease.lock");
    });

    it("关闭健康检查时不发起HTTP探测或尝试打开浏览器", async () => {
        const fetch = vi.spyOn(globalThis, "fetch");

        try {
            await runPortableForeground(process.execPath, "--version", process.cwd(), process.env, 3000, {
                healthCheck: false,
            });

            expect(fetch).not.toHaveBeenCalled();
            expect(processCommands.run).not.toHaveBeenCalled();
            expect(ownedProcess.spawn).toHaveBeenCalledWith(expect.objectContaining({
                command: process.execPath,
                args: ["--no-install", "--no-env-file", "--version"],
                stdin: "ignore",
            }));
        } finally {
            fetch.mockRestore();
        }
    });
});

describe("Manager Bun运行策略", () => {
    it("Source启动和管理员命令都显式禁止自动安装", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-source-runtime-"));
        roots.push(root);
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            Response.json({versionLabel: "v0.8.0-canary.1"}),
        );

        try {
            const launch = await launchApplication(root, sourceManifest());
            await launch.ready;
            await createAdmin(root, sourceManifest(), "admin");

            expect(ownedProcess.spawn).toHaveBeenCalledWith(expect.objectContaining({
                command: "bun",
                args: ["--no-install", "run", "dev:runtime"],
                cwd: root,
                env: expect.objectContaining({BUN: "bun"}),
            }));
            expect(processCommands.run).toHaveBeenCalledWith("bun", [
                "--no-install",
                "--no-env-file",
                "run",
                "auth:create-admin",
                "admin",
            ], expect.objectContaining({
                cwd: root,
                env: expect.objectContaining({BUN: "bun"}),
            }));
        } finally {
            fetch.mockRestore();
        }
    });

    it("原生Product管理员命令通过固定bootstrap且禁止自动安装", async () => {
        const root = await nativeProductRoot();

        await createAdmin(root, productManifest(), "admin");

        expect(processCommands.run).toHaveBeenCalledWith("bun", [
            "--no-install",
            "--no-env-file",
            join(root, ".output", "server", "commands", "product-command.mjs"),
            "command",
            "create-admin",
            "admin",
        ], expect.objectContaining({
            cwd: root,
            env: expect.objectContaining({BUN: "bun"}),
        }));
    });

    it("原生Product自动密码经pipe传递并从子进程env删除", async () => {
        const root = await nativeProductRoot();
        const password = "portable-密码\n";
        process.env.AUTH_ADMIN_PASSWORD = password;
        try {
            await createAdmin(root, productManifest(), "admin");
        } finally {
            delete process.env.AUTH_ADMIN_PASSWORD;
        }

        const [command, args, input, options] = processCommands.input.mock.calls[0]!;
        expect(command).toBe("bun");
        expect(args).toEqual([
            "--no-install",
            "--no-env-file",
            join(root, ".output", "server", "commands", "product-command.mjs"),
            "command",
            "create-admin",
            "admin",
            "--password-stdin",
        ]);
        expect(new TextDecoder().decode(input)).toBe(password);
        expect(options.env.AUTH_ADMIN_PASSWORD).toBeUndefined();
        expect(JSON.stringify([args, options])).not.toContain(password);
    });
});

async function nativeProductRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "manager-native-migration-"));
    roots.push(root);
    const script = join(root, ".output", "server", "commands", "product-command.mjs");
    await mkdir(join(script, ".."), {recursive: true});
    await writeFile(script, "", "utf8");
    return root;
}

function applicationMigrationReport(
    runId: string,
    action: "plan" | "apply" | "rollback",
    status: "planned" | "complete" | "already_current" | "rolled_back" | "not_started",
    changedItems = 0,
) {
    return {
        version: 1,
        catalogVersion: 3,
        runId,
        action,
        status,
        steps: [
            {id: "app-sqlite", runId: `${runId}-app-sqlite`, status: stepStatus(status), changedItems: 0, reviewItems: 0},
            {id: "agent-attachment-v1", runId: `${runId}-agent-attachment-v1`, status: stepStatus(status), changedItems, reviewItems: 0},
            {id: "agent-session-v2", runId: `${runId}-agent-session-v2`, status: stepStatus(status), changedItems: 0, reviewItems: 0},
            {id: "agent-session-v2-review-repair", runId: `${runId}-agent-session-v2-review-repair`, status: stepStatus(status), changedItems: 0, reviewItems: 0},
        ],
    };
}

function stepStatus(status: "planned" | "complete" | "already_current" | "rolled_back" | "not_started") {
    if (status === "complete") return "applied" as const;
    if (status === "already_current") return "skipped" as const;
    return status;
}

function productManifest(): InstallationManifest {
    const revision = "a".repeat(40);
    return {
        schemaVersion: 5,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "0.8.0-canary.1",
        channel: "canary",
        sourceRevision: revision,
        roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
        components: {
            source: {
                provider: "release", buildId: `sha256:${"9".repeat(64)}`,
                version: "0.8.0-canary.1",
                revision,
                path: ".",
                archiveSha256: "a".repeat(64),
                sourceUrl: "https://example.com/neuro-book-source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test fixture",
                files: ["package.json"],
            },
            product: {
                ...TEST_RUNTIME_IMAGE_IDENTITY,
                provider: "release", buildId: `sha256:${"9".repeat(64)}`,
                version: "0.8.0-canary.1",
                revision,
                platform: currentProductPlatform(),
                path: ".output",
                archiveSha256: "b".repeat(64),
                sourceUrl: "https://example.com/neuro-book-product-windows-x64.zip",
                license: "AGPL-3.0-only",
                redistribution: "test fixture",
            },
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
    };
}

function dockerManifest(): InstallationManifest {
    const revision = "b".repeat(40);
    return {
        schemaVersion: 5,
        profile: "ghcr",
        containerEngine: "docker",
        managerVersion: "0.1.0",
        appVersion: "0.8.0-canary.1",
        channel: "canary",
        sourceRevision: revision,
        roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
        components: {
            source: {provider: "container", version: "0.8.0-canary.1", revision, path: "/app"},
            product: {provider: "container", version: "0.8.0-canary.1", revision, image: "ghcr.io/notnotype/neuro-book:test", digest: `sha256:${"d".repeat(64)}`},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "container", version: "0.8.0-canary.1"},
            tools: {rg: {provider: "container", version: "0.8.0-canary.1"}, git: {provider: "container", version: "0.8.0-canary.1"}, python: {provider: "container", version: "0.8.0-canary.1"}},
        },
        installedAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
    };
}

function sourceManifest(): InstallationManifest {
    return {...productManifest(), profile: "source-dev"};
}

/** 创建可由测试精确推进的 Promise。 */
function deferred<T>(): {promise: Promise<T>; resolve(value: T): void} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}
