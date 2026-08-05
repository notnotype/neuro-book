import {randomUUID} from "node:crypto";
import {copyFile, readFile, rename} from "node:fs/promises";
import {dirname, join, relative} from "node:path";

import {
    applyJournaledApplicationMigrations,
    backupJournaledApplicationDatabase,
    inspectApplicationService,
    migrateCurrentApplicationState,
    planJournaledApplicationMigrations,
} from "#manager/migration-operation";
import {
    assertProductExit,
    launchApplication,
    terminateFailedLaunch,
    type ApplicationLaunch,
} from "#manager/app-commands";
import {
    stageReleaseProduct,
    stageReleaseSource,
    switchProduct,
    switchReleaseSource,
    type StagedProduct,
    type StagedReleaseSource,
} from "#manager/component";
import {buildSourceDockerImage, containerProductImageReference, inspectDockerApplication, stopDocker, writeDockerCompose} from "#manager/docker";
import {ensureDirectory, pathExists, removePath} from "#manager/files";
import {statePort} from "#manager/health";
import {
    commitFastForward,
    createStagedWorktree,
    removeStagedWorktree,
    type GitUpdateTarget,
} from "#manager/git";
import {mutateInstallation} from "#manager/installation-mutation";
import {writeInstallationManifest} from "#manager/manifest-store";
import {
    completeRuntimeWrapperSwitch,
    commitOperation,
    prepareProductRuntimeReceiptSwitch,
    completeProductRuntimeReceiptSwitch,
    createOperation,
    operationEffect,
    pathCreateEffect,
    prepareCandidateContainer,
    prepareRuntimeWrapperSwitch,
    recordCandidateContainer,
    recoverFailedOperation,
    setOperationEffect,
    updateOperation,
} from "#manager/operation";
import {assertInstallationHostCompatible, currentProductPlatform} from "#manager/platform";
import {installationPaths} from "#manager/paths";
import {buildSourceProduct, installSourceDependencies, issueInstalledProductRuntimeReceipt} from "#manager/product";
import {installManagerExecutable, runtimeExecutable, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {writeManagedToolWrappers} from "#manager/tools";
import {parseInstallationManifest} from "#manager/schema";
import {sourceDockerImageName} from "#manager/source-docker-image";
import {type ApplicationUpdateComponent} from "#manager/update-planner";
import {resolveUpdatePreflight} from "#manager/update-preflight";
import type {
    InstallationManifest,
    ProductComponent,
    ManagerComponent,
    ReleaseChannel,
    ReleaseManifest,
    SourceComponent,
} from "#manager/types";

import {MANAGER_VERSION} from "#manager/version-info";

export type UpdateOptions = {
    root: string;
    manifest: InstallationManifest;
    version?: string;
    releaseManifest?: string;
    channel?: ReleaseChannel;
    managerExecutable: string;
};

export type UpdateResult = {
    manifest: InstallationManifest;
    changed: boolean;
    reason: "updated" | "already-current";
};

/** 使用统一 journal 更新应用组件，Git commit point 永远位于健康检查之后。 */
export async function updateInstallation(input: UpdateOptions): Promise<UpdateResult> {
    return mutateInstallation(input.root, async (mutation) => {
        const paths = installationPaths(mutation.root, mutation.manifest.roots);
        const options: UpdateOptions = {...input, root: mutation.root, manifest: mutation.manifest};
        assertInstallationHostCompatible(options.manifest);
        const preflight = await resolveUpdatePreflight(options);
        if (preflight.alreadyCurrent) {
            const migrated = await migrateCurrentApplicationState(paths.root, options.manifest);
            return migrated
                ? {manifest: options.manifest, changed: true, reason: "updated"}
                : {manifest: options.manifest, changed: false, reason: "already-current"};
        }
        const id = randomUUID();
        const staging = join(paths.staging, id);
        const backup = join(paths.backups, id);
        const stagingRelative = relative(paths.root, staging).replaceAll("\\", "/");
        let journal = await createOperation({
            id,
            action: "update",
            root: paths.root,
            containerEngine: options.manifest.containerEngine,
            effects: [pathCreateEffect(stagingRelative)],
            backupRoot: backup,
            previousManifest: options.manifest,
            nextManifest: null,
        });
        await ensureDirectory(staging);
        journal = await setOperationEffect(journal, pathCreateEffect(stagingRelative, "applied"));
        let stagedWorktree: string | null = null;
        let gitTarget: GitUpdateTarget | null = null;
        let healthLaunch: ApplicationLaunch | null = null;
        const createdComponents: string[] = [];
        try {
            journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "managed-assets"});
            const recordManagerCreated = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathCreateEffect(path));
            };
            const recordManagerCreatedApplied = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathCreateEffect(path, "applied"));
            };
            const manager = await installManagerExecutable(paths.root, MANAGER_VERSION, options.managerExecutable, createdComponents, recordManagerCreated, recordManagerCreatedApplied);
            journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "managed-assets"});
            const nativeApplication = isNativeApplication(options.manifest.profile) && preflight.applicationChanged;
            const result = await prepareUpdate(options, preflight.components, staging, backup, journal, preflight.release, preflight.gitTarget, manager);
            stagedWorktree = result.stagedWorktree;
            gitTarget = result.gitTarget;
            journal = result.journal;
            parseInstallationManifest(result.manifest);
            journal = await updateOperation(journal, "validated", {nextManifest: result.manifest});
            if (gitTarget) journal = await setOperationEffect(journal, {
                kind: "git-fast-forward",
                state: "planned",
                owner: "source",
                previousRevision: gitTarget.previousRevision,
                targetRevision: gitTarget.targetRevision,
            });
            if (preflight.applicationChanged) {
                const migrationPlan = await planJournaledApplicationMigrations(paths.root, result.manifest, journal, {
                    planRoot: result.stagedProduct
                        ? dirname(result.stagedProduct.outputRoot)
                        : stagedWorktree ?? paths.root,
                    migrationRoot: result.stagedProduct
                        ? dirname(result.stagedProduct.outputRoot)
                        : result.manifest.profile === "source-dev" && stagedWorktree ? stagedWorktree : paths.root,
                    ...(result.stagedCompose ? {composePath: result.stagedCompose} : {}),
                    ...(result.stagedCompose ? {containerStateRoot: installationPaths(paths.root, result.manifest.roots).state} : {}),
                });
                journal = migrationPlan.journal;
            }
            if (nativeApplication) {
                const stateRoot = paths.state;
                await inspectApplicationService(paths.root, result.manifest, stateRoot);
                journal = await backupJournaledApplicationDatabase(journal, stateRoot);
            }
            if (result.stagedCompose) {
                const compose = join(paths.deploy, "docker-compose.generated.yml");
                const previousCompose = join(backup, "docker-compose.generated.yml");
                if (!await pathExists(compose)) throw new Error("Docker Profile缺少当前generated Compose，无法事务更新。" );
                const stateRoot = paths.state;
                const engine = requiredContainerEngine(options.manifest);
                const profile = result.manifest.profile;
                const product = result.manifest.components.product;
                if ((profile !== "ghcr" && profile !== "source-docker") || product?.provider !== "container") {
                    throw new Error("Container Compose更新缺少目标Profile或Product。" );
                }
                const stagedCompose = await writeDockerCompose({
                    engine,
                    root: paths.root,
                    stateRoot,
                    cacheRoot: paths.cache,
                    profile,
                    image: containerProductImageReference(profile, product),
                    port: await statePort(stateRoot),
                    output: result.stagedCompose,
                    layoutPath: compose,
                });
                const previousInspection = await inspectDockerApplication(engine, paths.root, stateRoot);
                const previousState = !previousInspection.containerId
                    ? "missing" as const
                    : previousInspection.status === "running" ? "running" as const : "stopped" as const;
                const targetImage = result.manifest.components.product?.provider === "container"
                    ? `${result.manifest.components.product.image}${result.manifest.components.product.digest ? `@${result.manifest.components.product.digest}` : ""}`
                    : undefined;
                journal = await setOperationEffect(journal, {
                    kind: "compose",
                    state: "planned",
                    owner: "compose",
                    previousState,
                    stopped: previousState === "running",
                    previousCompose,
                    created: false,
                    previousImage: previousInspection.configuredImage,
                    targetImage,
                });
                await ensureDirectory(backup);
                await copyFile(compose, previousCompose);
                if (previousState === "running") await stopDocker(engine, paths.root, stateRoot);
                journal = await backupJournaledApplicationDatabase(journal, stateRoot);
                await removePath(compose);
                await rename(stagedCompose, compose);
                journal = await setOperationEffect(journal, {
                    kind: "compose", state: "applied", owner: "compose",
                    previousState, stopped: previousState === "running", previousCompose,
                    created: false, previousImage: previousInspection.configuredImage, targetImage,
                });
            }
            if (result.stagedSource) {
                const previous = options.manifest.components.source;
                await switchReleaseSource({
                    root: paths.root,
                    staged: result.stagedSource,
                    backup: join(backup, "source"),
                    previousFiles: previous.provider === "release" ? previous.files : [],
                    onSwitchIntent: async () => {
                        journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "source"});
                    },
                });
                journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "source"});
            }
            if (result.stagedProduct) {
                await switchProduct(paths.root, result.stagedProduct.outputRoot, join(backup, "product"), async () => {
                    journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "product"});
                });
                journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "product"});
            }
            journal = await updateOperation(journal, "switched");
            if (preflight.applicationChanged) {
                journal = await applyJournaledApplicationMigrations(
                    paths.root,
                    result.manifest,
                    journal,
                    journal.migrationRoot ?? paths.root,
                );
                journal = await updateOperation(journal, "migrated");
                const launchRoot = result.manifest.profile === "source-dev" && stagedWorktree
                    ? stagedWorktree
                    : paths.root;
                healthLaunch = await launchApplication(launchRoot, result.manifest, {
                    stateRoot: installationPaths(paths.root, result.manifest.roots).state,
                    onContainerStarting: async () => {
                        journal = await prepareCandidateContainer(journal);
                    },
                    onContainerStarted: async (containerId) => {
                        journal = await recordCandidateContainer(journal, containerId, false);
                    },
                    onContainerStopped: async (containerId) => {
                        journal = await recordCandidateContainer(journal, containerId, true);
                    },
                });
                await healthLaunch.ready;
                const keepContainerRunning = (result.manifest.profile === "ghcr" || result.manifest.profile === "source-docker")
                    && operationEffect(journal, "compose")?.previousState === "running";
                if (!keepContainerRunning) {
                    await healthLaunch.shutdown();
                    assertProductExit(await healthLaunch.completion, "NeuroBook 服务退出");
                    healthLaunch = null;
                }
            }
            const installedProduct = result.manifest.components.product;
            if (installedProduct && installedProduct.provider !== "container" && await pathExists(join(paths.root, installedProduct.path))) {
                const receiptPath = join(paths.deploy, "product-runtime-receipt.json");
                journal = await prepareProductRuntimeReceiptSwitch(journal, receiptPath);
                await issueInstalledProductRuntimeReceipt(paths.root, installedProduct, receiptPath);
                journal = await completeProductRuntimeReceiptSwitch(journal);
            }
            journal = await updateOperation(journal, "healthy");
            if (gitTarget) {
                await commitFastForward(paths.root, gitTarget);
                journal = await setOperationEffect(journal, {
                    kind: "git-fast-forward", state: "applied", owner: "source",
                    previousRevision: gitTarget.previousRevision, targetRevision: gitTarget.targetRevision,
                });
                if (options.manifest.profile === "source-dev") {
                    const runtime = result.manifest.components.applicationRuntime;
                    if (runtime.provider === "container") throw new Error("Source Dev 不能使用 container Application Runtime。" );
                    try {
                        await installSourceDependencies(paths.root, runtimeExecutable(paths.root, runtime));
                        journal = await setOperationEffect(journal, {
                            kind: "git-fast-forward", state: "applied", owner: "source",
                            previousRevision: gitTarget.previousRevision, targetRevision: gitTarget.targetRevision,
                            dependenciesInstalled: true,
                        });
                    } catch (error) {
                        throw new Error(`Source Dev 已 fast-forward 到 ${gitTarget.targetRevision}，但依赖安装失败。Operation journal 已保留；修复网络或 lockfile 问题后重新执行 update。\n${String(error)}`);
                    }
                }
            }
            journal = await prepareRuntimeWrapperSwitch(journal);
            if (result.manifest.components.managerRuntime.provider === "managed") {
                await writeRuntimeWrapper(paths.root, result.manifest.components.managerRuntime);
            }
            await writeManagedToolWrappers(paths.root, result.manifest.components.tools);
            await writeManagerWrapper(paths.root, result.manifest.components.manager, result.manifest.components.managerRuntime);
            journal = await completeRuntimeWrapperSwitch(journal);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "planned", owner: "manifest"});
            await writeInstallationManifest(paths.manifest, result.manifest);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "applied", owner: "manifest"});
            await commitOperation(journal);
            healthLaunch = null;
            if (stagedWorktree) await removeStagedWorktree(paths.root, stagedWorktree);
            await removePath(staging);
            return {manifest: result.manifest, changed: true, reason: "updated"};
        } catch (error) {
            // Source Dev的migrationRoot位于staged worktree，rollback完成前必须保留executor。
            if (healthLaunch) await terminateFailedLaunch(healthLaunch, error);
            await recoverFailedOperation(paths.root, error);
            if (stagedWorktree) await removeStagedWorktree(paths.root, stagedWorktree).catch(() => undefined);
            throw error;
        }
    });
}

