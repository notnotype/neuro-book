import {readFile, realpath} from "node:fs/promises";
import {dirname, isAbsolute, join, relative} from "node:path";
import {Type, type Static} from "typebox";
import {Value} from "typebox/value";
import {parse, stringify} from "yaml";

import {resolveStateDatabaseUrl} from "#manager/config";
import {writeTextAtomic} from "#manager/files";
import {statePort} from "#manager/health";
import {commandAvailable, run, runCapture} from "#manager/process";
import type {CommandInspection, ContainerEngine, InstallProfile, ProductComponent} from "#manager/types";
import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

const ComposeSchema = Type.Object({
    services: Type.Object({
        app: Type.Object({image: Type.String({minLength: 1})}, {additionalProperties: true}),
    }, {additionalProperties: false}),
}, {additionalProperties: true});

type ComposeValue = Static<typeof ComposeSchema>;

const ImageInspectSchema = Type.Array(Type.Object({
    Id: Type.String({minLength: 1}),
    Digest: Type.Optional(Type.String({minLength: 1})),
    RepoDigests: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    Config: Type.Object({
        Labels: Type.Optional(Type.Union([
            Type.Null(),
            Type.Record(Type.String(), Type.String()),
        ])),
    }, {additionalProperties: true}),
}, {additionalProperties: true}), {minItems: 1, maxItems: 1});

const ContainerInspectSchema = Type.Array(Type.Object({
    Image: Type.String({minLength: 1}),
    ImageName: Type.Optional(Type.String({minLength: 1})),
    Config: Type.Object({Image: Type.Optional(Type.String())}, {additionalProperties: true}),
    State: Type.Object({
        Status: Type.String({minLength: 1}),
        ExitCode: Type.Integer(),
        Health: Type.Optional(Type.Union([
            Type.Null(),
            // Podman 4.9.3在没有healthcheck时仍输出Health对象，但Status为空字符串。
            Type.Object({Status: Type.String()}, {additionalProperties: true}),
        ])),
    }, {additionalProperties: true}),
}, {additionalProperties: true}), {minItems: 1, maxItems: 1});

type ImageInspectValue = Static<typeof ImageInspectSchema>[number];
type ContainerInspectValue = Static<typeof ContainerInspectSchema>[number];

/** Container Engine 已解析并与 Installation Manifest 一致的不可变镜像身份。 */
export type VerifiedContainerImage = Readonly<{
    engine: ContainerEngine;
    configuredImage: string;
    imageId: string;
    profile: "ghcr" | "source-docker";
    revision: string;
}>;

/** Docker app容器的轻量运行状态，不执行HTTP健康检查。 */
export type DockerApplicationInspection = {
    configuredImage: string;
    /** 尚未创建容器时为空。 */
    containerId?: string;
    /** 容器存在时由docker inspect返回。 */
    actualImage?: string;
    /** 容器实际引用的 Engine content ID。 */
    containerImageId?: string;
    /** 容器存在时由docker inspect返回。 */
    status?: string;
    /** 容器退出时用于区分正常停止与崩溃。 */
    exitCode?: number;
    /** Compose未声明healthcheck时为空。 */
    health?: string;
};

/** 一次Container Engine探测的CLI、Compose与daemon证据。 */
export type ContainerEngineInspection = {
    engine: ContainerEngine;
    command: CommandInspection;
    compose: CommandInspection;
    daemonAvailable: boolean;
    /** 任一必需能力不可用时给出完整原因。 */
    error?: string;
};

/** 新安装可用的Container Engine及全部候选探测结果。 */
export type ContainerEngineSelection = {
    engine: ContainerEngine | null;
    inspections: ContainerEngineInspection[];
    /** 配置非法或全部候选失败时存在。 */
    error?: string;
};

/**
 * 为新安装选择并验证Container Engine。
 *
 * 已安装实例不得调用此函数重新选择，必须使用Manifest或Journal中的固定值。
 */
