import {createConnection} from "node:net";
import {readFile, readdir} from "node:fs/promises";
import {join, resolve} from "node:path";

import {commandStatus} from "#manager/app-commands";
import {resolveStateDatabaseUrl} from "#manager/config";
import {containerProductImageReference, inspectDockerApplication, readDockerComposeImage} from "#manager/docker";
import {pathExists, sha256File} from "#manager/files";
import {assertCleanWorktree, repositoryRevision, validateRepository} from "#manager/git";
import {statePort} from "#manager/health";
import {installationPaths} from "#manager/paths";
import {assertInstallationHostCompatible} from "#manager/platform";
import {verifyInstalledProductRuntimeControlPlane, verifyInstalledProductRuntimeImage} from "#manager/product";
import {runCapture} from "#manager/process";
import {installationRootDataPaths} from "#manager/root-locators";
import {isCanonicalMachineInstallationRoot, renderManagerWrapper, renderRuntimeWrapper} from "#manager/runtime";
import {parseInstallationManifest} from "#manager/schema";
import {formatStateRootIntegrityWarning, inspectInstallationStateIntegrity, stateRootIntegrityFailed} from "#manager/state-integrity";
import {renderToolWrapper} from "#manager/tools";
import type {
    CommandInspection,
    DoctorReport,
    InstallationCheck,
    InstallationManifest,
    InstallationServiceStatus,
    InstallationStatus,
    ManagedRuntimeComponent,
    SystemRuntimeComponent,
    SystemToolComponent,
} from "#manager/types";
import {MANAGER_VERSION} from "#manager/version-info";
import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

/** 离线完整性检查结果；导入与doctor共用，不包含服务是否运行。 */
export type InstallationIntegrityInspection = {
    checks: InstallationCheck[];
    operations: string[];
    stateIntegrity: Awaited<ReturnType<typeof inspectInstallationStateIntegrity>>;
};

/** 执行完整离线检查，包括checksum、版本、wrapper、Source和State Root。 */
export async function inspectInstallationIntegrity(root: string, manifest: InstallationManifest): Promise<InstallationIntegrityInspection> {
    const absoluteRoot = resolve(root);
    const paths = installationPaths(absoluteRoot, manifest.roots);
    const stateRoot = paths.state;
    const checks: InstallationCheck[] = [];
    try {
        parseInstallationManifest(manifest);
        pass(checks, "manifest.schema", "manifest", "Installation Manifest v5语义有效");
    } catch (error) {
        fail(checks, "manifest.schema", "manifest", errorMessage(error), "重新安装该实例；Manager不迁移旧Installation Manifest。" );
    }
    let hostCompatible = true;
    try {
        assertInstallationHostCompatible(manifest);
        pass(checks, "manifest.host", "manifest", "实例Profile与Product平台兼容当前原生宿主");
    } catch (error) {
        hostCompatible = false;
        fail(checks, "manifest.host", "manifest", errorMessage(error), "在当前平台重新安装，并复用原State Root。" );
    }

    if (manifest.managerVersion === manifest.components.manager.version) {
        pass(checks, "manager.version", "manager", `Manager版本为${manifest.managerVersion}`);
    } else {
        fail(checks, "manager.version", "manager", `Manifest Manager版本${manifest.managerVersion}与组件版本${manifest.components.manager.version}不一致`, "重新运行Manager更新。" );
    }
    await checkChecksum(checks, "manager.bundle", "manager", resolve(absoluteRoot, manifest.components.manager.path), manifest.components.manager.bundleSha256);
    if (hostCompatible) {
        await checkRuntime(checks, absoluteRoot, "runtime.manager", manifest.components.managerRuntime);
        if (manifest.components.applicationRuntime.provider !== "container") {
            await checkRuntime(checks, absoluteRoot, "runtime.application", manifest.components.applicationRuntime);
        }
        await checkWrappers(checks, absoluteRoot, manifest);
        await checkTools(checks, absoluteRoot, manifest);
    }
    await checkSource(checks, absoluteRoot, manifest);
    await checkProduct(checks, absoluteRoot, manifest);
    await checkState(checks, stateRoot);
    try {
        const database = resolveAppSqliteLocation(await resolveStateDatabaseUrl(stateRoot), stateRoot);
        if ((manifest.profile === "ghcr" || manifest.profile === "source-docker") && database.scope === "external") {
            fail(checks, "state.database-location", "state", `Docker Profile配置了State Root外数据库：${database.hostPath}`, "将DATABASE_URL改回State Root内的相对file URL；Manager不会猜测外部volume。" );
        } else if (manifest.profile === "windows-portable" && database.scope === "external") {
            warn(checks, "state.database-location", "state", `Portable使用外部SQLite，移动data/时不会携带数据库：${database.hostPath}`, "建议将DATABASE_URL改回file:./workspace/.nbook/neuro-book.sqlite并人工迁移数据。" );
        } else {
            pass(checks, "state.database-location", "state", `App SQLite位置有效：${database.hostPath}`);
        }
    } catch (error) {
        fail(checks, "state.database-location", "state", errorMessage(error), "修正State Root .env/config.yaml中的DATABASE_URL。" );
    }
    await checkCompose(checks, absoluteRoot, manifest);

    const stateIntegrity = await inspectInstallationStateIntegrity(absoluteRoot, stateRoot);
    if (stateRootIntegrityFailed(stateIntegrity)) {
        fail(
            checks,
            stateIntegrity.kind === "shadow-workspace" ? "state.shadow-workspace" : "state.workspace-integrity",
            "state",
            stateIntegrity.kind === "shadow-workspace"
                ? `检测到错误Workspace Root：${stateIntegrity.checkedWorkspaceRoot}`
                : `无法验证Workspace Root完整性：${stateIntegrity.errorPath}`,
            formatStateRootIntegrityWarning(stateIntegrity),
        );
    } else {
        pass(checks, "state.shadow-workspace", "state", stateIntegrity.kind === "same-target-link"
            ? "Installation Root Workspace链接与真实Workspace Root指向同一目录"
            : "未检测到Workspace Root数据分叉");
    }

    const operations = await unfinishedOperations(paths.operations);
    if (operations.length === 0) pass(checks, "operation.unfinished", "operation", "没有未完成操作");
    else fail(checks, "operation.unfinished", "operation", `存在未完成操作：${operations.join(", ")}`, "再次运行mutating command触发恢复，或检查对应journal。" );
    return {checks, operations, stateIntegrity};
}

