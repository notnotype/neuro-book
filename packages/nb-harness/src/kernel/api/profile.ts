/**
 * Profile：自己就是拦截链最里层的扩展，另有 Profile 级的字段（名字、初始输入、工具、提示词、对话的样子、压缩）。
 * id 是 t05 的 key `<来源>.<名字>`（`builtin.writer`、`story.qa`），与所有扩展 id 不重复。
 */

import type {DepList, ConvNames, EventOf} from "./contract.js";
import type {ConversationTurn, Format} from "./conversation.js";
import type {ViewCtx} from "./ctx.js";
import type {EventsDecl} from "./events.js";
import type {AnyExtension, CompactionMethod, Contributions, Extension, ExtensionFields, Interceptors, OnTable, SettingsOf, SettingsSchema, StaticOr} from "./extension.js";
import type {Message} from "./model.js";
import type {PromptChild} from "./prompt.js";
import type {StateDecl} from "./state.js";
import type {TSchema} from "typebox";

type ProfileView<S extends StateDecl, Sc, Deps extends DepList, Si> = ViewCtx<S, SettingsOf<Sc>, Deps, StaticOr<Si>>;

/** Profile 的 `render`：能覆盖任何 conv 事件的文字；回复与工具结果必须给出文字（返回 null 会留下孤立的工具调用）。 */
export type ProfileRender<E extends EventsDecl, Deps extends DepList> = {
    [N in ConvNames<E, Deps>]?: (event: EventOf<E, Deps, N>) => N extends "assistant" | "toolResult" ? string : string | null;
};
/**
 * 一轮给模型看的样子：纯函数，不读视图（会变的内容用槽或 `reminder()`）。所以不写 `commit` 时一轮就按它提交，
 * 重开或回退后算出的历史逐块一致（docs/specs/harness/profile.md 输出 10、11）。
 */
export type TurnFn<Deps extends DepList, Pa, E extends EventsDecl> = (turn: ConversationTurn<StaticOr<Pa>>, format: Format<ProfileRender<E, Deps>>) => (Message | null)[];
/** 一轮以什么样子进历史：纯函数，不读视图；重开或回退时用它重算，结果确定。 */
export type CommitFn<Deps extends DepList, Pa, E extends EventsDecl> = (turn: ConversationTurn<StaticOr<Pa>>, format: Format<ProfileRender<E, Deps>>) => (Message | null)[];

