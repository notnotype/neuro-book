import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import {assertRpBootstrapStage} from "nbook/server/rp/intake-store";

export const RP_MAP_STATE_PATH = ".nbook/rp/runtime/map/state.json";
export const RP_MAP_LEDGER_PATH = ".nbook/rp/runtime/map-ledger.jsonl";

export const RP_MAP_LEVELS = ["world", "region", "town", "district", "building", "sub_location"] as const;
export const RP_LOCATION_STATUSES = ["rumored", "discovered", "familiar", "unavailable", "destroyed"] as const;
export const RP_LOCATION_BASES = ["world_structure", "event", "npc", "resource", "special_connection"] as const;

export type RpMapLevel = typeof RP_MAP_LEVELS[number];
export type RpLocationStatus = typeof RP_LOCATION_STATUSES[number];
export type RpLocationBasis = typeof RP_LOCATION_BASES[number];
export type RpLocationOrigin = "bootstrap" | "screenwriter" | "player" | "novel_import";
export type RpProposalStatus = "proposed" | "pending_import" | "conflict" | "rejected" | "superseded" | "materialized";
export type RpRouteStatus = "active" | "unavailable" | "destroyed";

/** 地图节点只保存目录、可见性与稳定连接；地点完整客观状态仍由 RP World Engine 持有。 */
export type RpLocationNode = {
    id: string;
    /** 必须与 RP World Engine location subject id 一致。 */
    worldSubjectId: string;
    parentId: string | null;
    level: RpMapLevel;
    canonicalName: string;
    playerSummary: string;
    rumorLabel: string | null;
    approximateDirection: string | null;
    status: RpLocationStatus;
    persistenceBasis: RpLocationBasis[];
    origin: RpLocationOrigin;
    sourceRefs: string[];
    /** 首次抵达后锁定基础身份，后续只能通过显式修订流程改写。 */
    solidifiedAtTick: number | null;
    createdAt: string;
    updatedAt: string;
};

export type RpLocationProposal = {
    id: string;
    requestedId: string;
    parentId: string | null;
    level: RpMapLevel;
    canonicalName: string;
    playerSummary: string;
    rumorLabel: string | null;
    approximateDirection: string | null;
    initialStatus: RpLocationStatus;
    persistenceBasis: RpLocationBasis[];
    origin: RpLocationOrigin;
    sourceRefs: string[];
    completeness: "complete" | "partial" | "vague";
    status: RpProposalStatus;
    conflictReasons: string[];
    playerOverrideApproved: boolean;
    /** 非空表示该提案已由一条保留相同 requestedId 的新提案替换。 */
    supersededById: string | null;
    /** 非空表示本提案是对该旧提案的审计式替换。 */
    supersedesProposalId: string | null;
    createdAt: string;
    updatedAt: string;
};

export type RpMapRoute = {
    id: string;
    fromId: string;
    toId: string;
    label: string;
    direction: string | null;
    distance: string | null;
    secret: boolean;
    discoveredAtTick: number | null;
    status: RpRouteStatus;
    createdAt: string;
    updatedAt: string;
};

export type RpMapState = {
    schemaVersion: 1;
    nodes: RpLocationNode[];
    proposals: RpLocationProposal[];
    routes: RpMapRoute[];
    updatedAt: string;
};

export type RpLocationProposalInput = {
    requestedId: string;
    parentId?: string | null;
    level: RpMapLevel;
    canonicalName: string;
    playerSummary: string;
    rumorLabel?: string | null;
    approximateDirection?: string | null;
    initialStatus: RpLocationStatus;
    persistenceBasis: RpLocationBasis[];
    origin: RpLocationOrigin;
    sourceRefs?: string[];
    completeness?: "complete" | "partial" | "vague";
};

