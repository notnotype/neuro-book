import {copyFile, cp, readdir, rename, rm} from "node:fs/promises";
import {isAbsolute, join, relative, resolve, sep} from "node:path";

import {rollbackApplicationStateMigration} from "#manager/app-commands";
import {rollbackProduct, rollbackReleaseSource} from "#manager/component";
import {removeDockerDeployment, removeDockerImage, startDocker, stopDockerContainer} from "#manager/docker";
import {verifyApplicationExecution} from "#manager/application-execution";
import {ensureDirectory, pathExists, readJson, removePath, writeJsonAtomic} from "#manager/files";
import {removeMaterializedRepository, repositoryRevision} from "#manager/git";
import {installationTarget} from "#manager/installation-path";
import {readInstallationManifest, writeInstallationManifest} from "#manager/manifest-store";
import {installationPaths} from "#manager/paths";
import {installSourceDependencies} from "#manager/product";
import {resolveInstallationRoots, rootLocatorsEqual} from "#manager/root-locators";
import {runtimeExecutable, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {migrateOperationJournal, parseOperationJournal} from "#manager/schema";
import {writeManagedToolWrappers} from "#manager/tools";
import type {
    InstallationManifest,
    InstallationRootLocators,
    OperationEffect,
    OperationJournal,
    OperationPathOwner,
    OperationPhase,
} from "#manager/types";

type OperationInput = Omit<OperationJournal, "schemaVersion" | "phase" | "effects" | "createdAt" | "updatedAt"> & {
    effects?: OperationEffect[];
};

/** 创建持久化Operation Journal；backup ownership在任何backup写入前进入Ledger。 */
export async function createOperation(input: OperationInput): Promise<OperationJournal> {
    const now = new Date().toISOString();
    const backupPath = operationBackupEffectPath(input);
    const effects = upsertEffect(input.effects ?? [], {
        kind: "path-create",
        state: "planned",
        owner: "backup",
        path: backupPath,
    });
    const journal: OperationJournal = {
        ...input,
        schemaVersion: 6,
        phase: "planned",
        effects,
        createdAt: now,
        updatedAt: now,
    };
    parseOperationJournal(journal, operationJournalPath(journal));
    await writeOperation(journal);
    return journal;
}

/** 原子更新Operation phase与非Effect恢复信息。 */
export async function updateOperation(journal: OperationJournal, phase: OperationPhase, patch: Partial<OperationJournal> = {}): Promise<OperationJournal> {
    const next = {...journal, ...patch, phase, updatedAt: new Date().toISOString()};
    parseOperationJournal(next, operationJournalPath(next));
    await writeOperation(next);
    return next;
}

/** 先持久化planned，再以同一identity写入applied；禁止状态倒退。 */
export async function setOperationEffect(journal: OperationJournal, effect: OperationEffect): Promise<OperationJournal> {
    const previous = journal.effects.find((candidate) => effectIdentity(candidate) === effectIdentity(effect));
    if (previous?.state === "applied" && effect.state === "planned") {
        throw new Error(`Operation effect不能从applied退回planned：${effectIdentity(effect)}`);
    }
    if (effect.state === "applied" && !previous) {
        throw new Error(`Operation effect缺少planned intent：${effectIdentity(effect)}`);
    }
    if (previous?.kind === "candidate-container" && effect.kind === "candidate-container"
        && previous.containerId && effect.containerId !== previous.containerId) {
        throw new Error(`Operation candidate-container不能更换容器身份：${previous.containerId}`);
    }
    return updateOperation(journal, journal.phase, {effects: upsertEffect(journal.effects, effect)});
}

/** 在 Compose 进入可能创建容器的阶段前持久化恢复屏障。 */
export function prepareCandidateContainer(journal: OperationJournal): Promise<OperationJournal> {
    return setOperationEffect(journal, {
        kind: "candidate-container",
        state: "planned",
        owner: "application",
        stopped: false,
    });
}

/** 持久化本次候选容器的精确身份或停止结果。 */
export function recordCandidateContainer(
    journal: OperationJournal,
    containerId: string,
    stopped: boolean,
): Promise<OperationJournal> {
    return setOperationEffect(journal, {
        kind: "candidate-container",
        state: "applied",
        owner: "application",
        containerId,
        stopped,
    });
}

/** 在任何wrapper写入前记录旧状态，并以临时目录原子提交恢复副本。 */
export async function prepareRuntimeWrapperSwitch(journal: OperationJournal): Promise<OperationJournal> {
    const runtimeBin = join(journal.root, ".runtime", "bin");
    const previousState = await pathExists(runtimeBin) ? "present" as const : "missing" as const;
    const backupPath = previousState === "present" ? join(journal.backupRoot, "runtime-bin") : undefined;
    let next = await setOperationEffect(journal, {
        kind: "wrapper-switch",
        state: "planned",
        owner: "wrapper",
        previousState,
        backupPath,
    });
    if (backupPath) await backupRuntimeWrappers(journal.root, journal.backupRoot);
    return next;
}

/** 所有稳定wrapper写入完成后提交同一切换Effect。 */
export async function completeRuntimeWrapperSwitch(journal: OperationJournal): Promise<OperationJournal> {
    const effect = operationEffect(journal, "wrapper-switch");
    if (!effect) throw new Error("Wrapper切换缺少planned intent。" );
    return setOperationEffect(journal, {...effect, state: "applied"});
}

/** 按固定Installation Root布局记录路径创建。 */
export function pathCreateEffect(path: string, state: OperationEffect["state"] = "planned"): OperationEffect {
    return {kind: "path-create", state, owner: operationPathOwner(path), path};
}

/** 按固定受管资产布局记录提交后退役。 */
export function pathRetireEffect(path: string, state: OperationEffect["state"] = "planned"): OperationEffect {
    const owner = operationPathOwner(path);
    if (owner !== "runtime" && owner !== "tool") throw new Error(`只有Runtime/Tool资产代次可以退役：${path}`);
    return {kind: "path-retire", state, owner, path};
}

/** 返回指定kind的Effect；singleton Effect由schema保证唯一。 */
export function operationEffect<K extends OperationEffect["kind"]>(journal: OperationJournal, kind: K): Extract<OperationEffect, {kind: K}> | undefined {
    return journal.effects.find((effect) => effect.kind === kind) as Extract<OperationEffect, {kind: K}> | undefined;
}

/** 在写入新 Product 回执前记录旧回执并持久化恢复屏障。 */
export async function prepareProductRuntimeReceiptSwitch(journal: OperationJournal, receiptPath: string): Promise<OperationJournal> {
    const expectedPath = resolve(journal.root, ".deploy", "product-runtime-receipt.json");
    if (resolve(receiptPath) !== expectedPath) throw new Error(`Product Runtime receipt 必须位于受管 .deploy：${receiptPath}`);
    const previousState = await pathExists(receiptPath) ? "present" as const : "missing" as const;
    const backupPath = previousState === "present" ? join(journal.backupRoot, "product-runtime-receipt.json") : undefined;
    let next = await setOperationEffect(journal, {
        kind: "receipt-switch",
        state: "planned",
        owner: "receipt",
        path: ".deploy/product-runtime-receipt.json",
        previousState,
        ...(backupPath ? {backupPath} : {}),
    });
    if (backupPath) {
        await ensureDirectory(resolve(backupPath, ".."));
        await copyFile(receiptPath, backupPath);
    }
    return next;
}

/** 新回执原子写入且完整验证成功后提交回执切换Effect。 */
export function completeProductRuntimeReceiptSwitch(journal: OperationJournal): Promise<OperationJournal> {
    const effect = operationEffect(journal, "receipt-switch");
    if (!effect) throw new Error("Product Runtime receipt切换缺少planned intent。");
    return setOperationEffect(journal, {...effect, state: "applied"});
}

/** 返回指定组件切换Effect。 */
export function componentSwitchEffect(journal: OperationJournal, owner: Extract<OperationEffect, {kind: "component-switch"}>["owner"]): Extract<OperationEffect, {kind: "component-switch"}> | undefined {
    return journal.effects.find((effect) => effect.kind === "component-switch" && effect.owner === owner) as Extract<OperationEffect, {kind: "component-switch"}> | undefined;
}

/** 标记操作成功提交，再清理已退役资产与Operation临时目录。 */
export async function commitOperation(journal: OperationJournal): Promise<OperationJournal> {
    const committed = await updateOperation(journal, "committed", {outcome: "success"});
    const cleaned = await cleanupCommittedEffects(committed, true);
    await removeCleanJournal(cleaned);
    return cleaned;
}

/** 在mutating command开始前恢复上次未完成操作。 */
export async function recoverInterruptedOperations(
    root: string,
    requestedRoots?: InstallationRootLocators,
): Promise<InstallationManifest | null> {
    const manifestPath = installationPaths(root).manifest;
    const manifestBeforeRecovery = await readInstallationManifest(manifestPath);
    const roots = requestedRoots ?? manifestBeforeRecovery?.roots;
    if (!roots) {
        throw new Error(`Operation recovery 缺少 Root Locator，且 Installation Manifest 不存在：${root}`);
    }
    if (manifestBeforeRecovery && !rootLocatorsEqual(roots, manifestBeforeRecovery.roots)) {
        throw new Error(`Operation recovery 的 Root Locator 与 Installation Manifest 不一致：${root}`);
    }
    const paths = installationPaths(root, roots);
    const legacyOperations = installationPaths(root).operations;
    const operationRoots = samePath(paths.operations, legacyOperations)
        ? [paths.operations]
        : [paths.operations, legacyOperations];
    const candidates: Array<{path: string; value: Record<string, unknown>; journal: OperationJournal}> = [];
    const byId = new Map<string, {path: string; value: Record<string, unknown>; journal: OperationJournal}>();
    const duplicatePaths = new Map<string, string[]>();
    for (const operations of operationRoots) {
        if (!await pathExists(operations)) continue;
        for (const entry of await readdir(operations, {withFileTypes: true})) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
            const path = join(operations, entry.name);
            const value = await readJson(path);
            if (!value || typeof value !== "object") throw new Error(`Operation journal损坏：${path}`);
            if ("schemaVersion" in value && (value.schemaVersion === 1 || value.schemaVersion === 2)) {
                if ("phase" in value && value.phase === "committed") continue;
                throw new Error(`发现未完成的Operation Journal v${String(value.schemaVersion)}，v3 Manager拒绝自动恢复：${path}\n请备份实例并人工核对Manifest、Product、数据库、Git和Compose状态。`);
            }
            const journal = migrateOperationJournal(value, path, roots);
            if (!rootLocatorsEqual(journal.roots, roots)) {
                throw new Error(`Operation journal的Root Locator与当前安装不一致：${path}`);
            }
            const existing = byId.get(journal.id);
            if (existing) {
                if (JSON.stringify(existing.journal) !== JSON.stringify(journal)) {
                    throw new Error(`发现身份相同但内容不一致的Operation journal：${existing.path} / ${path}`);
                }
                duplicatePaths.set(journal.id, [...duplicatePaths.get(journal.id) ?? [], path]);
                continue;
            }
            const candidate = {path, value: value as Record<string, unknown>, journal};
            byId.set(journal.id, candidate);
            candidates.push(candidate);
        }
    }
    for (const candidate of candidates) {
        let {journal} = candidate;
        const originalPath = candidate.path;
        if (!samePath(journal.root, root)) {
            journal = rebaseMovedPortableCommit(journal, root, originalPath);
        }
        const canonicalPath = operationJournalPath(journal);
        if (candidate.value.schemaVersion !== 6 || !samePath(originalPath, canonicalPath)) {
            await writeOperation(journal);
            if (!samePath(originalPath, canonicalPath)) await rm(originalPath, {force: true});
        }
        for (const duplicatePath of duplicatePaths.get(journal.id) ?? []) {
            if (!samePath(duplicatePath, canonicalPath)) await rm(duplicatePath, {force: true});
        }
        if (journal.phase === "committed") {
            const cleaned = await cleanupCommittedEffects(journal, journal.outcome === "success");
            await removeCleanJournal(cleaned);
            continue;
        }
        const git = operationEffect(journal, "git-fast-forward");
        if (git) {
            const head = await repositoryRevision(root);
            if (head !== git.previousRevision && head !== git.targetRevision) {
                throw new Error(`Git HEAD既不是Operation的previous也不是target，拒绝自动恢复：${head}\nOperation：${canonicalPath}`);
            }
            if (head === git.targetRevision && journal.nextManifest && journal.phase === "healthy") {
                let nextJournal = journal;
                if (journal.nextManifest.profile === "source-dev" && !git.dependenciesInstalled) {
                    const runtime = journal.nextManifest.components.applicationRuntime;
                    if (runtime.provider === "container") throw new Error("Source Dev不能使用container Application Runtime。");
                    await installSourceDependencies(root, runtimeExecutable(root, runtime));
                    nextJournal = await setOperationEffect(nextJournal, {...git, state: "applied", dependenciesInstalled: true});
                }
                const wrapper = operationEffect(nextJournal, "wrapper-switch");
                if (!wrapper) nextJournal = await prepareRuntimeWrapperSwitch(nextJournal);
                if (journal.nextManifest.components.managerRuntime.provider === "managed") {
                    await writeRuntimeWrapper(root, journal.nextManifest.components.managerRuntime);
                }
                await writeManagedToolWrappers(root, journal.nextManifest.components.tools);
                await writeManagerWrapper(root, journal.nextManifest.components.manager, journal.nextManifest.components.managerRuntime);
                nextJournal = await setOperationEffect(nextJournal, {...operationEffect(nextJournal, "wrapper-switch")!, state: "applied"});
                if (!operationEffect(nextJournal, "manifest-switch")) {
                    nextJournal = await setOperationEffect(nextJournal, {kind: "manifest-switch", state: "planned", owner: "manifest"});
                }
                await writeInstallationManifest(paths.manifest, journal.nextManifest);
                nextJournal = await setOperationEffect(nextJournal, {kind: "manifest-switch", state: "applied", owner: "manifest"});
                await commitOperation(nextJournal);
                continue;
            }
            if (head === git.targetRevision) {
                throw new Error(`Git HEAD已到target，但Operation尚未到达healthy commit point，拒绝自动提交Manifest：${canonicalPath}`);
            }
        }
        await rollbackOperation(journal);
    }
    return readInstallationManifest(paths.manifest);
}

