/** 对话的形状：内置扩展 `core.history` 按内核盖的位置章从日志归约出的轮与步。 */

import type {DeepReadonly, JsonValue} from "./basics.js";
import type {Contract} from "./contract.js";
import type {EventData, KernelEvents, LogEvent} from "./events.js";
import type {Message} from "./model.js";

export type ReplyEvent = LogEvent<"assistant", DeepReadonly<EventData<KernelEvents["assistant"]>>>;
export type ToolResultEvent = LogEvent<"toolResult", DeepReadonly<EventData<KernelEvents["toolResult"]>>>;

export interface Step {
    readonly reply: ReplyEvent;
    readonly results: readonly ToolResultEvent[];
    /** 这一步之后、下一次模型调用之前写入的对话事件：插话、对工具结果的提醒、`continued`。 */
    readonly after: readonly LogEvent[];
}

/** 一轮：一条输入、它的附带内容、ReAct 的各步。模板组件仍叫 `<Turn />`。 */
export interface ConversationTurn<P = unknown> {
    readonly id: string;
    /** 没有新输入的“继续”运行为 null。 */
    readonly input: LogEvent<"input", DeepReadonly<{text: string; payload: P; queued: string}>> | null;
    /** 输入之后、第一次模型调用之前写入的对话事件（以及空闲时写的、并进下一轮的）。 */
    readonly attachments: readonly LogEvent[];
    readonly steps: readonly Step[];
    /** 进行中的轮是 `running`；提交时是它的结束原因。 */
    readonly status: "running" | "completed" | "error" | "interrupted" | "aborted";
}

/** 事件渲染的覆盖表：键是事件名（依赖的写全名），返回给模型看的文字。 */
export type RenderTable = Readonly<Record<string, (event: LogEvent<string, any>) => string | null>>;

/** 写 `turn`、`commit` 用的渲染工具：事件按 render 渲染成块，保留来源；全空的消息返回 null，由内核丢掉。 */
export interface Format<R = RenderTable> {
    user(...parts: (LogEvent | string | null | undefined | false)[]): Message | null;
    assistant(reply: ReplyEvent): Message;
    /** 只留回复的文字，去掉工具调用：只留最终回复的提交不会留下没有结果的工具调用。 */
    assistantText(reply: ReplyEvent): Message | null;
    tool(result: ToolResultEvent): Message;
    step(step: Step): (Message | null)[];
    steps(steps: readonly Step[]): (Message | null)[];
    /** 缺省的一轮：附带内容在前、用户的话在最后，合成一条 user 消息；然后是各步。 */
    turn(turn: ConversationTurn<any>): (Message | null)[];
    /** 换一组文字覆盖再渲染，例如只在进历史时把工具结果换成首行。 */
    withRender(render: R): Format<R>;
}

/** 内置的对话记录：不写进 `dependsOn` 也能读。 */
export type CoreHistory = Contract<"core.history", {}, {
    /** 进行中这一轮的输入；没有时为 null。 */
    input: {text: string; payload?: JsonValue} | null;
    current: ConversationTurn | null;
    /** 单调增加、不受压缩影响的计数：“每 8 轮”“每 16 次运行”不用自己数。 */
    turns: number;
    runs: number;
}>;
