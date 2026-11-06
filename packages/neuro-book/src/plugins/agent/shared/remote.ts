/**
 * 远程合同 `nbook.agent/sessions`（docs/specs/agent/sessions.md“输入与前置条件”与输出 2、3、7–11）：窗口经它建会话、发指令、
 * 读日志、订阅帧。版本 1，服务端提供，只给浏览器调用。
 *
 * 从浏览器来的输入在这里按结构校验（用户的话、附件、提问的回答、设置补丁），只有 Profile 自己定义的 `payload`、`data`
 * 是自由 JSON；服务端交出的结构（事件、快照、预览）用 `Type.Unsafe` 带上内核的类型、schema 只核对是对象，形状由内核产生。
 * 业务失败码按指令取内核的码表（`commandErrors`），各码的详情 schema 照内核的 `CommandErrorDetails`，没有详情的码不收详情；
 * 打开会话遇到的存储码带可选的详情对象；通道保留的码不进这张表。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import {commandErrors, storageErrors} from "@notnotype/nb-harness/kernel/contracts";
import type {BranchPoint, CommandErrorDetails, CommandMap, JsonValue, CommandName, Diagnostic, HostOnlyCommand, DiagnosticLevel, DeltaFrame, Frame, InputMode, LogEvent, PreviewResult, RewindTarget, TreeNode, RunResult, RunStatus, SessionIndexEntry, SessionSnapshot} from "@notnotype/nb-harness/kernel/contracts";

import {TASK_ID} from "./contracts";
import type {ProfileEntry} from "./contracts";

const object = <T>() => Type.Unsafe<T>(Type.Object({}, {additionalProperties: true}));
const Nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);

/** 存储与打开会话的失败：详情是可选的对象（`StorageResult` 的 `detail`）。 */
const Detail = Type.Union([Type.Undefined(), Type.Record(Type.String(), Type.Unknown())]);
const NoDetail = Type.Undefined();

/** 指令失败码的详情，照内核的 `CommandErrorDetails` 逐个写；下面的类型核对保证内核交出的详情过得了它。 */
const RejectionParams = Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])));
const COMMAND_DETAILS = {
    "input-rejected": Type.Object({code: Type.String(), params: RejectionParams, by: Type.String()}, {additionalProperties: false}),
    "already-answered": Type.Object({by: Type.String(), decision: Type.String()}, {additionalProperties: false}),
    "invalid-value": Type.Object({extension: Type.String(), key: Type.String(), message: Type.String()}, {additionalProperties: false}),
    "unknown-key": Type.Object({extension: Type.String(), key: Type.String()}, {additionalProperties: false}),
    "already-running": Type.Object({runId: Type.String()}, {additionalProperties: false}),
    running: Type.Object({runId: Type.String()}, {additionalProperties: false}),
    "dependency-missing": Type.Object({extension: Type.String(), dependency: Type.String()}, {additionalProperties: false}),
} as const;
type DetailCode = keyof typeof COMMAND_DETAILS;

/** 打开会话会遇到的码（存储的码，加上宿主打开时抛错的 `open-failed`）。 */
const OPEN_CODES = [...storageErrors, "open-failed"] as const;
type OpenCode = (typeof OPEN_CODES)[number];

function errorsOf<const Codes extends readonly string[]>(codes: Codes): {readonly [Code in Codes[number]]: typeof Detail} {
    return Object.fromEntries(codes.map((code) => [code, Detail])) as {readonly [Code in Codes[number]]: typeof Detail};
}

/** 指令的失败码表：内核的码按 `COMMAND_DETAILS` 给详情、没列的不收详情；打开会话的码收可选的对象。 */
function commandErrorsOf<const Codes extends readonly string[]>(codes: Codes) {
    const table: Record<string, TSchema> = {};
    for (const code of codes) table[code] = code in COMMAND_DETAILS ? COMMAND_DETAILS[code as DetailCode] : NoDetail;
    for (const code of OPEN_CODES) table[code] ??= Detail;
    return table as {readonly [Code in Codes[number] | OpenCode]: Code extends DetailCode ? (typeof COMMAND_DETAILS)[Code] : Code extends OpenCode ? typeof Detail : typeof NoDetail};
}