export async function resolveContainerEngine(preferred?: ContainerEngine): Promise<ContainerEngine> {
    const selection = await inspectContainerEngines(preferred);
    if (selection.engine) return selection.engine;
    throw new Error(selection.error ?? "未检测到可用的 Docker 或 Podman。");
}

/** 一次探测并选择新安装使用的Container Engine；不修改任何容器状态。 */
export async function inspectContainerEngines(preferred?: ContainerEngine): Promise<ContainerEngineSelection> {
    let configured: ContainerEngine | undefined;
    try {
        configured = preferred ?? configuredContainerEngine();
    } catch (error) {
        return {engine: null, inspections: [], error: error instanceof Error ? error.message : String(error)};
    }
    const candidates = configured ? [configured] : ["docker", "podman"] as const;
    const inspections: ContainerEngineInspection[] = [];
    for (const candidate of candidates) {
        const inspection = await inspectContainerEngine(candidate);
        inspections.push(inspection);
        if (!inspection.error) return {engine: candidate, inspections};
    }
    return {
        engine: null,
        inspections,
        error: `未检测到可用的 Docker 或 Podman。\n${inspections.map((item) => `${item.engine}: ${item.error}`).join("\n")}`,
    };
}

/** 生成完整 Docker Compose，不依赖仓库根旧模板。 */
export async function writeDockerCompose(input: {
    engine: ContainerEngine;
    root: string;
    stateRoot: string;
    cacheRoot: string;
    profile: "source-docker" | "ghcr";
    image: string;
    port: number;
    output?: string;
    /** staging 写入时按最终 Compose 位置计算相对 volume。 */
    layoutPath?: string;
}): Promise<string> {
    const composePath = input.output ?? join(input.root, ".deploy", "docker-compose.generated.yml");
    const stateRelative = composeBindSource(input.layoutPath ?? composePath, input.stateRoot);
    const cacheRelative = composeBindSource(input.layoutPath ?? composePath, input.cacheRoot);
    const database = resolveAppSqliteLocation(await resolveStateDatabaseUrl(input.stateRoot), input.stateRoot);
    if (!database.containerUrl) throw new Error("Docker Profile的App SQLite必须位于State Root内。" );
    const service = input.profile === "ghcr"
        ? {
            image: input.image,
            environment: commonEnvironment(input.port, database.containerUrl),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/.env:/app/.env`,
                `${stateRelative}/logs:/app/logs`,
                `${stateRelative}/tool-state:/app/tool-state`,
                `${cacheRelative}:/app/cache`,
            ],
            restart: "unless-stopped",
        }
        : {
            image: input.image,
            environment: commonEnvironment(input.port, database.containerUrl),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/.env:/app/.env`,
                `${stateRelative}/logs:/app/logs`,
                `${stateRelative}/tool-state:/app/tool-state`,
                `${cacheRelative}:/app/cache`,
            ],
            restart: "unless-stopped",
        };
    if (process.platform !== "win32" && typeof process.getuid === "function" && typeof process.getgid === "function" && !await isRootlessPodman(input.engine)) {
        Object.assign(service, {user: `${process.getuid()}:${process.getgid()}`});
    }
    await writeTextAtomic(composePath, stringify({services: {app: service}}));
    return composePath;
}

/** 生成Compose可识别的bind source；普通相对路径必须带`.`前缀，否则会被解释为named volume。 */
function composeBindSource(layoutPath: string, hostRoot: string): string {
    const path = relative(dirname(layoutPath), hostRoot);
    if (!path) return ".";
    const normalized = path.replaceAll("\\", "/");
    if (isAbsolute(path) || normalized.startsWith(".")) return normalized;
    return `./${normalized}`;
}

