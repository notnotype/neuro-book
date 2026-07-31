import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import {assertRpBootstrapStage} from "nbook/server/rp/intake-store";
import {rpRandomInt} from "nbook/server/rp/random-source";

export const RP_EVENT_STATE_PATH = ".nbook/rp/runtime/events/state.json";
export const RP_EVENT_LEDGER_PATH = ".nbook/rp/runtime/events-ledger.jsonl";

export const RP_EVENT_TONES = ["calm", "exciting", "dangerous", "unusual"] as const;
export const RP_EVENT_STAGES = ["entry", "involvement", "development", "critical_choice", "outcome", "aftermath"] as const;
export const RP_EVENT_TERMINAL_STATUSES = ["resolved", "failed", "missed", "continued_without_player", "expired", "cancelled"] as const;

export type RpEventTone = typeof RP_EVENT_TONES[number];
export type RpEventStage = typeof RP_EVENT_STAGES[number];
export type RpEventTerminalStatus = typeof RP_EVENT_TERMINAL_STATUSES[number];
export type RpEventStatus = "available" | "saved" | "selected" | "active" | "suspended" | RpEventTerminalStatus;
export type RpEventAvailability = "available" | "needs_revalidation" | "unavailable";
export type RpEventOrigin = "candidate" | "opening" | "hard_schedule" | "player";
export type RpEventTrigger = "new_location" | "new_activity" | "calm_streak" | "plan_due" | "player_request" | "opening_stable";
export type RpHardEventKind = "schedule" | "weather" | "appointment" | "plan";

export type RpEventRecord = {
    schemaVersion: 1;
    id: string;
    /** 四卡同批共享 batchId；单独登记的事件为 null。 */
    batchId: string | null;
    origin: RpEventOrigin;
    trigger: RpEventTrigger;
    tone: RpEventTone;
    title: string;
    /** 玩家可见的入口与当前迹象，不包含预设结局。 */
    playerSummary: string;
    /** 主持层可见的安排依据；任何玩家视图都不得返回。 */
    hiddenSetup: string | null;
    status: RpEventStatus;
    availability: RpEventAvailability;
    /** unavailable 或 needs_revalidation 时说明玩家可知的原因。 */
    availabilityReason: string | null;
    stage: RpEventStage | null;
    locationId: string | null;
    /** 非空时用于检测互斥候选，例如同一 NPC 同时身处两个地点。 */
    compatibilityKey: string | null;
    hard: boolean;
    hardKind: RpHardEventKind | null;
    /** 项目历法时间字符串；硬性事件可以没有机器可比较的绝对时间。 */
    dueAt: string | null;
    backgroundProgress: boolean;
    createdAt: string;
    updatedAt: string;
    selectedAt: string | null;
    activatedAt: string | null;
    terminalAt: string | null;
    lastChange: string;
};

export type RpEventState = {
    schemaVersion: 1;
    events: RpEventRecord[];
    /** 已连续结算且没有实质事件的 IC 回合数，达到 5 后固定为 5 等待生成。 */
    calmTickStreak: number;
    candidateGenerationDue: boolean;
    /** 保留全部已结算 turn id，保证 record_tick 重放严格幂等。 */
    recordedTurnIds: string[];
    updatedAt: string;
};

export type RpPlayerEvent = Omit<RpEventRecord, "hiddenSetup" | "compatibilityKey" | "stage" | "backgroundProgress" | "selectedAt" | "activatedAt" | "terminalAt" | "schemaVersion">;

export type RpPlayerEventState = {
    schemaVersion: 1;
    calmTickStreak: number;
    candidateGenerationDue: boolean;
    updatedAt: string;
    events: RpPlayerEvent[];
};

export type RpCandidateProposal = {
    tone: RpEventTone;
    title: string;
    playerSummary: string;
    hiddenSetup?: string;
    locationId?: string;
    compatibilityKey?: string;
};

export type RpFormalEventInput = RpCandidateProposal & {
    origin: Exclude<RpEventOrigin, "candidate">;
    trigger: RpEventTrigger;
    hard?: boolean;
    hardKind?: RpHardEventKind;
    dueAt?: string;
    /** 开场事件可直接 active；其余正式事件默认 available。 */
    startActive?: boolean;
};