/**
 * 在一次 Manager 操作失败后执行持久化恢复。
 *
 * 恢复失败时同时保留原始错误，并阻止调用方清理 staging/backup；这些资产可能仍是
 * Journal 指向的 Product migration runner 或逐字节恢复依据。
 */
export async function recoverFailedOperation(
    root: string,
    failure: unknown,
    roots?: InstallationRootLocators,
): Promise<void> {
    try {
        await recoverInterruptedOperations(root, roots);
    } catch (recoveryError) {
        throw new AggregateError(
            [failure, recoveryError],
            "Manager 操作失败，自动恢复也未完成；已保留 Operation Journal、staging 与 backup。",
        );
    }
}

/** 清理提交后Effect；失败信息保存在具体Effect并由下一次mutating command重试。 */
async function cleanupCommittedEffects(journal: OperationJournal, includeRetired: boolean): Promise<OperationJournal> {
    let changed = false;
    const effects: OperationEffect[] = [];
    for (const effect of journal.effects) {
        if (includeRetired && effect.kind === "receipt-switch" && effect.backupPath) {
            try {
                await removePath(effect.backupPath);
                changed = true;
                effects.push({...effect, backupPath: undefined, cleanupError: undefined});
            } catch (error) {
                changed = true;
                effects.push({...effect, cleanupError: error instanceof Error ? error.message : String(error)});
            }
            continue;
        }
        const shouldRemove = effect.kind === "path-create" && (effect.owner === "staging" || effect.owner === "backup")
            || includeRetired && effect.kind === "path-retire";
        if (includeRetired && effect.kind === "docker-image" && effect.previousImage && !effect.previousImageRetired) {
            try {
                await removeDockerImage(requiredContainerEngine(journal), journal.root, effect.previousImage);
                changed = true;
                effects.push({...effect, previousImageRetired: true, cleanupError: undefined});
            } catch (error) {
                changed = true;
                effects.push({...effect, cleanupError: error instanceof Error ? error.message : String(error)});
            }
            continue;
        }
        if (!includeRetired && effect.kind === "docker-image" && effect.cleanupError) {
            try {
                await removeDockerImage(requiredContainerEngine(journal), journal.root, effect.image);
                changed = true;
                effects.push({...effect, cleanupError: undefined});
            } catch (error) {
                changed = true;
                effects.push({...effect, cleanupError: error instanceof Error ? error.message : String(error)});
            }
            continue;
        }
        const retryRolledBackPath = !includeRetired && effect.kind === "path-create" && Boolean(effect.cleanupError);
        if (!shouldRemove && !retryRolledBackPath) {
            effects.push(effect);
            continue;
        }
        try {
            await removePath(operationEffectTarget(journal, effect));
            changed = changed || effect.cleanupError !== undefined || effect.kind === "path-retire" && effect.state !== "applied";
            effects.push(effect.kind === "path-retire" ? {...effect, state: "applied", cleanupError: undefined} : {...effect, cleanupError: undefined});
        } catch (error) {
            changed = true;
            effects.push({...effect, cleanupError: error instanceof Error ? error.message : String(error)});
        }
    }
    return changed ? updateOperation(journal, "committed", {effects}) : journal;
}