/** 读取当前服务状态；不计算任何大文件checksum。 */
export async function inspectInstallationService(root: string, manifest: InstallationManifest): Promise<InstallationServiceStatus> {
    const absoluteRoot = resolve(root);
    const stateRoot = installationPaths(absoluteRoot, manifest.roots).state;
    let port: number;
    try {
        port = await statePort(stateRoot);
    } catch (error) {
        return {
            kind: manifest.profile === "ghcr" || manifest.profile === "source-docker" ? "container" : "native",
            status: "unavailable",
            port: 0,
            expectedVersion: manifest.appVersion,
            message: `State Root端口配置非法：${errorMessage(error)}`,
        };
    }
    if (manifest.profile !== "ghcr" && manifest.profile !== "source-docker") {
        if (!await portListening(port)) {
            return {kind: "native", status: "stopped", port, expectedVersion: manifest.appVersion, message: "原生服务未启动"};
        }
        const probe = await probeApplication(port, manifest.appVersion);
        return probe.ok
            ? {kind: "native", status: "running", port, expectedVersion: manifest.appVersion, observedVersion: probe.version, message: "原生服务正在运行且版本正确"}
            : {kind: "native", status: "degraded", port, expectedVersion: manifest.appVersion, ...(probe.version ? {observedVersion: probe.version} : {}), message: probe.message};
    }

    const product = manifest.components.product;
    const expectedImage = product?.provider === "container" ? expectedContainerImage(manifest) : undefined;
    if (!expectedImage) {
        return {kind: "container", status: "unavailable", port, expectedVersion: manifest.appVersion, message: "Docker Profile缺少container Product"};
    }
    const engine = manifest.containerEngine;
    if (!engine) {
        return {kind: "container", status: "unavailable", port, expectedVersion: manifest.appVersion, expectedImage, message: "Container Profile缺少固定Container Engine"};
    }
    const [docker, compose] = await Promise.all([
        commandStatus(engine),
        commandStatus(engine, ["compose", "version"]),
    ]);
    if (!docker.available || !compose.available) {
        return {
            kind: "container",
            status: "unavailable",
            port,
            expectedVersion: manifest.appVersion,
            expectedImage,
            message: !docker.available ? `${engine}不可用` : `${engine} Compose不可用`,
        };
    }
    try {
        const container = await inspectDockerApplication(engine, absoluteRoot, stateRoot);
        if (!sameContainerImageIdentity(expectedImage, container.configuredImage)) {
            return {kind: "container", status: "degraded", port, expectedVersion: manifest.appVersion, expectedImage, configuredImage: container.configuredImage, message: "Compose配置镜像与Manifest不一致"};
        }
        if (!container.containerId) {
            return {kind: "container", status: "stopped", port, expectedVersion: manifest.appVersion, expectedImage, configuredImage: container.configuredImage, message: "app容器尚未创建"};
        }
        if (!container.actualImage || !sameContainerImageIdentity(expectedImage, container.actualImage)) {
            return {
                kind: "container",
                status: "degraded",
                port,
                expectedVersion: manifest.appVersion,
                expectedImage,
                configuredImage: container.configuredImage,
                actualImage: container.actualImage,
                containerId: container.containerId,
                message: "运行容器镜像与Manifest不一致",
            };
        }
        if (container.status !== "running") {
            const normallyStopped = container.status === "created"
                || container.status === "exited" && (container.exitCode === 0 || container.exitCode === 143);
            return {
                kind: "container",
                status: normallyStopped ? "stopped" : "degraded",
                port,
                expectedVersion: manifest.appVersion,
                expectedImage,
                configuredImage: container.configuredImage,
                actualImage: container.actualImage,
                containerId: container.containerId,
                message: normallyStopped ? "app容器已正常停止" : `app容器状态异常：${container.status ?? "unknown"}`,
            };
        }
        if (container.health === "unhealthy") {
            return {kind: "container", status: "degraded", port, expectedVersion: manifest.appVersion, expectedImage, configuredImage: container.configuredImage, actualImage: container.actualImage, containerId: container.containerId, message: "app容器healthcheck失败"};
        }
        const probe = await probeApplication(port, manifest.appVersion);
        return probe.ok
            ? {kind: "container", status: "running", port, expectedVersion: manifest.appVersion, observedVersion: probe.version, expectedImage, configuredImage: container.configuredImage, actualImage: container.actualImage, containerId: container.containerId, message: "app容器正在运行且HTTP版本正确"}
            : {kind: "container", status: "degraded", port, expectedVersion: manifest.appVersion, ...(probe.version ? {observedVersion: probe.version} : {}), expectedImage, configuredImage: container.configuredImage, actualImage: container.actualImage, containerId: container.containerId, message: probe.message};
    } catch (error) {
        return {kind: "container", status: "unavailable", port, expectedVersion: manifest.appVersion, expectedImage, message: `无法读取${engine}应用状态：${errorMessage(error)}`};
    }
}