const locks = new Map<string, Promise<void>>();

const EventSchema: z.ZodType<RpEventRecord> = z.object({
    schemaVersion: z.literal(1),
    id: z.string(),
    batchId: z.string().nullable(),
    origin: z.enum(["candidate", "opening", "hard_schedule", "player"]),
    trigger: z.enum(["new_location", "new_activity", "calm_streak", "plan_due", "player_request", "opening_stable"]),
    tone: z.enum(RP_EVENT_TONES),
    title: z.string(),
    playerSummary: z.string(),
    hiddenSetup: z.string().nullable(),
    status: z.enum(["available", "saved", "selected", "active", "suspended", ...RP_EVENT_TERMINAL_STATUSES]),
    availability: z.enum(["available", "needs_revalidation", "unavailable"]),
    availabilityReason: z.string().nullable(),
    stage: z.enum(RP_EVENT_STAGES).nullable(),
    locationId: z.string().nullable(),
    compatibilityKey: z.string().nullable(),
    hard: z.boolean(),
    hardKind: z.enum(["schedule", "weather", "appointment", "plan"]).nullable(),
    dueAt: z.string().nullable(),
    backgroundProgress: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    selectedAt: z.string().nullable(),
    activatedAt: z.string().nullable(),
    terminalAt: z.string().nullable(),
    lastChange: z.string(),
});

const StateSchema: z.ZodType<RpEventState> = z.object({
    schemaVersion: z.literal(1),
    events: z.array(EventSchema),
    calmTickStreak: z.number().int().min(0).max(5),
    candidateGenerationDue: z.boolean(),
    recordedTurnIds: z.array(z.string()),
    updatedAt: z.string(),
});

/** 读取事件 canonical 状态；未初始化时返回不落盘的空状态。 */
export async function readRpEventState(projectRoot: string): Promise<RpEventState> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_EVENT_STATE_PATH), "utf-8"));
        return StateSchema.parse(parsed);
    } catch (error) {
        if (!isNotFound(error)) throw error;
        return emptyState();
    }
}

/** 玩家事件投影：不返回 hiddenSetup、互斥键、内部阶段和后台推进字段。 */
export async function readRpPlayerEvents(projectRoot: string): Promise<RpPlayerEventState> {
    const state = await readRpEventState(projectRoot);
    return {
        schemaVersion: state.schemaVersion,
        calmTickStreak: state.calmTickStreak,
        candidateGenerationDue: state.candidateGenerationDue,
        updatedAt: state.updatedAt,
        events: state.events.map(({hiddenSetup: _hiddenSetup, compatibilityKey: _compatibilityKey, stage: _stage, backgroundProgress: _backgroundProgress,
            selectedAt: _selectedAt, activatedAt: _activatedAt, terminalAt: _terminalAt, schemaVersion: _schemaVersion, ...event}) => event),
    };
}

/** 校验四卡提案：必须恰好覆盖平淡、刺激、危险、不寻常，且不得预写结局字段。 */
export function validateCandidateBatch(proposals: RpCandidateProposal[]): RpCandidateProposal[] {
    if (proposals.length !== 4) throw new Error("候选事件必须恰好为 4 张。");
    const tones = new Set(proposals.map((proposal) => proposal.tone));
    if (tones.size !== 4 || RP_EVENT_TONES.some((tone) => !tones.has(tone))) {
        throw new Error("四张候选必须分别为 calm、exciting、dangerous、unusual。");
    }
    const titles = new Set<string>();
    return proposals.map((proposal) => {
        const title = requireText(proposal.title, "候选标题");
        if (titles.has(title)) throw new Error(`候选标题重复：${title}`);
        titles.add(title);
        return {
            ...proposal,
            title,
            playerSummary: requireText(proposal.playerSummary, `候选「${title}」的玩家摘要`),
            hiddenSetup: optionalText(proposal.hiddenSetup),
            locationId: optionalText(proposal.locationId),
            compatibilityKey: optionalText(proposal.compatibilityKey),
        };
    });
}