/** 按Journal恢复当前操作；不会reset/stash/restore Git。 */
export async function rollbackOperation(initialJournal: OperationJournal): Promise<void> {
    let journal = initialJournal;
    const root = journal.root;
    const currentCompose = join(root, ".deploy", "docker-compose.generated.yml");
    const manifest = journal.previousManifest ?? journal.nextManifest;
    const stateRoot = manifest
        ? resolveInstallationRoots(root, manifest.roots).state
        : installationPaths(root).state;
    const candidate = operationEffect(journal, "candidate-container");
    if (candidate && !candidate.stopped) {
        if (candidate.state !== "applied" || !candidate.containerId) {
            throw new Error(
                `Operation ${journal.id} 已进入候选容器启动阶段，但没有可验证的容器身份；拒绝回滚 Application State。`,
            );
        }
        await stopDockerContainer(requiredContainerEngine(journal), root, candidate.containerId);
        journal = await recordCandidateContainer(journal, candidate.containerId, true);
    }
    const compose = operationEffect(journal, "compose");
    const composeChanged = Boolean(compose && (
        compose.created
        || compose.previousCompose
        || compose.targetImage !== compose.previousImage
    ));
    if (compose && await pathExists(currentCompose)
        && (composeChanged || compose.previousState === "missing")) {
        await removeDockerDeployment(requiredContainerEngine(journal), root, stateRoot);
    }
    if (journal.applicationStateMigration && journal.applicationStateMigration.state !== "rolled_back") {
        if (!journal.nextManifest) throw new Error("Application State migration 回滚缺少 nextManifest。");
        if (journal.applicationStateMigration.state !== "planned") {
            await rollbackApplicationStateMigration(
                root,
                journal.nextManifest,
                journal.applicationStateMigration.runId,
                journal.applicationStateMigration.state === "applying",
                journal.migrationRoot ?? root,
            );
        }
        journal = await updateOperation(journal, journal.phase, {applicationStateMigration: {...journal.applicationStateMigration, state: "rolled_back"}});
    }
    const database = operationEffect(journal, "sqlite-backup");
    if (database && await pathExists(database.backupPath)) {
        await ensureDirectory(resolve(database.hostPath, ".."));
        await rm(`${database.hostPath}-wal`, {force: true});
        await rm(`${database.hostPath}-shm`, {force: true});
        await copyFile(database.backupPath, database.hostPath);
    }
    const previousProduct = journal.previousManifest?.components.product;
    const nextProduct = journal.nextManifest?.components.product;
    const switched = ["switched", "migrated", "healthy"].includes(journal.phase);
    if ((componentSwitchEffect(journal, "product") || switched) && nextProduct && nextProduct.provider !== "container" && JSON.stringify(nextProduct) !== JSON.stringify(previousProduct)) {
        await rollbackProduct(root, join(journal.backupRoot, "product"), Boolean(previousProduct));
    }
    const previousSource = journal.previousManifest?.components.source;
    const nextSource = journal.nextManifest?.components.source;
    if ((componentSwitchEffect(journal, "source") || switched) && nextSource?.provider === "release" && previousSource?.provider !== "git") {
        await rollbackReleaseSource(root, join(journal.backupRoot, "source"), previousSource?.provider === "release" ? previousSource.files : [], nextSource.files);
    }
    if (compose?.previousCompose && await pathExists(compose.previousCompose)) await copyFile(compose.previousCompose, currentCompose);
    else if (compose?.created) await removePath(currentCompose);
    if (journal.previousManifest && isDockerProfile(journal.previousManifest.profile) && compose?.previousState === "running") {
        const execution = await verifyApplicationExecution(root, journal.previousManifest);
        if (execution.kind !== "container-product") {
            throw new Error("Operation recovery 需要已验证的 Container Product identity。");
        }
        await startDocker(
            execution.image,
            root,
            resolveInstallationRoots(root, journal.previousManifest.roots).state,
            journal.previousManifest.profile,
            journal.previousManifest.appVersion,
        );
    }
    const wrapper = operationEffect(journal, "wrapper-switch");
    if (wrapper) {
        const runtimeBin = join(root, ".runtime", "bin");
        const backupExists = Boolean(wrapper.backupPath && await pathExists(wrapper.backupPath));
        if (wrapper.previousState === "present" && !backupExists) {
            if (wrapper.state === "applied") {
                throw new Error(`Wrapper切换已应用但恢复副本不存在，拒绝删除当前wrapper：${wrapper.backupPath ?? "<missing>"}`);
            }
        } else {
            await removePath(runtimeBin);
        }
        if (wrapper.previousState === "present" && wrapper.backupPath && backupExists) {
            await ensureDirectory(resolve(runtimeBin, ".."));
            await cp(wrapper.backupPath, runtimeBin, {recursive: true});
        }
    }
    const rollbackEffects = [...journal.effects];
    const receipt = operationEffect(journal, "receipt-switch");
    if (receipt) {
        const receiptPath = installationTarget(root, receipt.path);
        try {
            if (receipt.previousState === "present") {
                if (!receipt.backupPath || !await pathExists(receipt.backupPath)) {
                    throw new Error(`Product Runtime receipt恢复副本不存在：${receipt.backupPath ?? "<missing>"}`);
                }
                await ensureDirectory(resolve(receiptPath, ".."));
                await copyFile(receipt.backupPath, receiptPath);
            } else {
                await rm(receiptPath, {force: true});
            }
            if (receipt.backupPath) await rm(receipt.backupPath, {force: true});
            const index = rollbackEffects.findIndex((candidate) => candidate.kind === "receipt-switch");
            if (index >= 0) rollbackEffects[index] = {...receipt, state: "applied", cleanupError: undefined};
        } catch (error) {
            const index = rollbackEffects.findIndex((candidate) => candidate.kind === "receipt-switch");
            if (index >= 0) rollbackEffects[index] = {...receipt, cleanupError: error instanceof Error ? error.message : String(error)};
        }
    }
    if (!journal.previousManifest && operationEffect(journal, "git-checkout")) await removeMaterializedRepository(root);
    for (const effect of [...journal.effects].reverse()) {
        if (effect.kind !== "path-create" || effect.owner === "state") continue;
        try {
            await removePath(operationEffectTarget(journal, effect));
        } catch (error) {
            const index = rollbackEffects.findIndex((candidate) => effectIdentity(candidate) === effectIdentity(effect));
            rollbackEffects[index] = {...effect, cleanupError: error instanceof Error ? error.message : String(error)};
        }
    }
    const image = operationEffect(journal, "docker-image");
    if (image) {
        try {
            await removeDockerImage(requiredContainerEngine(journal), root, image.image);
        } catch (error) {
            const index = rollbackEffects.findIndex((candidate) => candidate.kind === "docker-image");
            rollbackEffects[index] = {...image, cleanupError: error instanceof Error ? error.message : String(error)};
        }
    }
    const manifestPath = join(root, ".deploy", "installation.json");
    if (journal.previousManifest) await writeInstallationManifest(manifestPath, journal.previousManifest);
    else if (operationEffect(journal, "manifest-switch")) await rm(manifestPath, {force: true});
    const committed = await updateOperation(journal, "committed", {outcome: "rolled-back", effects: rollbackEffects});
    // 本轮 rollback 只记录 cleanup error；下一次 mutation 再重试，避免同一调用
    // 同时产生“失败”和“已清理”两种互相矛盾的观察结果。
    await removeCleanJournal(committed);
}