/** 返回轻量实例状态；只执行路径、operation和服务探测。 */
export async function installationStatus(root: string, manifest: InstallationManifest): Promise<InstallationStatus> {
    const absoluteRoot = resolve(root);
    const paths = installationPaths(absoluteRoot, manifest.roots);
    const stateRoot = paths.state;
    const [operations, stateIntegrity, service] = await Promise.all([
        unfinishedOperations(paths.operations),
        inspectInstallationStateIntegrity(absoluteRoot, stateRoot),
        inspectInstallationService(absoluteRoot, manifest),
    ]);
    const product = manifest.components.product;
    let productReady = !product || product.provider === "container";
    if (product && product.provider !== "container") {
        productReady = await verifyInstalledProductRuntimeControlPlane(absoluteRoot, product).then(() => true).catch(() => false);
    }
    const nextActions = operations.length > 0
        ? ["运行 neuro-book doctor 查看恢复状态"]
        : [
            ...(stateRootIntegrityFailed(stateIntegrity) ? ["检查Workspace Root数据分叉、链接目标或目录权限"] : []),
            ...(service.status === "stopped" ? ["运行 neuro-book start"] : []),
            ...(service.status === "degraded" || service.status === "unavailable" ? ["运行 neuro-book doctor 查看服务故障"] : []),
            "运行 neuro-book doctor",
        ];
    return {
        root: absoluteRoot,
        profile: manifest.profile,
        containerEngine: manifest.containerEngine,
        managerVersion: manifest.managerVersion,
        executingManagerVersion: MANAGER_VERSION,
        appVersion: manifest.appVersion,
        channel: manifest.channel,
        sourceRevision: manifest.sourceRevision,
        roots: {
            state: paths.state,
            cache: paths.cache,
            desktop: paths.desktop,
            webview: paths.webview,
        },
        port: service.port,
        productReady,
        service,
        unfinishedOperations: operations,
        stateIntegrity,
        nextActions: [...new Set(nextActions)],
        components: manifest.components,
    };
}