/** World 层登记一批新的四卡候选；旧的未保存普通候选保留审计记录但标为不可用。 */
export async function registerCandidateBatch(
    projectRoot: string,
    input: {trigger: RpEventTrigger; proposals: RpCandidateProposal[]},
): Promise<RpEventRecord[]> {
    await assertAdventureRunning(projectRoot);
    const proposals = validateCandidateBatch(input.proposals);
    return mutate(projectRoot, "register_candidates", (state, now) => {
        const events = state.events.map((event) => {
            if (event.origin !== "candidate" || event.status !== "available" || event.availability !== "available") return event;
            return changed(event, now, {
                availability: "unavailable",
                availabilityReason: "主持已生成一批新的待选事件。",
                lastChange: "被新一批候选替代",
            });
        });
        const batchId = `batch-${randomUUID()}`;
        const created = proposals.map((proposal) => createEvent(now, {
            ...proposal,
            batchId,
            origin: "candidate",
            trigger: input.trigger,
            hard: false,
            hardKind: null,
            dueAt: null,
            status: "available",
        }));
        state.events = [...events, ...created];
        if (input.trigger === "calm_streak") {
            state.calmTickStreak = 0;
            state.candidateGenerationDue = false;
        }
        return {value: created, detail: {batchId, trigger: input.trigger, eventIds: created.map((event) => event.id)}};
    });
}

/** Bootstrap、硬性日程或玩家明确要求时登记单个正式事件。 */
export async function registerFormalEvent(projectRoot: string, input: RpFormalEventInput): Promise<RpEventRecord> {
    await assertAdventureRunning(projectRoot);
    if (input.hard && !input.hardKind) throw new Error("硬性事件必须声明 hardKind。");
    if (!input.hard && input.hardKind) throw new Error("非硬性事件不得声明 hardKind。");
    if (input.origin === "hard_schedule" && !input.hard) throw new Error("hard_schedule 事件必须标记 hard=true。");
    return mutate(projectRoot, "register_event", (state, now) => {
        if (input.startActive) assertActiveCapacity(state.events, Boolean(input.hard));
        const event = createEvent(now, {
            ...input,
            title: requireText(input.title, "事件标题"),
            playerSummary: requireText(input.playerSummary, "事件玩家摘要"),
            hiddenSetup: optionalText(input.hiddenSetup),
            locationId: optionalText(input.locationId),
            compatibilityKey: optionalText(input.compatibilityKey),
            batchId: null,
            hard: Boolean(input.hard),
            hardKind: input.hardKind ?? null,
            dueAt: optionalText(input.dueAt) ?? null,
            status: input.startActive ? "active" : "available",
        });
        state.events.push(event);
        return {value: event, detail: {eventId: event.id, origin: event.origin, status: event.status}};
    });
}

/** 玩家保留候选。保留不设数量上限，但互斥键冲突时必须先由玩家处理。 */
export async function saveRpCandidate(projectRoot: string, eventId: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "save_candidate", (state, now) => {
        const event = requireEvent(state, eventId);
        if (event.origin !== "candidate" || !["available", "saved"].includes(event.status)) throw new Error(`事件 ${eventId} 不是可保留候选。`);
        if (event.availability !== "available") throw new Error(`候选当前不可保留：${event.availabilityReason ?? event.availability}`);
        if (event.compatibilityKey) {
            const conflict = state.events.find((other) => other.id !== event.id
                && other.status === "saved"
                && other.compatibilityKey === event.compatibilityKey);
            if (conflict) throw new Error(`候选与已保留事件「${conflict.title}」冲突；请修改其中一个设定或放弃保留。`);
        }
        const next = changed(event, now, {status: "saved", lastChange: "玩家保留候选"});
        replaceEvent(state, next);
        return {value: next, detail: {eventId, status: next.status}};
    });
}