/** 验证 Docker Profile 的基础 HTTP 与版本接口。 */
export async function verifyDockerApplication(port: number, expectedVersion: string): Promise<void> {
    const deadline = Date.now() + 45_000;
    let lastError = "容器尚未响应";
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
            if (response.ok) {
                const value = await response.json() as {versionLabel?: string};
                const expected = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
                if (value.versionLabel !== expected) throw new Error(`容器版本为 ${value.versionLabel ?? "<missing>"}，期望 ${expected}。`);
                return;
            }
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    throw new Error(`Docker HTTP 健康检查超时：${lastError}`);
}

/** 启动 Docker Profile，并在健康检查前发布本次候选容器的精确身份。 */
export async function startDocker(
    verifiedImage: VerifiedContainerImage,
    root: string,
    stateRoot: string,
    profile: InstallProfile,
    expectedVersion: string,
    onStarting?: () => Promise<void>,
    onStarted?: (containerId: string) => Promise<void>,
): Promise<void> {
    const engine = verifiedImage.engine;
    const existing = await inspectDockerApplication(engine, root, stateRoot);
    if (existing.containerId && existing.status === "running") {
        assertContainerUsesVerifiedImage(existing, verifiedImage);
        await verifyDockerApplication(await statePort(stateRoot), expectedVersion);
        return;
    }
    const compose = join(root, ".deploy", "docker-compose.generated.yml");
    const args = ["compose", "--env-file", join(stateRoot, ".env"), "-f", compose];
    if (profile === "ghcr") {
        await run(engine, [...args, "pull", "app"], await containerComposeOptions(engine, root));
        await onStarting?.();
        await run(engine, [...args, "up", "-d"], await containerComposeOptions(engine, root));
    } else {
        await onStarting?.();
        await run(engine, [...args, "up", "-d"], await containerComposeOptions(engine, root));
    }
    const containerId = await readApplicationContainerId(engine, root, stateRoot);
    if (!containerId) throw new Error("Compose启动后未返回app容器ID。");
    // ID已由当前Compose的唯一ownership label解析；先发布所有权，后续身份门禁失败时
    // 调用方才能精确停止本次候选，而不是遗留无法恢复的planned container effect。
    await onStarted?.(containerId);
    assertContainerUsesVerifiedImage(await inspectDockerApplication(engine, root, stateRoot), verifiedImage);
    await verifyDockerApplication(await statePort(stateRoot), expectedVersion);
}

/** 读取当前执行所用generated Compose中的固定app镜像，不依赖宿主Docker。 */
export async function readDockerComposeImage(root: string, composePath = join(root, ".deploy", "docker-compose.generated.yml")): Promise<string> {
    // YAML是外部文件，必须先作为unknown通过TypeBox门禁后才能读取字段。
    const value: unknown = parse(await readFile(composePath, "utf8"));
    if (!Value.Check(ComposeSchema, value)) {
        throw new Error(`generated Compose缺少services.app.image：${composePath}`);
    }
    return (value as ComposeValue).services.app.image;
}

/** 读取Compose配置与app容器状态；容器未创建是合法结果。 */
export async function inspectDockerApplication(engine: ContainerEngine, root: string, stateRoot: string): Promise<DockerApplicationInspection> {
    // generated Compose由Manager写入并已通过严格Schema门禁；不要依赖各Compose provider不一致的`config --images`扩展。
    const configuredImage = await readDockerComposeImage(root);
    const containerId = await readApplicationContainerId(engine, root, stateRoot);
    if (!containerId) return {configuredImage};
    const inspected = parseContainerInspect(await runCapture(engine, ["inspect", containerId], {cwd: root}));
    const actualImage = engine === "podman"
        ? inspected.ImageName ?? inspected.Config.Image
        : inspected.Config.Image;
    if (!actualImage) {
        throw new Error(`${engine} container inspect 缺少原始镜像引用。`);
    }
    return {
        configuredImage,
        containerId,
        actualImage,
        containerImageId: normalizeEngineImageId(inspected.Image),
        status: inspected.State.Status,
        exitCode: inspected.State.ExitCode,
        ...(inspected.State.Health?.Status ? {health: inspected.State.Health.Status} : {}),
    };
}

