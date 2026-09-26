import {camelize, computed, inject, toHandlerKey, type AllowedComponentProps, type ComponentCustomProps, type ComputedRef, type Ref, type VNode, type VNodeProps} from "vue";
import {Type, type Static} from "typebox";
import {LAB_INPUT_SINK, useLabEventSink} from "./lab-event-sink";

/**
 * 场景输入：fixture 声明哪些东西可以在 Lab 里调。分三层，键名与组件的 prop 名、插槽名逐字一致：
 *
 * - `props`：非受控 prop 的初值；没写的 prop 走组件自己的默认值。
 * - `model`：v-model 受控值的初值，键是 prop 名（`open`、`modelValue`）。组件发出 `update:<键>` 时 Lab 回写这一层。
 * - `slots`：插槽开关，键是组件的插槽名；`true` 时 fixture 填入它为这个插槽备好的预设内容。
 *
 * Lab 只展示 fixture 声明了的层，不去组件实现里读签名；键名对不对由登记处 `defineLabFixture<typeof X>` 的类型检查保证。
 * schema 是数据面板 JSON 编辑器的入口校验：不符合的编辑不生效，下游拿到的永远是这个形状。
 */
export const LabSceneInputSchema = Type.Object({
    props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    model: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    slots: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
}, {additionalProperties: false});

export type LabSceneInput = Static<typeof LabSceneInputSchema>;

/** Lab 交给 fixture 的场景初值。 */
export type LabFixtureProps = {scene: string; input?: LabSceneInput};

/*
 * 以下类型只在编译期起作用：从被测组件的类型推出场景输入该长什么样。运行时不解析组件。
 */

/** 组件实例上的 `$props`：数据 prop、`on*` 事件监听，外加 key / ref / class / style 等通用属性。取不到实例类型时返回 `never`，禁止登记退化为宽泛 Record。 */
export type LabSubjectProps<C> = C extends abstract new (...args: never[]) => {$props: infer P} ? P : never;

/** 每个组件都接受、但不是组件自己声明的属性。 */
type SharedAttrKey = keyof VNodeProps | keyof AllowedComponentProps | keyof ComponentCustomProps;

