/**
 * 把 nb-harness 的会话日志条目与流式事件合成视图消息（`MessageView[]`），给 neuro-book 与 nb-story 这样跑 harness 的
 * 宿主共用。输入是 JSON：会话日志（nb-session 的条目，`agent_message` 里是 OMP 的原样消息）与 SSE 推来的 `AgentEvent`。
 * 本包不依赖 nb-harness 与 OMP，只认这里读到的那几个字段。
 *
 * 两条来源的分工：
 * - **日志是权威**。运行结果只从日志来：`run_end`（出错、停止）与紧跟助手消息的 `usage`。缺密钥这类运行前就失败的
 *   情况，harness 一个事件都不发，日志里却有 `run_end`；单价未知与免费在事件里都是 0，日志里分别是 null 与 0。
 * - **事件只画“正在生成的那条”**。`message_start`、`message_update` 拼出正在生成的助手消息，`tool_execution_*`
 *   标出工具在跑、跑完的临时结果。日志里同一条助手消息到了，临时版本整条换掉；工具结果的日志到了，临时结果换掉；
 *   `run_end` 或 `agent_end` 到了，剩下的临时内容全部清掉。
 *
 * 宿主的责任：运行中把事件与新写入的日志条目按顺序推过来；断线重连时按 `seq` 补发日志。只给事件不给日志的宿主看
 * 不到运行错误与费用。
 *
 * 已经交出去的消息对象不再改动：工具结果、用量与停止都换一个新对象，宿主把上一次的结果放进响应式状态也不会读到半截。
 *
 * 输入不可信（来自磁盘与网络）：两个入口都收 `unknown`，认不出、缺字段、重复或对不上的条目跳过，记一条 `problems()`，
 * 不抛异常，不中断回放。
 */

import type {TextRef} from "@notnotype/nb-ui/text";

import {agentRef} from "./text";
import type {AssistantMessageView, ContentBlockView, JsonValue, MessageView, RunView, ToolCallView, UsageView} from "./types";

export type TranscriptProblem = {
    /** 出问题的输入：日志条目的 `seq`，或事件的 `type`。 */
    source: string;
    reason: string;
};

export type HarnessTranscript = {
    /** 一条会话日志条目（nb-session 的 `SessionEntry` JSON）。按 `seq` 只进不退，重复或更旧的 `seq` 忽略。 */
    applyLogEntry(entry: unknown): void;
    /** 一条 harness 事件（OMP 的 `AgentEvent` JSON，`serializeAgentEvent` 推来的那份）。 */
    applyEvent(event: unknown): void;
    /** 当前的视图消息：日志里的消息，加上正在生成的那条。 */
    messages(): readonly MessageView[];
    /**
     * 只按事件推出的运行状态：收到 `agent_start` 之后是运行中，`agent_end` 或日志的 `run_end` 之后回到空闲。只对本页收到过
     * `agent_start` 的运行有效：页面刷新、断线重连后只补日志时得不到“运行中”；停止中与等待回答也看不出来。宿主有服务端的
     * 运行状态时以它为准，这只是没有时的退路。
     */
    run(): RunView;
    problems(): readonly TranscriptProblem[];
};

type JsonRecord = {readonly [key: string]: unknown};

// run() 返回同一个对象，状态没变时宿主写回 ctx.run 不会让依赖它的计算重算（与 messages() 的引用稳定一致）。
const RUNNING: RunView = Object.freeze({status: "running", phase: ""});
const IDLE: RunView = Object.freeze({status: "idle", phase: ""});

const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === "object" && !Array.isArray(value);
const stringField = (record: JsonRecord, key: string): string | null => (typeof record[key] === "string" ? record[key] : null);
const numberField = (record: JsonRecord, key: string): number | null => (typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : null);

/** 把 unknown 收成视图能存的 JSON；函数、undefined 之类去掉。 */
function toJsonValue(value: unknown): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(toJsonValue);
    if (isRecord(value)) {
        const result: {[key: string]: JsonValue} = {};
        for (const [key, item] of Object.entries(value)) if (item !== undefined && typeof item !== "function") result[key] = toJsonValue(item);
        return result;
    }
    return null;
}

