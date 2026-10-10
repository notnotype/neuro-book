/**
 * 不需要自己搭台子的夹具：把场景输入原样绑到被测组件上。
 *
 * 大多数零件的夹具只做四件事：绑定场景输入、记录声明的事件、把个别事件回写成受控输入
 * （例如 `toggle` 写回 `expanded`）、补上函数或组件这类运行期 props。用 `defineSubjectFixture`
 * 登记就不必再为它写一个 `XxxFixture.vue`；需要插槽预设、`LabFixtureControls` 或异步准备的服务时，
 * 仍然手写夹具并用 `defineLabFixture` 登记。
 */
import {camelize, defineComponent, h, toHandlerKey, type Component, type PropType, type VNodeChild} from "vue";
import {useLabSubject, type LabEventOf, type LabPropOf, type LabSceneInput, type LabSlotOf, type LabSubjectProps} from "../lab-subject";
import type {LabFixture, LabFixtureDefinition} from "./index";

export type SubjectFixtureOptions<C> = {
    /** 记进事件 tab 的事件。 */
    events?: readonly LabEventOf<C>[];
    /** 事件发生时把第一个参数写回场景输入，让受控组件在 Lab 里真的能切换。 */
    writeBack?: Partial<Record<LabEventOf<C>, {layer: "props" | "model"; key: LabPropOf<C>}>>;
    /** 挂到零件根节点的 class，例如 `w-full`、`h-full w-full`。 */
    class?: string;
    /**
     * 运行期 props（注册表、服务等），在加载夹具时准备一次；它们不是可编辑的 JSON 输入。
     * 异步是为了让它依赖的模块和被测组件一样在选中时才加载。
     */
    runtimeProps?: () => Promise<Record<string, unknown>>;
    /**
     * 插槽预设：场景的 `slots` 层打开某个插槽时填进去的内容，例如按钮的文字。只放固定的文字或简单节点；
     * 内容要随场景变、或要自己的状态时，仍手写夹具。登记的插槽就是这里的键。
     */
    slotPresets?: Partial<Record<LabSlotOf<C>, () => VNodeChild>>;
    /** 组件的根是片段或传送门（例如抽屉）时为 true：Vue 接不住透传的 `data-lab-subject`，不加这个标记。 */
    rootless?: boolean;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type SubjectFixtureDefinition<C> = DistributiveOmit<LabFixtureDefinition<C>, "load" | "slots"> & SubjectFixtureOptions<C> & {
    /** 被测组件的懒加载入口，例如 `() => import("nbook/ui/SkillChip.vue")`。 */
    subject: () => Promise<{default: Component}>;
    /** 由 `slotPresets` 的键得出，不另写。 */
    slots?: never;
};

/** 同名事件监听合并调用：`events` 记录与 `writeBack` 回写都要生效。 */
function mergeHandlers(first: unknown, second: (...args: unknown[]) => void): (...args: unknown[]) => void {
    return typeof first === "function"
        ? (...args) => {
            (first as (...args: unknown[]) => void)(...args);
            second(...args);
        }
        : second;
}

type ResolvedOptions<C> = Omit<SubjectFixtureOptions<C>, "runtimeProps"> & {runtimeProps?: Record<string, unknown>};

export function createSubjectFixture<C>(component: Component, options: ResolvedOptions<C> = {}): Component {
    return defineComponent({
        name: "LabSubjectFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            const subject = useLabSubject<C>(() => props.input, options.events ?? []);
            const runtime = options.runtimeProps ?? {};
            const writeBacks = Object.entries(options.writeBack ?? {}) as Array<[string, {layer: "props" | "model"; key: LabPropOf<C>}]>;
            return () => {
                const bindings: Record<string, unknown> = {...subject.bindings.value};
                for (const [event, target] of writeBacks) {
                    const key = toHandlerKey(camelize(event));
                    bindings[key] = mergeHandlers(bindings[key], (value) => subject.write(target.layer, target.key, value));
                }
                const presets = Object.entries(options.slotPresets ?? {}) as Array<[string, () => VNodeChild]>;
                const slots = Object.fromEntries(presets.filter(([name]) => subject.slots.value[name] === true));
                return h(component, {...bindings, ...runtime, "class": options.class, ...(options.rootless === true ? {} : {"data-lab-subject": ""})}, slots);
            };
        },
    });
}

/**
 * 登记一个透传夹具。类型检查与 `defineLabFixture<typeof C>` 相同：场景输入按组件 C 的 props 校验，
 * 事件名与回写键也必须是 C 真实的事件与 prop。
 */
export function defineSubjectFixture<C = never>(
    definition: [C] extends [never] ? never : [LabSubjectProps<C>] extends [never] ? never : SubjectFixtureDefinition<C>,
): LabFixture {
    const {subject, events, writeBack, class: className, runtimeProps, slotPresets, rootless, ...rest} = definition as SubjectFixtureDefinition<C>;
    const load = async () => {
        const [module, runtime] = await Promise.all([subject(), runtimeProps?.()]);
        return createSubjectFixture<C>(module.default, {events, writeBack, class: className, runtimeProps: runtime, slotPresets, rootless});
    };
    const fixture = {...rest, ...(slotPresets === undefined ? {} : {slots: Object.keys(slotPresets)}), load};
    // 与 defineLabFixture 相同：类型检查发生在入口参数，这里只擦除成 registry 的宽化类型。
    return fixture as unknown as LabFixture;
}