/** 玩家放弃未开始的候选；保留历史记录，不直接删除。 */
export async function discardRpCandidate(projectRoot: string, eventId: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "discard_candidate", (state, now) => {
        const event = requireEvent(state, eventId);
        if (event.origin !== "candidate" || !["available", "saved", "selected"].includes(event.status)) throw new Error(`事件 ${eventId} 不能作为候选放弃。`);
        const next = terminal(event, "cancelled", now, "玩家放弃候选");
        replaceEvent(state, next);
        return {value: next, detail: {eventId, status: next.status}};
    });
}

/** 玩家选择一个候选入口；只确定入口，不自动激活或预设结局。 */
export async function selectRpCandidate(projectRoot: string, eventId: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "select_candidate", (state, now) => {
        const event = requireSelectable(state, eventId);
        const next = changed(event, now, {status: "selected", selectedAt: now, lastChange: "玩家选择候选入口"});
        replaceEvent(state, next);
        return {value: next, detail: {eventId, status: next.status}};
    });
}

/** 从玩家指定的 1-4 张候选中由服务端随机选择。 */
export async function randomSelectRpCandidate(projectRoot: string, eventIds: string[]): Promise<RpEventRecord> {
    if (eventIds.length < 1 || eventIds.length > 4) throw new Error("随机范围必须包含 1-4 张候选。");
    if (new Set(eventIds).size !== eventIds.length) throw new Error("随机范围中不能包含重复候选。");
    return mutate(projectRoot, "random_select", (state, now) => {
        const candidates = eventIds.map((eventId) => requireSelectable(state, eventId));
        const selected = candidates[rpRandomInt(candidates.length)];
        if (!selected) throw new Error("随机范围为空。");
        const next = changed(selected, now, {status: "selected", selectedAt: now, lastChange: `服务端从 ${eventIds.length} 张候选中随机选中`});
        replaceEvent(state, next);
        return {value: next, detail: {eventId: next.id, range: eventIds}};
    });
}

/** 离开地点后使普通候选失效；玩家已保留的候选进入重新校验状态。 */
export async function invalidateRpLocationCandidates(projectRoot: string, locationId: string): Promise<RpEventRecord[]> {
    const normalizedLocation = requireText(locationId, "地点 id");
    return mutate(projectRoot, "invalidate_location", (state, now) => {
        const changedEvents: RpEventRecord[] = [];
        state.events = state.events.map((event) => {
            if (event.origin !== "candidate" || event.locationId !== normalizedLocation || !["available", "saved"].includes(event.status)) return event;
            const next = changed(event, now, {
                availability: event.status === "saved" ? "needs_revalidation" : "unavailable",
                availabilityReason: `玩家已经离开地点 ${normalizedLocation}。`,
                lastChange: event.status === "saved" ? "离开地点，保留候选等待重新校验" : "离开地点，普通候选失效",
            });
            changedEvents.push(next);
            return next;
        });
        return {value: changedEvents, detail: {locationId: normalizedLocation, eventIds: changedEvents.map((event) => event.id)}};
    });
}

/** World 根据当前事实重新校验被保留候选是否仍可合理触发。 */
export async function revalidateRpCandidate(projectRoot: string, eventId: string, valid: boolean, reason: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "revalidate_candidate", (state, now) => {
        const event = requireEvent(state, eventId);
        if (event.status !== "saved") throw new Error(`只有 saved 候选可以重新校验，当前为 ${event.status}。`);
        const next = changed(event, now, {
            availability: valid ? "available" : "unavailable",
            availabilityReason: valid ? null : requireText(reason, "不可用原因"),
            lastChange: valid ? "候选重新校验通过" : "候选重新校验未通过",
        });
        replaceEvent(state, next);
        return {value: next, detail: {eventId, valid, reason: next.availabilityReason}};
    });
}