/** 在切换Compose或备份SQLite前停止受管app容器。 */
export async function stopDocker(engine: ContainerEngine, root: string, stateRoot: string): Promise<void> {
    if (engine === "docker") {
        await run(engine, [...composeArgs(root, stateRoot), "stop", "app"], await containerComposeOptions(engine, root));
        return;
    }
    const containerId = await readApplicationContainerId(engine, root, stateRoot);
    if (!containerId) return;
    // podman-compose 1.0.6的`stop`会连带rm；原生stop保留容器供doctor、restart和事务恢复。
    await run(engine, ["stop", "--time", "10", containerId], {cwd: root});
}

/** 只终止调用方持有身份的候选容器，不重新解释当前 Compose ownership。 */
export async function stopDockerContainer(engine: ContainerEngine, root: string, containerId: string): Promise<void> {
    if (!/^[a-f0-9]{12,64}$/u.test(containerId)) {
        throw new Error(`拒绝停止非法候选容器ID：${containerId || "<missing>"}`);
    }
    await run(engine, ["stop", "--time", "10", containerId], {cwd: root});
}

/** 回滚或Fresh Install失败时移除当前Compose创建的容器与网络。 */
export async function removeDockerDeployment(engine: ContainerEngine, root: string, stateRoot: string): Promise<void> {
    await run(engine, [...composeArgs(root, stateRoot), "down", "--remove-orphans"], await containerComposeOptions(engine, root));
}

/** 删除Source Docker事务创建但未提交的本地镜像。 */
export async function removeDockerImage(engine: ContainerEngine, root: string, image: string): Promise<void> {
    await run(engine, ["image", "rm", image], {cwd: root, stdio: "ignore"});
}

/** 在当前Compose的app镜像中执行一次性命令，不启动依赖或长期服务。 */
export async function runDockerApplicationCommand(
    verifiedImage: VerifiedContainerImage,
    root: string,
    stateRoot: string,
    command: string[],
    composePath?: string,
): Promise<string> {
    const engine = verifiedImage.engine;
    const [entrypoint, ...args] = command;
    if (!entrypoint) throw new Error("Docker一次性应用命令不能为空。");
    assertContainerUsesVerifiedImage({
        configuredImage: await readDockerComposeImage(root, composePath),
    }, verifiedImage);
    return runCapture(engine, [
        ...composeArgs(root, stateRoot, composePath),
        "run",
        "--rm",
        "--no-deps",
        // Product镜像的正式ENTRYPOINT负责迁移并启动长期服务；维护命令必须显式绕过它。
        "--entrypoint",
        entrypoint,
        "app",
        ...args,
    ], await containerComposeOptions(engine, root));
}

/** 从 staged Git worktree 构建带 revision tag 的 Source Docker image。 */
export async function buildSourceDockerImage(engine: ContainerEngine, sourceRoot: string, image: string): Promise<string> {
    const revision = (await runCapture("git", ["rev-parse", "--verify", "HEAD"], {cwd: sourceRoot})).trim().toLowerCase();
    if (!/^[a-f0-9]{40,64}$/u.test(revision)) {
        throw new Error(`Source Docker无法读取有效revision：${revision || "<missing>"}`);
    }
    await run(engine, [
        "build",
        "--file",
        join(sourceRoot, "Dockerfile"),
        "--build-arg",
        `NEURO_BOOK_SOURCE_REVISION=${revision}`,
        "--tag",
        image,
        sourceRoot,
    ], {cwd: sourceRoot});
    const inspected = await inspectContainerImage(engine, image, sourceRoot);
    const labelRevision = inspected.Config.Labels?.["org.opencontainers.image.revision"];
    if (labelRevision !== revision) {
        throw new Error(`Source Docker image revision label 不一致：expected=${revision} actual=${labelRevision ?? "<missing>"}`);
    }
    return normalizeEngineImageId(inspected.Id);
}

