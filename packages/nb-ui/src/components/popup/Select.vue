<script setup lang="ts">
import type {ButtonHTMLAttributes} from "vue";
import {computed, inject, mergeProps, ref, useAttrs, watch} from "vue";
import {
    SelectContent,
    SelectItem,
    SelectItemText,
    SelectPortal,
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectViewport,
} from "reka-ui";
import MenuRow from "./MenuRow.vue";
import PopupScrollbar from "./PopupScrollbar.vue";
import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {usePopupScroll} from "../../composables/usePopupScroll";
import {cn} from "../../utils/cn";
import {useFieldContext} from "../form/field-context";
import type {ControlSize} from "../shared-types";

/**
 * 下拉选择。弹出层基于 reka 的 Select 原语：键盘漫游、选中、打开时滚到选中项都由 reka 负责。
 *
 * - 选项是弹出列表共用的一行（`.nb-ui-menu-item`）：一档行高与字号，选中只画左侧勾选列的勾、底色不变；
 * - 滚动由 `usePopupScroll` 给出：截在第 9 项中间、顶底渐隐、悬浮滑块，可滚动时视口右侧给滑块让位；
 * - 外框按 reka 给的可用高度夹紧；与触发器相距 7px，避开触发器聚焦时的光圈；
 * - 浮层的材质只来自 `.nb-ui-popover-surface` 与 `.nb-ui-menu-surface` 两个类，这里只绑层级与宽度。
 */

export type SelectSize = Extract<ControlSize, "sm" | "md">;
export type SelectDirection = "auto" | "up" | "down";

export type SelectOption = {
    label: string;
    value: string;
    /** 次行说明文字，富选项场景使用 */
    description?: string;
    /** i-lucide-* 图标类，与 indicatorClass 互斥（indicator 优先） */
    iconClass?: string;
    /** 状态色圆点类（如 bg-emerald-500），与 iconClass 互斥（indicator 优先） */
    indicatorClass?: string;
    disabled?: boolean;
};