const NodeSchema: z.ZodType<RpLocationNode> = z.object({
    id: z.string(), worldSubjectId: z.string(), parentId: z.string().nullable(), level: z.enum(RP_MAP_LEVELS), canonicalName: z.string(),
    playerSummary: z.string(), rumorLabel: z.string().nullable(), approximateDirection: z.string().nullable(), status: z.enum(RP_LOCATION_STATUSES),
    persistenceBasis: z.array(z.enum(RP_LOCATION_BASES)), origin: z.enum(["bootstrap", "screenwriter", "player", "novel_import"]),
    sourceRefs: z.array(z.string()), solidifiedAtTick: z.number().int().nonnegative().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
const ProposalSchema: z.ZodType<RpLocationProposal> = z.object({
    id: z.string(), requestedId: z.string(), parentId: z.string().nullable(), level: z.enum(RP_MAP_LEVELS), canonicalName: z.string(),
    playerSummary: z.string(), rumorLabel: z.string().nullable(), approximateDirection: z.string().nullable(), initialStatus: z.enum(RP_LOCATION_STATUSES),
    persistenceBasis: z.array(z.enum(RP_LOCATION_BASES)), origin: z.enum(["bootstrap", "screenwriter", "player", "novel_import"]),
    sourceRefs: z.array(z.string()), completeness: z.enum(["complete", "partial", "vague"]), status: z.enum(["proposed", "pending_import", "conflict", "rejected", "superseded", "materialized"]),
    conflictReasons: z.array(z.string()), playerOverrideApproved: z.boolean(),
    supersededById: z.string().nullable().default(null), supersedesProposalId: z.string().nullable().default(null),
    createdAt: z.string(), updatedAt: z.string(),
});
const RouteSchema: z.ZodType<RpMapRoute> = z.object({
    id: z.string(), fromId: z.string(), toId: z.string(), label: z.string(), direction: z.string().nullable(), distance: z.string().nullable(), secret: z.boolean(),
    discoveredAtTick: z.number().int().nonnegative().nullable(), status: z.enum(["active", "unavailable", "destroyed"]), createdAt: z.string(), updatedAt: z.string(),
});
const StateSchema: z.ZodType<RpMapState> = z.object({
    schemaVersion: z.literal(1), nodes: z.array(NodeSchema), proposals: z.array(ProposalSchema), routes: z.array(RouteSchema), updatedAt: z.string(),
});

const locks = new Map<string, Promise<void>>();

/** 读取 GM 完整地图目录。 */
export async function readRpMapState(projectRoot: string): Promise<RpMapState> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_MAP_STATE_PATH), "utf-8"));
        return StateSchema.parse(parsed);
    } catch (error) {
        if (!isNotFound(error)) throw error;
        return emptyState();
    }
}

/** 玩家地图：传闻节点降级显示，未发现的秘密路线完全消失。 */
export async function readRpPlayerMap(projectRoot: string): Promise<{nodes: PlayerLocationNode[]; routes: RpMapRoute[]}> {
    const state = await readRpMapState(projectRoot);
    const visibleNodeIds = new Set(state.nodes.map((node) => node.id));
    return {
        nodes: state.nodes.map((node) => playerNode(node)),
        routes: state.routes.filter((route) => (!route.secret || route.discoveredAtTick !== null) && visibleNodeIds.has(route.fromId) && visibleNodeIds.has(route.toId)),
    };
}

/** screenwriter 或玩家提出地点；此时不写正式地图，也不分配另一个世界真相源。 */
export async function proposeRpLocation(projectRoot: string, input: RpLocationProposalInput): Promise<RpLocationProposal> {
    return mutate(projectRoot, "propose_location", (state, now) => {
        const requestedId = safeId(input.requestedId, "地点 id");
        const existing = state.proposals.find((proposal) => proposal.requestedId === requestedId && !["rejected", "superseded"].includes(proposal.status));
        if (existing) {
            const differences = proposalDifferences(existing, input);
            if (differences.length > 0) {
                throw new Error(`地点 ${requestedId} 已有不同定义的 ${existing.status} 提案；差异字段：${differences.join("、")}。请使用 replace_proposal 显式替换。`);
            }
            return {value: existing, detail: {proposalId: existing.id, requestedId, duplicate: true}};
        }
        const proposal = createProposal(input, now, input.origin === "novel_import" ? "pending_import" : "proposed");
        state.proposals.push(proposal);
        return {value: proposal, detail: {proposalId: proposal.id, origin: proposal.origin, requestedId: proposal.requestedId}};
    });
}

/**
 * 审计式替换未落地提案：旧提案保留并标记 superseded，新提案继续使用同一 requestedId。
 * 已 materialize 的地点必须走正式世界修订流程，不能通过提案替换改写。
 */
