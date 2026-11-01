/**
 * 远程合同 `nbook.agent/sessions`（docs/specs/agent/sessions.md“输入与前置条件”与输出 2、3、7–11）：窗口经它建会话、发指令、
 * 读日志、订阅帧。版本 1，服务端提供，只给浏览器调用。
 *
 * 方法的顶层输入逐个写字段（通道要求对象 schema、不收多余字段）；内核的结构（输入、事件、快照、预览）用 `Type.Unsafe` 带上
 * 内核的类型、schema 只核对是对象：它们的形状由内核定义与校验，这里不抄第二份。业务失败码按指令取内核的码表
 * （`commandErrors`），另加打开会话会遇到的存储码；通道保留的码不进这张表。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import {commandErrors, storageErrors} from "@notnotype/nb-harness/kernel/contracts";
import type {CommandMap, CommandName, Diagnostic, DiagnosticLevel, DeltaFrame, Frame, InputMode, LogEvent, PreviewResult, RewindTarget, RunResult, RunStatus, SessionIndexEntry, SessionSnapshot, UserInput} from "@notnotype/nb-harness/kernel/contracts";

import {TASK_ID} from "./contracts";
import type {ProfileEntry} from "./contracts";

const object = <T>() => Type.Unsafe<T>(Type.Object({}, {additionalProperties: true}));
const Nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);

/** 业务失败的详情：内核有的给对象，没有的不给。 */
const Detail = Type.Union([Type.Undefined(), Type.Record(Type.String(), Type.Unknown())]);

/** 打开会话会遇到的码（存储的码，加上宿主打开时抛错的 `open-failed`）。 */
const OPEN_CODES = [...storageErrors, "open-failed"] as const;
type OpenCode = (typeof OPEN_CODES)[number];

function errorsOf<const Codes extends readonly string[]>(codes: Codes): {readonly [Code in Codes[number]]: typeof Detail} {
    return Object.fromEntries(codes.map((code) => [code, Detail])) as {readonly [Code in Codes[number]]: typeof Detail};
}

const SessionId = Type.String({minLength: 1});
const CommandId = Type.String({minLength: 1, maxLength: 200});
const Input = object<UserInput>();
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
        answer: Type.Optional(object<{text: string; data?: unknown}>()),
        note: Type.Optional(Type.String()),
    },
    start: {},
    abort: {keepQueue: Type.Optional(Type.Boolean())},
    rewind: {to: Nullable(Type.String()), resend: Type.Optional(Input)},
    switchBranch: {node: Type.String()},
    fork: {leaf: Type.Optional(Nullable(Type.String()))},
    compact: {requirement: Type.Optional(Type.String())},
    changeSettings: {patch: object<Readonly<Record<string, Readonly<Record<string, unknown>>>>>()},
    changeProfile: {profile: Type.String({minLength: 1})},
    setTitle: {title: Type.String()},
    archive: {archived: Type.Boolean()},
} as const;

type CommandMethods = {
    readonly [K in CommandName]: {
        readonly input: TSchema;
        readonly output: ReturnType<typeof object<{value: CommandMap[K]["value"]; seq: number; replayed: boolean}>>;
        readonly effect: "write";
        readonly errors: {readonly [Code in (typeof commandErrors)[K][number] | OpenCode]: typeof Detail};
    };
};

const commandMethods = Object.fromEntries((Object.keys(commandArgs) as CommandName[]).map((name) => [name, {
    input: Type.Object({sessionId: SessionId, commandId: CommandId, ...commandArgs[name]}, {additionalProperties: false}),
    output: object<unknown>(),
    effect: "write",
    errors: errorsOf([...commandErrors[name], ...OPEN_CODES]),
}])) as unknown as CommandMethods;

const BySession = {sessionId: SessionId};
const queryErrors = errorsOf(OPEN_CODES);

/** 一条日志：放得下就是事件本身，太大就是占位，内容经 `eventChunk` 分段读（sessions.md 输出 9）。 */
export type LogItem = {readonly kind: "event"; readonly event: LogEvent} | {readonly kind: "oversized"; readonly seq: number; readonly type: string; readonly bytes: number};
export type PreviewItem = {readonly kind: "inline"; readonly preview: PreviewResult} | {readonly kind: "oversized"; readonly token: string; readonly bytes: number};

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
    snapshot: {input: Type.Object(BySession, {additionalProperties: false}), output: object<SessionSnapshot>(), effect: "read", errors: queryErrors},
    log: {
        input: Type.Object({...BySession, afterSeq: Type.Integer({minimum: 0}), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 2000}))}, {additionalProperties: false}),
        output: object<{items: LogItem[]; head: number; more: boolean; through: number}>(),
        effect: "read",
        errors: queryErrors,
    },
    rewindTargets: {input: Type.Object(BySession, {additionalProperties: false}), output: Type.Unsafe<RewindTarget[]>(Type.Array(Type.Unknown())), effect: "read", errors: queryErrors},
    path: {input: Type.Object({...BySession, leaf: Type.Optional(Nullable(Type.String()))}, {additionalProperties: false}), output: Type.Unsafe<LogItem[]>(Type.Array(Type.Unknown())), effect: "read", errors: queryErrors},
    siblings: {input: Type.Object({...BySession, node: Type.String()}, {additionalProperties: false}), output: Type.Unsafe<{node: string; latestLeaf: string}[]>(Type.Array(Type.Unknown())), effect: "read", errors: queryErrors},
    runResult: {input: Type.Object({...BySession, runId: Type.String()}, {additionalProperties: false}), output: Type.Unsafe<RunResult | null>(Type.Unknown()), effect: "read", errors: queryErrors},
    preview: {
        input: Type.Object({...BySession, leaf: Type.Optional(Nullable(Type.String()))}, {additionalProperties: false}),
        output: object<PreviewItem>(),
        effect: "read",
        errors: errorsOf([...OPEN_CODES, "preview-unavailable"] as const),
    },
    diagnostics: {
        input: Type.Object({...BySession, afterSeq: Type.Optional(Type.Integer({minimum: 0})), extension: Type.Optional(Type.String()), level: Type.Optional(Type.Unsafe<DiagnosticLevel>(Type.String()))}, {additionalProperties: false}),
        output: object<{items: Diagnostic[]; more: boolean}>(),
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
} as const;

export const agentSessionsContract = defineRemoteService({id: "nbook.agent/sessions", version: 1, provider: "server", callers: ["browser"], methods, events});

/** 远程合同里每条指令的参数与内核的一致：内核改了参数，这里编译不过。 */
type ArgsOf<K extends CommandName> = Static<ReturnType<typeof Type.Object<(typeof commandArgs)[K]>>>;
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
const argsMatchKernel: {readonly [K in CommandName]: SameKeys<ArgsOf<K>, CommandMap[K]["args"]>} = {
    send: true, enqueue: true, edit: true, remove: true, resolve: true, start: true, abort: true, rewind: true, switchBranch: true, fork: true, compact: true, changeSettings: true, changeProfile: true, setTitle: true, archive: true,
};
void argsMatchKernel;

export type {DeltaFrame, RunStatus};
