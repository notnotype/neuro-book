import {createHash, randomUUID} from "node:crypto";
import {access, appendFile, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join, posix, relative, sep} from "node:path";
import {createClient, type Client, type InValue} from "@libsql/client";
import {z} from "zod";
import {mergeRpOocKnowledge, readRpCognitionState, type RpCognitionState} from "nbook/server/rp/cognition-store";
import {readRpIntake} from "nbook/server/rp/intake-store";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {ensureRpWorldDatabase, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import type {
    RpConsistencyIssueDto,
    RpTimelineNodeDto,
    RpTimelineProblemReportDto,
    RpTimelinePreviewDto,
    RpTimelineRestoreResultDto,
    RpTimelineTreeDto,
} from "nbook/shared/dto/rp-runtime.dto";

export const RP_TIMELINE_ROOT = ".nbook/rp/branches";
export const RP_TIMELINE_TREE_PATH = `${RP_TIMELINE_ROOT}/tree.json`;
export const RP_TIMELINE_LEDGER_PATH = `${RP_TIMELINE_ROOT}/ledger.jsonl`;
export const RP_TIMELINE_PROBLEM_ROOT = `${RP_TIMELINE_ROOT}/problems`;
export const RP_TIMELINE_MAX_CHILDREN = 4 as const;
export const RP_TIMELINE_FULL_INTERVAL = 10;

const WORLD_EXPORT_PATH = ".nbook/world-rp.export.json";
const WORLD_DATABASE_PATH = ".nbook/world-rp.sqlite";
const SNAPSHOT_ROOTS = [".nbook/rp/runtime", "rp/ticks", "rp/dice", "rp/characters"] as const;
const TERMINAL_TURN_STATUSES = new Set(["committed", "failed", "cancelled"]);

type TimelineTreeState = Omit<RpTimelineTreeDto, "archivedNodeCount">;

type TimelineManifest = {
    schemaVersion: 1;
    nodeId: string;
    storage: "full" | "delta";
    parentId: string | null;
    hashes: Record<string, string>;
    changedPaths: string[];
    deletedPaths: string[];
    integrityHash: string;
};

type WorldExport = {
    schemaVersion: 1;
    subjects: Array<{id: string; type: string; name: string}>;
    slices: Array<{id: string; instant: string; title: string; summary: string; kind: string}>;
    patches: Array<{
        id: string;
        sliceId: string;
        subjectId: string;
        instant: string;
        seq: number;
        path: string;
        op: string;
        value: string | null;
        summary: string | null;
        text: string | null;
        vectorBase64: string | null;
        model: string | null;
    }>;
    operations: Array<{id: string; result: string; createdAt: string}>;
};

const TimelineNodeSchema: z.ZodType<RpTimelineNodeDto> = z.object({
    id: z.string(), parentId: z.string().nullable(), childrenIds: z.array(z.string()), label: z.string(), summary: z.string(),
    kind: z.enum(["root", "turn", "checkpoint", "safety"]), storage: z.enum(["full", "delta"]), depth: z.number().int().nonnegative(),
    locked: z.boolean(), archived: z.boolean(), turnId: z.string().nullable(), tick: z.number().int().positive().nullable(), createdAt: z.string(),
    worldSliceCount: z.number().int().nonnegative(), worldSubjectCount: z.number().int().nonnegative(), logicalFileCount: z.number().int().nonnegative(), logicalBytes: z.number().int().nonnegative(),
});
const TimelineTreeSchema: z.ZodType<TimelineTreeState> = z.object({
    schemaVersion: z.literal(1), rootId: z.string(), activeNodeId: z.string(), nodes: z.array(TimelineNodeSchema),
    maxChildren: z.literal(4), fullSnapshotInterval: z.number().int().positive(), updatedAt: z.string(),
});
const ManifestSchema: z.ZodType<TimelineManifest> = z.object({
    schemaVersion: z.literal(1), nodeId: z.string(), storage: z.enum(["full", "delta"]), parentId: z.string().nullable(),
    hashes: z.record(z.string(), z.string()), changedPaths: z.array(z.string()), deletedPaths: z.array(z.string()), integrityHash: z.string(),
});
const WorldExportSchema: z.ZodType<WorldExport> = z.object({
    schemaVersion: z.literal(1),
    subjects: z.array(z.object({id: z.string(), type: z.string(), name: z.string()})),
    slices: z.array(z.object({id: z.string(), instant: z.string(), title: z.string(), summary: z.string(), kind: z.string()})),
    patches: z.array(z.object({
        id: z.string(), sliceId: z.string(), subjectId: z.string(), instant: z.string(), seq: z.number().int(), path: z.string(), op: z.string(),
        value: z.string().nullable(), summary: z.string().nullable(), text: z.string().nullable(), vectorBase64: z.string().nullable(), model: z.string().nullable(),
    })),
    operations: z.array(z.object({id: z.string(), result: z.string(), createdAt: z.string()})),
});
const TurnStatusSchema = z.object({status: z.string()});
const locks = new Map<string, Promise<void>>();

/** 读取玩家可见的时间线树；尚未初始化时返回 null，不在 GET 中产生写入。 */
export async function readRpTimelineTree(projectRoot: string): Promise<RpTimelineTreeDto | null> {
    const state = await readTreeState(projectRoot);
    return state ? toTreeDto(state) : null;
}

/**
 * 校验切片树索引与恢复材料。childrenIds 是可由 parentId 唯一重建的派生索引，允许安全自动修复。
 * deep 模式会逐个物化所有可用节点；其他模式只验证 active 节点。
 */
export async function inspectRpTimelineIntegrity(projectRoot: string, input: {
    deep: boolean;
    repairIndexes: boolean;
}): Promise<{issues: RpConsistencyIssueDto[]; repaired: Array<{code: string; scope: string; message: string}>}> {
    return withTimelineLock(projectRoot, async () => {
        const state = await readTreeState(projectRoot);
        if (!state) return {issues: [], repaired: []};
        const issues: RpConsistencyIssueDto[] = [];
        const repaired: Array<{code: string; scope: string; message: string}> = [];
        const nodeIds = new Set(state.nodes.map((node) => node.id));
        if (!nodeIds.has(state.rootId) || !nodeIds.has(state.activeNodeId)) {
            issues.push({code: "timeline.anchor_missing", severity: "error", scope: "timeline", message: "切片树的根节点或 active 节点不存在。", repair: "player_confirmation"});
            return {issues, repaired};
        }
        let indexChanged = false;
        for (const node of state.nodes) {
            if (node.parentId && !nodeIds.has(node.parentId)) {
                issues.push({code: "timeline.parent_missing", severity: "error", scope: node.id, message: `切片 ${node.label} 引用了不存在的父节点。`, repair: "player_confirmation"});
                continue;
            }
            const expected = state.nodes.filter((child) => !child.archived && child.parentId === node.id).map((child) => child.id);
            if (JSON.stringify([...node.childrenIds].sort()) !== JSON.stringify(expected.sort())) {
                issues.push({code: "timeline.children_index", severity: "warning", scope: node.id, message: `切片 ${node.label} 的子节点索引与 parentId 不一致。`, repair: "automatic"});
                if (input.repairIndexes) {
                    node.childrenIds = expected;
                    indexChanged = true;
                }
            }
        }
        if (indexChanged) {
            state.updatedAt = new Date().toISOString();
            await writeTreeState(projectRoot, state);
            repaired.push({code: "timeline.children_index", scope: "timeline", message: "已依据 parentId 重建切片树子节点索引。"});
        }
        const targets = input.deep ? state.nodes.filter((node) => !node.archived) : [requireNode(state, state.activeNodeId)];
        for (const node of targets) {
            try {
                await materializeNode(projectRoot, state, node.id);
            } catch (error) {
                issues.push({code: "timeline.material_corrupt", severity: "error", scope: node.id, message: errorMessage(error), repair: "player_confirmation"});
            }
        }
        return {issues, repaired};
    });
}

/**
 * 诊断目标切片的恢复材料，并沿祖先链寻找最近仍可完整验证的节点。只写问题报告，不自动改变时间线。
 */
export async function diagnoseRpTimelineNode(projectRoot: string, nodeId: string): Promise<RpTimelineProblemReportDto | null> {
    const state = requireTree(await readTreeState(projectRoot));
    const target = requireNode(state, nodeId);
    try {
        await materializeNode(projectRoot, state, target.id);
        return null;
    } catch (error) {
        const attemptedNodeIds = [target.id];
        let ancestor = target.parentId ? requireNode(state, target.parentId) : null;
        let verified: RpTimelineNodeDto | null = null;
        while (ancestor) {
            attemptedNodeIds.push(ancestor.id);
            try {
                await materializeNode(projectRoot, state, ancestor.id);
                verified = ancestor;
                break;
            } catch {
                ancestor = ancestor.parentId ? requireNode(state, ancestor.parentId) : null;
            }
        }
        const id = `problem-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const reportPath = `${RP_TIMELINE_PROBLEM_ROOT}/${id}.json`;
        const report: RpTimelineProblemReportDto = {
            schemaVersion: 1, id, targetNodeId: target.id, targetLabel: target.label, failure: errorMessage(error), attemptedNodeIds,
            lastVerifiedNodeId: verified?.id ?? null, lastVerifiedLabel: verified?.label ?? null,
            options: ["retry", ...(verified ? ["restore_last_verified" as const] : []), "keep_current", "inspect_report"],
            reportPath, createdAt: new Date().toISOString(),
        };
        await writeJsonAtomic(join(projectRoot, reportPath), report);
        await appendLedger(projectRoot, {op: "diagnose_failure", nodeId: target.id, reportId: id, lastVerifiedNodeId: verified?.id ?? null, at: report.createdAt});
        return report;
    }
}

/** 初始化根检查点；根节点永久锁定并代表启用分支功能时的完整状态。 */
export async function initializeRpTimeline(projectRoot: string, label = "当前时间线起点"): Promise<RpTimelineTreeDto> {
    await assertAdventureActive(projectRoot);
    await assertNoIncompleteTurns(projectRoot);
    return withTimelineLock(projectRoot, async () => {
        const existing = await readTreeState(projectRoot);
        if (existing) return toTreeDto(existing);
        const now = new Date().toISOString();
        const empty: TimelineTreeState = {
            schemaVersion: 1, rootId: "", activeNodeId: "", nodes: [], maxChildren: RP_TIMELINE_MAX_CHILDREN,
            fullSnapshotInterval: RP_TIMELINE_FULL_INTERVAL, updatedAt: now,
        };
        const captured = await captureNode(projectRoot, empty, {label, summary: "启用世界切片树时的完整状态", kind: "root", turnId: null, tick: null, replaceNodeId: null});
        captured.rootId = captured.activeNodeId;
        const root = requireNode(captured, captured.rootId);
        root.locked = true;
        await writeTreeState(projectRoot, captured);
        await appendLedger(projectRoot, {op: "initialize", nodeId: root.id, at: now});
        return toTreeDto(captured);
    });
}

/** 手工建立检查点；分支点达到四个子节点时必须显式指定要归档的替换对象。 */
export async function createRpTimelineCheckpoint(projectRoot: string, input: {label: string; summary: string; replaceNodeId: string | null}): Promise<RpTimelineTreeDto> {
    await assertAdventureActive(projectRoot);
    await assertNoIncompleteTurns(projectRoot);
    return withTimelineLock(projectRoot, async () => {
        const state = requireTree(await readTreeState(projectRoot));
        const next = await captureNode(projectRoot, state, {label: input.label, summary: input.summary, kind: "checkpoint", turnId: null, tick: null, replaceNodeId: input.replaceNodeId});
        await writeTreeState(projectRoot, next);
        await appendLedger(projectRoot, {op: "checkpoint", nodeId: next.activeNodeId, at: next.updatedAt});
        return toTreeDto(next);
    });
}

/** 自动为已提交回合建立差量节点；时间线功能未初始化时保持无操作。 */
export async function captureCommittedRpTimeline(projectRoot: string, turn: {id: string; sequence: number; inputSummary: string}): Promise<void> {
    await withTimelineLock(projectRoot, async () => {
        const state = await readTreeState(projectRoot);
        if (!state || state.nodes.some((node) => node.turnId === turn.id)) return;
        const next = await captureNode(projectRoot, state, {
            label: `Tick #${turn.sequence}`,
            summary: turn.inputSummary,
            kind: "turn",
            turnId: turn.id,
            tick: turn.sequence,
            replaceNodeId: null,
        });
        await writeTreeState(projectRoot, next);
        await appendLedger(projectRoot, {op: "capture_turn", nodeId: next.activeNodeId, turnId: turn.id, at: next.updatedAt});
    });
}

