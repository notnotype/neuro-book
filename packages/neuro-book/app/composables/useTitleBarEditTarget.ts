import {computed, ref, watch, type ComputedRef, type Ref} from "vue";
import {useActiveElement} from "@vueuse/core";
import {
    isTitleBarFocusOwner,
    resolveEffectiveTitleBarEditTarget,
    resolveTitleBarEditTarget,
    type TitleBarEditTarget,
} from "nbook/app/utils/workbench-chrome";

/**
 * 标题栏编辑动作的**目标会话**：菜单显示与命令执行共用同一份判定。
 *
 * 为什么需要它：「焦点在谁身上」是编辑动作的唯一判据，但**键盘进标题栏是正常路径**
 * （Tab 到标题栏、ArrowRight 换组）——那一步会把焦点从输入框/编辑器移走，宿主按此刻焦点
 * 只能报 `none`，于是六条编辑动作全变禁用、禁用项又被排除出键盘遍历，菜单里一个可点项都没有。
 *
 * 所以：焦点落在标题栏（含它 Teleport 出去的下拉层）里时，沿用**最近一次真实的可编辑焦点**；
 * 焦点在页面其它地方时，仍按此刻的真实焦点判（鼠标路径不回退、不假装可编辑）。
 * 执行原生编辑命令前，调用方可以把焦点还给 `rememberedElement`，命令才会作用在它身上。
 */
export type TitleBarEditTargetSession = Readonly<{
    /** 菜单 enabled 与执行去处共用的一份编辑目标。 */
    target: ComputedRef<TitleBarEditTarget>;
    /** 最近一次真实落在可编辑处的元素；焦点被标题栏拿走时，执行前把焦点还给它。 */
    rememberedElement: ComputedRef<HTMLElement | null>;
    /** 此刻焦点是否在标题栏（含下拉层）里。 */
    titleBarOwnsFocus: ComputedRef<boolean>;
}>;

export function useTitleBarEditTarget(options: {
    /** Studio 的 source / preview 编辑器是否活跃（优先于 `activeElement` 的分类）。 */
    editorActive: () => boolean;
    /** 焦点来源；默认取文档当前焦点，测试与特殊宿主可注入。 */
    activeElement?: Ref<Element | null>;
}): TitleBarEditTargetSession {
    const activeElement = options.activeElement ?? useActiveElement();
    const liveTarget = computed(() => resolveTitleBarEditTarget(activeElement.value ?? null, options.editorActive()));
    /** 最近一次真实的可编辑焦点（元素 + 当时的目标档位）。 */
    const remembered = ref<Readonly<{element: HTMLElement; target: TitleBarEditTarget}> | null>(null);

    watch([activeElement, liveTarget], () => {
        const element = activeElement.value;
        if (liveTarget.value === "none" || !(element instanceof HTMLElement)) {
            return;
        }
        remembered.value = {element, target: liveTarget.value};
    }, {immediate: true});

    const titleBarOwnsFocus = computed(() => isTitleBarFocusOwner(activeElement.value ?? null));
    const target = computed(() => resolveEffectiveTitleBarEditTarget({
        liveTarget: liveTarget.value,
        rememberedTarget: remembered.value?.target ?? null,
        titleBarOwnsFocus: titleBarOwnsFocus.value,
    }));

    return {
        target,
        rememberedElement: computed(() => remembered.value?.element ?? null),
        titleBarOwnsFocus,
    };
}