/** 执行完整doctor；服务停止只产生warning，因此仍可healthy。 */
export async function doctor(root: string, manifest: InstallationManifest): Promise<DoctorReport> {
    const absoluteRoot = resolve(root);
    const paths = installationPaths(absoluteRoot, manifest.roots);
    const stateRoot = paths.state;
    const integrity = await inspectInstallationIntegrity(absoluteRoot, manifest);
    const containerCommand = manifest.containerEngine;
    const commands = {
        bun: await commandStatus("bun"),
        git: await commandStatus("git"),
        rg: await commandStatus("rg"),
        container: containerCommand ? await commandStatus(containerCommand) : {available: false},
        compose: containerCommand ? await commandStatus(containerCommand, ["compose", "version"]) : {available: false},
    };
    const service = await inspectInstallationService(absoluteRoot, manifest);
    const checks = [...integrity.checks, ...serviceChecks(service, manifest.containerEngine, commands)];
    return {
        healthy: checks.every((check) => check.status !== "fail"),
        containerEngine: manifest.containerEngine,
        checks,
        paths: {
            root: absoluteRoot,
            roots: {
                state: paths.state,
                cache: paths.cache,
                desktop: paths.desktop,
                webview: paths.webview,
            },
            workspace: join(stateRoot, "workspace"),
            bootConfig: join(stateRoot, "config.yaml"),
            stateIntegrity: integrity.stateIntegrity,
        },
        service: {...service, commands},
        components: manifest.components,
        operations: integrity.operations,
        python: {
            python3: await commandStatus("python3"),
            python: await commandStatus("python"),
            note: "Manager v1只检测Python，不托管下载。",
        },
    };
}

async function checkRuntime(checks: InstallationCheck[], root: string, id: string, runtime: ManagedRuntimeComponent | SystemRuntimeComponent): Promise<void> {
    if (runtime.provider === "managed") {
        const path = resolve(root, runtime.path);
        await checkChecksum(checks, id, "runtime", path, runtime.executableSha256);
        await checkExecutableVersion(checks, `${id}.version`, "runtime", path, runtime.version, true);
        return;
    }
    await checkExecutableVersion(checks, `${id}.version`, "runtime", runtime.executable, runtime.version, false);
}

async function checkTools(checks: InstallationCheck[], root: string, manifest: InstallationManifest): Promise<void> {
    for (const [name, tool] of Object.entries(manifest.components.tools)) {
        if (!tool || tool.provider === "container") continue;
        if (tool.provider === "system") {
            await checkSystemTool(checks, name, tool, manifest.components.source.provider === "git" && name === "git");
            continue;
        }
        const checksum = "gitSha256" in tool ? tool.gitSha256 : tool.executableSha256;
        const toolPath = resolve(root, tool.path);
        await checkChecksum(checks, `tool.${name}`, "tool", toolPath, checksum);
        await checkExecutableVersion(checks, `tool.${name}.version`, "tool", toolPath, tool.version, true);
        await checkWrapper(checks, `tool.${name}.wrapper`, "tool", wrapperPath(root, name), renderToolWrapper(tool.path));
        if (name === "git" && "bashPath" in tool) {
            await checkChecksum(checks, "tool.bash", "tool", resolve(root, tool.bashPath), tool.bashSha256);
            await checkExecutable(checks, "tool.bash.version", "tool", resolve(root, tool.bashPath));
            await checkWrapper(checks, "tool.bash.wrapper", "tool", wrapperPath(root, "bash"), renderToolWrapper(tool.bashPath));
        }
    }
}