/** 回合进入 world commit 前检查当前分支是否还有子节点容量。 */
export async function assertRpTimelineCommitCapacity(projectRoot: string): Promise<void> {
    const state = await readTreeState(projectRoot);
    if (!state) return;
    const active = requireNode(state, state.activeNodeId);
    if (liveChildren(state, active).length >= RP_TIMELINE_MAX_CHILDREN) {
        throw new Error("当前世界切片已经有 4 条直接分支；请先在世界切片管理器中选择一条未锁定分支作为替换对象，再继续本回合。");
    }
}

/** 锁定或解锁检查点；根节点不可解锁。 */
export async function setRpTimelineNodeLock(projectRoot: string, nodeId: string, locked: boolean): Promise<RpTimelineTreeDto> {
    return withTimelineLock(projectRoot, async () => {
        const state = requireTree(await readTreeState(projectRoot));
        const node = requireNode(state, nodeId);
        if (node.id === state.rootId && !locked) throw new Error("根切片必须保持锁定。");
        node.locked = locked;
        state.updatedAt = new Date().toISOString();
        await writeTreeState(projectRoot, state);
        await appendLedger(projectRoot, {op: locked ? "lock" : "unlock", nodeId, at: state.updatedAt});
        return toTreeDto(state);
    });
}

/** 将当前 active 节点的一条直接子分支归档，为第五条分支腾出位置。 */
export async function archiveRpTimelineBranch(projectRoot: string, nodeId: string): Promise<RpTimelineTreeDto> {
    return withTimelineLock(projectRoot, async () => {
        const state = requireTree(await readTreeState(projectRoot));
        archiveReplacement(state, state.activeNodeId, nodeId);
        state.updatedAt = new Date().toISOString();
        await writeTreeState(projectRoot, state);
        await appendLedger(projectRoot, {op: "archive_branch", nodeId, parentId: state.activeNodeId, at: state.updatedAt});
        return toTreeDto(state);
    });
}