export async function replaceRpLocationProposal(
    projectRoot: string,
    proposalId: string,
    input: RpLocationProposalInput,
): Promise<RpLocationProposal> {
    return mutate(projectRoot, "replace_proposal", (state, now) => {
        const previous = requireProposal(state, proposalId);
        if (!["proposed", "pending_import", "conflict"].includes(previous.status)) {
            throw new Error(`地点提案当前不可替换：${previous.status}`);
        }
        const requestedId = safeId(input.requestedId, "地点 id");
        if (requestedId !== previous.requestedId) throw new Error("替换提案必须保持原 requestedId，不得借此改换地点身份。");
        if (input.origin !== previous.origin) throw new Error("替换提案必须由原来源职责提交，不得改变 origin。");
        const competing = state.proposals.find((proposal) => proposal.id !== previous.id
            && proposal.requestedId === requestedId
            && !["rejected", "superseded"].includes(proposal.status));
        if (competing) throw new Error(`地点 ${requestedId} 已存在另一条活动提案：${competing.id}`);
        const replacement = createProposal(input, now, previous.status === "pending_import" ? "pending_import" : "proposed", previous.id);
        previous.status = "superseded";
        previous.supersededById = replacement.id;
        previous.updatedAt = now;
        state.proposals.push(replacement);
        return {value: replacement, detail: {proposalId: replacement.id, replacedProposalId: previous.id, requestedId}};
    });
}

/** 一次性登记小说来源地点盘点；只有玩家确认纳入后才进入 world 校验队列。 */
export async function stageRpLocationImports(projectRoot: string, inputs: RpLocationProposalInput[]): Promise<RpLocationProposal[]> {
    if (inputs.length === 0) throw new Error("小说地点盘点不能为空。");
    const requestedIds = inputs.map((input) => safeId(input.requestedId, "地点 id"));
    if (new Set(requestedIds).size !== requestedIds.length) throw new Error("同一批小说地点盘点不能包含重复 requestedId。");
    return mutate(projectRoot, "stage_imports", (state, now) => {
        const proposals = inputs.map((input) => {
            const requestedId = safeId(input.requestedId, "地点 id");
            const existing = state.proposals.find((proposal) => proposal.requestedId === requestedId && proposal.origin === "novel_import" && proposal.status !== "rejected");
            return existing ?? createProposal({...input, origin: "novel_import"}, now, "pending_import");
        });
        state.proposals.push(...proposals.filter((proposal) => !state.proposals.includes(proposal)));
        return {value: proposals, detail: {proposalIds: proposals.map((item) => item.id), count: proposals.length}};
    });
}

/** 玩家必须对同一批待确认导入候选逐项纳入或排除，防止主持静默删减。 */
export async function confirmRpLocationImports(projectRoot: string, decisions: Array<{proposalId: string; include: boolean}>): Promise<RpLocationProposal[]> {
    return mutate(projectRoot, "confirm_imports", (state, now) => {
        const pending = state.proposals.filter((proposal) => proposal.status === "pending_import");
        if (pending.length === 0) {
            const decided = decisions.map((decision) => requireProposal(state, decision.proposalId));
            const matches = decided.every((proposal, index) => decisions[index]!.include ? proposal.status !== "rejected" : proposal.status === "rejected");
            if (matches) return {value: decided, detail: {duplicate: true, proposalIds: decided.map((proposal) => proposal.id)}};
        }
        const decisionIds = new Set(decisions.map((decision) => decision.proposalId));
        if (pending.some((proposal) => !decisionIds.has(proposal.id)) || decisions.some((decision) => !pending.some((proposal) => proposal.id === decision.proposalId))) {
            throw new Error("导入确认必须覆盖当前全部待确认地点，不能由主持静默漏掉候选。");
        }
        const changed = decisions.map((decision) => {
            const proposal = requireProposal(state, decision.proposalId);
            proposal.status = decision.include ? "proposed" : "rejected";
            proposal.updatedAt = now;
            return proposal;
        });
        return {value: changed, detail: {included: changed.filter((item) => item.status === "proposed").map((item) => item.id), rejected: changed.filter((item) => item.status === "rejected").map((item) => item.id)}};
    });
}