/** 自由的 JSON（Profile 定义的 `payload`、提问回答的 `data`、设置补丁的值）：经过 JSON 链路的本来就是 JSON。 */
const Json = Type.Unsafe<JsonValue>(Type.Unknown());
const SessionId = Type.String({minLength: 1});
const CommandId = Type.String({minLength: 1, maxLength: 200});
const Attachment = Type.Object({kind: Type.Union([Type.Literal("image"), Type.Literal("file")]), uri: Type.String({minLength: 1})}, {additionalProperties: false});
const Input = Type.Object({text: Type.String(), payload: Type.Optional(Json), attachments: Type.Optional(Type.Array(Attachment))}, {additionalProperties: false});
const Mode = Type.Unsafe<InputMode>(Type.Union([Type.Literal("steer"), Type.Literal("followup")]));

/** 各指令的参数（不含会话 id 与 `commandId`），逐个写字段：与内核的 `CommandMap` 由下面的类型核对锁住。 */
const commandArgs = {
    send: {input: Input, mode: Type.Optional(Mode)},
    enqueue: {input: Input, mode: Mode},
    edit: {inputId: Type.String(), input: Input},
    remove: {inputId: Type.String()},
    resolve: {
        id: Type.String(),
        decision: Type.Union([Type.Literal("allow"), Type.Literal("allow-session"), Type.Literal("deny"), Type.Literal("answer")]),
        answer: Type.Optional(Type.Object({text: Type.String(), data: Type.Optional(Json)}, {additionalProperties: false})),
        note: Type.Optional(Type.String()),
    },
    start: {},
    abort: {keepQueue: Type.Optional(Type.Boolean())},
    rewind: {to: Nullable(Type.String()), resend: Type.Optional(Input)},
    switchBranch: {node: Type.String()},
    fork: {leaf: Type.Optional(Nullable(Type.String()))},
    compact: {requirement: Type.Optional(Type.String())},
    changeSettings: {patch: Type.Record(Type.String(), Type.Record(Type.String(), Json))},
    changeProfile: {profile: Type.String({minLength: 1})},
    setTitle: {title: Type.String()},
    archive: {archived: Type.Boolean()},
} as const;

/** 暴露给远程的指令：只给宿主的不进合同（harness/runtime.md 输出 72）。 */
export type RemoteCommandName = Exclude<CommandName, HostOnlyCommand>;

type CommandMethods = {
    readonly [K in RemoteCommandName]: {
        readonly input: TSchema;
        readonly output: ReturnType<typeof object<{value: CommandMap[K]["value"]; seq: number; replayed: boolean}>>;
        readonly effect: "write";
        readonly errors: ReturnType<typeof commandErrorsOf<(typeof commandErrors)[K]>>;
    };
};

const commandMethods = Object.fromEntries((Object.keys(commandArgs) as RemoteCommandName[]).map((name) => [name, {
    input: Type.Object({sessionId: SessionId, commandId: CommandId, ...commandArgs[name]}, {additionalProperties: false}),
    output: object<unknown>(),
    effect: "write",
    errors: commandErrorsOf(commandErrors[name]),
}])) as unknown as CommandMethods;

const BySession = {sessionId: SessionId};
const queryErrors = errorsOf(OPEN_CODES);
/** 单个结果编码后放不进一条消息（快照、运行结果这类不分页的）：明确失败，不让链路收到超过上限的消息（sessions.md 输出 9）。 */
const wholeErrors = errorsOf([...OPEN_CODES, "result-too-large"] as const);

/** 一条日志：放得下就是事件本身，太大就是占位，内容经 `eventChunk` 分段读（sessions.md 输出 9）。 */
export type LogItem = {readonly kind: "event"; readonly event: LogEvent} | {readonly kind: "oversized"; readonly seq: number; readonly type: string; readonly bytes: number};
export type PreviewItem = {readonly kind: "inline"; readonly preview: PreviewResult} | {readonly kind: "oversized"; readonly token: string; readonly bytes: number};

export type ActivityItem = {readonly id: string; readonly state: "running" | "waiting"};

/** 审批预览（builtin-tools.md 输出 26）：按文件分组。 */
export type ApprovalPreview = {readonly files: ReadonlyArray<{readonly address: string; readonly kind: "diff"; readonly before: string; readonly after: string} | {readonly address: string; readonly kind: "too-large"; readonly bytes: number} | {readonly address: string; readonly kind: "failed"; readonly code: string}>};
/** 放不进一条消息时和 `preview` 一样经 `previewChunk` 分段读。 */
export type ApprovalPreviewItem = {readonly kind: "inline"; readonly preview: ApprovalPreview} | {readonly kind: "oversized"; readonly token: string; readonly bytes: number};