/** 校验并只读预览任意未归档节点；不改变 active 时间线。 */
export async function previewRpTimelineNode(projectRoot: string, nodeId: string): Promise<RpTimelinePreviewDto> {
    const state = requireTree(await readTreeState(projectRoot));
    const node = requireNode(state, nodeId);
    if (node.archived) throw new Error("该分支已经归档，不能从普通树视图预览。");
    const files = await materializeNode(projectRoot, state, node.id);
    const world = parseWorldExport(files.get(WORLD_EXPORT_PATH));
    const activeFiles = node.id === state.activeNodeId ? files : await materializeNode(projectRoot, state, state.activeNodeId);
    const activeWorld = parseWorldExport(activeFiles.get(WORLD_EXPORT_PATH));
    const summary = summarizeFiles(files, world);
    const activeSummary = summarizeFiles(activeFiles, activeWorld);
    return {
        node,
        activeNodeId: state.activeNodeId,
        pathNodeIds: pathToRoot(state, node.id).reverse(),
        summary,
        impact: {
            changedFiles: changedFileCount(activeFiles, files),
            categories: [
                impactCategory("turns", "正式回合", activeSummary.turns, summary.turns),
                impactCategory("events", "事件", activeSummary.events, summary.events),
                impactCategory("map", "地图节点", activeSummary.mapNodes, summary.mapNodes),
                impactCategory("npcs", "NPC 名册", activeSummary.npcs, summary.npcs),
                impactCategory("resources", "资源账户", activeSummary.resources, summary.resources),
                impactCategory("relations", "关系", activeSummary.relations, summary.relations),
                impactCategory("beliefs", "角色认知", activeSummary.beliefs, summary.beliefs),
                impactCategory("dice", "骰子记录", activeSummary.diceRolls, summary.diceRolls),
                impactCategory("worldSlices", "World Engine 切面", activeWorld?.slices.length ?? 0, world?.slices.length ?? 0),
            ],
        },
        integrity: "verified",
    };
}