function isNativeApplication(profile: InstallationManifest["profile"]): boolean {
    return profile !== "source-docker" && profile !== "ghcr";
}

async function prepareUpdate(
    options: UpdateOptions,
    selected: Set<ApplicationUpdateComponent>,
    staging: string,
    backup: string,
    initialJournal: Awaited<ReturnType<typeof createOperation>>,
    release: ReleaseManifest | null,
    plannedGitTarget: GitUpdateTarget | null,
    manager: ManagerComponent,
): Promise<{
    manifest: InstallationManifest;
    stagedWorktree: string | null;
    gitTarget: GitUpdateTarget | null;
    stagedSource: StagedReleaseSource | null;
    stagedProduct: StagedProduct | null;
    stagedCompose: string | null;
    journal: Awaited<ReturnType<typeof createOperation>>;
}> {
    const profile = options.manifest.profile;
    const paths = installationPaths(options.root, options.manifest.roots);
    const channel = options.channel ?? options.manifest.channel;
    if (release && release.sourceRevision !== options.manifest.sourceRevision && profile !== "ghcr"
        && (!selected.has("source") || !selected.has("product"))) {
        throw new Error("Release Source 与 Product 必须同版本更新；请同时选择 source 和 product。" );
    }
    let source: SourceComponent = options.manifest.components.source;
    let product: ProductComponent | undefined = options.manifest.components.product;
    let appVersion = options.manifest.appVersion;
    let sourceRevision = options.manifest.sourceRevision;
    let gitTarget: GitUpdateTarget | null = null;
    let stagedWorktree: string | null = null;
    let stagedSource: StagedReleaseSource | null = null;
    let stagedProduct: StagedProduct | null = null;
    let stagedCompose: string | null = null;
    let journal = initialJournal;
    const bunRuntime = options.manifest.components.applicationRuntime;
    const bun = bunRuntime.provider === "container" ? null : runtimeExecutable(paths.root, bunRuntime);

    if ((profile === "source-product" || profile === "source-docker") && (selected.has("source") || selected.has("product"))) {
        if (!plannedGitTarget) throw new Error("Source Profile更新缺少预检锁定的Git目标。" );
        gitTarget = plannedGitTarget;
        sourceRevision = gitTarget.targetRevision;
        stagedWorktree = join(staging, "source-worktree");
        await createStagedWorktree(paths.root, stagedWorktree, gitTarget.targetRevision);
        appVersion = await sourceVersion(stagedWorktree);
        source = {...source, version: appVersion, revision: sourceRevision};
        if (profile === "source-product" && selected.has("product")) {
            if (!bun) throw new Error("Source Product 缺少 Application Runtime。" );
            await installSourceDependencies(stagedWorktree, bun);
            stagedProduct = await buildSourceProduct({
                root: paths.root,
                sourceRoot: stagedWorktree,
                staging: join(staging, "build"),
                version: appVersion,
                revision: sourceRevision,
                stateRoot: paths.state,
                bun,
            });
            product = stagedProduct.component;
        } else if (profile === "source-docker") {
            const engine = requiredContainerEngine(options.manifest);
            const previousImage = options.manifest.components.product?.provider === "container"
                ? options.manifest.components.product.image
                : undefined;
            const image = sourceDockerImageName(sourceRevision, journal.id);
            product = {provider: "container", version: appVersion, revision: sourceRevision, image};
            journal = await setOperationEffect(journal, {kind: "docker-image", state: "planned", owner: "product", image: product.image, previousImage});
            const containerImageId = await buildSourceDockerImage(engine, stagedWorktree, product.image);
            product = {...product, containerImageId};
            journal = await setOperationEffect(journal, {kind: "docker-image", state: "applied", owner: "product", image: product.image, previousImage});
        }
    } else if (profile === "source-dev" && selected.has("source")) {
        if (!plannedGitTarget) throw new Error("Source Dev更新缺少预检锁定的Git目标。" );
        gitTarget = plannedGitTarget;
        sourceRevision = gitTarget.targetRevision;
        const sourceWorktree = join(staging, "source-worktree");
        await createStagedWorktree(paths.root, sourceWorktree, sourceRevision);
        stagedWorktree = sourceWorktree;
        if (!bun) throw new Error("Source Dev 缺少Application Runtime。" );
        await installSourceDependencies(sourceWorktree, bun);
        appVersion = await sourceVersion(sourceWorktree);
        source = {...source, version: appVersion, revision: sourceRevision};
    }

    if (release) {
        appVersion = release.version;
        sourceRevision = release.sourceRevision;
        if (profile === "ghcr" && (selected.has("source") || selected.has("product"))) {
            source = {provider: "container", version: release.version, revision: release.sourceRevision, path: "/app"};
            product = {provider: "container", version: release.version, revision: release.sourceRevision, image: release.ghcr.ref, digest: release.ghcr.digest};
        } else if (profile !== "ghcr") {
            if (selected.has("source") && source.provider === "release") {
                stagedSource = await stageReleaseSource({
                    root: paths.root,
                    staging,
                    asset: release.source,
                    buildId: release.buildId,
                    version: release.version,
                    revision: release.sourceRevision,
                    previous: source,
                });
                source = stagedSource.component;
            }
            if (selected.has("product")) {
                const platform = currentProductPlatform();
                const asset = release.products.find((item) => item.platform === platform);
                if (!asset) throw new Error(`Release ${release.version} 缺少 ${platform} Product。`);
                stagedProduct = await stageReleaseProduct({
                    staging,
                    asset,
                    buildId: release.buildId,
                    version: release.version,
                    revision: release.sourceRevision,
                });
                product = stagedProduct.component;
            }
        }
    }

    const managerRuntime = options.manifest.components.managerRuntime;
    const applicationRuntime = options.manifest.components.applicationRuntime;
    const tools = options.manifest.components.tools;
    const next: InstallationManifest = {
        ...options.manifest,
        managerVersion: MANAGER_VERSION,
        appVersion,
        channel,
        sourceRevision,
        components: {source, product, manager, managerRuntime, applicationRuntime, tools},
        updatedAt: new Date().toISOString(),
    };
    if (profile === "ghcr" && (selected.has("source") || selected.has("product"))
        && product?.provider === "container" && product.digest) {
        stagedCompose = await writeDockerCompose({
            engine: requiredContainerEngine(options.manifest),
            root: paths.root,
            stateRoot: paths.state,
            cacheRoot: paths.cache,
            profile: "ghcr",
            image: containerProductImageReference("ghcr", product),
            port: await statePort(paths.state),
            output: join(staging, "docker-compose.generated.yml"),
        });
    } else if (profile === "source-docker" && product?.provider === "container") {
        stagedCompose = await writeDockerCompose({
            engine: requiredContainerEngine(options.manifest),
            root: paths.root,
            stateRoot: paths.state,
            cacheRoot: paths.cache,
            profile: "source-docker",
            image: product.image,
            port: await statePort(paths.state),
            output: join(staging, "docker-compose.generated.yml"),
        });
    }
    return {manifest: next, stagedWorktree, gitTarget, stagedSource, stagedProduct, stagedCompose, journal};
}

/**
 * 在创建Operation或备份数据库前解析目标版本，并移除已经完全一致的Release组件。
 * Git Profile继续由既有fetch/worktree流程判定目标revision。
 */
/** 返回已安装容器实例固定使用的Container Engine。 */
function requiredContainerEngine(manifest: InstallationManifest): NonNullable<InstallationManifest["containerEngine"]> {
    if (!manifest.containerEngine) throw new Error(`${manifest.profile} Manifest缺少Container Engine。`);
    return manifest.containerEngine;
}

async function sourceVersion(root: string): Promise<string> {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {version?: string};
    return packageJson.version ?? "0.0.0";
}
