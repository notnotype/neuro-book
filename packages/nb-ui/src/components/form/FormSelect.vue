<script setup lang="ts">
import {computed, inject, useAttrs} from "vue";
import {
    SelectContent,
    SelectItem,
    SelectItemIndicator,
    SelectItemText,
    SelectPortal,
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectViewport,
} from "reka-ui";
import {useDropdownFloating} from "../../composables/useDropdownFloating";
import {cn} from "../../utils/cn";
import {useFormFieldContext} from "./form-field-context";

/**
 * 下拉选择（FormSelect · 65% 磨砂、8px 模糊、双向虚化遮罩与 macOS 悬浮滑块体系）。
 *
 * 弹出层基于 Reka Select 原语构建，通过 `.nb-ui-popover-surface` 与 `.nb-ui-menu-surface`
 * 接入 65% 面色 + 8px 高斯模糊 + 130% 饱和度 + 1.0 亮度 与 4 层微反光立体阴影。
 *
 * 视觉与交互规范：
 * 1. 间距对称与空间避让：内容容器四周统一 6px 内边距（p-1.5），内容溢出时视口右侧自动保留 6px（pr-1.5）避让槽，杜绝滚动条与选项高亮/对勾重合；
 * 2. 齐腰截半露底：锁定黄金视口截断高度，精准呈现单行第 5.5 项 / 双行第 3.5 项 50% 截断视觉线索；
 * 3. 动态双向渐隐（后续虚化半个 item）：当有更多未读项时，视口底部通过 16px 精确散焦 mask 呈现柔润透光的虚化半项线索；滑到底部后虚化自动消除；
 * 4. 100% 绝对可见 macOS 悬浮微胶囊滑块：置于 Viewport 外侧、Content 内侧，不受渐隐遮罩切断，不受 Reka UI scrollbar-width:none 影响，自由抓取拖拽；
 * 5. 间距：`:side-offset="7"`，避免遮挡 Trigger 聚焦时的底部发光圈；
 * 6. 尺寸规范：严格消费 nb-ui-control-h-sm / nb-ui-control-h-md 主题高度。
 */

export type FormSelectSize = "default" | "sm";
export type FormSelectDirection = "auto" | "up" | "down";