/** 恢复到旧节点；可先建立完整安全切片，并始终保留玩家 OOC 认知。 */
export async function restoreRpTimelineNode(projectRoot: string, input: {
    nodeId: string;
    createSafety: boolean;
    safetyLabel: string;
    replaceNodeId: string | null;
}): Promise<RpTimelineRestoreResultDto> {
    await assertAdventureActive(projectRoot);
    await assertNoIncompleteTurns(projectRoot);
    const {runRpConsistencyCheck} = await import("nbook/server/rp/consistency-store");
    await runRpConsistencyCheck(projectRoot, "standard", true);
    const restored = await withTimelineLock(projectRoot, async () => {
        let state = requireTree(await readTreeState(projectRoot));
        const target = requireNode(state, input.nodeId);
        if (target.archived) throw new Error("归档分支不能直接恢复。");
        if (target.id === state.activeNodeId) throw new Error("该切片已经是当前 active 切片。");
        let files: Map<string, Uint8Array>;
        try {
            files = await materializeNode(projectRoot, state, target.id);
        } catch (error) {
            const report = await diagnoseRpTimelineNode(projectRoot, target.id);
            const fallback = report?.lastVerifiedLabel ? `最近可验证祖先为「${report.lastVerifiedLabel}」，必须由玩家确认后另行恢复。` : "未找到可验证祖先。";
            throw new Error(`目标切片材料损坏，已生成问题报告 ${report?.reportPath ?? ""}。${fallback} 原因：${errorMessage(error)}`);
        }
        const preservedCognition = await readRpCognitionState(projectRoot);
        let safetyNodeId: string | null = null;
        if (input.createSafety) {
            state = await captureNode(projectRoot, state, {
                label: input.safetyLabel, summary: `恢复到「${target.label}」之前自动保存`, kind: "safety", turnId: null, tick: null, replaceNodeId: input.replaceNodeId,
            });
            safetyNodeId = state.activeNodeId;
            await writeTreeState(projectRoot, state);
        }
        await restoreLogicalFiles(projectRoot, files);
        await restoreWorldExport(projectRoot, parseWorldExport(files.get(WORLD_EXPORT_PATH)));
        await mergeRpOocKnowledge(projectRoot, {oocKnowledge: preservedCognition.oocKnowledge, oocFacts: preservedCognition.oocFacts});
        state.activeNodeId = target.id;
        state.updatedAt = new Date().toISOString();
        await writeTreeState(projectRoot, state);
        await appendLedger(projectRoot, {op: "restore", fromNodeId: safetyNodeId ? requireNode(state, safetyNodeId).parentId : null, toNodeId: target.id, safetyNodeId, at: state.updatedAt});
        return {
            tree: toTreeDto(state), restoredNodeId: target.id, safetyNodeId,
            preservedOocFacts: preservedCognition.oocFacts.length, restoredAt: state.updatedAt,
        };
    });
    await runRpConsistencyCheck(projectRoot, "standard", true);
    return restored;
}

