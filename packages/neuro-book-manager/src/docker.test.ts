import {mkdtemp, readFile, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parse} from "yaml";

import {
    buildSourceDockerImage,
    containerComposeEnvironment,
    inspectDockerApplication,
    resolveContainerEngine,
    runDockerApplicationCommand,
    startDocker,
    stopDocker,
    stopDockerContainer,
    writeDockerCompose,
    verifyContainerProductImage,
    verifyRunningDockerApplication,
    type VerifiedContainerImage,
} from "#manager/docker";
import type {ContainerEngine, ProductComponent} from "#manager/types";

const processCommands = vi.hoisted(() => ({
    available: vi.fn(),
    capture: vi.fn(),
    run: vi.fn(),
}));

vi.mock("#manager/process", () => ({
    commandAvailable: processCommands.available,
    runCapture: processCommands.capture,
    run: processCommands.run,
}));

const roots: string[] = [];
beforeEach(() => {
    vi.clearAllMocks();
    processCommands.available.mockResolvedValue(true);
});
afterEach(async () => {
    delete process.env.NEURO_BOOK_CONTAINER_ENGINE;
    delete process.env.PODMAN_COMPOSE_PROVIDER;
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Docker Compose部署合同", () => {
    it("Podman存在独立provider时固定使用它", async () => {
        processCommands.available.mockImplementation(async (command: string) => command === "podman-compose");

        await expect(containerComposeEnvironment("podman")).resolves.toMatchObject({PODMAN_COMPOSE_PROVIDER: "podman-compose"});
        expect(processCommands.available).toHaveBeenCalledWith("podman-compose");
    });

    it("Podman缺少独立provider时保留用户provider选择", async () => {
        process.env.PODMAN_COMPOSE_PROVIDER = "docker-compose";
        processCommands.available.mockResolvedValue(false);

        await expect(containerComposeEnvironment("podman")).resolves.toMatchObject({PODMAN_COMPOSE_PROVIDER: "docker-compose"});
        expect(processCommands.available).toHaveBeenCalledWith("podman-compose");
    });
    it("Podman缺少独立provider且用户未设置时不注入provider", async () => {
        delete process.env.PODMAN_COMPOSE_PROVIDER;
        processCommands.available.mockResolvedValue(false);

        const environment = await containerComposeEnvironment("podman");

        expect(environment.PODMAN_COMPOSE_PROVIDER).toBeUndefined();
        expect(processCommands.available).toHaveBeenCalledWith("podman-compose");
    });

    it("Docker不读取Podman provider", async () => {
        process.env.PODMAN_COMPOSE_PROVIDER = "docker-compose";

        await expect(containerComposeEnvironment("docker")).resolves.toEqual(process.env);
        expect(processCommands.available).not.toHaveBeenCalled();
    });

    it("Docker验证失败时选择完整可用的Podman", async () => {
        processCommands.capture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "compose") throw new Error("compose missing");
            return "ok\n";
        });
        await expect(resolveContainerEngine()).resolves.toBe("podman");
        expect(processCommands.capture).toHaveBeenCalledWith("podman", ["compose", "version"], {
            env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"}),
        });
        expect(processCommands.capture).toHaveBeenCalledWith("podman", ["info"]);
    });
    it("Podman缺少独立provider时允许podman compose自行委托", async () => {
        delete process.env.PODMAN_COMPOSE_PROVIDER;
        processCommands.available.mockResolvedValue(false);
        processCommands.capture.mockResolvedValue("podman-compose delegate\n");

        await expect(resolveContainerEngine("podman")).resolves.toBe("podman");

        const composeCall = processCommands.capture.mock.calls.find(([, args]) => args[0] === "compose");
        expect(composeCall?.[2]?.env?.PODMAN_COMPOSE_PROVIDER).toBeUndefined();
    });
    it("显式engine在info失败时不静默切换", async () => {
        processCommands.capture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "info") throw new Error("daemon unavailable");
            return "ok\n";
        });
        await expect(resolveContainerEngine("docker")).rejects.toThrow("daemon或machine不可用");
        expect(processCommands.available).not.toHaveBeenCalledWith("podman");
    });
    it("环境变量只接受docker或podman", async () => {
        process.env.NEURO_BOOK_CONTAINER_ENGINE = "nerdctl";
        await expect(resolveContainerEngine()).rejects.toThrow("只接受docker或podman");
        expect(processCommands.available).not.toHaveBeenCalled();
    });

    it("POSIX容器使用当前用户写入State Root", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-"));
        roots.push(root);
        const output = await writeDockerCompose({engine: "docker", root, stateRoot: root, cacheRoot: join(root, ".cache"), profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string; volumes: string[]; environment: Record<string, string>}}};
        if (process.platform === "win32") expect(compose.services.app.user).toBeUndefined();
        else expect(compose.services.app.user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
        expect(compose.services.app.volumes).toContain("../.env:/app/.env");
        expect(compose.services.app.volumes).toContain("../tool-state:/app/tool-state");
        expect(compose.services.app.volumes).toContain("../.cache:/app/cache");
        expect(compose.services.app.environment).toMatchObject({
            NEURO_BOOK_APPLICATION_ROOT: "/app",
            NEURO_BOOK_CACHE_ROOT: "/app/cache",
            LLMLINT_HOME: "/app/tool-state/llmlint",
            LLMLINT_CACHE_DIR: "/app/cache/llmlint",
            BUN_INSTALL_CACHE_DIR: "/app/cache/bun/install",
        });
    });

    it("rootless Podman不重复注入宿主UID", async () => {
        processCommands.capture.mockResolvedValue("true\n");
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-podman-"));
        roots.push(root);
        const output = await writeDockerCompose({engine: "podman", root, stateRoot: root, cacheRoot: join(root, ".cache"), profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string}}};
        expect(compose.services.app.user).toBeUndefined();
    });

    it("一次性应用命令覆盖Product ENTRYPOINT并保留参数边界", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-command-"));
        roots.push(root);
        const stateRoot = root;
        await writeDockerCompose({engine: "docker", root, stateRoot, cacheRoot: join(root, ".cache"), profile: "ghcr", image: verifiedImage("docker").configuredImage, port: 3000});

        await expect(runDockerApplicationCommand(verifiedImage("docker"), root, stateRoot, [
            "bun",
            "--no-install",
            ".output/server/commands/product-command.mjs",
            "command",
            "migrate-application-state",
            "--plan",
            "--run-id",
            "operation-state",
        ])).resolves.toBe("migration-report");

        expect(processCommands.capture).toHaveBeenCalledWith("docker", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            join(root, ".deploy", "docker-compose.generated.yml"),
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "bun",
            "app",
            "--no-install",
            ".output/server/commands/product-command.mjs",
            "command",
            "migrate-application-state",
            "--plan",
            "--run-id",
            "operation-state",
        ], {cwd: root});
    });

    it("Fresh Install使用候选Compose完成一次性应用命令", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-candidate-"));
        roots.push(root);
        const staging = join(root, ".deploy", "staging", "operation");
        const stateRoot = join(staging, "migration-plan-state");
        const cacheRoot = join(staging, "migration-plan-cache");
        const composePath = join(staging, "docker-compose.generated.yml");
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot,
            cacheRoot,
            profile: "ghcr",
            image: verifiedImage("docker").configuredImage,
            port: 3000,
            output: composePath,
        });
        const compose = parse(await readFile(composePath, "utf8")) as {services: {app: {volumes: string[]}}};
        expect(compose.services.app.volumes).toContain("./migration-plan-state/workspace:/app/workspace");
        expect(compose.services.app.volumes).toContain("./migration-plan-cache:/app/cache");

        await expect(runDockerApplicationCommand(
            verifiedImage("docker"),
            root,
            stateRoot,
            ["bun", "migration.ts"],
            composePath,
        )).resolves.toBe("migration-report");

        expect(processCommands.capture).toHaveBeenCalledWith("docker", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            composePath,
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "bun",
            "app",
            "migration.ts",
        ], {cwd: root});

        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: verifiedImage("docker").configuredImage,
            port: 3000,
            output: composePath,
            layoutPath: join(root, ".deploy", "docker-compose.generated.yml"),
        });
        const activated = parse(await readFile(composePath, "utf8")) as {services: {app: {volumes: string[]}}};
        expect(activated.services.app.volumes).toContain("../workspace:/app/workspace");
        expect(activated.services.app.volumes).toContain("../.cache:/app/cache");
    });

    it("Podman存在独立provider时Compose固定使用podman-compose provider", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-command-podman-"));
        roots.push(root);
        const stateRoot = root;
        await writeDockerCompose({engine: "podman", root, stateRoot, cacheRoot: join(root, ".cache"), profile: "ghcr", image: verifiedImage("podman").configuredImage, port: 3000});

        await runDockerApplicationCommand(verifiedImage("podman"), root, stateRoot, ["bun", "migration.ts"]);

        expect(processCommands.capture).toHaveBeenCalledWith("podman", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            join(root, ".deploy", "docker-compose.generated.yml"),
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "bun",
            "app",
            "migration.ts",
        ], {
            cwd: root,
            env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"}),
        });
    });

    it("Podman通过原生labels定位app并在停止时保留容器", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-podman-stop-"));
        roots.push(root);
        const stateRoot = root;
        const containerId = "a".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockResolvedValue(containerId);

        await stopDocker("podman", root, stateRoot);

        expect(processCommands.capture).toHaveBeenCalledWith("podman", [
            "ps",
            "--all",
            "--filter",
            `label=com.docker.compose.project.working_dir=${await realpath(join(root, ".deploy"))}`,
            "--filter",
            "label=com.docker.compose.service=app",
            "--format",
            "{{.ID}}",
        ], {cwd: root});
        expect(processCommands.run).toHaveBeenCalledWith("podman", [
            "stop",
            "--time",
            "10",
            containerId,
        ], {cwd: root});
        expect(processCommands.run).not.toHaveBeenCalledWith("podman", expect.arrayContaining(["compose", "stop"]), expect.anything());
    });

    it("Podman停止app时拒绝多容器或非ID输出", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-podman-invalid-"));
        roots.push(root);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockResolvedValue("container-one\ncontainer-two\n");

        await expect(stopDocker("podman", root, root))
            .rejects.toThrow("非法app容器ID");
        expect(processCommands.run).not.toHaveBeenCalled();
    });

    it("Podman状态探测不读取Docker专属Health字段", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-inspect-podman-"));
        roots.push(root);
        const containerId = "b".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) return `${containerId}\n`;
            if (args[0] === "inspect") return containerInspect("running");
            throw new Error(`未预期命令：${args.join(" ")}`);
        });

        await expect(inspectDockerApplication("podman", root, root))
            .resolves.toEqual({
                configuredImage: "ghcr.io/notnotype/neuro-book:test",
                containerId,
                actualImage: "ghcr.io/notnotype/neuro-book:test",
                containerImageId: `sha256:${"a".repeat(64)}`,
                status: "running",
                exitCode: 0,
            });
        expect(processCommands.capture.mock.calls.some(([, args]) => args.includes("{{if .State.Health}}{{.State.Health.Status}}{{end}}")))
            .toBe(false);
        expect(processCommands.capture.mock.calls.some(([, args]) => args.includes("config")))
            .toBe(false);
        expect(processCommands.capture).toHaveBeenCalledWith("podman", [
            "ps",
            "--all",
            "--filter",
            `label=com.docker.compose.project.working_dir=${await realpath(join(root, ".deploy"))}`,
            "--filter",
            "label=com.docker.compose.service=app",
            "--format",
            "{{.ID}}",
        ], {cwd: root});
        expect(processCommands.capture.mock.calls.some(([, args]) => args[0] === "compose" && args.includes("ps")))
            .toBe(false);
    });

    it("Podman使用顶层ImageName并接受未配置healthcheck的原生inspect形状", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-inspect-podman-native-"));
        roots.push(root);
        const containerId = "f".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args[0] === "ps") return `${containerId}\n`;
            if (args[0] === "inspect") return JSON.stringify([{
                Image: "a".repeat(64),
                ImageName: "ghcr.io/notnotype/neuro-book:test",
                Config: {Image: ""},
                State: {Status: "running", ExitCode: 0, Health: {Status: "", FailingStreak: 0, Log: null}},
            }]);
            throw new Error(`未预期命令：${args.join(" ")}`);
        });

        await expect(inspectDockerApplication("podman", root, root))
            .resolves.toMatchObject({
                actualImage: "ghcr.io/notnotype/neuro-book:test",
                containerImageId: `sha256:${"a".repeat(64)}`,
                status: "running",
                exitCode: 0,
            });
    });

    it("一次性应用命令拒绝空命令", async () => {
        await expect(runDockerApplicationCommand(verifiedImage("docker"), "/tmp/neuro-book", "/tmp/neuro-book-state", []))
            .rejects.toThrow("Docker一次性应用命令不能为空");
        expect(processCommands.capture).not.toHaveBeenCalled();
    });

    it("一次性应用命令在spawn前拒绝被改写的Compose image", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-command-tampered-"));
        roots.push(root);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book@sha256:" + "c".repeat(64),
            port: 3000,
        });

        await expect(runDockerApplicationCommand(verifiedImage("docker"), root, root, ["bun", "command.mjs"]))
            .rejects.toThrow("Compose image 与 verified identity 不一致");
        expect(processCommands.capture).not.toHaveBeenCalled();
    });

    it("GHCR拒绝错误digest与错误repository", async () => {
        const product = containerProduct({digest: `sha256:${"d".repeat(64)}`});
        processCommands.capture.mockResolvedValueOnce(imageInspect({
            digest: product.digest,
            repoDigests: [`ghcr.io/other/neuro-book@${product.digest}`],
        }));

        await expect(verifyContainerProductImage("docker", "/tmp/neuro-book", "ghcr", product))
            .rejects.toThrow("未证明目标 digest");

        processCommands.capture.mockResolvedValueOnce(imageInspect({
            digest: `sha256:${"e".repeat(64)}`,
            repoDigests: [`ghcr.io/notnotype/neuro-book@sha256:${"e".repeat(64)}`],
        }));
        await expect(verifyContainerProductImage("docker", "/tmp/neuro-book", "ghcr", product))
            .rejects.toThrow("未证明目标 digest");
    });

    it("GHCR接受同repository的精确digest并返回Engine image ID", async () => {
        const product = containerProduct({digest: `sha256:${"d".repeat(64)}`});
        processCommands.capture.mockResolvedValue(imageInspect({
            digest: product.digest,
            repoDigests: [`ghcr.io/notnotype/neuro-book@${product.digest}`],
        }));

        await expect(verifyContainerProductImage("podman", "/tmp/neuro-book", "ghcr", product))
            .resolves.toMatchObject({
                configuredImage: `ghcr.io/notnotype/neuro-book@${product.digest}`,
                imageId: `sha256:${"a".repeat(64)}`,
            });
    });

    it("Source Docker拒绝tag重绑与缺失镜像", async () => {
        const product = containerProduct({
            image: "neuro-book-source:test",
            digest: undefined,
            containerImageId: `sha256:${"b".repeat(64)}`,
        });
        processCommands.capture.mockResolvedValueOnce(imageInspect({revision: product.revision}));
        await expect(verifyContainerProductImage("docker", "/tmp/neuro-book", "source-docker", product))
            .rejects.toThrow("Source Docker tag 已重绑");

        processCommands.capture.mockRejectedValueOnce(new Error("No such image"));
        await expect(verifyContainerProductImage("docker", "/tmp/neuro-book", "source-docker", product))
            .rejects.toThrow("No such image");
        expect(processCommands.run).not.toHaveBeenCalledWith("docker", expect.arrayContaining(["pull"]), expect.anything());
    });

    it("compose exec前拒绝错误候选Container image ID", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-exec-identity-"));
        roots.push(root);
        const verified = verifiedImage("docker");
        await writeDockerCompose({engine: "docker", root, stateRoot: root, cacheRoot: join(root, ".cache"), profile: "ghcr", image: verified.configuredImage, port: 3000});
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) return `${"f".repeat(64)}\n`;
            if (args[0] === "inspect") return containerInspect("running", undefined, `sha256:${"c".repeat(64)}`);
            throw new Error(`未预期命令：${args.join(" ")}`);
        });

        await expect(verifyRunningDockerApplication(verified, root, root))
            .rejects.toThrow("Container image ID 与 verified identity 不一致");
    });

    it("Source Docker把staged HEAD作为Product Runtime Image revision", async () => {
        const sourceRoot = join(tmpdir(), "nbook-source-docker");
        const revision = "a".repeat(40);
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args[0] === "rev-parse") return `${revision}\n`;
            if (args[0] === "image" && args[1] === "inspect") {
                return JSON.stringify([{
                    Id: `sha256:${"a".repeat(64)}`,
                    RepoDigests: [],
                    Config: {Labels: {"org.opencontainers.image.revision": revision}},
                }]);
            }
            throw new Error(`未预期命令：${args.join(" ")}`);
        });

        await expect(buildSourceDockerImage("docker", sourceRoot, "neuro-book-source:test"))
            .resolves.toBe(`sha256:${"a".repeat(64)}`);

        expect(processCommands.capture).toHaveBeenCalledWith("git", ["rev-parse", "--verify", "HEAD"], {cwd: sourceRoot});
        expect(processCommands.run).toHaveBeenCalledWith("docker", [
            "build",
            "--file",
            join(sourceRoot, "Dockerfile"),
            "--build-arg",
            `NEURO_BOOK_SOURCE_REVISION=${revision}`,
            "--tag",
            "neuro-book-source:test",
            sourceRoot,
        ], {cwd: sourceRoot});
    });

    it("Source Docker拒绝无法证明的staged revision", async () => {
        processCommands.capture.mockResolvedValue("not-a-revision\n");

        await expect(buildSourceDockerImage("podman", "/tmp/neuro-book", "neuro-book-source:test"))
            .rejects.toThrow("无法读取有效revision");
        expect(processCommands.run).not.toHaveBeenCalled();
    });

    it("已有running容器只验证版本，不发布候选也不执行Compose up", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-owned-launch-"));
        roots.push(root);
        const containerId = "c".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) return `${containerId}\n`;
            if (args[0] === "inspect") return containerInspect("running", "healthy");
            throw new Error(`未预期命令：${args.join(" ")}`);
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({versionLabel: "v0.9.0"}),
        } as Response);
        const started: string[] = [];
        const starting = vi.fn();
        try {
            await startDocker(verifiedImage("docker"), root, root, "ghcr", "0.9.0", starting, async (id) => {
                started.push(id);
            });
        } finally {
            fetchMock.mockRestore();
        }

        expect(starting).not.toHaveBeenCalled();
        expect(started).toEqual([]);
        expect(processCommands.run).not.toHaveBeenCalled();
    });

    it.each(["stopped", "missing"] as const)("%s容器启动后发布精确候选ID", async (previousState) => {
        const root = await mkdtemp(join(tmpdir(), `nbook-compose-${previousState}-launch-`));
        roots.push(root);
        const containerId = "d".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        let psCalls = 0;
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) {
                psCalls += 1;
                return previousState === "missing" && psCalls === 1 ? "" : `${containerId}\n`;
            }
            if (args[0] === "inspect") return containerInspect("exited");
            throw new Error(`未预期命令：${args.join(" ")}`);
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({versionLabel: "v0.9.0"}));
        const checkpoints: string[] = [];
        try {
            await startDocker(
                verifiedImage("docker"),
                root,
                root,
                "ghcr",
                "0.9.0",
                async () => { checkpoints.push("starting"); },
                async (id) => { checkpoints.push(`started:${id}`); },
            );
        } finally {
            fetchMock.mockRestore();
        }

        expect(checkpoints).toEqual(["starting", `started:${containerId}`]);
        expect(processCommands.run).toHaveBeenCalledWith("docker", expect.arrayContaining(["pull", "app"]), {cwd: root});
        expect(processCommands.run).toHaveBeenCalledWith("docker", expect.arrayContaining(["up", "-d"]), {cwd: root});
    });

    it("候选镜像身份错误时仍先发布精确容器ID供事务回收", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-invalid-candidate-launch-"));
        roots.push(root);
        const containerId = "1".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        let psCalls = 0;
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) {
                psCalls += 1;
                return psCalls === 1 ? "" : `${containerId}\n`;
            }
            if (args[0] === "inspect") return containerInspect("running", undefined, `sha256:${"9".repeat(64)}`);
            throw new Error(`未预期命令：${args.join(" ")}`);
        });
        const started = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);

        await expect(startDocker(verifiedImage("docker"), root, root, "ghcr", "0.9.0", undefined, started))
            .rejects.toThrow("Container image ID 与 verified identity 不一致");
        expect(started).toHaveBeenCalledWith(containerId);
    });

    it("Podman启动后通过原生labels发布精确候选ID", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-podman-launch-"));
        roots.push(root);
        const containerId = "e".repeat(64);
        processCommands.capture.mockResolvedValue("true\n");
        await writeDockerCompose({
            engine: "podman",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockReset();
        let psCalls = 0;
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args[0] === "ps") {
                psCalls += 1;
                return psCalls === 1 ? "" : `${containerId}\n`;
            }
            if (args[0] === "inspect") return containerInspect("running");
            throw new Error(`未预期命令：${args.join(" ")}`);
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({versionLabel: "v0.9.0"}));
        const started = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
        try {
            await startDocker(verifiedImage("podman"), root, root, "ghcr", "0.9.0", undefined, started);
        } finally {
            fetchMock.mockRestore();
        }

        expect(started).toHaveBeenCalledWith(containerId);
        expect(processCommands.capture).toHaveBeenCalledWith("podman", [
            "ps",
            "--all",
            "--filter",
            `label=com.docker.compose.project.working_dir=${await realpath(join(root, ".deploy"))}`,
            "--filter",
            "label=com.docker.compose.service=app",
            "--format",
            "{{.ID}}",
        ], {cwd: root});
    });
});