/** OMP 消息内容里的文字：字符串，或 `{type: "text", text}` 块的拼接。 */
function contentText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.flatMap((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("");
}

/** base64 解码后的字节数：每 4 个字符 3 字节，扣掉末尾的 `=` 补位。 */
function base64Bytes(data: string): number {
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** 用户消息的内容块，按原来的先后：图片的位置是模型输入的一部分（docs/specs/ui/agent-conversation-view.md“输入框与待处理区”）。 */
function userBlocks(content: string | readonly unknown[]): ContentBlockView[] {
    if (typeof content === "string") return content === "" ? [] : [{kind: "text", text: content}];
    return content.flatMap((block): ContentBlockView[] => {
        if (!isRecord(block)) return [];
        if (block.type === "text" && typeof block.text === "string") return block.text === "" ? [] : [{kind: "text", text: block.text}];
        if (block.type !== "image") return [];
        const data = stringField(block, "data");
        const mimeType = stringField(block, "mimeType");
        if (data === null || mimeType === null) return [];
        // harness 只给 base64，没有附件地址：定位符写成 data: 地址，宿主的 resolveAttachmentUrl 原样返回即可。
        return [{kind: "attachment", locator: `data:${mimeType};base64,${data}`, name: mimeType, mimeType, bytes: base64Bytes(data)}];
    });
}

const RETRYABLE_ERRORS = new Set(["network", "rate_limit", "provider"]);
const ERROR_KEYS = {
    network: "harness.error.network",
    rate_limit: "harness.error.rateLimit",
    auth: "harness.error.auth",
    quota: "harness.error.quota",
    context_overflow: "harness.error.contextOverflow",
    provider: "harness.error.provider",
    local: "harness.error.local",
} as const;

/** 模型出错的类别（`ModelErrorKind`）对应的那句话；认不出的类别按 `local`。宿主在消息流之外写出错原因时用（例如子代理的收口结果）。 */
export function modelErrorText(kind: string): TextRef {
    return agentRef(kind in ERROR_KEYS ? ERROR_KEYS[kind as keyof typeof ERROR_KEYS] : ERROR_KEYS.local);
}

/**
 * 由日志条目合成的消息来自哪一条日志（它的 `seq`）；正在生成的临时消息（事件来的）为 null。宿主要把消息对到日志
 * 条目上时用它（例如 nb-story 按每轮在日志里的起点切分轮次），不要自己解析消息 id。
 */
export function logSeqOf(message: {readonly id: string}): number | null {
    const match = /^h(\d+)$/u.exec(message.id);
    return match === null ? null : Number(match[1]);
}

/** 运行错误的说明与压缩条目的名称是本包目录的引用，由视图按当前语言翻译。 */
export function createHarnessTranscript(): HarnessTranscript {
    const logged: MessageView[] = [];
    const problems: TranscriptProblem[] = [];
    let lastSeq = 0;
    /** 日志里还没有结果的工具调用：id → 所在助手消息在 `logged` 里的位置。 */
    const openCalls = new Map<string, number>();
    const seenCallIds = new Set<string>();

    /**
     * 正在生成的助手消息（事件拼出），与工具的临时状态。`liveStamp` 是它的 OMP `timestamp`：日志里同一条消息到了才把它换掉。
     * 前一条消息的日志可能晚于下一条消息的事件到达，只按“来了一条助手日志”就清会把正在生成的下一条一起清掉。
     */
    let live: AssistantMessageView | null = null;
    let liveStamp: number | null = null;
    let running = false;
    const liveTools = new Map<string, {status: ToolCallView["status"]; result?: ToolCallView["result"]; error?: string}>();

    const problem = (source: string, reason: string): void => {
        problems.push({source, reason});
    };

    function assistantFrom(message: JsonRecord, id: string, timestamp: number, status: AssistantMessageView["status"], source: string): AssistantMessageView {
        const content = Array.isArray(message.content) ? message.content : [];
        const toolCalls: ToolCallView[] = [];
        let thinking = "";
        for (const block of content) {
            if (!isRecord(block)) continue;
            if (block.type === "thinking" && typeof block.thinking === "string") thinking += block.thinking;
            if (block.type === "toolCall") {
                const callId = stringField(block, "id");
                const name = stringField(block, "name");
                if (callId === null || name === null) {
                    problem(source, "工具调用缺 id 或 name");
                    continue;
                }
                toolCalls.push({id: callId, name, status: status === "streaming" ? "streaming" : "running", args: toJsonValue(block.arguments ?? {})});
            }
        }
        return {kind: "assistant", id, timestamp, status, text: contentText(content), thinking, model: stringField(message, "model") ?? "", toolCalls, contentOmitted: false};
    }

    function settledStatus(message: JsonRecord): AssistantMessageView["status"] {
        switch (message.stopReason) {
            case "aborted": return "stopped";
            case "error": return "error";
            default: return "done";
        }
    }

    function applyAgentMessage(message: unknown, seq: number, timestamp: number): void {
        const source = `seq ${String(seq)}`;
        if (!isRecord(message)) {
            problem(source, "agent_message 的 message 不是对象");
            return;
        }
        const id = `h${String(seq)}`;
        const at = numberField(message, "timestamp") ?? timestamp;
        switch (message.role) {
            case "user": {
                const content = message.content;
                if (typeof content !== "string" && !Array.isArray(content)) {
                    problem(source, "用户消息缺 content");
                    return;
                }
                logged.push({kind: "user", id, timestamp: at, intent: message.steering === true ? "steer" : "normal", blocks: userBlocks(content), contentOmitted: false});
                return;
            }
            case "assistant": {
                if (!Array.isArray(message.content) || typeof message.stopReason !== "string") {
                    problem(source, "助手消息缺 content 或 stopReason");
                    return;
                }
                const view = assistantFrom(message, id, at, settledStatus(message), source);
                view.toolCalls = view.toolCalls.filter((call) => {
                    if (seenCallIds.has(call.id)) {
                        problem(source, `工具调用 id 重复：${call.id}`);
                        return false;
                    }
                    seenCallIds.add(call.id);
                    openCalls.set(call.id, logged.length);
                    return true;
                });
                logged.push(view);
                // 日志里这条到了，事件拼出的临时版本作废；时间戳对不上的是下一条，留着。
                const stamp = numberField(message, "timestamp");
                if (liveStamp === null || stamp === null || stamp === liveStamp) {
                    live = null;
                    liveStamp = null;
                }
                return;
            }
            case "toolResult": {
                const callId = stringField(message, "toolCallId");
                if (!Array.isArray(message.content) || typeof message.isError !== "boolean") {
                    problem(source, "工具结果缺 content 或 isError");
                    return;
                }
                const index = callId === null ? undefined : openCalls.get(callId);
                const owner = index === undefined ? undefined : logged[index];
                if (callId === null || index === undefined || owner?.kind !== "assistant") {
                    problem(source, `工具结果找不到对应的调用：${callId ?? "（缺 toolCallId）"}`);
                    return;
                }
                openCalls.delete(callId);
                liveTools.delete(callId);
                const isError = message.isError;
                const text = contentText(message.content);
                logged[index] = {...owner, toolCalls: owner.toolCalls.map((call) => (call.id !== callId ? call : {
                    ...call,
                    status: isError ? "error" : "success",
                    result: {text, truncated: false, ...(message.details === undefined ? {} : {details: toJsonValue(message.details)})},
                    ...(isError ? {error: text} : {}),
                }))};
                return;
            }
            default:
                problem(source, `不认识的消息角色：${String(message.role)}`);
        }
    }

    function applyUsage(entry: JsonRecord, source: string): void {
        const last = logged.at(-1);
        if (last === undefined || last.kind !== "assistant") {
            problem(source, "usage 前面不是助手消息");
            return;
        }
        const fields = ["input", "output", "cacheRead", "cacheWrite"].map((key) => numberField(entry, key));
        if (fields.some((value) => value === null)) {
            problem(source, "usage 缺数字字段");
            return;
        }
        const cost = entry.cost === null ? null : numberField(entry, "cost");
        const [input, output, cacheRead, cacheWrite] = fields as number[];
        const usage: UsageView = {input: input!, output: output!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, cost};
        logged[logged.length - 1] = {...last, usage};
    }

    function applyRunEnd(entry: JsonRecord, seq: number, timestamp: number): void {
        running = false;
        live = null;
        liveStamp = null;
        liveTools.clear();
        // 这次运行里没等到结果的工具调用不会再有结果了。
        for (const [callId, index] of openCalls) {
            const owner = logged[index];
            if (owner?.kind === "assistant") logged[index] = {...owner, toolCalls: owner.toolCalls.map((call) => (call.id === callId ? {...call, status: "error"} : call))};
        }
        openCalls.clear();
        if (entry.stopReason === "aborted") {
            const last = logged.at(-1);
            if (last?.kind === "assistant") {
                logged[logged.length - 1] = {...last, status: "stopped"};
                return;
            }
            // 模型还没开口就被停了：补一条空的“已停止”回复，分轮层才会在这一轮末尾写“已停止”，不当作普通完成。
            logged.push({kind: "assistant", id: `h${String(seq)}`, timestamp, status: "stopped", text: "", thinking: "", model: "", toolCalls: [], contentOmitted: false});
            return;
        }
        const error = isRecord(entry.error) ? entry.error : {};
        const kind = stringField(error, "kind") ?? "local";
        logged.push({kind: "error", id: `h${String(seq)}`, timestamp, message: modelErrorText(kind), retryable: RETRYABLE_ERRORS.has(kind)});
    }

    return {
        applyLogEntry(entry) {
            if (!isRecord(entry)) {
                problem("日志", "条目不是对象");
                return;
            }
            const seq = numberField(entry, "seq");
            const source = seq === null ? "日志" : `seq ${String(seq)}`;
            if (seq === null || typeof entry.kind !== "string") {
                problem(source, "条目缺 seq 或 kind");
                return;
            }
            if (seq <= lastSeq) return;
            lastSeq = seq;
            const at = Date.parse(stringField(entry, "at") ?? "");
            const timestamp = Number.isNaN(at) ? 0 : at;
            switch (entry.kind) {
                case "agent_message":
                    applyAgentMessage(entry.message, seq, timestamp);
                    return;
                case "usage":
                    applyUsage(entry, source);
                    return;
                case "run_end":
                    applyRunEnd(entry, seq, timestamp);
                    return;
                case "compaction":
                    logged.push({kind: "system", id: `h${String(seq)}`, timestamp, source: "compaction", label: agentRef("harness.compaction"), text: stringField(entry, "summary") ?? ""});
                    return;
                // 会话快照与元数据不显示；只存文字的旧条目 harness 已不再写。
                case "session_snapshot":
                case "meta":
                case "message":
                case "tool_call":
                case "tool_result":
                    return;
                default:
                    problem(source, `不认识的条目：${entry.kind}`);
            }
        },

        applyEvent(event) {
            if (!isRecord(event) || typeof event.type !== "string") {
                problem("事件", "不是带 type 的对象");
                return;
            }
            const source = event.type;
            switch (event.type) {
                case "message_start":
                case "message_update": {
                    if (!isRecord(event.message)) {
                        problem(source, "缺 message");
                        return;
                    }
                    // 用户消息与工具结果的事件不画：它们在日志里马上就到。
                    if (event.message.role !== "assistant") return;
                    const stamp = numberField(event.message, "timestamp");
                    // 同一条消息沿用 id，Vue 的 key 不跳；换了一条（时间戳不同）才换 id。
                    const same = live !== null && stamp === liveStamp;
                    const id = same ? live!.id : `live${String(lastSeq)}-${String(stamp ?? 0)}`;
                    live = assistantFrom(event.message, id, stamp ?? 0, "streaming", source);
                    liveStamp = stamp;
                    return;
                }
                case "tool_execution_start":
                case "tool_execution_end": {
                    const callId = stringField(event, "toolCallId");
                    if (callId === null) {
                        problem(source, "缺 toolCallId");
                        return;
                    }
                    // 日志里已经有这个调用的结果了：日志为准，晚到的事件不再盖上去。
                    if (seenCallIds.has(callId) && !openCalls.has(callId)) return;
                    if (event.type === "tool_execution_start") {
                        liveTools.set(callId, {status: "running"});
                        return;
                    }
                    const isError = event.isError === true;
                    const result = isRecord(event.result) ? event.result : {};
                    const text = contentText(result.content);
                    const details = result.details === undefined ? {} : {details: toJsonValue(result.details)};
                    liveTools.set(callId, {status: isError ? "error" : "success", result: {text, truncated: false, ...details}, ...(isError ? {error: text} : {})});
                    return;
                }
                case "agent_start":
                    running = true;
                    return;
                case "agent_end":
                    running = false;
                    live = null;
                    liveStamp = null;
                    liveTools.clear();
                    return;
                // 对视图没有新信息的事件：消息结束以日志为准，工具的中途进度不显示。
                case "turn_start":
                case "turn_end":
                case "message_end":
                case "tool_execution_update":
                case "tool_stream_update":
                    return;
                default:
                    problem(source, `不认识的事件：${event.type}`);
                    return;
            }
        },

        messages() {
            // 没有被工具事件改动的消息原样返回：宿主每次事件都取一遍，引用不变的消息不用重新渲染。
            const withTools = (message: MessageView): MessageView => {
                if (message.kind !== "assistant" || !message.toolCalls.some((call) => liveTools.has(call.id))) return message;
                return {...message, toolCalls: message.toolCalls.map((call) => {
                    const overlay = liveTools.get(call.id);
                    return overlay === undefined ? call : {...call, ...overlay};
                })};
            };
            const result = logged.map(withTools);
            if (live !== null) result.push(withTools(live));
            return result;
        },

        run() {
            return running ? RUNNING : IDLE;
        },

        problems() {
            return problems;
        },
    };
}