async function captureNode(projectRoot: string, source: TimelineTreeState, input: {
    label: string; summary: string; kind: RpTimelineNodeDto["kind"]; turnId: string | null; tick: number | null; replaceNodeId: string | null;
}): Promise<TimelineTreeState> {
    const state = cloneTree(source);
    const parent = state.activeNodeId ? requireNode(state, state.activeNodeId) : null;
    if (parent && liveChildren(state, parent).length >= RP_TIMELINE_MAX_CHILDREN) {
        if (!input.replaceNodeId) throw new Error("当前切片已有 4 条直接分支，必须选择一条未锁定分支进行替换。");
        archiveReplacement(state, parent.id, input.replaceNodeId);
    } else if (input.replaceNodeId) {
        throw new Error("当前切片尚未达到 4 条分支，不需要替换已有分支。");
    }
    const files = await captureLogicalFiles(projectRoot);
    const parentManifest = parent ? await readManifest(projectRoot, parent.id) : null;
    const depth = parent ? parent.depth + 1 : 0;
    const branching = Boolean(parent && liveChildren(state, parent).length > 0);
    const storage: "full" | "delta" = input.kind === "root" || input.kind === "safety" || branching || depth % RP_TIMELINE_FULL_INTERVAL === 0 ? "full" : "delta";
    const id = `slice-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const hashes = hashFiles(files);
    const changedPaths = storage === "full" ? [...hashes.keys()] : [...hashes.keys()].filter((path) => parentManifest?.hashes[path] !== hashes.get(path));
    const deletedPaths = storage === "full" ? [] : Object.keys(parentManifest?.hashes ?? {}).filter((path) => !hashes.has(path));
    const manifest: TimelineManifest = {
        schemaVersion: 1, nodeId: id, storage, parentId: parent?.id ?? null, hashes: Object.fromEntries([...hashes].sort(([a], [b]) => a.localeCompare(b))),
        changedPaths: changedPaths.sort(), deletedPaths: deletedPaths.sort(), integrityHash: "",
    };
    manifest.integrityHash = manifestHash(manifest);
    await writeNodeMaterial(projectRoot, manifest, files);
    const world = parseWorldExport(files.get(WORLD_EXPORT_PATH));
    const now = new Date().toISOString();
    const node: RpTimelineNodeDto = {
        id, parentId: parent?.id ?? null, childrenIds: [], label: requireLabel(input.label), summary: input.summary.trim(), kind: input.kind, storage, depth,
        locked: input.kind === "root", archived: false, turnId: input.turnId, tick: input.tick, createdAt: now,
        worldSliceCount: world?.slices.length ?? 0, worldSubjectCount: world?.subjects.length ?? 0,
        logicalFileCount: files.size, logicalBytes: [...files.values()].reduce((total, value) => total + value.byteLength, 0),
    };
    state.nodes.push(node);
    if (parent) parent.childrenIds.push(node.id);
    state.activeNodeId = node.id;
    state.updatedAt = now;
    return state;
}

async function captureLogicalFiles(projectRoot: string): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    for (const root of SNAPSHOT_ROOTS) await collectFiles(projectRoot, root, files);
    const world = await exportWorld(projectRoot);
    if (world) files.set(WORLD_EXPORT_PATH, encodeJson(world));
    return files;
}

async function collectFiles(projectRoot: string, relativeRoot: string, files: Map<string, Uint8Array>): Promise<void> {
    const absoluteRoot = join(projectRoot, ...relativeRoot.split("/"));
    let entries;
    try {
        entries = await readdir(absoluteRoot, {withFileTypes: true});
    } catch (error) {
        if (isNotFound(error)) return;
        throw error;
    }
    for (const entry of entries) {
        const absolute = join(absoluteRoot, entry.name);
        const logical = posix.join(relativeRoot, relative(absoluteRoot, absolute).split(sep).join("/"));
        if (entry.isSymbolicLink()) throw new Error(`世界切片不接受符号链接：${logical}`);
        if (entry.isDirectory()) await collectFiles(projectRoot, logical, files);
        else if (entry.isFile()) files.set(logical, await readFile(absolute));
    }
}

async function writeNodeMaterial(projectRoot: string, manifest: TimelineManifest, files: Map<string, Uint8Array>): Promise<void> {
    for (const logical of manifest.changedPaths) {
        assertLogicalPath(logical);
        const value = files.get(logical);
        if (!value) throw new Error(`切片载荷缺少声明文件：${logical}`);
        const target = payloadPath(projectRoot, manifest.nodeId, logical);
        await mkdir(dirname(target), {recursive: true});
        await writeFile(target, value);
    }
    await writeJsonAtomic(manifestPath(projectRoot, manifest.nodeId), manifest);
}

async function materializeNode(projectRoot: string, state: TimelineTreeState, nodeId: string): Promise<Map<string, Uint8Array>> {
    const chain = pathToRoot(state, nodeId).reverse();
    const files = new Map<string, Uint8Array>();
    let foundFull = false;
    for (const id of chain) {
        const manifest = await readManifest(projectRoot, id);
        if (manifest.storage === "full") {
            files.clear();
            foundFull = true;
        } else if (!foundFull) {
            continue;
        }
        for (const logical of manifest.deletedPaths) files.delete(logical);
        for (const logical of manifest.changedPaths) {
            assertLogicalPath(logical);
            const value = await readFile(payloadPath(projectRoot, id, logical));
            if (sha256(value) !== manifest.hashes[logical]) throw new Error(`世界切片 ${id} 的文件校验失败：${logical}`);
            files.set(logical, value);
        }
    }
    if (!foundFull) throw new Error(`世界切片 ${nodeId} 找不到完整基线。`);
    const targetManifest = await readManifest(projectRoot, nodeId);
    const actual = Object.fromEntries([...hashFiles(files)].sort(([a], [b]) => a.localeCompare(b)));
    if (JSON.stringify(actual) !== JSON.stringify(targetManifest.hashes)) throw new Error(`世界切片 ${nodeId} 的最终文件索引不一致。`);
    return files;
}

async function restoreLogicalFiles(projectRoot: string, files: Map<string, Uint8Array>): Promise<void> {
    for (const root of SNAPSHOT_ROOTS) {
        const target = join(projectRoot, ...root.split("/"));
        await rm(target, {recursive: true, force: true});
    }
    for (const [logical, value] of files) {
        if (logical === WORLD_EXPORT_PATH) continue;
        assertLogicalPath(logical);
        const target = join(projectRoot, ...logical.split("/"));
        await mkdir(dirname(target), {recursive: true});
        await writeFile(target, value);
    }
}

async function exportWorld(projectRoot: string): Promise<WorldExport | null> {
    const databasePath = join(projectRoot, WORLD_DATABASE_PATH);
    if (!(await exists(databasePath))) return null;
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        await client.execute("BEGIN TRANSACTION READONLY");
        const subjects = (await client.execute(`SELECT "id", "type", "name" FROM "WorldSubject" ORDER BY "id"`)).rows.map((row) => ({id: textColumn(row.id), type: textColumn(row.type), name: textColumn(row.name)}));
        const slices = (await client.execute(`SELECT "id", "instant", "title", "summary", "kind" FROM "WorldSlice" ORDER BY "instant", "id"`)).rows.map((row) => ({id: textColumn(row.id), instant: integerText(row.instant), title: textColumn(row.title), summary: textColumn(row.summary), kind: textColumn(row.kind)}));
        const patches = (await client.execute(`SELECT "id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value", "summary", "text", "vector", "model" FROM "WorldPatch" ORDER BY "instant", "seq", "id"`)).rows.map((row) => ({
            id: textColumn(row.id), sliceId: textColumn(row.sliceId), subjectId: textColumn(row.subjectId), instant: integerText(row.instant), seq: numberColumn(row.seq), path: textColumn(row.path), op: textColumn(row.op),
            value: nullableText(row.value), summary: nullableText(row.summary), text: nullableText(row.text), vectorBase64: blobBase64(row.vector), model: nullableText(row.model),
        }));
        const operations = await hasTable(client, "WorldOperation") ? (await client.execute(`SELECT "id", "result", "createdAt" FROM "WorldOperation" ORDER BY "createdAt", "id"`)).rows.map((row) => ({id: textColumn(row.id), result: textColumn(row.result), createdAt: textColumn(row.createdAt)})) : [];
        await client.execute("COMMIT");
        return {schemaVersion: 1, subjects, slices, patches, operations};
    } catch (error) {
        try { await client.execute("ROLLBACK"); } catch { /* 原始导出错误优先。 */ }
        throw error;
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

async function restoreWorldExport(projectRoot: string, world: WorldExport | null): Promise<void> {
    const databasePath = join(projectRoot, WORLD_DATABASE_PATH);
    await ensureRpWorldDatabase(databasePath);
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        await client.execute("BEGIN IMMEDIATE");
        await client.execute(`DELETE FROM "WorldPatch"`);
        await client.execute(`DELETE FROM "WorldSlice"`);
        await client.execute(`DELETE FROM "WorldSubject"`);
        if (await hasTable(client, "WorldOperation")) await client.execute(`DELETE FROM "WorldOperation"`);
        for (const subject of world?.subjects ?? []) await execute(client, `INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, ?, ?)`, [subject.id, subject.type, subject.name]);
        for (const slice of world?.slices ?? []) await execute(client, `INSERT INTO "WorldSlice" ("id", "instant", "title", "summary", "kind") VALUES (?, ?, ?, ?, ?)`, [slice.id, BigInt(slice.instant), slice.title, slice.summary, slice.kind]);
        for (const patch of world?.patches ?? []) await execute(client, `INSERT INTO "WorldPatch" ("id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value", "summary", "text", "vector", "model") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            patch.id, patch.sliceId, patch.subjectId, BigInt(patch.instant), patch.seq, patch.path, patch.op, patch.value, patch.summary, patch.text,
            patch.vectorBase64 ? Uint8Array.from(Buffer.from(patch.vectorBase64, "base64")) : null, patch.model,
        ]);
        if (world?.operations.length) {
            await client.execute(`CREATE TABLE IF NOT EXISTS "WorldOperation" ("id" TEXT PRIMARY KEY NOT NULL, "result" TEXT NOT NULL, "createdAt" TEXT NOT NULL)`);
            for (const operation of world.operations) await execute(client, `INSERT INTO "WorldOperation" ("id", "result", "createdAt") VALUES (?, ?, ?)`, [operation.id, operation.result, operation.createdAt]);
        }
        await client.execute("COMMIT");
    } catch (error) {
        try { await client.execute("ROLLBACK"); } catch { /* 原始恢复错误优先。 */ }
        throw error;
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

function summarizeFiles(files: Map<string, Uint8Array>, world: WorldExport | null): RpTimelinePreviewDto["summary"] {
    return {
        events: arrayLength(files, ".nbook/rp/runtime/events/state.json", "events"),
        activeEvents: arrayCount(files, ".nbook/rp/runtime/events/state.json", "events", (item) => typeof item === "object" && item !== null && "status" in item && ["selected", "active", "suspended"].includes(String(item.status))),
        npcs: arrayLength(files, ".nbook/rp/runtime/npcs/state.json", "npcs"),
        resources: arrayLength(files, ".nbook/rp/runtime/mechanics/state.json", "accounts"),
        beliefs: arrayLength(files, ".nbook/rp/runtime/cognition/state.json", "beliefs"),
        mapNodes: arrayLength(files, ".nbook/rp/runtime/map/state.json", "nodes"),
        relations: arrayLength(files, ".nbook/rp/runtime/relations/state.json", "edges"),
        diceRolls: jsonLineCount(files.get("rp/dice/rolls.jsonl")),
        turns: [...files.keys()].filter((path) => /^\.nbook\/rp\/runtime\/turns\/[^/]+\.json$/u.test(path)).length,
        latestWorldInstant: world?.slices.at(-1)?.instant ?? null,
    };
}

function impactCategory(key: RpTimelinePreviewDto["impact"]["categories"][number]["key"], label: string, activeValue: number, targetValue: number): RpTimelinePreviewDto["impact"]["categories"][number] {
    return {key, label, activeValue, targetValue};
}

function changedFileCount(active: Map<string, Uint8Array>, target: Map<string, Uint8Array>): number {
    const activeHashes = hashFiles(active);
    const targetHashes = hashFiles(target);
    return new Set([...activeHashes.keys(), ...targetHashes.keys()]).size
        - [...activeHashes.keys()].filter((path) => activeHashes.get(path) === targetHashes.get(path)).length;
}

function jsonLineCount(value: Uint8Array | undefined): number {
    if (!value) return 0;
    return Buffer.from(value).toString("utf-8").split(/\r?\n/u).filter((line) => line.trim()).length;
}

function arrayLength(files: Map<string, Uint8Array>, path: string, key: string): number {
    const value = parseJsonObject(files.get(path));
    return Array.isArray(value?.[key]) ? value[key].length : 0;
}

function arrayCount(files: Map<string, Uint8Array>, path: string, key: string, predicate: (item: object) => boolean): number {
    const value = parseJsonObject(files.get(path));
    const list = value?.[key];
    return Array.isArray(list) ? list.filter((item): item is object => typeof item === "object" && item !== null).filter(predicate).length : 0;
}

function parseJsonObject(value: Uint8Array | undefined): {[key: string]: unknown} | null {
    if (!value) return null;
    const parsed: unknown = JSON.parse(Buffer.from(value).toString("utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as {[key: string]: unknown} : null;
}

function parseWorldExport(value: Uint8Array | undefined): WorldExport | null {
    if (!value) return null;
    const parsed: unknown = JSON.parse(Buffer.from(value).toString("utf-8"));
    return WorldExportSchema.parse(parsed);
}

function archiveReplacement(state: TimelineTreeState, parentId: string, nodeId: string): void {
    const parent = requireNode(state, parentId);
    const node = requireNode(state, nodeId);
    if (!parent.childrenIds.includes(node.id) || node.parentId !== parent.id) throw new Error("替换对象必须是当前切片的直接子分支。");
    if (node.id === state.rootId || node.id === state.activeNodeId || node.locked) throw new Error("根切片、active 切片或已锁定切片不能替换。");
    const stack = [node.id];
    while (stack.length) {
        const current = requireNode(state, stack.pop()!);
        current.archived = true;
        stack.push(...current.childrenIds);
    }
    parent.childrenIds = parent.childrenIds.filter((id) => id !== node.id);
}

function liveChildren(state: TimelineTreeState, node: RpTimelineNodeDto): RpTimelineNodeDto[] {
    return node.childrenIds.map((id) => requireNode(state, id)).filter((child) => !child.archived);
}

function pathToRoot(state: TimelineTreeState, nodeId: string): string[] {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: RpTimelineNodeDto | null = requireNode(state, nodeId);
    while (current) {
        if (seen.has(current.id)) throw new Error("世界切片树存在父节点环。");
        seen.add(current.id);
        path.push(current.id);
        current = current.parentId ? requireNode(state, current.parentId) : null;
    }
    return path;
}

function requireNode(state: TimelineTreeState, nodeId: string): RpTimelineNodeDto {
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error(`未找到世界切片：${nodeId}`);
    return node;
}

function requireTree(state: TimelineTreeState | null): TimelineTreeState {
    if (!state) throw new Error("世界切片树尚未初始化。");
    return state;
}

function cloneTree(state: TimelineTreeState): TimelineTreeState {
    return {...state, nodes: state.nodes.map((node) => ({...node, childrenIds: [...node.childrenIds]}))};
}

function toTreeDto(state: TimelineTreeState): RpTimelineTreeDto {
    return {...state, nodes: state.nodes.filter((node) => !node.archived), archivedNodeCount: state.nodes.filter((node) => node.archived).length};
}

async function readTreeState(projectRoot: string): Promise<TimelineTreeState | null> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_TIMELINE_TREE_PATH), "utf-8"));
        return TimelineTreeSchema.parse(parsed);
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

