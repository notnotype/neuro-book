<script setup lang="ts">
import {computed, inject} from "vue";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import {useFloatingScrollbar} from "../../composables/useFloatingScrollbar";
import type {DropdownItem} from "./dropdown.types";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


/**
 * 下拉菜单（Dropdown · 65% 磨砂、8px 模糊与即时感知 macOS 悬浮滚动条）。
 *
 * 浮层基于 Reka DropdownMenu 原语与 Popper 定位构建，
 * 100% 对齐 FormSelect 磨砂视觉规范（65% 面色、8px 模糊、130% 饱和、1.0 亮度），
 * 支持 4px 悬浮 macOS 胶囊滚动条与自适应双向渐隐。
 */

const props = withDefaults(defineProps<{
    items: DropdownItem[];
    menuClass?: string;
    menuMaxHeight?: string;
    rootClass?: string;
    compact?: boolean;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    disabled?: boolean;
    popoverStyle?: Record<string, string | number>;
}>(), {
    menuClass: "min-w-[190px]",
    menuMaxHeight: "210px",
    rootClass: "",
    compact: false,
    align: "start",
    side: "bottom",
    sideOffset: 7,
    disabled: false,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

function handleSelect(item: DropdownItem): void {
    if (item.disabled) return;
    emit("select", item.value);
}

// 悬浮 macOS 滚动条与自适应双向渐隐（挂载即时感知）
const {
    scrollThumbTop,
    scrollThumbHeight,
    isScrollable,
    isDragging,
    scrollFadeClass,
    setViewportRef,
    handleViewportScroll,
    handleThumbMouseDown,
} = useFloatingScrollbar();

const popoverPanelStyle = computed(() => ({
    zIndex: popoverZIndex,
    backgroundColor: "color-mix(in srgb, var(--bg-panel) 65%, transparent)",
    backdropFilter: "blur(8px) saturate(130%) brightness(1.0)",
    WebkitBackdropFilter: "blur(8px) saturate(130%) brightness(1.0)",
    boxShadow: "0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 6px 16px -2px color-mix(in srgb, var(--shadow-color) 16%, transparent), 0 20px 48px -4px color-mix(in srgb, var(--shadow-color) 28%, transparent), 0 36px 80px -8px color-mix(in srgb, var(--shadow-color) 20%, transparent)",
    borderRadius: "10px",
    border: "1px solid color-mix(in srgb, var(--text-main) 12%, transparent)",
    ...props.popoverStyle,
}));

function itemClass(item: DropdownItem): string {
    if (item.tone === "danger") {
        return "text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:text-[var(--status-danger)]";
    }
    if (item.active) {
        return "bg-[color-mix(in_srgb,var(--accent-main)_14%,transparent)] text-[var(--text-main)] font-medium";
    }
    return "text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] data-[highlighted]:text-[var(--text-main)]";
}
</script>

<template>
    <DropdownMenuRoot :modal="false">
        <DropdownMenuTrigger as-child :disabled="props.disabled" :class="props.rootClass">
            <slot />
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
            <DropdownMenuContent
                position="popper"
                :align="props.align"
                :side="props.side"
                :side-offset="props.sideOffset"
                :avoid-collisions="true"
                :collision-padding="8"
                :style="popoverPanelStyle"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion relative overflow-hidden p-1.5"
                :class="props.menuClass"
                @close-auto-focus="(e) => e.preventDefault()"
            >
                <!-- 滚动视口（自适应双向渐隐 + 隐藏原生滚动条） -->
                <div
                    :ref="setViewportRef"
                    class="clean-dropdown-viewport w-full"
                    :class="[scrollFadeClass, isScrollable ? 'pr-1.5' : '']"
                    :style="{
                        maxHeight: props.menuMaxHeight,
                    }"
                    @scroll="handleViewportScroll"
                >
                    <template v-for="item in props.items" :key="item.value">
                        <DropdownMenuSeparator
                            v-if="item.separator"
                            class="h-[1px] my-1 mx-1 bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)]"
                        />
                        <DropdownMenuItem
                            v-else
                            :disabled="item.disabled"
                            class="nb-ui-popover-item mb-1 flex h-[var(--control-h-sm)] w-full items-center justify-between gap-2.5 rounded-[calc(var(--radius-control)*0.75)] px-2.5 text-left outline-none cursor-pointer select-none transition-colors last:mb-0 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed text-[13px]"
                            :class="[
                                props.compact ? 'text-[var(--text-xs)]' : 'text-[var(--text-sm)]',
                                itemClass(item),
                            ]"
                            @select="handleSelect(item)"
                        >
                            <span class="inline-flex min-w-0 items-center gap-2">
                                <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                <span class="truncate">{{ item.label }}</span>
                            </span>

                            <span v-if="item.rightIconClass" :class="[item.rightIconClass, 'h-3.5 w-3.5 shrink-0 opacity-70']"></span>
                            <span v-else-if="item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)] tracking-wider">
                                {{ item.shortcut }}
                            </span>
                        </DropdownMenuItem>
                    </template>
                </div>

                <!-- 100% 绝对可见、100% 鼠标完全可按住拖拽的 macOS 4px 悬浮胶囊滑块 -->
                <div
                    v-if="isScrollable"
                    class="absolute right-[3px] top-1.5 bottom-1.5 w-1 z-20 flex flex-col justify-start"
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
            </DropdownMenuContent>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>

<style scoped>
.clean-dropdown-viewport {
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
.clean-dropdown-viewport::-webkit-scrollbar {
    display: none;
}
</style>
