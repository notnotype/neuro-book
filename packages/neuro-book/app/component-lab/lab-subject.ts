import {camelize, computed, inject, toHandlerKey, type Component, type ComponentPropsOptions, type ComputedRef, type EmitsOptions} from "vue";
import {Type, type Static} from "typebox";
import {LAB_INPUT_SINK, useLabEventSink, type LabInputSink} from "./lab-event-sink";

/**
 * 场景输入：按被测组件的调用签名分层。键名与组件的 prop 名、插槽名逐字一致——不改名、不另起 fixture 私有字段。
 *
 * - `props`：非受控 prop 的初值；没写的 prop 走组件自己的默认值。
 * - `model`：v-model 受控值的初值，键是 prop 名（`open`、`modelValue`）。组件发出 `update:<键>` 时 Lab 回写这一层。
 * - `slots`：插槽开关，键是组件的插槽名；`true` 时 fixture 填入它为这个插槽备好的预设内容，缺省或 `false` 用组件自带内容。
 *
 * schema 是数据面板 JSON 编辑器的入口校验：不符合的编辑不生效，下游拿到的永远是这个形状。
 */
export const LabSceneInputSchema = Type.Object({
    props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    model: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    slots: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
}, {additionalProperties: false});

export type LabSceneInput = Static<typeof LabSceneInputSchema>;

/** Lab 交给 fixture 的场景初值：`data` 是复合宿主输入，`input` 是组件签名分层输入。 */
export type LabFixtureProps = {scene: string; data?: unknown; input?: LabSceneInput};

export type LabPropSignature = Readonly<{name: string; required: boolean}>;

/**
 * 被测组件的调用签名，读自组件的运行时选项。
 *
 * `defineProps` / `defineEmits` 编译后留下的 `props` / `emits` 就是这里的来源，所以它是**实现**的签名，
 * 不是文档里写的那份。插槽没有运行时声明，不在这里；fixture 备了哪些插槽预设由场景登记声明。
 */
export type LabSignature = Readonly<{
    props: readonly LabPropSignature[];
    emits: readonly string[];
    /** 同时有 prop `x` 与事件 `update:x` 的受控值 */
    models: readonly string[];
}>;

export type LabInputIssue = Readonly<{layer: keyof LabSceneInput; key: string; message: string}>;

const UPDATE_PREFIX = "update:";

/** `update:model-value` → `modelValue`；不是 `update:` 事件时为 null。 */
function modelKeyOf(emitName: string): string | null {
    return emitName.startsWith(UPDATE_PREFIX) ? camelize(emitName.slice(UPDATE_PREFIX.length)) : null;
}

export function readLabSignature(component: Component): LabSignature {
    // 选项式与 `<script setup>` 编译产物、函数式组件都在这两个字段上声明签名
    const options = component as {props?: ComponentPropsOptions; emits?: EmitsOptions};
    const rawProps = options.props ?? [];
    const props: LabPropSignature[] = Array.isArray(rawProps)
        ? rawProps.map((name) => ({name: camelize(name), required: false}))
        : Object.entries(rawProps).map(([name, definition]) => ({
            name: camelize(name),
            // 构造器与构造器数组写法没有 required，只有对象写法能声明必填
            required: definition !== null && typeof definition === "object" && !Array.isArray(definition) && definition.required === true,
        }));
    const rawEmits = options.emits ?? [];
    const emits = Array.isArray(rawEmits) ? [...rawEmits] : Object.keys(rawEmits);
    const propNames = props.map((prop) => prop.name);
    const models = [...new Set(emits.map(modelKeyOf).filter((key): key is string => key !== null && propNames.includes(key)))];
    return {props, emits, models};
}

/**
 * 输入与签名对不上的每一处。这些规则就是「数据 tab 是完整的」的定义：
 * 每个 v-model 都有初值、必填 prop 都有值、受控值与普通 prop 各归各层、没有签名以外的键。
 */
export function checkLabInput(signature: LabSignature, input: LabSceneInput | undefined, slotPresets: readonly string[]): LabInputIssue[] {
    const issues: LabInputIssue[] = [];
    const propNames = signature.props.map((prop) => prop.name);
    const props = input?.props ?? {};
    const model = input?.model ?? {};

    for (const key of Object.keys(props)) {
        if (!propNames.includes(key)) {
            issues.push({layer: "props", key, message: "组件签名里没有这个 prop"});
        } else if (signature.models.includes(key)) {
            issues.push({layer: "props", key, message: `它是受控值（组件会发 update:${key}），放进 model 层`});
        }
    }
    for (const key of Object.keys(model)) {
        if (!propNames.includes(key)) {
            issues.push({layer: "model", key, message: "组件签名里没有这个 prop"});
        } else if (!signature.models.includes(key)) {
            issues.push({layer: "model", key, message: `组件不发 update:${key}，它不是受控值，放进 props 层`});
        }
    }
    for (const key of signature.models) {
        if (!(key in model)) {
            issues.push({layer: "model", key, message: "受控值没有初值：Lab 不持有它，就接不住组件的回写"});
        }
    }
    for (const prop of signature.props) {
        if (prop.required && !signature.models.includes(prop.name) && !(prop.name in props)) {
            issues.push({layer: "props", key: prop.name, message: "必填 prop 没有初值"});
        }
    }
    for (const key of Object.keys(input?.slots ?? {})) {
        if (!slotPresets.includes(key)) {
            issues.push({layer: "slots", key, message: "fixture 没有为这个插槽登记预设内容"});
        }
    }
    return issues;
}

export type LabSubject = {
    /** 直接 `v-bind` 到被测组件：props 层 + model 层 + 签名里每个事件的监听。 */
    bindings: ComputedRef<Record<string, unknown>>;
    /** slots 层：fixture 用它决定是否填入某个插槽的预设内容。 */
    slots: ComputedRef<Readonly<Record<string, boolean>>>;
    /**
     * fixture 扮演宿主时改写一项输入，例如收到 `action` 后改 `count`。
     * 改的与数据面板是同一份，面板随之更新；不在 Lab 里时是空操作。
     */
    write: LabInputSink;
};

/**
 * fixture 接入分层输入的唯一入口。
 *
 * - 签名里的**每个**事件都记进事件 tab，不由 fixture 挑着转发；
 * - `update:x` 且 `x` 是受控值时，把新值写回 model 层——Lab 持有受控值，组件的 v-model 才真的是双向的；
 * - fixture 自己还想响应某个事件时，照常在组件上写 `@x`，Vue 会把两份监听合并调用。
 */
export function useLabSubject(component: Component, input: () => LabSceneInput | undefined): LabSubject {
    const {emits, models} = readLabSignature(component);
    const recordEvent = useLabEventSink();
    const write = inject(LAB_INPUT_SINK, () => undefined);
    // 与 Vue 查找监听的规则一致：`update:model-value` 与 `update:modelValue` 都落到 `onUpdate:modelValue`
    const listeners = Object.fromEntries(emits.map((name) => {
        const key = modelKeyOf(name);
        return [toHandlerKey(camelize(name)), (...args: unknown[]) => {
            recordEvent(name, args.length <= 1 ? args[0] : args);
            if (key !== null && models.includes(key)) {
                write("model", key, args[0]);
            }
        }];
    }));
    return {
        bindings: computed(() => ({...input()?.props, ...input()?.model, ...listeners})),
        slots: computed(() => input()?.slots ?? {}),
        write,
    };
}