/**
 * 物化并验证 Installation Manifest 声明的 Container Product。
 * GHCR 使用 repository@digest；Source Docker 使用 build 时登记的 Engine image ID 与 revision label。
 */
export async function verifyContainerProductImage(
    engine: ContainerEngine,
    root: string,
    profile: InstallProfile,
    product: Extract<ProductComponent, {provider: "container"}>,
): Promise<VerifiedContainerImage> {
    if (profile !== "ghcr" && profile !== "source-docker") {
        throw new Error(`${profile} 不是 Container Product profile。`);
    }
    const configuredImage = containerProductImageReference(profile, product);
    let inspected: ImageInspectValue;
    try {
        inspected = await inspectContainerImage(engine, configuredImage, root);
    } catch (error) {
        if (profile !== "ghcr") throw error;
        await run(engine, ["pull", configuredImage], {cwd: root});
        inspected = await inspectContainerImage(engine, configuredImage, root);
    }
    const imageId = normalizeEngineImageId(inspected.Id);
    if (profile === "ghcr") {
        const digest = requiredDigest(product);
        const digestReference = immutableGhcrReference(product.image, digest);
        const repoDigests = inspected.RepoDigests ?? [];
        const digestMatches = repoDigests.length > 0
            ? repoDigests.includes(digestReference)
            : inspected.Digest === digest;
        if (!digestMatches) {
            throw new Error(`GHCR image inspect 未证明目标 digest：${digestReference}`);
        }
    } else {
        if (!product.containerImageId || imageId !== normalizeEngineImageId(product.containerImageId)) {
            throw new Error(`Source Docker tag 已重绑：expected=${product.containerImageId ?? "<missing>"} actual=${imageId}`);
        }
        const labelRevision = inspected.Config.Labels?.["org.opencontainers.image.revision"];
        if (labelRevision !== product.revision) {
            throw new Error(`Source Docker image revision label 不一致：expected=${product.revision} actual=${labelRevision ?? "<missing>"}`);
        }
    }
    return Object.freeze({engine, configuredImage, imageId, profile, revision: product.revision});
}

/** 返回 Compose 与 Container Config.Image 必须使用的不可变引用。 */
export function containerProductImageReference(
    profile: InstallProfile,
    product: Extract<ProductComponent, {provider: "container"}>,
): string {
    return profile === "ghcr"
        ? immutableGhcrReference(product.image, requiredDigest(product))
        : product.image;
}

/** 候选或既有 app 容器必须同时匹配 immutable Config.Image 与 Engine content ID。 */
export function assertContainerUsesVerifiedImage(
    inspection: DockerApplicationInspection,
    verifiedImage: VerifiedContainerImage,
): void {
    if (inspection.configuredImage !== verifiedImage.configuredImage) {
        throw new Error(`Compose image 与 verified identity 不一致：expected=${verifiedImage.configuredImage} actual=${inspection.configuredImage}`);
    }
    if (!inspection.containerId) return;
    if (inspection.actualImage !== verifiedImage.configuredImage) {
        throw new Error(`Container Config.Image 与 verified identity 不一致：expected=${verifiedImage.configuredImage} actual=${inspection.actualImage ?? "<missing>"}`);
    }
    if (inspection.containerImageId !== verifiedImage.imageId) {
        throw new Error(`Container image ID 与 verified identity 不一致：expected=${verifiedImage.imageId} actual=${inspection.containerImageId ?? "<missing>"}`);
    }
}

/** compose exec 前确认当前运行容器仍属于 verified image。 */
export async function verifyRunningDockerApplication(
    verifiedImage: VerifiedContainerImage,
    root: string,
    stateRoot: string,
): Promise<DockerApplicationInspection> {
    const inspection = await inspectDockerApplication(verifiedImage.engine, root, stateRoot);
    if (!inspection.containerId || inspection.status !== "running") {
        throw new Error(`Product容器未运行：${inspection.status ?? "missing"}`);
    }
    assertContainerUsesVerifiedImage(inspection, verifiedImage);
    return inspection;
}