/** 在切换稳定wrapper前备份现有`.runtime/bin`。 */
export async function backupRuntimeWrappers(root: string, backupRoot: string): Promise<string | undefined> {
    const runtimeBin = join(root, ".runtime", "bin");
    if (!await pathExists(runtimeBin)) return undefined;
    const backup = join(backupRoot, "runtime-bin");
    const temporary = join(backupRoot, "runtime-bin.pending");
    await removePath(backup);
    await removePath(temporary);
    await ensureDirectory(resolve(backup, ".."));
    await cp(runtimeBin, temporary, {recursive: true});
    await rename(temporary, backup);
    return backup;
}

function writeOperation(journal: OperationJournal): Promise<void> {
    return writeJsonAtomic(operationJournalPath(journal), journal);
}

/** cleanup 全部成功后 Journal 已无恢复价值；只有具体 cleanupError 才保留重试依据。 */
async function removeCleanJournal(journal: OperationJournal): Promise<void> {
    if (journal.effects.some((effect) => "cleanupError" in effect && effect.cleanupError)) return;
    await rm(operationJournalPath(journal), {force: true});
}

/**
 * Portable 只允许移动已经 committed 且没有 cleanup error 的崩溃窗口。
 *
 * 未提交事务或明确残留 cleanup error 仍必须移回原位置处理，避免把待恢复的
 * Product/数据库绝对身份静默改写成另一棵目录。
 */
