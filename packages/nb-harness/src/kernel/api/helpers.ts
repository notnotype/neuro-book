/**
 * helper 的签名：能独立成一个扩展、或能写成一个纯函数的常见写法，只用公开接口写成，内核不为它们开特例。
 * 实现在 `kernel/helpers/`；每个 helper 的“用核心字段手写的展开版”写成测试与它对照。
 */

import type {DeepReadonly} from "./basics.js";
import type {ConvNamesOfDependency, Dependency, DepList} from "./contract.js";
import type {ConversationTurn} from "./conversation.js";
import type {Resources, ViewCtx} from "./ctx.js";
import type {EventSpec} from "./events.js";
import type {Extension, StaticOr} from "./extension.js";
import type {PromptChild} from "./prompt.js";
import type {TSchema} from "typebox";

type ReminderView<Deps extends DepList> = ViewCtx<{}, {}, Deps>;

/**
 * 提醒：值变了的那一轮、或每隔 `every` 轮，在这一轮开头写一条附带内容（自己的 conv 事件 `reminder`）。
 * `every` 与 `watch` 至少给一个（“每轮一次”写 `every: 1`）。`text` 返回 null 表示这次不提醒。
 */
export type ReminderOptions<Id extends string, Deps extends DepList> = {
    id: Id;
    tags?: string[];
    dependsOn?: Deps;
    text: (change: {value: unknown; previous: unknown; first: boolean; view: ReminderView<NoInfer<Deps>>}) => string | null;
} & ({every: number; watch?: (view: ReminderView<NoInfer<Deps>>) => unknown} | {every?: number; watch: (view: ReminderView<NoInfer<Deps>>) => unknown});
export type ReminderHelper = <const Id extends string, const Deps extends DepList = []>(
    options: ReminderOptions<Id, Deps>,
) => Extension<Id, {reminder: EventSpec<"path", "conv", {text: string}>}, {}>;

type OpeningPart = string | null | undefined | false;
/** 开场：会话创建时与每次压缩之后调用 `load` 读一次，交给稳定的共用槽 `opening`。 */
export type OpeningHelper = <const Id extends string, Si extends TSchema | undefined = undefined, const Deps extends DepList = []>(options: {
    id: Id;
    initial?: Si;
    dependsOn?: Deps;
    load: (from: {initial: DeepReadonly<StaticOr<NoInfer<Si>>>; resources: Resources; read: ViewCtx<{}, {}, NoInfer<Deps>>["read"]; signal: AbortSignal}) => Promise<readonly OpeningPart[]> | readonly OpeningPart[];
}) => Extension<Id, {}, {}>;

/** 缺省布局的选项：会变的槽放末尾（缓存最好）还是 `<Turn />` 前（用户的话在最后）；要不要历史、只要最近几轮。 */
export interface StandardLayoutOptions {
    volatile?: "end" | "before-turn";
    history?: boolean | {last: number};
}
export type StandardLayoutHelper = (options?: StandardLayoutOptions) => (view: ViewCtx<any, any, any, any>) => PromptChild;

/** 只留最终回复：去掉工具记录与中间的步，最后一步的回复去掉工具调用。 */
export type FinalOnlyHelper = <P>(turn: ConversationTurn<P>) => ConversationTurn<P>;
/** 去掉某个依赖的几种对话事件：`withoutEvents(turn, memory, "retrieved")`；名字拼错是编译错误。 */
export type WithoutEventsHelper = <P, D extends Dependency, N extends ConvNamesOfDependency<D>>(turn: ConversationTurn<P>, dependency: D, ...names: N[]) => ConversationTurn<P>;