/** `frames` 推的帧：日志帧用 `LogItem` 投影，其余照内核的帧。 */
export type RemoteFrame = {readonly type: "log"; readonly item: LogItem} | Exclude<Frame, {type: "log"}>;

const methods = {
    ...commandMethods,
    list: {
        input: Type.Object({project: Type.Optional(Type.String()), archived: Type.Optional(Type.Boolean()), background: Type.Optional(Type.Boolean())}, {additionalProperties: false}),
        output: Type.Unsafe<readonly SessionIndexEntry[]>(Type.Array(Type.Object({}, {additionalProperties: true}))),
        effect: "read",
        errors: errorsOf(storageErrors),
    },
    create: {
        input: Type.Object({profile: Type.String({minLength: 1}), initial: Type.Optional(Type.Unknown()), project: Type.Optional(Type.String())}, {additionalProperties: false}),
        output: Type.Object({sessionId: Type.String()}, {additionalProperties: false}),
        effect: "write",
        errors: errorsOf([...storageErrors, "profile-invalid", "invalid-initial", "open-failed"] as const),
    },
    snapshot: {input: Type.Object(BySession, {additionalProperties: false}), output: object<SessionSnapshot>(), effect: "read", errors: wholeErrors},
    log: {
        input: Type.Object({...BySession, afterSeq: Type.Integer({minimum: 0}), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 2000}))}, {additionalProperties: false}),
        output: object<{items: LogItem[]; head: number; more: boolean; through: number}>(),
        effect: "read",
        errors: queryErrors,
    },
    rewindTargets: {input: Type.Object(BySession, {additionalProperties: false}), output: Type.Unsafe<RewindTarget[]>(Type.Array(Type.Unknown())), effect: "read", errors: wholeErrors},
    /** 按页读路径：`from` 是从根数起的下标，下一页从交回的 `next` 读。 */
    path: {input: Type.Object({...BySession, leaf: Type.Optional(Nullable(Type.String())), from: Type.Optional(Type.Integer({minimum: 0}))}, {additionalProperties: false}), output: object<{items: LogItem[]; more: boolean; next: number}>(), effect: "read", errors: queryErrors},
    /** 整棵树的结构（runtime.md 输出 80、81）。节点小，分页不用按字节算。 */
    treeNodes: {input: Type.Object({...BySession, afterSeq: Type.Optional(Type.Integer({minimum: 0}))}, {additionalProperties: false}), output: object<{nodes: TreeNode[]; more: boolean; through: number}>(), effect: "read", errors: wholeErrors},
    branchPoints: {input: Type.Object(BySession, {additionalProperties: false}), output: Type.Unsafe<BranchPoint[]>(Type.Array(Type.Unknown())), effect: "read", errors: wholeErrors},
    siblings: {input: Type.Object({...BySession, node: Type.String()}, {additionalProperties: false}), output: Type.Unsafe<{node: string; latestLeaf: string}[]>(Type.Array(Type.Unknown())), effect: "read", errors: wholeErrors},
    runResult: {input: Type.Object({...BySession, runId: Type.String()}, {additionalProperties: false}), output: Type.Unsafe<RunResult | null>(Type.Unknown()), effect: "read", errors: wholeErrors},
    preview: {
        input: Type.Object({...BySession, leaf: Type.Optional(Nullable(Type.String()))}, {additionalProperties: false}),
        output: object<PreviewItem>(),
        effect: "read",
        errors: errorsOf([...OPEN_CODES, "preview-unavailable"] as const),
    },
    approvalPreview: {
        input: Type.Object({...BySession, interactionId: Type.String()}, {additionalProperties: false}),
        output: object<ApprovalPreviewItem>(),
        effect: "read",
        errors: errorsOf([...OPEN_CODES, "unknown-interaction"] as const),
    },
    /** 运行中与等用户的前台会话（sessions.md 输出 15）：先订阅事件 `activityChanged`，再取这份。 */
    activity: {input: Type.Object({}, {additionalProperties: false}), output: Type.Unsafe<readonly ActivityItem[]>(Type.Array(Type.Unknown())), effect: "read"},
    /** 按页读诊断：`after` 是上一页最后一条的 id（诊断按 id 合并、按出现先后排）；长文字截短。 */
    diagnostics: {
        input: Type.Object({...BySession, afterSeq: Type.Optional(Type.Integer({minimum: 0})), extension: Type.Optional(Type.String()), level: Type.Optional(Type.Unsafe<DiagnosticLevel>(Type.String())), after: Type.Optional(Type.String())}, {additionalProperties: false}),
        output: object<{items: Diagnostic[]; more: boolean; next: string | null}>(),
        effect: "read",
        errors: queryErrors,
    },
    eventChunk: {
        input: Type.Object({...BySession, seq: Type.Integer({minimum: 1}), index: Type.Integer({minimum: 0})}, {additionalProperties: false}),
        output: Type.Object({text: Type.String(), last: Type.Boolean()}, {additionalProperties: false}),
        effect: "read",
        errors: errorsOf([...OPEN_CODES, "unknown-event", "out-of-range"] as const),
    },
    previewChunk: {
        input: Type.Object({token: Type.String(), index: Type.Integer({minimum: 0})}, {additionalProperties: false}),
        output: Type.Object({text: Type.String(), last: Type.Boolean()}, {additionalProperties: false}),
        effect: "read",
        errors: errorsOf(["unknown-token", "out-of-range"] as const),
    },
    profiles: {input: Type.Object({}, {additionalProperties: false}), output: Type.Unsafe<readonly ProfileEntry[]>(Type.Array(Type.Unknown())), effect: "read"},
    /** 发起任务、立即返回（sessions.md 输出 10、11）；结果经 `runResult` 与 `frames` 取。同一个 `taskId` 重发得到同一个结果。 */
    startTask: {
        input: Type.Object({
            taskId: Type.String({pattern: TASK_ID}),
            profile: Type.String({minLength: 1}),
            initial: Type.Optional(Type.Unknown()),
            input: Input,
            project: Type.Optional(Type.String()),
            background: Type.Optional(Type.Boolean()),
        }, {additionalProperties: false}),
        output: Type.Object({sessionId: Type.String(), runId: Type.String()}, {additionalProperties: false}),
        effect: "write",
        errors: errorsOf([...OPEN_CODES, ...commandErrors.send, "profile-invalid", "invalid-initial", "task-conflict", "invalid-task-id", "already-running"] as const),
    },
} as const;