function rebaseMovedPortableCommit(journal: OperationJournal, currentRoot: string, journalPath: string): OperationJournal {
    const manifests = [journal.previousManifest, journal.nextManifest].filter(
        (manifest): manifest is InstallationManifest => manifest !== null,
    );
    const cleanupFailed = journal.effects.some((effect) => "cleanupError" in effect && Boolean(effect.cleanupError));
    if (
        journal.phase !== "committed"
        || cleanupFailed
        || manifests.length === 0
        || manifests.some((manifest) => manifest.profile !== "windows-portable")
    ) {
        throw new Error(`Operation journal的Installation Root不匹配；未完成或待清理的Portable必须移回原位置：${journalPath}`);
    }
    const oldRoot = resolve(journal.root);
    const newRoot = resolve(currentRoot);
    const rebase = (path: string): string => {
        const nested = relative(oldRoot, resolve(path));
        if (nested === ".." || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
            throw new Error(`Committed Portable journal包含Installation Root外路径，拒绝移动恢复：${path}`);
        }
        return resolve(newRoot, nested);
    };
    const effects = journal.effects.map((effect): OperationEffect => {
        if (effect.kind === "wrapper-switch" && effect.backupPath) {
            return {...effect, backupPath: rebase(effect.backupPath)};
        }
        if (effect.kind === "receipt-switch" && effect.backupPath) {
            return {...effect, backupPath: rebase(effect.backupPath)};
        }
        if (effect.kind === "compose" && effect.previousCompose) {
            return {...effect, previousCompose: rebase(effect.previousCompose)};
        }
        if (effect.kind === "sqlite-backup") {
            return {
                ...effect,
                stateRoot: rebase(effect.stateRoot),
                hostPath: rebase(effect.hostPath),
                backupPath: rebase(effect.backupPath),
            };
        }
        return effect;
    });
    return {
        ...journal,
        root: newRoot,
        backupRoot: rebase(journal.backupRoot),
        ...(journal.migrationRoot ? {migrationRoot: rebase(journal.migrationRoot)} : {}),
        effects,
    };
}