async function writeTreeState(projectRoot: string, state: TimelineTreeState): Promise<void> {
    await writeJsonAtomic(join(projectRoot, RP_TIMELINE_TREE_PATH), TimelineTreeSchema.parse(state));
}

async function readManifest(projectRoot: string, nodeId: string): Promise<TimelineManifest> {
    const parsed: unknown = JSON.parse(await readFile(manifestPath(projectRoot, nodeId), "utf-8"));
    const manifest = ManifestSchema.parse(parsed);
    if (manifest.nodeId !== nodeId || manifest.integrityHash !== manifestHash(manifest)) throw new Error(`世界切片 ${nodeId} 的清单校验失败。`);
    return manifest;
}

function manifestHash(manifest: TimelineManifest): string {
    return sha256(Buffer.from(JSON.stringify({nodeId: manifest.nodeId, storage: manifest.storage, parentId: manifest.parentId, hashes: manifest.hashes, changedPaths: manifest.changedPaths, deletedPaths: manifest.deletedPaths}), "utf-8"));
}

function hashFiles(files: Map<string, Uint8Array>): Map<string, string> {
    return new Map([...files].map(([path, value]) => [path, sha256(value)]));
}

function sha256(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

function manifestPath(projectRoot: string, nodeId: string): string {
    return join(projectRoot, RP_TIMELINE_ROOT, "nodes", safeNodeId(nodeId), "manifest.json");
}

function payloadPath(projectRoot: string, nodeId: string, logical: string): string {
    assertLogicalPath(logical);
    return join(projectRoot, RP_TIMELINE_ROOT, "nodes", safeNodeId(nodeId), "payload", ...logical.split("/"));
}

function safeNodeId(nodeId: string): string {
    if (!/^slice-\d+-[a-f0-9]{8}$/u.test(nodeId)) throw new Error(`非法世界切片 id：${nodeId}`);
    return nodeId;
}

function assertLogicalPath(logical: string): void {
    const normalized = posix.normalize(logical);
    if (normalized !== logical || logical.startsWith("/") || logical.includes("..")) throw new Error(`非法切片文件路径：${logical}`);
    if (logical === WORLD_EXPORT_PATH) return;
    if (!SNAPSHOT_ROOTS.some((root) => logical === root || logical.startsWith(`${root}/`))) throw new Error(`切片文件超出 RP 恢复范围：${logical}`);
}

function requireLabel(value: string): string {
    const label = value.trim();
    if (!label || label.length > 120) throw new Error("世界切片名称必须为 1-120 个字符。");
    return label;
}

async function assertAdventureActive(projectRoot: string): Promise<void> {
    const intake = await readRpIntake(projectRoot);
    if (intake.phase !== "active") throw new Error(`世界切片树只能在 active 冒险中使用；当前为 ${intake.phase}。`);
}

async function assertNoIncompleteTurns(projectRoot: string): Promise<void> {
    const root = join(projectRoot, ".nbook/rp/runtime/turns");
    let entries;
    try { entries = await readdir(root, {withFileTypes: true}); } catch (error) { if (isNotFound(error)) return; throw error; }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const parsed: unknown = JSON.parse(await readFile(join(root, entry.name), "utf-8"));
        const status = TurnStatusSchema.parse(parsed).status;
        if (!TERMINAL_TURN_STATUSES.has(status)) throw new Error(`存在尚未结束的回合（${entry.name}：${status}），不能创建或恢复世界切片。`);
    }
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_TIMELINE_LEDGER_PATH);
    await mkdir(dirname(path), {recursive: true});
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
}