/** world 校验地点提案。冲突只记录问题；通过后才建立与 World Engine subject id 同名的稳定节点。 */
export async function reviewRpLocationProposal(projectRoot: string, proposalId: string, input: {
    accepted: boolean;
    conflictReasons?: string[];
}): Promise<RpLocationProposal | RpLocationNode> {
    return mutate<RpLocationProposal | RpLocationNode>(projectRoot, "review_proposal", (state, now) => {
        const proposal = requireProposal(state, proposalId);
        if (proposal.status === "materialized") return {value: requireNode(state, proposal.requestedId), detail: {proposalId, accepted: true, duplicate: true}};
        if (!["proposed", "conflict"].includes(proposal.status)) throw new Error(`地点提案当前不可校验：${proposal.status}`);
        const reasons = normalizeTexts(input.conflictReasons ?? []);
        if (!input.accepted) {
            if (reasons.length === 0) throw new Error("地点冲突必须提供具体原因，让玩家决定修改还是放弃。");
            proposal.status = "conflict";
            proposal.conflictReasons = reasons;
            proposal.updatedAt = now;
            return {value: proposal, detail: {proposalId, accepted: false, conflictReasons: reasons}};
        }
        if (proposal.status === "conflict" && !proposal.playerOverrideApproved) throw new Error("地点仍有未获玩家处理的设定冲突，不能静默纳入地图。");
        validateProposalForMaterialization(state, proposal);
        const node = materializeNode(state, proposal, now);
        proposal.status = "materialized";
        proposal.updatedAt = now;
        state.nodes.push(node);
        return {value: node, detail: {proposalId, accepted: true, locationId: node.id}};
    });
}

/** 玩家在看到冲突原因后明确选择保留提案；world 仍需再次校验并写入 World Engine。 */
export async function approveRpLocationConflict(projectRoot: string, proposalId: string, approved: boolean): Promise<RpLocationProposal> {
    if (!approved) throw new Error("未获得玩家批准，不能覆盖地点设定冲突。");
    return mutate(projectRoot, "approve_conflict", (state, now) => {
        const proposal = requireProposal(state, proposalId);
        if (proposal.status !== "conflict") throw new Error("只有 conflict 地点提案需要玩家处理。");
        if (proposal.playerOverrideApproved) return {value: proposal, detail: {proposalId, approved: true, duplicate: true}};
        proposal.playerOverrideApproved = true;
        proposal.updatedAt = now;
        return {value: proposal, detail: {proposalId, approved: true, conflictReasons: proposal.conflictReasons}};
    });
}

/** 首次抵达自动固化基础身份，并至少变为 discovered。 */
export async function arriveRpLocation(projectRoot: string, locationId: string, tick: number): Promise<RpLocationNode> {
    return mutate(projectRoot, "arrive", (state, now) => {
        const node = requireNode(state, locationId);
        if (node.status === "destroyed") throw new Error(`地点「${node.canonicalName}」已毁坏，不能作为抵达目的地。`);
        if (node.status === "unavailable") throw new Error(`地点「${node.canonicalName}」当前不可用，不能抵达。`);
        if (node.status === "rumored") node.status = "discovered";
        node.solidifiedAtTick ??= requireTick(tick);
        node.updatedAt = now;
        return {value: node, detail: {locationId, tick, status: node.status, solidified: true}};
    });
}

/** 关闭、熟悉或毁坏地点时保留原节点，只修改状态。 */
export async function setRpLocationStatus(projectRoot: string, locationId: string, status: RpLocationStatus, reason: string): Promise<RpLocationNode> {
    return mutate(projectRoot, "set_location_status", (state, now) => {
        const node = requireNode(state, locationId);
        if (node.status === "destroyed" && status !== "destroyed") throw new Error("destroyed 地点不能在普通运行流程中恢复；请走世界修订流程。");
        node.status = status;
        node.updatedAt = now;
        return {value: node, detail: {locationId, status, reason: requireText(reason, "地点状态原因")}};
    });
}