function samePath(left: string, right: string): boolean {
    const normalize = (path: string): string => process.platform === "win32"
        ? resolve(path).toLocaleLowerCase("en-US")
        : resolve(path);
    return normalize(left) === normalize(right);
}

function operationPathOwner(path: string): OperationPathOwner {
    const normalized = path.replaceAll("\\", "/");
    if (normalized.startsWith(".deploy/staging/")) return "staging";
    if (normalized.startsWith(".deploy/backups/") || normalized.startsWith("manager-state/backups/")) return "backup";
    if (normalized === "node_modules") return "source";
    if (normalized.startsWith(".runtime/bun/")) return "runtime";
    if (normalized.startsWith(".runtime/tools/")) return "tool";
    if (normalized.startsWith(".runtime/manager/")) return "manager";
    if (normalized === ".runtime/bin") return "wrapper";
    const launchers = new Set(["Start Neuro Book.cmd", "Start Neuro Book.ps1", "Update Neuro Book.cmd", "Update Neuro Book.ps1", "Create Admin.cmd", "Create Admin.ps1"]);
    if (launchers.has(normalized)) return "portable-launcher";
    throw new Error(`无法从固定Installation布局确定Effect owner：${path}`);
}

function operationBackupEffectPath(input: OperationInput): string {
    const paths = installationPaths(input.root, input.roots);
    const relativeBackup = relative(paths.managerState, resolve(input.backupRoot)).replaceAll("\\", "/");
    if (paths.managerState === paths.deploy) {
        return relative(input.root, input.backupRoot).replaceAll("\\", "/");
    }
    return `manager-state/${relativeBackup}`;
}