export interface ProfileFields<Id extends string, S extends StateDecl, E extends EventsDecl, Sc, Deps extends DepList, Si, Pa>
    extends Omit<ExtensionFields<Id, S, E, Sc, {}, Deps>, "tags" | "exports" | "render" | "on" | "intercept" | "contribute" | "version"> {
    /** 改提示词或逻辑时升它（进 Profile 哈希）。 */
    version: string;
    name: string;
    /** 必填：目录与 `agent.invoke` 靠它。 */
    description: string;
    /** 调用方给的初始输入：内核按它校验，`ctx.initial` 有类型。 */
    initial?: Si;
    /** 输入带的结构化数据（例如选区）：`turn.input.data.payload` 有类型。 */
    payload?: Pa;
    /** 运行结果的 schema（t14 的 `outputSchema`）：建会话时抄进会话头，内核据此生成 `yield` 收尾工具。 */
    result?: {mode: "optional" | "required"; schema: TSchema};
    modelNeeds?: {vision?: boolean; thinking?: boolean; minContext?: number};
    /**
     * 这个 Profile 用哪些工具（t04）：写了就只把宿主声明里列出的交给模型，`required` 缺了运行以 `tools-missing` 收口；
     * 不写时宿主给的全部交给模型。工具的实现由宿主经 `SessionEnv.tools` 给。
     */
    tools?: {required?: string[]; optional?: string[]};
    /** 插件经 `agent.extensions` 贡献的扩展：按标签排除，或一个都不要。 */
    pluginExtensions?: {exclude: string[]} | "none";
    /** 可复用的扩展（几个 Profile 共用的、helper 返回的、别人写的）。 */
    extensions?: readonly AnyExtension[];
    on?: OnTable<NoInfer<S>, NoInfer<E>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>>;
    intercept?: Interceptors<NoInfer<S>, SettingsOf<NoInfer<Sc>>, NoInfer<Deps>, StaticOr<NoInfer<Si>>>;
    contribute?: Contributions<ProfileView<NoInfer<S>, NoInfer<Sc>, NoInfer<Deps>, NoInfer<Si>>>;
    /** 系统提示词的内容：缺省布局与模板里自闭合的 `<System />` 放它。 */
    system?: PromptChild | ((view: ProfileView<NoInfer<S>, NoInfer<Sc>, NoInfer<Deps>, NoInfer<Si>>) => PromptChild);
    /** 整张模板；不写用 `standardLayout()`。 */
    prompt?: (view: ProfileView<NoInfer<S>, NoInfer<Sc>, NoInfer<Deps>, NoInfer<Si>>) => PromptChild;
    /** 一轮给模型看的样子；不写用 `format.turn`。进行中按它渲染。 */
    turn?: TurnFn<NoInfer<Deps>, NoInfer<Pa>, NoInfer<E>>;
    /** 一轮结束后以什么样子进历史；不写与 `turn` 的缺省相同。提交时就校验，不合格用缺省并写诊断。 */
    commit?: CommitFn<NoInfer<Deps>, NoInfer<Pa>, NoInfer<E>>;
    /** 优先级：`commit` 里 `format.withRender` 的、这里、扩展的 render。 */
    render?: ProfileRender<NoInfer<E>, NoInfer<Deps>>;
    /** 压缩（t11）：给方法的要求、两种情况的方法顺序；false 表示不压缩（单轮模板）。 */
    compaction?: {require?: string; onThreshold?: CompactionMethod[]; onOverflow?: CompactionMethod[]} | false;
}

declare const ProfileBrand: unique symbol;
export type Profile<Id extends string = string, E extends EventsDecl = any, S extends StateDecl = any> = Extension<Id, E, {}, S> & {
    readonly [ProfileBrand]: true;
    readonly name: string;
    readonly version: string;
};
/**
 * 任意一个 Profile（宿主的 `profiles.resolve` 交回它）。只列内核按名字读的字段：带具体类型参数的处理函数表对 `any`
 * 不是逆变兼容的，写成 `ProfileFields<…any>` 会让具体的 Profile 赋不进来。
 */
export type AnyProfile = Profile & {
    readonly description: string;
    readonly extensions?: readonly AnyExtension[];
    readonly pluginExtensions?: {readonly exclude: readonly string[]} | "none";
};

export type DefineProfile = <
    const Id extends string,
    S extends StateDecl = {},
    E extends EventsDecl = {},
    Sc extends SettingsSchema | undefined = undefined,
    const Deps extends DepList = [],
    Si extends TSchema | undefined = undefined,
    Pa extends TSchema | undefined = undefined,
>(spec: ProfileFields<Id, S, E, Sc, Deps, Si, Pa>) => Profile<Id, E, S> & ProfileFields<Id, S, E, Sc, Deps, Si, Pa>;

/**
 * 派生变体：必须给新 id（它是自己的设置命名空间，不继承基础 Profile 的用户设置）；`render`、`tools`、`extensions`
 * 逐项合并；只能改 Profile 级的字段，逻辑继承。
 */
export type DeriveProfile = <const Id extends string, B extends Profile>(
    base: B,
    patch: {
        id: Id;
        version?: string;
        name?: string;
        description?: string;
        render?: B extends {render?: infer R} ? R : never;
        commit?: B extends {commit?: infer C} ? C : never;
        turn?: B extends {turn?: infer T} ? T : never;
        prompt?: B extends {prompt?: infer Pr} ? Pr : never;
        tools?: {required?: string[]; optional?: string[]};
        extensions?: readonly AnyExtension[];
        compaction?: B extends {compaction?: infer Co} ? Co : never;
    },
) => Omit<B, "id"> & {id: Id};