type Camelize<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<Camelize<Tail>>}` : S;

/**
 * `$props` 里组件自己声明的数据 prop 的键。去掉索引签名与通用属性；与 Vue 的规则一致，
 * `on` 后紧跟非小写字母的是事件监听（`onToggle` 是，`online` 不是）。
 */
type DataKey<K> = string extends K ? never : number extends K ? never : K extends SharedAttrKey ? never
    : K extends `on${infer E}` ? (E extends Uncapitalize<E> ? K : never) : K;

/** 事件监听键对应的事件名：`onToggle` → `toggle`，`onUpdate:open` → `update:open`。 */
type EventKey<K> = string extends K ? never : K extends SharedAttrKey ? never
    : K extends `on${infer E}` ? (E extends Uncapitalize<E> ? never : Uncapitalize<E>) : never;

type DataProps<P> = {[K in keyof P as DataKey<K>]: P[K]};

/** JSON 面板不接收运行期能力；普通对象递归映射，属性保留原可选/只读修饰。 */
type NonJsonValue = ((...args: never[]) => unknown) | Date | RegExp | Map<unknown, unknown> | ReadonlyMap<unknown, unknown>
    | Set<unknown> | ReadonlySet<unknown> | Promise<unknown> | Node | VNode | Ref<unknown>
    | (abstract new (...args: never[]) => unknown);
type JsonObject<T, Depth extends readonly unknown[]> = {[K in keyof T as [LabJsonInput<T[K], Depth>] extends [never] ? never : K]: LabJsonInput<T[K], Depth>};
type JsonArray<T extends readonly unknown[], Depth extends readonly unknown[]> = number extends T["length"]
    ? [LabJsonInput<T[number], Depth>] extends [never] ? never
        : T extends unknown[] ? Array<LabJsonInput<T[number], Depth>> : ReadonlyArray<LabJsonInput<T[number], Depth>>
    : T extends readonly [infer Head, ...infer Tail]
        ? [LabJsonInput<Head, Depth>] extends [never] ? never
            : T extends [unknown, ...unknown[]] ? [LabJsonInput<Head, Depth>, ...JsonArray<Tail, Depth>]
                : readonly [LabJsonInput<Head, Depth>, ...JsonArray<Tail, Depth>]
        : T;
/** 场景递归展开有界；超过可检查深度的字段不准登记，绝不放宽为 unknown。 */
export type LabJsonInput<T, Depth extends readonly unknown[] = []> = Depth["length"] extends 12 ? never : T extends unknown
    ? T extends string | number | boolean | null ? T
        : T extends NonJsonValue | undefined | symbol | bigint ? never
            : unknown extends T ? unknown
                : T extends readonly unknown[] ? JsonArray<T, [...Depth, unknown]>
                    : T extends object ? JsonObject<T, [...Depth, unknown]> extends infer O
                        ? [keyof O] extends [never] ? [keyof T] extends [never] ? O : never : O
                        : never
                        : never
    : never;

type JsonDataProps<P> = {[K in keyof DataProps<P> as [LabJsonInput<DataProps<P>[K]>] extends [never]
    ? never : K]: LabJsonInput<DataProps<P>[K]>};
export type LabJsonPropOf<C> = keyof JsonDataProps<LabSubjectProps<C>> & string;

/** v-model 受控值：同时有数据 prop `x` 与事件 `update:x`（事件写成 kebab 也算）。 */
type ModelKey<P> = Extract<{[K in keyof P]-?: K extends `onUpdate:${infer M}` ? Camelize<M> : never}[keyof P], keyof DataProps<P>>;

/** 只要组件有数据 prop，必须显式登记 props 层；空键集合的层不能凭空出现。 */
type Layer<Name extends string, T, RequiredLayer extends boolean = false> = [keyof T] extends [never]
    ? {[K in Name]?: never}
    : RequiredLayer extends true ? {[K in Name]: T} : {} extends T ? {[K in Name]?: T} : {[K in Name]: T};

/** 组件的数据 prop 名。 */
export type LabPropOf<C> = keyof DataProps<LabSubjectProps<C>> & string;

/** 组件发出的事件名。 */
export type LabEventOf<C> = keyof {[K in keyof LabSubjectProps<C> as EventKey<K>]: true} & string;

/**
 * 组件的具名插槽。模板里 `<slot>` 声明的插槽由 vue-tsc 推出；默认 `$slots` 的 `[name: string]` 索引签名不算。
 * 取不到实例类型的组件退回任意字符串。
 */
export type LabSlotOf<C> = C extends abstract new (...args: never[]) => {$slots: infer S}
    ? keyof {[K in keyof S as string extends K ? never : number extends K ? never : K]: true} & string
    : string;

/**
 * 按组件 C 检查过的场景输入：
 * - 键名必须是 C 真实的 prop 名 / 插槽名，写错即多余属性报错；
 * - 必填的非受控 prop 必须出现在 `props` 层；
 * - 每个 v-model 都必须在 `model` 层给初值，也只能放在这一层。
 */
export type LabInputOf<C> =
    Layer<"props", Omit<JsonDataProps<LabSubjectProps<C>>, ModelKey<LabSubjectProps<C>>>, true>
    & Layer<"model", Required<Pick<JsonDataProps<LabSubjectProps<C>>, Extract<ModelKey<LabSubjectProps<C>>, LabJsonPropOf<C>>>>>
    & Layer<"slots", {[K in LabSlotOf<C>]?: boolean}>;

/** JSON 来源的 props 与模型值，加上组件原本声明的监听键；运行期服务由 fixture 自行补齐。 */
export type LabBindingsOf<C> = JsonDataProps<LabSubjectProps<C>>
    & {[K in keyof LabSubjectProps<C> as EventKey<K> extends never ? never : K]: LabSubjectProps<C>[K]};

export type LabSubject<C> = {
    /** 直接 `v-bind` 到被测组件：props 层 + model 层 + 声明的事件与 v-model 的监听。 */
    bindings: ComputedRef<LabBindingsOf<C>>;
    /** slots 层：fixture 用它决定是否填入某个插槽的预设内容。 */
    slots: ComputedRef<Readonly<Record<string, boolean>>>;
    /**
     * fixture 扮演宿主时改写一项输入，例如收到 `toggle` 后改 `active`。
     * 改的与数据面板是同一份，面板随之更新；不在 Lab 里时是空操作。
     */
    write: (layer: "props" | "model", key: LabPropOf<C>, value: unknown) => void;
};

/**
 * fixture 接入场景输入的入口。怎么接由 fixture 自己决定，这里只统一 Lab 必须一致的两件事：
 *
 * - model 层的每个键 `x` 都监听 `update:x`：记进事件 tab 并写回 model 层——Lab 持有受控值，v-model 才真的双向；
 * - `events` 里声明的事件记进事件 tab。没声明的事件 Lab 看不到；fixture 还想响应某个事件时照常写 `@x`，Vue 会合并两份监听。
 *
 * 类型参数 C 是被测组件（`useLabSubject<typeof X>`），只用于类型：`bindings` 的形状、`events` 与 `write` 键的取值范围。
 */
export function useLabSubject<C>(input: () => LabSceneInput | undefined, events: readonly LabEventOf<C>[] = []): LabSubject<C> {
    const recordEvent = useLabEventSink();
    const write = inject(LAB_INPUT_SINK, () => undefined);
    // 监听键与 Vue 查找监听的规则一致：`composer-send` 与 `composerSend` 都落到 `onComposerSend`
    const declared = computed(() => {
        const modelEventKeys = new Set(Object.keys(input()?.model ?? {}).map((key) => toHandlerKey(camelize(`update:${key}`))));
        return Object.fromEntries(events
            .map((name) => [toHandlerKey(camelize(name)), name] as const)
            .filter(([handlerKey]) => !modelEventKeys.has(handlerKey))
            .map(([handlerKey, name]) => [handlerKey, (...args: unknown[]) => {
                recordEvent(name, args.length <= 1 ? args[0] : args);
            }]));
    });
    return {
        bindings: computed(() => {
            const model = input()?.model ?? {};
            const modelListeners = Object.fromEntries(Object.keys(model).map((key) => [`onUpdate:${key}`, (value: unknown) => {
                recordEvent(`update:${key}`, value);
                write("model", key, value);
            }]));
            const merged = {...input()?.props, ...model, ...declared.value, ...modelListeners};
            // 场景输入是 JSON，这里证明不了它的形状；形状由登记处 defineLabFixture<typeof X> 的类型检查保证
            const bound = merged as LabBindingsOf<C>;
            return bound;
        }),
        slots: computed(() => input()?.slots ?? {}),
        write,
    };
}