/** 建立公开或秘密路线；秘密路线在 discover 前不出现在玩家投影。 */
export async function registerRpMapRoute(projectRoot: string, input: {
    id: string; fromId: string; toId: string; label: string; direction?: string | null; distance?: string | null; secret: boolean;
}): Promise<RpMapRoute> {
    return mutate(projectRoot, "register_route", (state, now) => {
        const id = safeId(input.id, "路线 id");
        const existing = state.routes.find((route) => route.id === id);
        if (existing) {
            if (existing.fromId === input.fromId && existing.toId === input.toId && existing.secret === input.secret) return {value: existing, detail: {routeId: id, duplicate: true}};
            throw new Error(`路线 id 已存在且定义不同：${id}`);
        }
        requireNode(state, input.fromId);
        requireNode(state, input.toId);
        if (input.fromId === input.toId) throw new Error("路线两端不能是同一地点。");
        const route: RpMapRoute = {
            id, fromId: input.fromId, toId: input.toId, label: requireText(input.label, "路线名称"), direction: optionalText(input.direction), distance: optionalText(input.distance),
            secret: input.secret, discoveredAtTick: input.secret ? null : 0, status: "active", createdAt: now, updatedAt: now,
        };
        state.routes.push(route);
        return {value: route, detail: {routeId: id, secret: route.secret}};
    });
}

/** 客观事件使秘密路线被化身发现后，才进入玩家地图。 */
export async function discoverRpMapRoute(projectRoot: string, routeId: string, tick: number): Promise<RpMapRoute> {
    return mutate(projectRoot, "discover_route", (state, now) => {
        const route = requireRoute(state, routeId);
        route.discoveredAtTick ??= requireTick(tick);
        route.updatedAt = now;
        return {value: route, detail: {routeId, tick, discovered: true}};
    });
}

/** 路线关闭或毁坏时保留索引与玩家已获得的认知。 */
export async function setRpMapRouteStatus(projectRoot: string, routeId: string, status: RpRouteStatus, reason: string): Promise<RpMapRoute> {
    return mutate(projectRoot, "set_route_status", (state, now) => {
        const route = requireRoute(state, routeId);
        if (route.status === "destroyed" && status !== "destroyed") throw new Error("destroyed 路线不能在普通运行流程中恢复；请走世界修订流程。");
        route.status = status;
        route.updatedAt = now;
        return {value: route, detail: {routeId, status, reason: requireText(reason, "路线状态原因")}};
    });
}

type PlayerLocationNode = {
    id: string;
    parentId: string | null;
    level: RpMapLevel;
    label: string;
    summary: string;
    approximateDirection: string | null;
    status: RpLocationStatus;
};

function playerNode(node: RpLocationNode): PlayerLocationNode {
    if (node.status === "rumored") {
        return {id: node.id, parentId: node.parentId, level: node.level, label: node.rumorLabel ?? "传闻中的地点", summary: node.playerSummary, approximateDirection: node.approximateDirection, status: node.status};
    }
    return {id: node.id, parentId: node.parentId, level: node.level, label: node.canonicalName, summary: node.playerSummary, approximateDirection: node.approximateDirection, status: node.status};
}

function createProposal(input: RpLocationProposalInput, now: string, status: RpProposalStatus, supersedesProposalId: string | null = null): RpLocationProposal {
    return {
        id: `location-proposal-${randomUUID()}`,
        requestedId: safeId(input.requestedId, "地点 id"),
        parentId: input.parentId ? safeId(input.parentId, "父地点 id") : null,
        level: input.level,
        canonicalName: requireText(input.canonicalName, "地点名称"),
        playerSummary: requireText(input.playerSummary, "玩家可见地点摘要"),
        rumorLabel: optionalText(input.rumorLabel),
        approximateDirection: optionalText(input.approximateDirection),
        initialStatus: input.initialStatus,
        persistenceBasis: [...new Set(input.persistenceBasis)],
        origin: input.origin,
        sourceRefs: normalizeTexts(input.sourceRefs ?? []),
        completeness: input.completeness ?? "complete",
        status,
        conflictReasons: [],
        playerOverrideApproved: false,
        supersededById: null,
        supersedesProposalId,
        createdAt: now,
        updatedAt: now,
    };
}

/** 返回重复 requestedId 提案中真正发生变化的业务字段。 */
function proposalDifferences(existing: RpLocationProposal, input: RpLocationProposalInput): string[] {
    const candidate = createProposal(input, existing.createdAt, existing.status);
    const fields: Array<keyof RpLocationProposalInput> = [
        "parentId", "level", "canonicalName", "playerSummary", "rumorLabel", "approximateDirection",
        "initialStatus", "persistenceBasis", "origin", "sourceRefs", "completeness",
    ];
    return fields.filter((field) => JSON.stringify(existing[field] ?? null) !== JSON.stringify(candidate[field] ?? null));
}

