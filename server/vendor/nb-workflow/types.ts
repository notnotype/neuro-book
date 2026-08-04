/**
 * nb-workflow spike 核心类型。
 *
 * 对应 Task 110「V1 收敛」范围：
 * - Run 即 session（spike 中简化为独立 RunRecord，不建真 session 树，接入 NeuroBook 时替换）
 * - Activity = 一切 journaled 副作用；ActivityKey = (分支路径, 路径内序号, kind, 参数指纹)
 * - Session 是持久一等公民，workflow 是无状态 conductor
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** 对齐 NeuroBook：SessionEntryId 是字符串，SessionId 是数字 */
export type EntryId = string;
export type SessionId = number;

/** Session 元数据（对齐 Task 110 meta 整理：kind + tags 为新增一等字段） */
export type SessionMeta = {
    sessionId: SessionId;
    profileKey: string;
    kind: "chat" | "workflow" | "system";
    tags: string[];
    /** 为空表示顶层 session；否则挂在父 session 子树下（UI 聚合用） */
    parentSessionId?: SessionId;
    title?: string;
    archived: boolean;
};

/** append-only 树上的一个 entry（spike 只建模 message，够场景验证） */
export type SessionEntry = {
    id: EntryId;
    parentId: EntryId | null;
    type: "message";
    role: "user" | "assistant";
    /** 自然语言正文；结构化输入走 input */
    message?: string;
    /** 本轮 payload（对齐 invoke_agent 的 input） */
    input?: JsonValue;
    /** assistant 结构化输出（对齐 report_result.data） */
    data?: JsonValue;
    /** workflow 表示由 workflow append/invoke 写入；direct 表示用户直接对话 */
    origin: "workflow" | "direct";
};

/** invoke 返回，对齐现有 invoke_agent 工具合同（waiting 是普通返回值，不是失败） */
export type InvokeResult = {
    status: "completed" | "waiting";
    result: {
        message: string;
        /** 结构化输出；completed 且 responder 返回 data 时非空 */
        data: JsonValue | null;
    };
};

export type InvokeOptions = {
    mode?: "prompt" | "continue" | "steer" | "followup";
    message?: string;
    input?: JsonValue;
    /** Run 取消信号；宿主 AgentPort 应将它绑定到本次精确 invocation。 */
    signal?: AbortSignal;
};

/** journal 中一条 Activity 记录。spike 只记成功（错误不落 journal，重跑时重执行——见 README 发现 F4） */
export type ActivityRecord = {
    /** `${path}#${seq}` */
    key: string;
    /** 分支路径：root 或 root/<mapSeq>:<index> 递归 */
    path: string;
    /** 路径内序号（每条路径独立计数，并发完成序不影响身份） */
    seq: number;
    kind: string;
    /** 参数规范化 JSON（spike 直接用字符串，不哈希，便于调试） */
    fingerprint: string;
    result: JsonValue;
};

/** 挂起中的 ask，等用户应答后经 resume 写回 journal */
export type PendingAsk = {
    key: string;
    path: string;
    seq: number;
    fingerprint: string;
    spec: AskSpec;
};

export type AskSpec = {
    kind: "select" | "text" | "approve";
    title: string;
    /** 可选 Markdown 说明；为空表示仅展示标题，非空表示给用户的完整审批/提问上下文。 */
    description?: string;
    options?: { id: string; label: string }[];
    multi?: boolean;
};

export type RunStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";

/** workflow 定义：spike 中脚本是真函数（沙盒是接入期问题）；phases 用于骨架投影 */
export type WorkflowDefinition<TArgs = JsonValue, TResult = JsonValue> = {
    key: string;
    /** 声明骨架（投影一），可选 */
    phases?: { key: string; title: string }[];
    run: (wf: Wf, args: TArgs) => Promise<TResult>;
};

export type ProgressState = { phase?: string; done?: number; total?: number };

/**
 * 状态图操作（`wf.chart` 发出的观测事件载荷，非 journaled）。
 * 设计要点：
 * - node/edge 是**增量声明**：可以运行前由宿主预置（声明骨架），也可以代码运行中随时补（动态分支/每项子状态），同一套 API。
 * - enter/leave/move 以 **token** 表达并发：一个 token = 一条并行执行线（默认 "main"；map 分支用 item id 当 token），
 *   多个 token 同时停在不同/相同节点 = 并发在图上可见。
 * - token 可附 sessionId：展示「哪个 agent session 正在这个状态上干活」。
 */