/** 将选中候选或到期硬性事件激活；普通 active 最多 3 个，硬性事件可临时成为第 4 焦点。 */
export async function activateRpEvent(projectRoot: string, eventId: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "activate_event", (state, now) => {
        const event = requireEvent(state, eventId);
        const allowed = event.hard ? ["available", "saved", "selected", "suspended"] : ["selected", "suspended"];
        if (!allowed.includes(event.status)) throw new Error(`事件 ${eventId} 当前为 ${event.status}，不能激活。`);
        if (event.availability !== "available") throw new Error(`事件当前不可激活：${event.availabilityReason ?? event.availability}`);
        assertActiveCapacity(state.events, event.hard, event.id);
        const next = changed(event, now, {
            status: "active",
            stage: event.stage ?? "entry",
            activatedAt: event.activatedAt ?? now,
            backgroundProgress: false,
            lastChange: event.status === "suspended" ? "玩家回归，事件恢复" : "事件进入 active",
        });
        replaceEvent(state, next);
        return {value: next, detail: {eventId, status: next.status, stage: next.stage}};
    });
}

/** 推进 active/suspended 事件阶段；阶段只能向前，避免 Agent 回写逆序。 */
export async function advanceRpEventStage(projectRoot: string, eventId: string, stage: RpEventStage, change: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "advance_stage", (state, now) => {
        const event = requireEvent(state, eventId);
        if (!["active", "suspended"].includes(event.status) || !event.stage) throw new Error(`事件 ${eventId} 当前不能推进阶段。`);
        if (RP_EVENT_STAGES.indexOf(stage) < RP_EVENT_STAGES.indexOf(event.stage)) throw new Error(`事件阶段不能从 ${event.stage} 回退到 ${stage}。`);
        const next = changed(event, now, {stage, lastChange: requireText(change, "阶段变化说明")});
        replaceEvent(state, next);
        return {value: next, detail: {eventId, stage}};
    });
}

/** 暂停 active 事件；离场后 NPC 默认继续在后台行动。 */
export async function suspendRpEvent(projectRoot: string, eventId: string, reason: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "suspend_event", (state, now) => {
        const event = requireEvent(state, eventId);
        if (event.status !== "active") throw new Error(`只有 active 事件可以暂停，当前为 ${event.status}。`);
        const next = changed(event, now, {status: "suspended", backgroundProgress: true, lastChange: requireText(reason, "暂停原因")});
        replaceEvent(state, next);
        return {value: next, detail: {eventId, status: next.status, backgroundProgress: true}};
    });
}

/** 结束事件并保留终态原因；continued_without_player 不占 active 名额。 */
export async function finishRpEvent(projectRoot: string, eventId: string, status: RpEventTerminalStatus, reason: string): Promise<RpEventRecord> {
    return mutate(projectRoot, "finish_event", (state, now) => {
        const event = requireEvent(state, eventId);
        if (!["active", "suspended", "selected", "available", "saved"].includes(event.status)) throw new Error(`事件 ${eventId} 已为终态 ${event.status}。`);
        const next = terminal(event, status, now, requireText(reason, "事件结束原因"));
        replaceEvent(state, next);
        return {value: next, detail: {eventId, status}};
    });
}

/** committed 回合结算时记录是否平淡；同一 turnId 重试不重复增长。 */
export async function recordRpEventTick(projectRoot: string, turnId: string, meaningfulEvent: boolean): Promise<RpEventState> {
    const normalizedTurnId = requireText(turnId, "turn id");
    return mutate(projectRoot, "record_tick", (state) => {
        if (state.recordedTurnIds.includes(normalizedTurnId)) {
            return {value: state, detail: {turnId: normalizedTurnId, duplicate: true, calmTickStreak: state.calmTickStreak}};
        }
        state.recordedTurnIds.push(normalizedTurnId);
        state.calmTickStreak = meaningfulEvent ? 0 : Math.min(5, state.calmTickStreak + 1);
        state.candidateGenerationDue = state.calmTickStreak >= 5;
        return {value: state, detail: {
            turnId: normalizedTurnId,
            meaningfulEvent,
            calmTickStreak: state.calmTickStreak,
            candidateGenerationDue: state.candidateGenerationDue,
        }};
    });
}

function emptyState(): RpEventState {
    return {
        schemaVersion: 1,
        events: [],
        calmTickStreak: 0,
        candidateGenerationDue: false,
        recordedTurnIds: [],
        updatedAt: new Date(0).toISOString(),
    };
}