async function checkSystemTool(checks: InstallationCheck[], name: string, tool: SystemToolComponent, required: boolean): Promise<void> {
    try {
        const output = (await runCapture(tool.executable, ["--version"])).trim();
        pass(checks, `tool.${name}.version`, "tool", `${name}可执行：${output.split(/\r?\n/u)[0] ?? tool.executable}`);
    } catch (error) {
        const message = `${name}当前不可执行：${tool.executable} (${errorMessage(error)})`;
        if (required) fail(checks, `tool.${name}.version`, "tool", message, "安装或修复该Source Profile所需的Git。" );
        else warn(checks, `tool.${name}.version`, "tool", message, "需要该可选工具时再安装。" );
    }
}

async function checkWrappers(checks: InstallationCheck[], root: string, manifest: InstallationManifest): Promise<void> {
    await checkWrapper(
        checks,
        "manager.wrapper",
        "manager",
        wrapperPath(root, "neuro-book"),
        renderManagerWrapper(
            manifest.components.manager,
            manifest.components.managerRuntime,
            process.platform,
            isCanonicalMachineInstallationRoot(root),
        ),
    );
    if (manifest.components.managerRuntime.provider === "managed") {
        await checkWrapper(checks, "runtime.wrapper", "runtime", wrapperPath(root, "bun"), renderRuntimeWrapper(manifest.components.managerRuntime));
    }
}

async function checkSource(checks: InstallationCheck[], root: string, manifest: InstallationManifest): Promise<void> {
    const source = manifest.components.source;
    if (source.provider !== "git") {
        if (source.revision === manifest.sourceRevision) pass(checks, "source.revision", "source", "Source revision与Manifest一致");
        else fail(checks, "source.revision", "source", "Source revision与Manifest不一致");
        return;
    }
    try {
        await validateRepository(root, source.repository, source.branch);
        pass(checks, "source.git.contract", "source", "Git remote、branch与upstream有效");
    } catch (error) {
        fail(checks, "source.git.contract", "source", errorMessage(error), "修复Git remote/branch/upstream后重试；Manager不会自动reset。" );
    }
    try {
        const revision = await repositoryRevision(root);
        if (revision === manifest.sourceRevision) pass(checks, "source.revision", "source", `Git revision为${revision}`);
        else fail(checks, "source.revision", "source", `Git revision为${revision}，Manifest记录${manifest.sourceRevision}`, "确认checkout是否被人工修改。" );
    } catch (error) {
        fail(checks, "source.revision", "source", `无法读取Git revision：${errorMessage(error)}`);
    }
    try {
        await assertCleanWorktree(root, installationRootDataPaths(manifest.roots));
        pass(checks, "source.git.dirty", "source", "Git worktree干净");
    } catch (error) {
        fail(checks, "source.git.dirty", "source", errorMessage(error), "提交或移走用户改动；Manager不会自动stash、restore或reset。" );
    }
}

async function checkProduct(checks: InstallationCheck[], root: string, manifest: InstallationManifest): Promise<void> {
    const product = manifest.components.product;
    if (!product) return;
    if (product.revision === manifest.sourceRevision) pass(checks, "product.revision", "product", "Source/Product revision一致");
    else fail(checks, "product.revision", "product", "Source/Product revision不一致", "重新更新Product。" );
    if (product.provider !== "container") {
        try {
            const image = await verifyInstalledProductRuntimeImage(root, product);
            pass(checks, "product.runtime-image", "product", `Product Runtime Image完整且代次一致：${image.imageId}`);
        } catch (error) {
            fail(checks, "product.runtime-image", "product", errorMessage(error), "重新更新Product；不要复用只有入口文件的旧.output。" );
        }
    }
}

async function checkState(checks: InstallationCheck[], stateRoot: string): Promise<void> {
    await checkPath(checks, "state.root", "state", stateRoot);
    await checkPath(checks, "state.workspace", "state", join(stateRoot, "workspace"));
    await checkPath(checks, "state.config", "state", join(stateRoot, "config.yaml"));
    await checkPath(checks, "state.logs", "state", join(stateRoot, "logs"));
    pass(checks, "state.location", "state", `State Root locator解析有效：${stateRoot}`);
}