/** Docker Adapter 单元测试使用的已验证镜像句柄。 */
function verifiedImage(engine: ContainerEngine): VerifiedContainerImage {
    return {
        engine,
        configuredImage: "ghcr.io/notnotype/neuro-book:test",
        imageId: `sha256:${"a".repeat(64)}`,
        profile: "ghcr",
        revision: "b".repeat(40),
    };
}

/** 生成 Docker/Podman 共用的原始 container inspect fixture。 */
function containerInspect(status: string, health?: string, imageId = `sha256:${"a".repeat(64)}`): string {
    return JSON.stringify([{
        Image: imageId,
        Config: {Image: "ghcr.io/notnotype/neuro-book:test"},
        State: {
            Status: status,
            ExitCode: 0,
            ...(health ? {Health: {Status: health}} : {}),
        },
    }]);
}

/** 建立容器Product fixture。 */
function containerProduct(overrides: Partial<Extract<ProductComponent, {provider: "container"}>> = {}): Extract<ProductComponent, {provider: "container"}> {
    return {
        provider: "container",
        version: "0.9.0",
        revision: "b".repeat(40),
        image: "ghcr.io/notnotype/neuro-book:test",
        digest: `sha256:${"d".repeat(64)}`,
        ...overrides,
    };
}

/** 生成 Docker/Podman 共用的原始 image inspect fixture。 */
function imageInspect(input: {digest?: string; repoDigests?: string[]; revision?: string} = {}): string {
    return JSON.stringify([{
        Id: `sha256:${"a".repeat(64)}`,
        ...(input.digest ? {Digest: input.digest} : {}),
        RepoDigests: input.repoDigests ?? [],
        Config: {Labels: input.revision ? {"org.opencontainers.image.revision": input.revision} : {}},
    }]);
}