async function assertAdventureRunning(projectRoot: string): Promise<void> {
    await assertRpBootstrapStage(projectRoot, ["opening_event"]);
}

function createEvent(
    now: string,
    input: RpCandidateProposal & {
        batchId: string | null;
        origin: RpEventOrigin;
        trigger: RpEventTrigger;
        hard: boolean;
        hardKind: RpHardEventKind | null;
        dueAt: string | null;
        status: "available" | "active";
    },
): RpEventRecord {
    return {
        schemaVersion: 1,
        id: `event-${randomUUID()}`,
        batchId: input.batchId,
        origin: input.origin,
        trigger: input.trigger,
        tone: input.tone,
        title: input.title,
        playerSummary: input.playerSummary,
        hiddenSetup: input.hiddenSetup ?? null,
        status: input.status,
        availability: "available",
        availabilityReason: null,
        stage: input.status === "active" ? "entry" : null,
        locationId: input.locationId ?? null,
        compatibilityKey: input.compatibilityKey ?? null,
        hard: input.hard,
        hardKind: input.hardKind,
        dueAt: input.dueAt,
        backgroundProgress: false,
        createdAt: now,
        updatedAt: now,
        selectedAt: null,
        activatedAt: input.status === "active" ? now : null,
        terminalAt: null,
        lastChange: input.status === "active" ? "登记并激活正式事件" : "登记事件入口",
    };
}

function requireEvent(state: RpEventState, eventId: string): RpEventRecord {
    const event = state.events.find((item) => item.id === eventId);
    if (!event) throw new Error(`未找到 RP 事件：${eventId}`);
    return event;
}

function requireSelectable(state: RpEventState, eventId: string): RpEventRecord {
    const event = requireEvent(state, eventId);
    if (event.origin !== "candidate" || !["available", "saved"].includes(event.status)) throw new Error(`事件 ${eventId} 不是可选择候选。`);
    if (event.availability !== "available") throw new Error(`候选「${event.title}」当前不可选择：${event.availabilityReason ?? event.availability}`);
    return event;
}

function assertActiveCapacity(events: RpEventRecord[], incomingHard: boolean, ignoredId?: string): void {
    const active = events.filter((event) => event.id !== ignoredId && event.status === "active");
    const normalCount = active.filter((event) => !event.hard).length;
    if (!incomingHard && normalCount >= 3) throw new Error("同时最多只能有 3 个普通 active 事件；请先结束或暂停其中一个。");
    if (incomingHard && active.length >= 4) throw new Error("当前已存在 4 个 active 焦点；请先处理一个事件再启动硬性事件。");
}

function changed(event: RpEventRecord, now: string, patch: Partial<RpEventRecord>): RpEventRecord {
    return {...event, ...patch, id: event.id, schemaVersion: 1, updatedAt: now};
}

function terminal(event: RpEventRecord, status: RpEventTerminalStatus, now: string, reason: string): RpEventRecord {
    return changed(event, now, {
        status,
        terminalAt: now,
        backgroundProgress: false,
        lastChange: reason,
    });
}

function replaceEvent(state: RpEventState, event: RpEventRecord): void {
    const index = state.events.findIndex((item) => item.id === event.id);
    if (index < 0) throw new Error(`未找到 RP 事件：${event.id}`);
    state.events[index] = event;
}

async function mutate<T>(
    projectRoot: string,
    operation: string,
    action: (state: RpEventState, now: string) => {value: T; detail: object},
): Promise<T> {
    await assertAdventureRunning(projectRoot);
    const statePath = join(projectRoot, RP_EVENT_STATE_PATH);
    return withLock(statePath, async () => {
        const state = await readRpEventState(projectRoot);
        const now = new Date().toISOString();
        const result = action(state, now);
        state.updatedAt = now;
        await writeJsonAtomic(statePath, state);
        await appendLedger(projectRoot, {operation, at: now, ...result.detail});
        return result.value;
    });
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_EVENT_LEDGER_PATH);
    await mkdir(dirname(path), {recursive: true});
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
}

async function writeJsonAtomic(path: string, value: RpEventState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
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

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

function optionalText(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