export type FormSelectOption = {
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
    options: FormSelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    size?: FormSelectSize;
    dropdownDirection?: FormSelectDirection;
    disabled?: boolean;
    required?: boolean;
    hideCheckmark?: boolean;
}>(), {
    modelValue: "",
    id: "",
    name: "",
    placeholder: "",
    size: "default",
    dropdownDirection: "auto",
    disabled: false,
    required: false,
    hideCheckmark: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const field = useFormFieldContext();
const controlId = computed(() => props.id || field?.inputId.value || undefined);
const isRequired = computed(() => props.required || field?.required.value === true);
const isInvalid = computed(() => field?.invalid.value === true);
const isSmall = computed(() => props.size === "sm");
const controlSizeClass = computed(() => isSmall.value
    ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[12px]"
    : "nb-ui-control-h-md nb-ui-control-px text-[13px]");

/*
 * SelectRoot 之上是 reka 的 PopperRoot（只 renderSlot，不产生元素），其下并列着触发器与
 * 浮层两个根节点。多根组件不会自动继承 class 与其他属性，Vue 会**静默丢弃**它们——
 * 调用方传的宽度、aria-label 全部落空。所以这里关掉自动继承，显式转发到触发器。
 *
 * class 单独走 cn()：触发器自带 w-full，与调用方传的宽度是同特指度的两条规则，
 * 拼接的话谁生效取决于样式表先后，而本包的预编译 CSS 与宿主的原子类不在同一张表。
 */
defineOptions({inheritAttrs: false});
const attrs = useAttrs();
const forwardedAttrs = computed(() => {
    const {class: _class, ...rest} = attrs;
    return rest;
});
const triggerClass = computed(() => cn(
    "nb-ui-control flex w-full items-center justify-between gap-1.5 rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] outline-none disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer select-none font-medium shadow-sm transition-[border-color,box-shadow,background-color] [transition-duration:var(--motion-fast)]",
    controlSizeClass.value,
    isInvalid.value ? "nb-ui-control-invalid" : "",
    attrs.class as string | undefined,
));
const optionSizeClass = computed(() => isSmall.value
    ? "min-h-[calc(var(--control-h-sm)-var(--space-1))] px-2.5 py-0.5 text-[12px]"
    : "min-h-[var(--control-h-sm)] px-2.5 py-1.5 text-[13px]");

const popperSide = computed(() => {
    if (props.dropdownDirection === "up") return "top" as const;
    if (props.dropdownDirection === "down") return "bottom" as const;
    return undefined;
});
const allowSideFlip = computed(() => props.dropdownDirection === "auto");

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const selectedLabel = computed(() => selectedOption.value?.label ?? "");

function handleUpdate(value: unknown): void {
    emit("update:modelValue", typeof value === "string" ? value : "");
}

// 浮层材质、同心律视口、黄金截半高度、双向虚化渐隐与 macOS 悬浮滑块单一真相源
const {
    popoverStyle,
    popoverClasses,
    setViewportRef,
    viewportStyle,
    viewportClasses,
    handleViewportScroll,
    handleThumbMouseDown,
    handleCloseAutoFocus,
    scrollThumbTop,
    scrollThumbHeight,
    isScrollable,
    isDragging,
} = useDropdownFloating({
    size: computed(() => props.size),
    sideOffset: 7,
    popoverStyle: computed(() => ({
        width: "var(--reka-select-trigger-width)",
        minWidth: "var(--reka-select-trigger-width)",
    })),
});
</script>

<template>
    <SelectRoot
        :model-value="props.modelValue"
        :disabled="props.disabled"
        :name="props.name || undefined"
        :required="isRequired"
        :modal="false"
        @update:model-value="handleUpdate"
    >
        <SelectTrigger
            v-bind="forwardedAttrs"
            :id="controlId"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="isInvalid || undefined"
            :class="triggerClass"
            @focus="emit('focus', $event)"
        >
            <span class="flex min-w-0 items-center gap-1.5 pr-1">
                <span v-if="selectedOption?.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="selectedOption.indicatorClass" aria-hidden="true"></span>
                <span v-else-if="selectedOption?.iconClass" class="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" :class="selectedOption.iconClass" aria-hidden="true"></span>
                <SelectValue class="min-w-0 truncate text-left" :placeholder="props.placeholder">{{ selectedLabel || props.placeholder }}</SelectValue>
            </span>
            <span
                class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] data-[state=open]:rotate-180"
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
                :class="popoverClasses"
                @close-auto-focus="handleCloseAutoFocus"
            >
                <SelectViewport
                    :ref="setViewportRef"
                    :class="[viewportClasses, '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden']"
                    :style="viewportStyle"
                    @scroll="handleViewportScroll"
                >
                    <SelectItem
                        v-for="option in props.options"
                        :key="option.value"
                        :value="option.value"
                        :data-value="option.value"
                        :disabled="option.disabled"
                        class="nb-ui-popover-item mb-1 flex cursor-pointer select-none items-center gap-2 outline-none transition-colors last:mb-0 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--overlay-item-active)] data-[highlighted]:text-[var(--text-main)] data-[state=checked]:bg-[color-mix(in_srgb,var(--accent-main)_14%,transparent)] data-[state=checked]:text-[var(--text-main)] font-normal data-[state=checked]:font-medium"
                        :class="optionSizeClass"
                    >
                        <span v-if="option.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="option.indicatorClass" aria-hidden="true"></span>
                        <span v-else-if="option.iconClass" class="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" :class="option.iconClass" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1">
                            <SelectItemText class="block truncate">{{ option.label }}</SelectItemText>
                            <span
                                v-if="option.description"
                                class="mt-[calc(var(--space-1)*0.5)] block truncate text-[var(--text-2xs)] font-normal text-[var(--text-muted)] group-data-[state=checked]:text-[var(--accent-text)]"
                            >{{ option.description }}</span>
                        </span>
                        <SelectItemIndicator v-if="!props.hideCheckmark" class="shrink-0">
                            <span class="i-lucide-check h-[1.15em] w-[1.15em] text-[var(--accent-main)]" aria-hidden="true"></span>
                        </SelectItemIndicator>
                    </SelectItem>
                </SelectViewport>

                <!-- 100% 绝对可见、100% 鼠标完全可按住拖拽的 macOS 4px 悬浮胶囊滑块（独立避让区，不受 mask 渐隐吞噬） -->
                <div
                    v-if="isScrollable"
                    class="absolute right-[3px] top-1.5 bottom-1.5 w-1 z-20 flex flex-col justify-start pointer-events-auto"
                >
                    <div
                        class="w-1 rounded-full cursor-pointer transition-colors"
                        :class="isDragging ? 'bg-[color-mix(in_srgb,var(--text-main)_75%,transparent)]' : 'bg-[color-mix(in_srgb,var(--text-main)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_70%,transparent)]'"
                        :style="{
                            height: `${scrollThumbHeight}px`,
                            transform: `translateY(${scrollThumbTop}px)`,
                        }"
                        @mousedown="handleThumbMouseDown"
                    ></div>
                </div>
            </SelectContent>
        </SelectPortal>
    </SelectRoot>
</template>
