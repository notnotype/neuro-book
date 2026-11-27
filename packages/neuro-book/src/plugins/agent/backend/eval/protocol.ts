/**
 * eval 内核与宿主之间的消息（docs/specs/agent/eval.md）。两端都在 Bun 的 IPC 上收发，序列化用缺省的 `advanced`：
 * `json` 会把 `Map`、`undefined`、`NaN` 悄悄改成别的值，宿主就没法把不合格的参数拒掉（harness/runtime.md 输出 92）。
 *
 * 内核里跑的是模型写的代码，它能直接 `process.send` 任意东西，所以宿主收到的每条都按 schema 校验，不合格的当成内核坏了。
 * 宿主发给内核的由宿主自己构造，内核只做最小的检查。
 */

import {Type, type Static} from "typebox";
import {Value} from "typebox/value";

/** 代码里一次调用的目标：`tool.<名>` 按交给服务商的名字找，`<对象>.<方法>` 按全局对象找。 */
const CallTarget = Type.Union([
    Type.Object({kind: Type.Literal("tool"), name: Type.String()}),
    Type.Object({kind: Type.Literal("global"), object: Type.String(), method: Type.String()}),
]);
export type CallTarget = Static<typeof CallTarget>;

const Image = Type.Object({data: Type.String(), mime: Type.String()});

const KernelError = Type.Object({message: Type.String(), stack: Type.Optional(Type.String())});
export type KernelError = Static<typeof KernelError>;

/** 内核发给宿主的消息。`cell` 是宿主在 `run` 里给的编号，内核原样带回。 */
export const KernelMessage = Type.Union([
    Type.Object({type: Type.Literal("ready"), version: Type.Number()}),
    Type.Object({type: Type.Literal("log"), cell: Type.Number(), text: Type.String()}),
    Type.Object({type: Type.Literal("display"), cell: Type.Number(), image: Image}),
    // `args` 不在这里约束形状：要先原样收下，才能告诉代码“参数不是能写进日志的 JSON”（宿主在转给 invoke 之前核对）。
    Type.Object({type: Type.Literal("call"), id: Type.Number(), cell: Type.Number(), target: CallTarget, args: Type.Unknown()}),
    Type.Object({type: Type.Literal("done"), cell: Type.Number(), ok: Type.Literal(true), value: Type.Optional(Type.String())}),
    Type.Object({type: Type.Literal("done"), cell: Type.Number(), ok: Type.Literal(false), error: KernelError}),
]);
export type KernelMessage = Static<typeof KernelMessage>;

/** 嵌套调用在代码里的结果：成功时 `value` 是交给代码的值（结构化值或文字），失败时内核据此抛 `ToolCallError`。 */
export const CallReply = Type.Union([
    Type.Object({ok: Type.Literal(true), value: Type.Unknown(), images: Type.Optional(Type.Array(Image))}),
    Type.Object({ok: Type.Literal(false), tool: Type.String(), status: Type.String(), code: Type.Optional(Type.String()), message: Type.String(), details: Type.Optional(Type.Unknown())}),
]);
export type CallReply = Static<typeof CallReply>;

/** 这个会话里可用的全局对象：内核按它装上（或换掉）对应的全局。 */
export type GlobalObjects = ReadonlyArray<{readonly name: string; readonly methods: readonly string[]}>;

/** 宿主发给内核的消息。 */
export type HostMessage =
    | {readonly type: "hello"; readonly version: number}
    /** `tools` 是这一刻能经 `tool.<名>` 调的名字：内核据此对拼错的名字当场报错并列出可用的；能不能调仍由宿主在调用时判。 */
    | {readonly type: "run"; readonly cell: number; readonly source: string; readonly tools: readonly string[]; readonly globals: GlobalObjects}
    | {readonly type: "reply"; readonly id: number; readonly reply: CallReply};

export function isKernelMessage(value: unknown): value is KernelMessage {
    return Value.Check(KernelMessage, value);
}
