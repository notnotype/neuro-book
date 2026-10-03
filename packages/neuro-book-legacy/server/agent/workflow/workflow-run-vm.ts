import {parseActivityParamsObject} from "@notnotype/nb-workflow";
import {traceGraph} from "@notnotype/nb-workflow";
import type {ActivityParamsSource, ActivityRecord, JsonValue, RunView, WorkflowEvent} from "@notnotype/nb-workflow";
import {PROFILE_NAMES} from "nbook/server/agent/workflow/workflow-demo-scenarios";

/**
 * Run 观测视图模型构建器（Task 110 反馈轮：用户看得懂的投影）。
 *
 * 「用户 ↔ 前端 ↔ workflow」模式的数据面：服务端把 journal/事件流加工成
 * 结构化 VM（人话标签、phase 进度、session 序列图），前端自行组装 UI，
 * 不再直面 `agents.invoke @root/1:0#1` 这类内核标识。
 */

export type PhaseVm = {
    key: string;
    title: string;
    status: "pending" | "active" | "done";
    /** 归入本 phase 的 activity key（按事件顺序，供前端联动） */
    activityKeys: string[];
    /** 本 phase 内的用户参与点标题 */
    askTitles: string[];
};

export type ParticipantVm = {
    sessionId: number;
    /** 用户视角名（中文 profile 名或原 key） */
    name: string;
    profileKey: string;
    /** acquire 的持久参与者标签 */
    tag?: string;
};

export type RunVm = {
    /** activityKey → 人话标签（事件流、trace 图、phase 明细共用） */
    labels: Record<string, string>;
    phases: PhaseVm[];
    /** session 序列图（mermaid sequenceDiagram）：以参与者为主角的对话流 */
    flowMermaid: string;
    /** 人话版动态 trace（mermaid graph）：虚线橙=进行中，绿=本次缓存命中 */
    traceMermaid: string;
    participants: ParticipantVm[];
    /** 当前正在运行的 activity（前端做高亮脉冲） */
    runningNow: RunningNowVm[];
    /** 泳道时间线：每个 session 一条泳道，编排器级 activity 归入 sessionId=null 泳道 */
    timeline: TimelineLaneVm[];
    /** Agent 直播卡片：每个参与者的当前状态与最近一问一答 */
    live: LiveCardVm[];
    /** 实时生长关系图（mermaid graph LR）：create 长节点、每次 invoke 一条边、进行中橙色虚线 */
    relationMermaid: string;
    /** 状态图（wf.chart）：完全由执行过程画出——一开始是空的，节点/边随代码运行长出来；无 chart 事件为 null */
    machineMermaid: string | null;
};

export type RunningNowVm = {
    key: string;
    label: string;
    /** invoke 类 activity 的目标 session（非 invoke 为空） */
    sessionId?: number;
    /** 服务端打点的开始时刻（epoch ms），前端算已耗时 */
    startedAt: number;
};

export type TimelineSpanVm = {
    key: string;
    label: string;
    /** 相对本执行段起点的 ms */
    start: number;
    /** 为 null 表示仍在进行中（条形右端开放） */
    end: number | null;
    /** 缓存命中：重放瞬间完成，画为窄条并标 ⚡ */
    cached: boolean;
};

export type TimelineLaneVm = {
    /** null = 编排器泳道（workspace.read / ask 等非 invoke activity） */
    sessionId: number | null;
    name: string;
    spans: TimelineSpanVm[];
};

export type LiveCardVm = {
    sessionId: number;
    name: string;
    /** 有进行中的 invoke 指向该 session */
    busy: boolean;
    /** 最近一次收到的指令（人话短语）；未被 invoke 过为空 */
    lastAction?: string;
    /** 最近一次回复（截断）；尚未回复过为空 */
    lastReply?: string;
};

/** journal/事件里提取的 session 命名信息 */
export type SessionNaming = {profileKey?: string; tag?: string};

type RunningActivity = {path: string; seq: number; kind: string; fingerprint: string; params?: string; startedAt: number};