async function writeJsonAtomic(path: string, value: object): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

function encodeJson(value: object): Uint8Array {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function execute(client: Client, sql: string, args: InValue[]): Promise<void> {
    await client.execute({sql, args});
}

async function hasTable(client: Client, table: string): Promise<boolean> {
    const result = await client.execute({sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`, args: [table]});
    return result.rows.length > 0;
}

function textColumn(value: InValue | undefined): string {
    if (typeof value !== "string") throw new Error("World Engine 导出遇到非文本列。");
    return value;
}

function nullableText(value: InValue | undefined): string | null {
    if (value === null || value === undefined) return null;
    return textColumn(value);
}

function integerText(value: InValue | undefined): string {
    if (typeof value === "bigint" || typeof value === "number") return String(value);
    throw new Error("World Engine 导出遇到非整数列。");
}

function numberColumn(value: InValue | undefined): number {
    if (typeof value !== "number" && typeof value !== "bigint") throw new Error("World Engine 导出遇到非数值列。");
    return Number(value);
}

function blobBase64(value: InValue | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof ArrayBuffer) return Buffer.from(value).toString("base64");
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
    throw new Error("World Engine 导出遇到非法向量列。");
}

async function exists(path: string): Promise<boolean> {
    try { await access(path); return true; } catch { return false; }
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}

/** 将未知异常压缩为可落盘的问题说明。 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function withTimelineLock<T>(projectRoot: string, action: () => Promise<T>): Promise<T> {
    const key = join(projectRoot, RP_TIMELINE_TREE_PATH);
    const previous = locks.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(key, tail);
    await previous;
    try { return await action(); } finally { release(); if (locks.get(key) === tail) locks.delete(key); }
}