export type ChartOp =
    | { op: "node"; key: string; title?: string }
    | { op: "edge"; from: string; to: string; label?: string }
    | { op: "enter"; key: string; token: string; sessionId?: SessionId }
    | { op: "leave"; key: string; token: string }
    /** leave(from)+enter(to)，并确保 from→to 边存在 */
    | { op: "move"; from: string; to: string; token: string; sessionId?: SessionId; label?: string };

/** 宿主注入的 wf 根对象（V1 收敛面） */
export type Wf = {
    args: JsonValue;
    agents: {
        /** 查 profile 信息（journaled） */
        profile(profileKey: string): Promise<JsonValue>;
        /** 新建 session；ephemeral 的在 run 成功后归档；model 指定该 session 用的模型（缺省用 run 级默认，再缺省用 profile 默认） */
        create(profileKey: string, opts?: { initial?: JsonValue; tags?: string[]; parent?: SessionHandle; ephemeral?: boolean; model?: string }): Promise<SessionHandle>;
        /** 持久参与者：按 (profileKey, tag) 查未归档 session，找到复用，没有才建 */
        acquire(opts: { profileKey: string; tag: string; parent?: SessionHandle }): Promise<SessionHandle>;
        /** wf.sessions.open(id).invoke(...) 的糖 */
        invoke(sessionId: SessionId, opts: InvokeOptions): Promise<InvokeResult>;
    };
    sessions: {
        open(sessionId: SessionId): Promise<SessionHandle>;
    };
    /** 并发：注意必须传 thunk（惰性函数），同一路径下裸并发会破坏 seq 确定性 */
    all<T>(thunks: (() => Promise<T>)[]): Promise<T[]>;
    map<TItem, TOut>(items: TItem[], fn: (item: TItem, index: number) => Promise<TOut>, opts?: { concurrency?: number }): Promise<TOut[]>;
    /** 人类参与：挂起点。无应答时抛 SuspendSignal，run 转 waiting */
    ask(spec: AskSpec): Promise<JsonValue>;
    log(message: string): void;
    progress(state: ProgressState): void;
    /** 观测：状态图（声明与指针分离；见 ChartOp 注释）。纯观测不进 journal，replay 时随代码重跑自然重建 */
    chart: {
        node(key: string, title?: string): void;
        edge(from: string, to: string, label?: string): void;
        enter(key: string, opts?: { token?: string; sessionId?: SessionId }): void;
        leave(key: string, opts?: { token?: string }): void;
        move(from: string, to: string, opts?: { token?: string; sessionId?: SessionId; label?: string }): void;
    };
    workspace: {
        /** 只读读取（journaled）；spike 从 env.files 取 */
        read(path: string): Promise<string>;
    };
    /** 面 B/C：发起方 session 句柄；面 A 下调用抛错 */
    caller(): Promise<SessionHandle>;
};

/** session 句柄：持显式游标（append/invoke 锚定游标而非全局 active leaf——发现 F2） */
export type SessionHandle = {
    readonly id: SessionId;
    /** 当前游标（同步派生态，不是 activity） */
    leaf(): EntryId | null;
    transcript(opts?: { tail?: number }): Promise<SessionEntry[]>;
    /** 统一原语：rewind / 切分支 / 恢复现场都是它；同步 session active leaf */
    checkout(entryId: EntryId): Promise<void>;
    append(msg: { role: "user" | "assistant"; message?: string; input?: JsonValue }): Promise<EntryId>;
    invoke(opts: InvokeOptions): Promise<InvokeResult>;
    /** 作用域安全旁路：进入记住原游标，结束/异常自动 checkout 回原位，旁支留树上 */
    excursion<T>(at: EntryId | "leaf", fn: (branch: SessionHandle) => Promise<T>): Promise<T>;
};

export type RunView = {
    runId: string;
    workflowKey: string;
    status: RunStatus;
    result?: JsonValue;
    error?: string;
    pendingAsks: PendingAsk[];
    logs: string[];
    progress: ProgressState | null;
    journal: ActivityRecord[];
};