/** 读取并严格解析单个 Engine image inspect JSON。 */
async function inspectContainerImage(engine: ContainerEngine, image: string, cwd: string): Promise<ImageInspectValue> {
    const value: unknown = JSON.parse(await runCapture(engine, ["image", "inspect", image], {cwd}));
    if (!Value.Check(ImageInspectSchema, value)) {
        throw new Error(`${engine} image inspect 返回了无效 JSON：${image}`);
    }
    return (value as Static<typeof ImageInspectSchema>)[0]!;
}

/** 读取并严格解析单个 app container inspect JSON。 */
function parseContainerInspect(text: string): ContainerInspectValue {
    const value: unknown = JSON.parse(text);
    if (!Value.Check(ContainerInspectSchema, value)) {
        throw new Error("Container inspect 返回了无效 JSON。");
    }
    return (value as Static<typeof ContainerInspectSchema>)[0]!;
}

/** 统一 Docker `sha256:` 与 Podman 纯 hex 的 Engine image ID 形式。 */
function normalizeEngineImageId(value: string): string {
    const normalized = value.trim().toLowerCase();
    const digest = normalized.startsWith("sha256:") ? normalized.slice("sha256:".length) : normalized;
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
        throw new Error(`Container Engine 返回了非法 image ID：${value || "<missing>"}`);
    }
    return `sha256:${digest}`;
}

/** 从 tag/ref 提取 repository，并拼出唯一 OCI digest reference。 */
function immutableGhcrReference(image: string, digest: string): string {
    const withoutDigest = image.split("@")[0]!;
    const slash = withoutDigest.lastIndexOf("/");
    const colon = withoutDigest.lastIndexOf(":");
    const repository = colon > slash ? withoutDigest.slice(0, colon) : withoutDigest;
    if (!repository || !repository.includes("/")) {
        throw new Error(`GHCR image repository 无效：${image}`);
    }
    return `${repository}@${digest}`;
}

/** GHCR Product 必须携带 OCI digest。 */
function requiredDigest(product: Extract<ProductComponent, {provider: "container"}>): string {
    if (!product.digest) throw new Error("GHCR Product 缺少 OCI digest。");
    return product.digest.toLowerCase();
}

/** 生成所有Docker生命周期命令共用的Compose参数。 */
function composeArgs(root: string, stateRoot: string, composePath?: string): string[] {
    return ["compose", "--env-file", join(stateRoot, ".env"), "-f", composePath ?? join(root, ".deploy", "docker-compose.generated.yml")];
}

/** 读取Manager生成的唯一app容器ID。 */
async function readApplicationContainerId(engine: ContainerEngine, root: string, stateRoot: string): Promise<string | undefined> {
    // podman-compose 1.0.6会把provider诊断与ID混入stdout，不能作为机器可读接口。
    let output: string;
    if (engine === "podman") {
        // provider也使用Compose目录的realpath写label，查询必须采用相同身份。
        const composeWorkingDirectory = await realpath(join(root, ".deploy"));
        output = await runCapture(engine, [
            "ps",
            "--all",
            "--filter",
            `label=com.docker.compose.project.working_dir=${composeWorkingDirectory}`,
            "--filter",
            "label=com.docker.compose.service=app",
            "--format",
            "{{.ID}}",
        ], {cwd: root});
    } else {
        output = await runCapture(
            engine,
            [...composeArgs(root, stateRoot), "ps", "--all", "--quiet", "app"],
            await containerComposeOptions(engine, root),
        );
    }
    const containerIds = output
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter(Boolean);
    if (containerIds.length === 0) return undefined;
    const containerId = containerIds[0];
    if (containerIds.length !== 1 || !containerId || !/^[a-f0-9]{12,64}$/u.test(containerId)) {
        throw new Error(`${engine}返回了非法app容器ID：${containerIds.join(", ") || "<missing>"}`);
    }
    return containerId;
}