const props = withDefaults(defineProps<{
    modelValue?: string;
    options: SelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    size?: SelectSize;
    dropdownDirection?: SelectDirection;
    disabled?: boolean;
    required?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，交互不改值（docs/specs/ui/forms.md 输出 28）。 */
    readonly?: boolean;
    hideCheckmark?: boolean;
} & /* @vue-ignore */ ButtonHTMLAttributes>(), {
    modelValue: "",
    id: "",
    name: "",
    placeholder: "",
    size: "md",
    dropdownDirection: "auto",
    disabled: false,
    required: false,
    invalid: false,
    readonly: false,
    hideCheckmark: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const field = useFieldContext();
const controlId = computed(() => props.id || field?.inputId.value || undefined);
const isRequired = computed(() => props.required || field?.required.value === true);
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);
const isSmall = computed(() => props.size === "sm");
const controlSizeClass = computed(() => isSmall.value
    ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[length:var(--text-xs)]"
    : "nb-ui-control-h-md nb-ui-control-px text-[length:var(--text-sm)]");

/*
 * SelectRoot 之上是 reka 的 PopperRoot（只 renderSlot，不产生元素），其下并列着触发器与
 * 浮层两个根节点。多根组件不会自动继承 class 与其他属性，Vue 会**静默丢弃**它们——
 * 调用方传的宽度、aria-label 全部落空。所以这里关掉自动继承，显式转发到触发器。
 *
 * class 单独走 cn()：触发器自带 w-full，与调用方传的宽度是同特指度的两条规则，
 * 拼接的话谁生效取决于 Tailwind 输出这两条规则的先后，与 class 属性里的先后无关。
 */
defineOptions({inheritAttrs: false});
const attrs = useAttrs();
const forwardedAttrs = computed(() => {
    const {class: _class, ...rest} = attrs;
    return rest;
});
const triggerClass = computed(() => cn(
    "group/select-trigger nb-ui-control flex w-full items-center justify-between gap-1.5 rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] outline-none disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer select-none font-medium",
    controlSizeClass.value,
    isInvalid.value ? "nb-ui-control-invalid" : "",
    // 只读不画成可点：光标与悬停都不变。
    props.readonly ? "!cursor-default" : "",
    attrs.class as string | undefined,
));
const popperSide = computed(() => {
    if (props.dropdownDirection === "up") return "top" as const;
    if (props.dropdownDirection === "down") return "bottom" as const;
    return undefined;
});
const allowSideFlip = computed(() => props.dropdownDirection === "auto");

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const selectedLabel = computed(() => selectedOption.value?.label ?? "");
/**
 * 左侧一列，勾与图标共用（Task 决定 8）：选中项画勾，其它项画自己的图标或状态点。要画勾或有一项带图标时每行都留这一列，
 * 名称左边对齐。
 */
const leadColumn = computed(() => !props.hideCheckmark || props.options.some((option) => option.indicatorClass || option.iconClass));

function showsCheck(option: SelectOption): boolean {
    return !props.hideCheckmark && option.value === props.modelValue;
}

function handleUpdate(value: unknown): void {
    emit("update:modelValue", typeof value === "string" ? value : "");
}

const {zIndex} = usePopoverLayer();
const popoverStyle = {
    zIndex,
    width: "var(--reka-select-trigger-width)",
    minWidth: "var(--reka-select-trigger-width)",
};

/** 滚动只接 reka 的 `SelectViewport`：打开时由 reka 滚到选中项，这里不重置滚动位置。 */
const scroll = usePopupScroll();

/**
 * 浮层开合由这里持有、始终受控：reka 在 setup 时就按 `open` 是不是 undefined 定受控与否，之后不再变，只读挂载、再改成
 * 可编辑时若靠传 undefined 切回非受控，浮层就再也打不开。只读时打开请求不采纳；变成只读时关掉已开的浮层。
 */
const open = ref(false);
function handleOpen(value: boolean): void {
    open.value = value && !props.readonly;
}
watch(() => props.readonly, (readonly) => {
    if (readonly) open.value = false;
});

/** 只读时 reka 在按下时阻止默认行为，鼠标点触发器不会聚焦；这里补上（输出 28：只读可以聚焦）。 */
function handleTriggerPointerdown(event: PointerEvent): void {
    if (props.readonly) (event.currentTarget as HTMLElement).focus();
}

/** 关闭时不把焦点强行弹回触发器（reka 会先弹一次焦点再交还，触发器的焦点环会闪一下）。 */
function handleCloseAutoFocus(event: Event): void {
    event.preventDefault();
}
</script>

<template>
    <SelectRoot
        :model-value="props.modelValue"
        :disabled="props.disabled"
        :name="props.name || undefined"
        :required="isRequired"
        :open="open"
        @update:open="handleOpen"
        @update:model-value="handleUpdate"
    >
        <SelectTrigger
            v-bind="mergeProps(forwardedAttrs, {id: controlId, onFocus: (event: FocusEvent) => emit('focus', event), onPointerdown: handleTriggerPointerdown})"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="isInvalid || undefined"
            :aria-readonly="props.readonly || undefined"
            :class="triggerClass"
        >
            <span class="flex min-w-0 items-center gap-1.5 pr-1">
                <slot name="leading" :selected="selectedOption">
                    <span v-if="selectedOption?.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="selectedOption.indicatorClass" aria-hidden="true"></span>
                    <span v-else-if="selectedOption?.iconClass" class="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" :class="selectedOption.iconClass" aria-hidden="true"></span>
                </slot>
                <SelectValue class="min-w-0 truncate text-left" :placeholder="props.placeholder">{{ selectedLabel || props.placeholder }}</SelectValue>
            </span>
            <!-- 打开态 `data-state` 在触发器上，箭头按触发器的命名 group 转，不受外层同样带 data-state 的元素影响。 -->
            <span
                class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] group-data-[state=open]/select-trigger:rotate-180"
                :class="isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4'"
                aria-hidden="true"
            ></span>
        </SelectTrigger>

        <SelectPortal>
            <SelectContent
                position="popper"
                :side="popperSide"
                :side-flip="allowSideFlip"
                :avoid-collisions="allowSideFlip"
                :side-offset="7"
                :body-lock="false"
                :disable-outside-pointer-events="false"
                :style="popoverStyle"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion relative flex max-h-[var(--reka-popper-available-height)] flex-col overflow-hidden"
                @close-auto-focus="handleCloseAutoFocus"
            >
                <SelectViewport
                    :ref="scroll.setViewport"
                    class="nb-ui-popover-scroll w-full"
                    :class="scroll.fadeClass.value"
                    :style="scroll.viewportStyle.value"
                    v-bind="{onScroll: scroll.onScroll}"
                >
                    <SelectItem
                        v-for="option in props.options"
                        :key="option.value"
                        :value="option.value"
                        :data-value="option.value"
                        :disabled="option.disabled"
                        class="nb-ui-menu-item"
                    >
                        <MenuRow :lead-column="leadColumn" :checked="showsCheck(option)" :icon="option.indicatorClass ? undefined : option.iconClass" muted-icon :hint="option.description">
                            <template #lead><span v-if="option.indicatorClass && !showsCheck(option)" class="h-1.5 w-1.5 rounded-full shadow-sm" :class="option.indicatorClass"></span></template>
                            <!-- 名称格必须是 reka 的 SelectItemText：它在 SelectItem 里登记文字，首字母跳转靠这个。 -->
                            <template #label><SelectItemText class="nb-ui-menu-item__label">{{ option.label }}</SelectItemText></template>
                        </MenuRow>
                    </SelectItem>
                </SelectViewport>

                <PopupScrollbar :scroll="scroll" />
            </SelectContent>
        </SelectPortal>
    </SelectRoot>
</template>