function operationJournalPath(journal: OperationJournal): string {
    const paths = installationPaths(journal.root, journal.roots);
    return join(paths.operations, `${journal.id}.json`);
}

function operationEffectTarget(
    journal: OperationJournal,
    effect: Extract<OperationEffect, {kind: "path-create" | "path-retire"}>,
): string {
    if (effect.kind === "path-create" && effect.owner === "backup" && effect.path.startsWith("manager-state/")) {
        const paths = installationPaths(journal.root, journal.roots);
        return installationTarget(paths.managerState, effect.path.slice("manager-state/".length));
    }
    return installationTarget(journal.root, effect.path);
}

function upsertEffect(effects: OperationEffect[], effect: OperationEffect): OperationEffect[] {
    const identity = effectIdentity(effect);
    return [...effects.filter((candidate) => effectIdentity(candidate) !== identity), effect];
}

function effectIdentity(effect: OperationEffect): string {
    if (effect.kind === "path-create" || effect.kind === "path-retire") return `${effect.kind}:${effect.path}`;
    if (effect.kind === "component-switch") return `${effect.kind}:${effect.owner}`;
    return effect.kind;
}

function isDockerProfile(profile: InstallationManifest["profile"]): profile is "ghcr" | "source-docker" {
    return profile === "ghcr" || profile === "source-docker";
}

function requiredContainerEngine(journal: OperationJournal): NonNullable<OperationJournal["containerEngine"]> {
    if (!journal.containerEngine) throw new Error(`Operation ${journal.id}缺少Container Engine。`);
    return journal.containerEngine;
}