/** 事件 + 服务端接收时刻（epoch ms）——时间线视图的数据源 */
export type TimedEvent = {event: WorkflowEvent; at: number};

export type RunVmInput = {
    view: RunView;
    /** 本次执行段事件（自最近一次 status:running 起，时间序，带服务端时间戳） */
    events: TimedEvent[];
    /** 进行中的 activity（started 未完成） */
    running: Map<string, RunningActivity>;
    /** 声明骨架 */
    phases?: {key: string; title: string}[];
    /** sessionId → 命名（journal 提取 + 服务补查合并） */
    sessions: Map<number, SessionNaming>;
};

const MODE_CN: Record<string, string> = {prompt: "提问", followup: "追问", steer: "插话", continue: "继续"};

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** mermaid 标签净化：进图文本必须过这一道（引号/分号/换行都会炸图）；n 可放宽（状态图节点带人名） */
const safe = (s: string, n = 30) => trunc(s.replace(/\s+/g, " ").replace(/["`;<>]/g, "'"), n);

function profileName(profileKey: string | undefined): string {
    if (!profileKey) return "session";
    return PROFILE_NAMES[profileKey] ?? profileKey;
}

function sessionName(sessionId: number, sessions: Map<number, SessionNaming>): string {
    return `${profileName(sessions.get(sessionId)?.profileKey)}#${sessionId}`;
}
/** 从 canonical 参数 side channel 读取观测字段；旧记录再兼容 inline JSON fingerprint。 */
function parseParams(source: ActivityParamsSource): Record<string, JsonValue> {
    return parseActivityParamsObject(source) ?? {};
}
export function inlineActivityResult(record: Pick<ActivityRecord, "result">): JsonValue | undefined {
    return record.result.kind === "inline" ? record.result.value : undefined;
}

function inputHint(input: JsonValue | undefined): string {
    if (input === undefined || input === null) return "";
    if (typeof input === "string") return `「${trunc(input, 14)}」`;
    if (Array.isArray(input)) return `（${input.length} 项）`;
    if (typeof input === "object") return `（${Object.keys(input).slice(0, 3).join("/")}）`;
    return `（${String(input)}）`;
}

/** 单条 Activity 的人话标签 */
export function activityLabel(kind: string, source: ActivityParamsSource, sessions: Map<number, SessionNaming>): string {
    const p = parseActivityParamsObject(source) ?? {};
    switch (kind) {
        case "agents.create":
            return `创建 ${profileName(typeof p.profileKey === "string" ? p.profileKey : undefined)}${p.ephemeral ? "（临时）" : ""}`;
        case "agents.invoke": {
            const who = typeof p.id === "number" ? sessionName(p.id, sessions) : "agent";
            const mode = MODE_CN[String(p.mode ?? "prompt")] ?? String(p.mode);
            const hint = typeof p.message === "string" && p.message ? `「${trunc(p.message, 14)}」` : inputHint(p.input);
            return `${who}：${mode}${hint}`;
        }
        case "agents.profile":
            return `查询 profile ${String(p.profileKey ?? "")}`;
        case "sessions.open":
            return `接入 session#${String(p.id ?? "?")}`;
        case "sessions.append": {
            const hint = typeof p.message === "string" && p.message ? `「${trunc(p.message, 12)}」` : inputHint(p.input);
            return `写入消息${hint}`;
        }
        case "sessions.checkout":
            return "游标复位（checkout）";
        case "sessions.transcript":
            return "读取对话历史";
        case "workspace.read":
            return `读取 ${String(p.path ?? "")}`;
        case "ask":
            return `等待用户：${String(p.title ?? "")}`;
        default:
            return kind;
    }
}

/** journal 提取参与者命名（create/acquire 的参数里有 profileKey/tag，结果里有 sessionId） */
export function collectSessionNaming(journal: ActivityRecord[]): Map<number, SessionNaming> {
    const out = new Map<number, SessionNaming>();
    for (const record of journal) {
        const result = inlineActivityResult(record) as {sessionId?: number} | undefined;
        const p = parseParams(record);
        if ((record.kind === "agents.create" || record.kind === "agents.acquire") && typeof result?.sessionId === "number") {
            out.set(result.sessionId, {
                profileKey: typeof p.profileKey === "string" ? p.profileKey : undefined,
                tag: typeof p.tag === "string" ? p.tag : undefined,
            });
        }
        if (record.kind === "agents.invoke" && typeof p.id === "number" && !out.has(p.id)) {
            out.set(p.id, {});
        }
        if (record.kind === "sessions.open" && typeof p.id === "number" && !out.has(p.id)) {
            out.set(p.id, {});
        }
    }
    return out;
}

/** 组装完整 VM */
export function buildRunVm(input: RunVmInput): RunVm {
    const {view, events, running, sessions} = input;

    // 标签表：journal 全量 + 进行中 + 挂起中的 ask（尚未 journal，但用户正盯着它）
    const labels: Record<string, string> = {};
    for (const record of view.journal) labels[record.key] = activityLabel(record.kind, record, sessions);
    for (const [key, r] of running) labels[key] = activityLabel(r.kind, r, sessions);
    for (const ask of view.pendingAsks) labels[ask.key] = `等待用户：${ask.spec.title}`;

    return {
        labels,
        phases: buildPhases(input),
        flowMermaid: buildFlow(events.map((t) => t.event), sessions, running),
        traceMermaid: buildTrace(view, events.map((t) => t.event), running, labels),
        participants: [...sessions.entries()]
            .map(([sessionId, naming]) => ({
                sessionId,
                name: `${profileName(naming.profileKey)}#${sessionId}`,
                profileKey: naming.profileKey ?? "?",
                tag: naming.tag,
            }))
            .sort((a, b) => a.sessionId - b.sessionId),
        runningNow: buildRunningNow(running, labels),
        timeline: buildTimeline(events, running, labels, sessions),
        live: buildLive(view, running, sessions),
        relationMermaid: buildRelation(view, running, sessions),
        machineMermaid: buildChart(events, sessions),
    };
}

/**
 * 状态图（wf.chart）：**完全由执行过程画出来，且 append-only（只增不删）**——
 * 每条边带执行序号 ①②③…（同一条边多次走过 = 多个序号），终图本身就是可回放的流程记录。
 * 并发以 token 表达（多个节点同时橙 = 并发）；节点**持久**显示打过工的 session 中文名（不随 token 离开消失，
 * 活跃与否只用颜色表达，避免标签闪变导致图重排）。橙=有 token 停留，绿=走过。
 * 无 chart 事件时返回 null（前端不显示该 tab）。
 * TODO（用户已提，后续做）：边显示流经的数据摘要；token 沿边移动的动画（序号已为重放动画铺路）。
 */
function buildChart(events: TimedEvent[], sessions: Map<number, SessionNaming>): string | null {
    type NodeState = {title: string; visits: number; tokens: Map<string, number | undefined>; workers: Set<number>};
    const nodes = new Map<string, NodeState>();
    const nodeOf = (key: string, title?: string): NodeState => {
        let n = nodes.get(key);
        if (!n) { n = {title: title ?? key, visits: 0, tokens: new Map(), workers: new Set()}; nodes.set(key, n); }
        else if (title) n.title = title;
        return n;
    };
    type EdgeState = {from: string; to: string; label?: string; seqs: number[]};
    const edges: EdgeState[] = [];
    /** 全局执行步号：边的创建/走过顺序，终图可读出流程 */
    let step = 0;
    const edgeOf = (from: string, to: string, label?: string, stamp = true): EdgeState => {
        let e = edges.find((x) => x.from === from && x.to === to);
        if (!e) { e = {from, to, label, seqs: []}; edges.push(e); if (stamp) e.seqs.push(++step); }
        else if (label) e.label = label;
        return e;
    };
    const enterNode = (key: string, token: string, sessionId: number | undefined) => {
        const n = nodeOf(key);
        n.visits++;
        n.tokens.set(token, sessionId);
        if (sessionId !== undefined) n.workers.add(sessionId);
    };

    // 图零预置：只从 chart 事件长出来
    let sawChart = false;
    let lastEdge: EdgeState | undefined;
    for (const {event} of events) {
        if (event.type !== "chart") continue;
        sawChart = true;
        const op = event.op;
        if (op.op === "node") nodeOf(op.key, op.title);
        if (op.op === "edge") edgeOf(op.from, op.to, op.label);
        if (op.op === "enter") enterNode(op.key, op.token, op.sessionId);
        if (op.op === "leave") nodeOf(op.key).tokens.delete(op.token);
        if (op.op === "move") {
            nodeOf(op.from).tokens.delete(op.token);
            const e = edgeOf(op.from, op.to, op.label, false);
            e.seqs.push(++step);
            lastEdge = e;
            enterNode(op.to, op.token, op.sessionId);
        }
    }
    if (!sawChart) return null;

    /** 执行序号 → ①②③…（超 20 退化为 (n)） */
    const circled = (n: number) => (n >= 1 && n <= 20 ? "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"[n - 1] : `(${n})`);
    const lines = ["graph LR"];
    for (const [key, n] of nodes) {
        // 持久 worker 名：谁在这个节点上干过活就一直显示（活跃与否只用颜色表达，标签保持稳定）
        const names = [...n.workers].map((sessionId) => sessionName(sessionId, sessions));
        const workerText = names.length ? `〔${names.slice(0, 3).join("·")}${names.length > 3 ? `+${names.length - 3}` : ""}〕` : "";
        lines.push(`    c_${key}["${safe(`${n.title}${n.visits > 1 ? ` ×${n.visits}` : ""}${workerText}`, 44)}"]`);
    }
    edges.forEach((e) => {
        const label = `${e.seqs.map(circled).join("")}${e.label ? ` ${e.label}` : ""}`.trim();
        lines.push(label ? `    c_${e.from} -->|"${safe(label, 40)}"| c_${e.to}` : `    c_${e.from} --> c_${e.to}`);
    });
    if (lastEdge) lines.push(`    linkStyle ${edges.indexOf(lastEdge)} stroke:#d97706,stroke-width:2.5px`);
    for (const [key, n] of nodes) {
        if (n.tokens.size > 0) lines.push(`    style c_${key} fill:#33200f,stroke:#d97706,stroke-dasharray:5 5,color:#ffcf87`);
        else if (n.visits > 0) lines.push(`    style c_${key} fill:#14261a,stroke:#2ea043,color:#7ee787`);
    }
    return lines.join("\n");
}

/** 进行中的 activity 列表（invoke 类解析指纹取目标 session） */
function buildRunningNow(running: Map<string, RunningActivity>, labels: Record<string, string>): RunningNowVm[] {
    return [...running.entries()].map(([key, r]) => {
        const p = parseParams(r);
        return {
            key,
            label: labels[key] ?? r.kind,
            sessionId: r.kind === "agents.invoke" && typeof p.id === "number" ? p.id : undefined,
            startedAt: r.startedAt,
        };
    });
}

/**
 * 泳道时间线：activity_started 开条、activity 完成关条，时间归一为相对本执行段起点的 ms。
 * 缓存命中（无 started 直接完成）画为瞬时条并标 ⚡；进行中的条 end=null。
 */
function buildTimeline(events: TimedEvent[], running: Map<string, RunningActivity>, labels: Record<string, string>, sessions: Map<number, SessionNaming>): TimelineLaneVm[] {
    const base = events[0]?.at;
    if (base === undefined) return [];
    const lanes = new Map<number | null, TimelineLaneVm>();
    const laneOf = (sessionId: number | null): TimelineLaneVm => {
        let lane = lanes.get(sessionId);
        if (!lane) {
            lane = {sessionId, name: sessionId === null ? "编排器" : sessionName(sessionId, sessions), spans: []};
            lanes.set(sessionId, lane);
        }
        return lane;
    };
    /** activity 归属泳道：invoke 落目标 session，其余落编排器 */
    const laneKey = (kind: string, source: ActivityParamsSource): number | null => {
        if (kind !== "agents.invoke") return null;
        const p = parseParams(source);
        return typeof p.id === "number" ? p.id : null;
    };
    /** key → 未闭合的 span（started 后等完成） */
    const open = new Map<string, TimelineSpanVm>();

    for (const {event, at} of events) {
        const t = at - base;
        if (event.type === "activity_started") {
            const span: TimelineSpanVm = {key: event.key, label: labels[event.key] ?? event.kind, start: t, end: null, cached: false};
            open.set(event.key, span);
            laneOf(laneKey(event.kind, event)).spans.push(span);
        }
        if (event.type === "activity") {
            const {record} = event;
            const opened = open.get(record.key);
            if (opened) {
                opened.end = t;
                open.delete(record.key);
            } else {
                laneOf(laneKey(record.kind, record)).spans.push({
                    key: record.key, label: labels[record.key] ?? record.kind, start: t, end: t, cached: true,
                });
            }
        }
        if (event.type === "ask_pending") {
            const span: TimelineSpanVm = {key: event.ask.key, label: `等待用户：${event.ask.spec.title}`, start: t, end: null, cached: false};
            open.set(event.ask.key, span);
            laneOf(null).spans.push(span);
        }
    }
    // 已不在 running/pending 里的未闭合条（如挂起后释放的旧段）保持 end=null 也无妨——running 是权威，这里只呈现
    void running;
    return [...lanes.values()].sort((a, b) => (a.sessionId ?? -1) - (b.sessionId ?? -1));
}

/** 直播卡片：journal 顺序扫每个 session 最近一次 invoke 的指令与回复，busy 来自 running */
function buildLive(view: RunView, running: Map<string, RunningActivity>, sessions: Map<number, SessionNaming>): LiveCardVm[] {
    const busyIds = new Set<number>();
    const lastAction = new Map<number, string>();
    const lastReply = new Map<number, string>();
    for (const r of running.values()) {
        if (r.kind !== "agents.invoke") continue;
        const p = parseParams(r);
        if (typeof p.id !== "number") continue;
        busyIds.add(p.id);
        lastAction.set(p.id, invokeHint(p));
    }
    for (const record of view.journal) {
        if (record.kind !== "agents.invoke") continue;
        const p = parseParams(record);
        if (typeof p.id !== "number") continue;
        if (!busyIds.has(p.id)) lastAction.set(p.id, invokeHint(p));
        const outcome = inlineActivityResult(record) as {message?: string} | undefined;
        if (typeof outcome?.message === "string") lastReply.set(p.id, trunc(outcome.message, 40));
    }
    return [...sessions.keys()].sort((a, b) => a - b).map((sessionId) => ({
        sessionId,
        name: sessionName(sessionId, sessions),
        busy: busyIds.has(sessionId),
        lastAction: lastAction.get(sessionId),
        lastReply: lastReply.get(sessionId),
    }));
}

/** invoke 参数 → 「提问「…」」短语（卡片与关系图边标签共用） */
function invokeHint(p: Record<string, JsonValue>): string {
    const mode = MODE_CN[String(p.mode ?? "prompt")] ?? String(p.mode);
    const hint = typeof p.message === "string" && p.message ? `「${trunc(p.message, 14)}」` : inputHint(p.input);
    return `${mode}${hint}`;
}

/**
 * 实时生长关系图：编排器为起点，create/acquire 长出 session 节点，每次 invoke 一条独立边
 * （同一 session 多次 invoke = 多条边汇入，writer↔critic 循环肉眼可见）；进行中的边橙色虚线。
 * 边超 60 条时退化为按 session 聚合的计数边，防大 run 炸图。
 */
function buildRelation(view: RunView, running: Map<string, RunningActivity>, sessions: Map<number, SessionNaming>): string {
    const nodes: string[] = [`    WF(("编排器"))`];
    const declared = new Set<string>(["WF"]);
    const declareSession = (sessionId: number, suffix = "") => {
        const id = `S${sessionId}`;
        if (!declared.has(id)) {
            declared.add(id);
            const tag = sessions.get(sessionId)?.tag;
            nodes.push(`    ${id}["${safe(sessionName(sessionId, sessions) + (tag ? `·${tag}` : "") + suffix)}"]`);
        }
        return id;
    };
    type Edge = {from: string; to: string; label: string; live: boolean};
    const edges: Edge[] = [];
    const invokeCount = new Map<number, number>();
    const pushInvoke = (sessionId: number, p: Record<string, JsonValue>, live: boolean) => {
        const n = (invokeCount.get(sessionId) ?? 0) + 1;
        invokeCount.set(sessionId, n);
        edges.push({from: "WF", to: declareSession(sessionId), label: `第${n}次·${invokeHint(p)}${live ? " ⏳" : ""}`, live});
    };

    for (const record of view.journal) {
        const p = parseParams(record);
        if ((record.kind === "agents.create" || record.kind === "agents.acquire")) {
            const result = inlineActivityResult(record) as {sessionId?: number} | undefined;
            if (typeof result?.sessionId === "number") {
                const id = declareSession(result.sessionId);
                edges.push({from: "WF", to: id, label: record.kind === "agents.create" ? "创建" : "唤起", live: false});
            }
        }
        if (record.kind === "agents.invoke" && typeof p.id === "number") pushInvoke(p.id, p, false);
        if (record.kind === "ask") {
            if (!declared.has("U")) { declared.add("U"); nodes.push(`    U(["用户"])`); }
            edges.push({from: "WF", to: "U", label: safe(`已应答：${trunc(JSON.stringify(inlineActivityResult(record) ?? null), 14)}`), live: false});
        }
    }
    for (const r of running.values()) {
        if (r.kind !== "agents.invoke") continue;
        const p = parseParams(r);
        if (typeof p.id === "number") pushInvoke(p.id, p, true);
    }
    for (const ask of view.pendingAsks) {
        if (!declared.has("U")) { declared.add("U"); nodes.push(`    U(["用户"])`); }
        edges.push({from: "WF", to: "U", label: safe(`🙋 ${ask.spec.title}`), live: true});
    }

    // 防炸图：边太多退化为聚合计数边（create/ask 边保留）
    let finalEdges = edges;
    if (edges.length > 60) {
        finalEdges = edges.filter((e) => !e.label.startsWith("第"));
        for (const [sessionId, n] of invokeCount) {
            finalEdges.push({from: "WF", to: `S${sessionId}`, label: `调用 ×${n}`, live: [...running.values()].some((r) => r.kind === "agents.invoke" && parseParams(r).id === sessionId)});
        }
    }

    const busyIds = new Set<number>();
    for (const r of running.values()) {
        const p = parseParams(r);
        if (r.kind === "agents.invoke" && typeof p.id === "number") busyIds.add(p.id);
    }

    const lines = ["graph LR", ...nodes];
    const liveStyles: string[] = [];
    finalEdges.forEach((e, i) => {
        lines.push(e.live ? `    ${e.from} -.->|"${safe(e.label)}"| ${e.to}` : `    ${e.from} -->|"${safe(e.label)}"| ${e.to}`);
        if (e.live) liveStyles.push(`    linkStyle ${i} stroke:#d97706,stroke-width:2px,stroke-dasharray:5 5`);
    });
    for (const sessionId of busyIds) {
        lines.push(`    style S${sessionId} fill:#33200f,stroke:#d97706,stroke-dasharray:5 5,color:#ffcf87`);
    }
    return [...lines, ...liveStyles].join("\n");
}

/** phase 进度：progress 事件切段，activity/ask 按事件顺序归入当前段 */
function buildPhases(input: RunVmInput): PhaseVm[] {
    const declared = input.phases ?? [];
    if (declared.length === 0) return [];
    const keySet = new Set(declared.map((p) => p.key));
    const buckets = new Map<string, string[]>(declared.map((p) => [p.key, []]));
    const asks = new Map<string, string[]>(declared.map((p) => [p.key, []]));
    let current = declared[0]?.key ?? "";

    for (const {event} of input.events) {
        if (event.type === "progress" && typeof event.state.phase === "string" && keySet.has(event.state.phase)) {
            current = event.state.phase;
        }
        if (event.type === "activity_started" || event.type === "activity") {
            const key = event.type === "activity" ? event.record.key : event.key;
            const bucket = buckets.get(current);
            if (bucket && !bucket.includes(key)) bucket.push(key);
        }
        if (event.type === "ask_pending") {
            asks.get(current)?.push(event.ask.spec.title);
        }
    }

    const activeIndex = declared.findIndex((p) => p.key === current);
    return declared.map((p, i) => ({
        key: p.key,
        title: p.title,
        status: input.view.status === "completed" || i < activeIndex ? "done" : i === activeIndex ? "active" : "pending",
        activityKeys: buckets.get(p.key) ?? [],
        askTitles: asks.get(p.key) ?? [],
    }));
}

/**
 * session 序列图：请求箭头在 started 时刻、返回箭头在完成时刻——并发交错天然可见。
 * 缓存命中（无 started）合并为一对相邻箭头并标 ⚡。
 */
function buildFlow(events: WorkflowEvent[], sessions: Map<number, SessionNaming>, running: Map<string, RunningActivity>): string {
    const lines: string[] = [];
    const order: string[] = [];
    const declare = (id: string, label: string) => {
        if (!order.includes(id)) {
            order.push(id);
            lines.push(`    participant ${id} as ${safe(label)}`);
        }
    };
    declare("WF", "编排器");
    const body: string[] = [];
    /** started 过的 invoke key（完成时只补返回箭头） */
    const startedInvokes = new Set<string>();

    const sessionActor = (sessionId: number) => {
        const id = `S${sessionId}`;
        declare(id, sessionName(sessionId, sessions));
        return id;
    };

    for (const event of events) {
        if (event.type === "activity_started" && event.kind === "agents.invoke") {
            const p = parseParams(event);
            if (typeof p.id !== "number") continue;
            const actor = sessionActor(p.id);
            const mode = MODE_CN[String(p.mode ?? "prompt")] ?? "调用";
            const hint = typeof p.message === "string" && p.message ? `「${trunc(p.message, 12)}」` : inputHint(p.input);
            body.push(`    WF->>${actor}: ${safe(`${mode}${hint}`)}`);
            startedInvokes.add(event.key);
            continue;
        }
        if (event.type === "activity") {
            const {record} = event;
            const p = parseParams(record);
            if (record.kind === "agents.invoke" && typeof p.id === "number") {
                const actor = sessionActor(p.id);
                const outcome = inlineActivityResult(record) as {status?: string; message?: string} | undefined;
                const reply = outcome?.status === "waiting"
                    ? `反问：${trunc(outcome.message ?? "", 14)}`
                    : trunc(outcome?.message ?? "完成", 16);
                if (!startedInvokes.has(record.key)) {
                    // 缓存命中：请求+返回连发并标记
                    const mode = MODE_CN[String(p.mode ?? "prompt")] ?? "调用";
                    body.push(`    WF->>${actor}: ${safe(`⚡${mode}（缓存命中）`)}`);
                }
                body.push(`    ${actor}-->>WF: ${safe(reply)}`);
                continue;
            }
            if ((record.kind === "agents.create" || record.kind === "agents.acquire")) {
                const result = inlineActivityResult(record) as {sessionId?: number; created?: boolean} | undefined;
                if (typeof result?.sessionId === "number") {
                    const actor = sessionActor(result.sessionId);
                    const reused = record.kind === "agents.acquire" && result.created === false;
                    body.push(`    note over ${actor}: ${record.kind === "agents.create" ? "创建" : reused ? "唤起（复用既有）" : "唤起（新建）"}`);
                }
                continue;
            }
            if (record.kind === "sessions.append" && typeof p.id === "number") {
                const actor = sessionActor(p.id);
                const hint = typeof p.message === "string" && p.message ? trunc(p.message, 12) : "context";
                body.push(`    note over ${actor}: 写入「${safe(hint)}」`);
                continue;
            }
            if (record.kind === "ask") {
                declare("U", "用户");
                body.push(`    U-->>WF: ${safe(`已应答：${trunc(JSON.stringify(inlineActivityResult(record) ?? null), 14)}`)}`);
                continue;
            }
            if (record.kind === "workspace.read") {
                body.push(`    note over WF: 读取 ${safe(String(p.path ?? ""))}`);
            }
            continue;
        }
        if (event.type === "ask_pending") {
            declare("U", "用户");
            body.push(`    WF->>U: ${safe(`🙋 ${event.ask.spec.title}`)}`);
        }
    }
    // 尾部仍在进行中的 invoke 补标注（started 箭头已画）
    for (const [, r] of running) {
        if (r.kind !== "agents.invoke") continue;
        const p = parseParams(r);
        if (typeof p.id === "number") body.push(`    note over ${sessionActor(p.id)}: ⏳ 进行中`);
    }
    return ["sequenceDiagram", ...lines, ...body].join("\n");
}

/** 人话版 trace：结构（节点/边）来自 vendor traceGraph，标签换人话，附状态着色 */
function buildTrace(view: RunView, events: WorkflowEvent[], running: Map<string, RunningActivity>, labels: Record<string, string>): string {
    const placeholders: ActivityRecord[] = [...running.entries()].map(([key, r]) => ({
        key, path: r.path, seq: r.seq, kind: r.kind, fingerprint: r.fingerprint, params: r.params, result: {kind: "inline", value: null},
    }));
    // 挂起中的 ask 也进图（体育场节点 + 橙色等待样式）
    const askPlaceholders: ActivityRecord[] = view.pendingAsks.map((ask) => ({
        key: ask.key, path: ask.path, seq: ask.seq, kind: "ask", fingerprint: ask.fingerprint, result: {kind: "inline", value: null},
    }));
    const combined = [...view.journal, ...placeholders, ...askPlaceholders]
        .sort((a, b) => (a.path === b.path ? a.seq - b.seq : a.path.localeCompare(b.path)));
    const graph = traceGraph(combined);

    const cachedKeys = new Set<string>();
    for (const event of events) {
        if (event.type === "activity" && event.cached) cachedKeys.add(event.record.key);
    }
    const pendingKeys = new Set(view.pendingAsks.map((ask) => ask.key));

    const idOf = new Map(graph.nodes.map((n, i) => [n.key, `t${i}`]));
    const lines = graph.nodes.map((n) => {
        const id = idOf.get(n.key);
        const label = safe(labels[n.key] ?? n.kind);
        return n.kind === "ask" ? `    ${id}(["${label}"])` : `    ${id}["${label}"]`;
    });
    const edgeLines = graph.edges
        .filter(([from, to]) => idOf.has(from) && idOf.has(to))
        .map(([from, to]) => `    ${idOf.get(from)} --> ${idOf.get(to)}`);
    const styles: string[] = [];
    graph.nodes.forEach((n, i) => {
        if (running.has(n.key) || pendingKeys.has(n.key)) styles.push(`    style t${i} fill:#33200f,stroke:#d97706,stroke-dasharray:5 5,color:#ffcf87`);
        else if (cachedKeys.has(n.key)) styles.push(`    style t${i} fill:#14261a,stroke:#2ea043,color:#7ee787`);
    });
    return ["graph TD", ...lines, ...edgeLines, ...styles].join("\n");
}