async function checkCompose(checks: InstallationCheck[], root: string, manifest: InstallationManifest): Promise<void> {
    if (manifest.profile !== "ghcr" && manifest.profile !== "source-docker") return;
    const composePath = join(root, ".deploy", "docker-compose.generated.yml");
    if (!await pathExists(composePath)) {
        fail(checks, "service.compose", "service", `generated Compose缺失：${composePath}`, "重新安装或更新Docker Profile。" );
        return;
    }
    try {
        const configuredImage = await readDockerComposeImage(root);
        const expectedImage = expectedContainerImage(manifest);
        if (configuredImage === expectedImage) pass(checks, "service.compose-image", "service", `Compose固定镜像正确：${configuredImage}`);
        else fail(checks, "service.compose-image", "service", `Compose镜像${configuredImage}与Manifest${expectedImage}不一致`, "重新更新Docker Profile，避免手工修改generated Compose。" );
    } catch (error) {
        fail(checks, "service.compose", "service", errorMessage(error), "重新安装或更新Docker Profile。" );
    }
}

function serviceChecks(
    service: InstallationServiceStatus,
    engine: InstallationManifest["containerEngine"],
    commands: {container: CommandInspection; compose: CommandInspection},
): InstallationCheck[] {
    const checks: InstallationCheck[] = [];
    if (service.kind === "container") {
        const label = engine ?? "Container Engine";
        if (commands.container.available) pass(checks, "service.container-engine", "service", `${label}可用：${commands.container.version ?? "版本未知"}`);
        else fail(checks, "service.container-engine", "service", `${label}不可用`, `安装并启动${label}。` );
        if (commands.compose.available) pass(checks, "service.compose-command", "service", `${label} Compose可用：${commands.compose.version ?? "版本未知"}`);
        else fail(checks, "service.compose-command", "service", `${label} Compose不可用`, `安装支持${label} compose的版本。` );
    }
    if (service.status === "running") pass(checks, "service.application", "service", service.message);
    else if (service.status === "stopped") warn(checks, "service.application", "service", service.message, "运行 neuro-book start。" );
    else fail(checks, "service.application", "service", service.message, "检查端口、镜像和应用日志后重新启动。" );
    return checks;
}

async function checkChecksum(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], path: string, expected: string): Promise<void> {
    if (!await pathExists(path)) {
        fail(checks, id, category, `组件缺失：${path}`, "重新安装或更新对应组件。" );
        return;
    }
    const actual = await sha256File(path);
    if (actual === expected) pass(checks, id, category, `checksum通过：${path}`);
    else fail(checks, id, category, `checksum不匹配：${path}`, "组件可能损坏，请重新安装或更新。" );
}

async function checkExecutableVersion(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], path: string, expected: string, compareVersion: boolean): Promise<void> {
    try {
        const output = (await runCapture(path, ["--version"])).trim();
        if (!output) throw new Error("版本输出为空");
        if (compareVersion && !output.includes(expected)) {
            fail(checks, id, category, `组件版本不匹配：${path}，期望${expected}，实际${output}`, "重新安装或更新对应组件。" );
            return;
        }
        pass(checks, id, category, `组件可执行：${path} (${output.split(/\r?\n/u)[0] ?? expected})`);
    } catch (error) {
        fail(checks, id, category, `组件无法执行版本检查：${path} (${errorMessage(error)})`, "重新安装或修复对应Runtime。" );
    }
}

async function checkExecutable(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], path: string): Promise<void> {
    await checkExecutableVersion(checks, id, category, path, "", false);
}

async function checkWrapper(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], path: string, expected: string): Promise<void> {
    if (!await pathExists(path)) {
        fail(checks, id, category, `稳定wrapper缺失：${path}`, "使用当前Manager刷新Runtime wrapper。" );
        return;
    }
    const actual = await readFile(path, "utf8");
    if (actual === expected) pass(checks, id, category, `稳定wrapper指向Manifest当前组件：${path}`);
    else fail(checks, id, category, `稳定wrapper内容与Manifest不一致：${path}`, "使用当前Manager刷新Runtime wrapper。" );
}