const events = {
    /** 先订阅、再用 `log` 补到 `through`；`onResync` 时按最后收到的 seq 再补（sessions.md 输出 7、8）。 */
    frames: {filter: Type.Object(BySession, {additionalProperties: false}), payload: object<RemoteFrame>()},
    activityChanged: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Unsafe<readonly ActivityItem[]>(Type.Array(Type.Unknown()))},
} as const;

export const agentSessionsContract = defineRemoteService({id: "nbook.agent/sessions", version: 1, provider: "server", callers: ["browser"], methods, events});

/**
 * 远程合同与内核的对照，内核改了这里编译不过：每条指令的参数字段相同、校验过的输入能交给内核（输入方向）；内核交出的
 * 失败详情过得了详情 schema（输出方向）。
 */
type ArgsOf<K extends RemoteCommandName> = Static<ReturnType<typeof Type.Object<(typeof commandArgs)[K]>>>;
type Matches<K extends RemoteCommandName> = [keyof ArgsOf<K>] extends [keyof CommandMap[K]["args"]] ? ([keyof CommandMap[K]["args"]] extends [keyof ArgsOf<K>] ? (ArgsOf<K> extends CommandMap[K]["args"] ? true : false) : false) : false;
const argsMatchKernel: {readonly [K in RemoteCommandName]: Matches<K>} = {
    send: true, enqueue: true, edit: true, remove: true, resolve: true, start: true, abort: true, rewind: true, switchBranch: true, fork: true, compact: true, changeSettings: true, changeProfile: true, setTitle: true, archive: true,
};
const detailsMatchKernel: {readonly [C in DetailCode]: CommandErrorDetails[C] extends Static<(typeof COMMAND_DETAILS)[C]> ? true : false} = {
    "input-rejected": true, "already-answered": true, "invalid-value": true, "unknown-key": true, "already-running": true, running: true, "dependency-missing": true,
};
const allDetailCodesListed: [Exclude<keyof CommandErrorDetails, DetailCode>] extends [never] ? true : false = true;
void argsMatchKernel;
void detailsMatchKernel;
void allDetailCodesListed;

export type {DeltaFrame, RunStatus};