/** Podman有独立provider时固定使用它；缺少时保留用户的provider环境变量。 */
export async function containerComposeEnvironment(engine: ContainerEngine): Promise<NodeJS.ProcessEnv> {
    if (engine !== "podman") return process.env;
    if (!await commandAvailable("podman-compose")) return process.env;
    return {...process.env, PODMAN_COMPOSE_PROVIDER: "podman-compose"};
}

/** 为所有Compose调用提供一致的工作目录与Podman provider合同。 */
export async function containerComposeOptions(engine: ContainerEngine, cwd: string): Promise<{cwd: string; env?: NodeJS.ProcessEnv}> {
    return engine === "podman" ? {cwd, env: await containerComposeEnvironment(engine)} : {cwd};
}

function commonEnvironment(port: number, databaseUrl: string): Record<string, string> {
    return {
        HOST: "0.0.0.0",
        PORT: String(port),
        NUXT_PORT: String(port),
        DATABASE_KIND: "sqlite",
        DATABASE_URL: databaseUrl,
        NEURO_BOOK_APPLICATION_ROOT: "/app",
        NEURO_BOOK_STATE_ROOT: "/app",
        NEURO_BOOK_CACHE_ROOT: "/app/cache",
        LLMLINT_HOME: "/app/tool-state/llmlint",
        LLMLINT_CACHE_DIR: "/app/cache/llmlint",
        BUN_INSTALL_CACHE_DIR: "/app/cache/bun/install",
    };
}

/** rootless Podman已把容器root映射为宿主用户，不能再次注入宿主UID。 */
async function isRootlessPodman(engine: ContainerEngine): Promise<boolean> {
    if (engine !== "podman") return false;
    return (await runCapture(engine, ["info", "--format", "{{.Host.Security.Rootless}}"])).trim() === "true";
}

/** 只接受正式支持的Container Engine名称，禁止把环境变量当任意命令入口。 */
function configuredContainerEngine(): ContainerEngine | undefined {
    const value = process.env.NEURO_BOOK_CONTAINER_ENGINE?.trim();
    if (!value) return undefined;
    if (value !== "docker" && value !== "podman") {
        throw new Error(`NEURO_BOOK_CONTAINER_ENGINE只接受docker或podman，当前值为${value}。`);
    }
    return value;
}

/** 验证CLI、Compose子命令和Engine daemon/machine并保留一次探测结果。 */
async function inspectContainerEngine(engine: ContainerEngine): Promise<ContainerEngineInspection> {
    let command: CommandInspection;
    try {
        const version = (await runCapture(engine, ["--version"])).split(/\r?\n/u)[0]?.trim();
        command = {available: true, ...(version ? {version} : {})};
    } catch (error) {
        return {
            engine,
            command: {available: false},
            compose: {available: false},
            daemonAvailable: false,
            error: `系统中未找到${engine}命令：${error instanceof Error ? error.message : String(error)}`,
        };
    }
    let compose: CommandInspection;
    try {
        const version = (await runCapture(engine, ["compose", "version"], {
            env: await containerComposeEnvironment(engine),
        })).split(/\r?\n/u)[0]?.trim();
        compose = {available: true, ...(version ? {version} : {})};
    } catch (error) {
        return {
            engine,
            command,
            compose: {available: false},
            daemonAvailable: false,
            error: `${engine} compose不可用：${error instanceof Error ? error.message : String(error)}`,
        };
    }
    try {
        await runCapture(engine, ["info"]);
        return {engine, command, compose, daemonAvailable: true};
    } catch (error) {
        return {
            engine,
            command,
            compose,
            daemonAvailable: false,
            error: `${engine} daemon或machine不可用：${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