function validateProposalForMaterialization(state: RpMapState, proposal: RpLocationProposal): void {
    if (proposal.persistenceBasis.length === 0) throw new Error("地点必须持续承载事件、NPC、资源、特殊连接或世界层级，不能把一次性背景空间建成节点。");
    if (state.nodes.some((node) => node.id === proposal.requestedId)) throw new Error(`地点 id 已存在：${proposal.requestedId}`);
    if (state.nodes.some((node) => node.parentId === proposal.parentId && normalizeName(node.canonicalName) === normalizeName(proposal.canonicalName))) {
        throw new Error(`同一父节点下已存在同名地点「${proposal.canonicalName}」。`);
    }
    if (proposal.level === "world") {
        if (proposal.parentId !== null) throw new Error("world 层地点不能有父节点。");
        return;
    }
    if (!proposal.parentId) throw new Error(`${proposal.level} 层地点必须指定父节点。`);
    const parent = requireNode(state, proposal.parentId);
    if (RP_MAP_LEVELS.indexOf(parent.level) >= RP_MAP_LEVELS.indexOf(proposal.level)) throw new Error("父地点层级必须高于子地点。 ");
}

function materializeNode(state: RpMapState, proposal: RpLocationProposal, now: string): RpLocationNode {
    validateProposalForMaterialization(state, proposal);
    return {
        id: proposal.requestedId,
        worldSubjectId: proposal.requestedId,
        parentId: proposal.parentId,
        level: proposal.level,
        canonicalName: proposal.canonicalName,
        playerSummary: proposal.playerSummary,
        rumorLabel: proposal.rumorLabel,
        approximateDirection: proposal.approximateDirection,
        status: proposal.initialStatus,
        persistenceBasis: proposal.persistenceBasis,
        origin: proposal.origin,
        sourceRefs: proposal.sourceRefs,
        solidifiedAtTick: null,
        createdAt: now,
        updatedAt: now,
    };
}

function requireProposal(state: RpMapState, proposalId: string): RpLocationProposal {
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error(`未找到地点提案：${proposalId}`);
    return proposal;
}

function requireNode(state: RpMapState, locationId: string): RpLocationNode {
    const node = state.nodes.find((item) => item.id === locationId);
    if (!node) throw new Error(`未找到地图地点：${locationId}`);
    return node;
}

function requireRoute(state: RpMapState, routeId: string): RpMapRoute {
    const route = state.routes.find((item) => item.id === routeId);
    if (!route) throw new Error(`未找到地图路线：${routeId}`);
    return route;
}

function safeId(value: string, label: string): string {
    const normalized = value.trim();
    if (!/^[\p{L}\p{N}_.:-]+$/u.test(normalized)) throw new Error(`非法${label}：${value}`);
    return normalized;
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

function optionalText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized || null;
}

function normalizeTexts(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeName(value: string): string {
    return value.trim().toLowerCase();
}

function requireTick(tick: number): number {
    if (!Number.isInteger(tick) || tick < 0) throw new Error("tick 必须是非负整数。");
    return tick;
}

function emptyState(): RpMapState {
    return {schemaVersion: 1, nodes: [], proposals: [], routes: [], updatedAt: new Date(0).toISOString()};
}

async function mutate<T>(projectRoot: string, operation: string, action: (state: RpMapState, now: string) => {value: T; detail: object}): Promise<T> {
    await assertAdventureRunning(projectRoot);
    const statePath = join(projectRoot, RP_MAP_STATE_PATH);
    return withLock(statePath, async () => {
        const state = await readRpMapState(projectRoot);
        const now = new Date().toISOString();
        const result = action(state, now);
        state.updatedAt = now;
        await writeAtomic(statePath, state);
        await appendLedger(projectRoot, {operation, at: now, ...result.detail});
        return result.value;
    });
}

async function assertAdventureRunning(projectRoot: string): Promise<void> {
    await assertRpBootstrapStage(projectRoot, ["map"]);
}

async function writeAtomic(path: string, state: RpMapState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_MAP_LEDGER_PATH);
    await mkdir(dirname(path), {recursive: true});
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
}

async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(path, tail);
    await previous;
    try {
        return await action();
    } finally {
        release();
        if (locks.get(path) === tail) locks.delete(path);
    }
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