async function checkPath(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], path: string): Promise<void> {
    if (await pathExists(path)) pass(checks, id, category, `路径存在：${path}`);
    else fail(checks, id, category, `路径缺失：${path}`, "重新安装或更新对应组件。" );
}

async function unfinishedOperations(root: string): Promise<string[]> {
    if (!await pathExists(root)) return [];
    const result: string[] = [];
    for (const entry of await readdir(root, {withFileTypes: true})) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const content = await readFile(join(root, entry.name), "utf8");
        if (!content.includes('"phase": "committed"')) result.push(entry.name);
    }
    return result;
}

function expectedContainerImage(manifest: InstallationManifest): string {
    const product = manifest.components.product;
    if (!product || product.provider !== "container") throw new Error("Docker Profile缺少container Product。" );
    return containerProductImageReference(manifest.profile, product);
}

/**
 * 比较容器镜像的不可变身份。
 *
 * Docker通常保留`repository:tag@digest`，Podman可能规范化为`repository@digest`。
 * 双方都携带digest时，repository与digest必须一致，tag不参与不可变身份；
 * Source Docker等无digest引用继续要求逐字一致。
 */
function sameContainerImageIdentity(expected: string, actual: string): boolean {
    if (expected === actual) return true;
    const expectedIdentity = immutableContainerImageIdentity(expected);
    const actualIdentity = immutableContainerImageIdentity(actual);
    return expectedIdentity !== null
        && actualIdentity !== null
        && expectedIdentity.repository === actualIdentity.repository
        && expectedIdentity.digest === actualIdentity.digest;
}

/** 从带digest的OCI引用中提取规范化repository与digest，忽略可变tag别名。 */
function immutableContainerImageIdentity(reference: string): {repository: string; digest: string} | null {
    const separator = reference.lastIndexOf("@");
    if (separator <= 0 || reference.indexOf("@") !== separator) return null;
    const name = reference.slice(0, separator);
    const digest = reference.slice(separator + 1).toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) return null;
    const lastSlash = name.lastIndexOf("/");
    const lastColon = name.lastIndexOf(":");
    const repository = (lastColon > lastSlash ? name.slice(0, lastColon) : name).toLowerCase();
    if (!repository || /[\s@]/u.test(repository)) return null;
    return {repository, digest};
}

function wrapperPath(root: string, name: string): string {
    return join(root, ".runtime", "bin", process.platform === "win32" ? `${name}.cmd` : name);
}

async function probeApplication(port: number, expectedVersion: string): Promise<{ok: true; version: string} | {ok: false; version?: string; message: string}> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
        if (!response.ok) return {ok: false, message: `版本接口返回HTTP ${response.status}`};
        // HTTP响应属于外部输入，仅接受正式versionLabel字符串。
        const value: unknown = await response.json();
        const version = versionLabel(value);
        if (!version) return {ok: false, message: "版本接口缺少versionLabel"};
        const expected = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
        if (version !== expected) return {ok: false, version, message: `运行中服务版本为${version}，期望${expected}`};
        return {ok: true, version};
    } catch (error) {
        return {ok: false, message: `端口已占用但NeuroBook版本接口不可达：${errorMessage(error)}`};
    }
}

function versionLabel(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null || !("versionLabel" in value)) return undefined;
    const label = value.versionLabel;
    return typeof label === "string" ? label : undefined;
}

async function portListening(port: number): Promise<boolean> {
    return new Promise<boolean>((resolvePromise) => {
        const socket = createConnection({host: "127.0.0.1", port});
        const finish = (value: boolean): void => {
            socket.destroy();
            resolvePromise(value);
        };
        socket.setTimeout(500);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}

function pass(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], message: string): void {
    checks.push({id, category, status: "pass", message});
}

function warn(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], message: string, remediation?: string): void {
    checks.push({id, category, status: "warn", message, ...(remediation ? {remediation} : {})});
}

function fail(checks: InstallationCheck[], id: string, category: InstallationCheck["category"], message: string, remediation?: string): void {
    checks.push({id, category, status: "fail", message, ...(remediation ? {remediation} : {})});
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
