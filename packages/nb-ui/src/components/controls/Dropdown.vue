<script setup lang="ts">
import {computed} from "vue";
import {
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuItemIndicator,
    DropdownMenuPortal,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuRoot,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "reka-ui";
import {useDropdownFloating} from "../../composables/useDropdownFloating";
import type {DropdownItem} from "./dropdown.types";

/**
 * 下拉菜单（Dropdown · 规范化黄金 Surface、同心圆角与 N.5 齐腰截半露底视口）。
 *
 * 浮层接入 `useDropdownFloating` 单一真相源，
 * 严格对齐 FormSelect 黄金微反光立体投影与 130% 饱和滤波，
 * 支持 4px 悬浮 macOS 胶囊滚动条与自适应双向渐隐。
 *
 * 结构覆盖平面项、分隔线、一层子菜单（Sub）与受控 radio / checkbox；
 * 键盘漫游、子菜单展开与关闭后焦点归还全部由 Reka 菜单原语承担，组件不自己排焦点。
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
    /** 受控展开态：传了由宿主决定，不传由原语自管；两种用法都会发 update:open。 */
    open?: boolean;
}>(), {
    menuClass: "min-w-[190px]",
    menuMaxHeight: undefined,
    rootClass: "",
    compact: false,
    align: "start",
    side: "bottom",
    sideOffset: 7,
    disabled: false,
    // 显式 undefined 默认值：Boolean 档缺省会被 Vue 转成 false，那样就永远拿不到「未受控」这一档
    open: undefined,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
    (e: "focus", event: FocusEvent): void;
    (e: "update:open", value: boolean): void;
}>();

function handleOpenChange(value: boolean): void {
    emit("update:open", value);
}

/** 子菜单父项不走这里：它只展开子菜单，不执行自己的动作。 */
function handleSelect(item: DropdownItem): void {
    if (item.disabled) return;
    emit("select", item.value);
}

// 统一浮层材质、同心律视口、黄金截半高度与 macOS 悬浮滚动条单一真相源
const {
    popoverStyle: floatingPopoverStyle,
    popoverClasses,
    setViewportRef,
    viewportStyle,
    viewportClasses,
    handleViewportScroll,
    handleThumbMouseDown,
    scrollThumbTop,
    scrollThumbHeight,
    isScrollable,
    isDragging,
} = useDropdownFloating({
    size: computed(() => props.compact ? "sm" : "default"),
    sideOffset: computed(() => props.sideOffset),
    popoverStyle: computed(() => props.popoverStyle),
    maxHeightLimit: computed(() => props.menuMaxHeight ? parseInt(props.menuMaxHeight, 10) : undefined),
});

/** 子菜单视口与主视口同材质同截断口径；主视口的悬浮滑块是单例，只服务于主视口。 */
const submenuViewportStyle = computed<Record<string, string>>(() => ({
    maxHeight: props.menuMaxHeight ?? "238px",
    borderRadius: "var(--nb-popover-inner-radius)",
}));

/** 一级菜单渲染节点：一层子菜单的父项与子项共用同一套形态，子项里不再产生 submenu。 */
type DropdownMenuNode =
    | {kind: "separator"; key: string}
    | {kind: "item"; key: string; item: DropdownItem}
    | {kind: "checkbox"; key: string; item: DropdownItem}
    | {kind: "submenu"; key: string; item: DropdownItem}
    | {kind: "radio-group"; key: string; group: string; items: DropdownItem[]};

/**
 * 把平面项列表折叠成渲染节点。同组连排的 radio 合成一个 RadioGroup——
 * 互斥态本身由宿主的 checked 决定，组件只把组内当前值交给原语。
 */
function resolveMenuNodes(items: readonly DropdownItem[], depth: number): DropdownMenuNode[] {
    const nodes: DropdownMenuNode[] = [];
    for (const item of items) {
        if (item.separator) {
            nodes.push({kind: "separator", key: item.value});
            continue;
        }
        if (item.type === "radio") {
            // 缺 group 的 radio 无法与其他项互斥：各自成组渲染，并明确告诉开发者这是非法贡献。
            const group = item.group ?? item.value;
            if (item.group === undefined) {
                console.warn(`[nb-ui/Dropdown] radio 项「${item.value}」缺少 group，已按单项独立成组渲染。`);
            }
            const last = nodes[nodes.length - 1];
            if (last !== undefined && last.kind === "radio-group" && last.group === group) {
                last.items.push(item);
                continue;
            }
            nodes.push({kind: "radio-group", key: `${group}/${item.value}`, group, items: [item]});
            continue;
        }
        if (item.type === "checkbox") {
            nodes.push({kind: "checkbox", key: item.value, item});
            continue;
        }
        if ((item.children?.length ?? 0) > 0) {
            if (depth > 0) {
                console.warn(`[nb-ui/Dropdown] 子菜单项「${item.value}」的 children 已超过一层，按普通项渲染。`);
                nodes.push({kind: "item", key: item.value, item});
                continue;
            }
            nodes.push({kind: "submenu", key: item.value, item});
            continue;
        }
        nodes.push({kind: "item", key: item.value, item});
    }
    return nodes;
}

const menuNodes = computed(() => resolveMenuNodes(props.items, 0));

const submenuNodes = computed<Record<string, DropdownMenuNode[]>>(() => {
    const nodes: Record<string, DropdownMenuNode[]> = {};
    for (const node of menuNodes.value) {
        if (node.kind === "submenu") {
            nodes[node.key] = resolveMenuNodes(node.item.children ?? [], 1);
        }
    }
    return nodes;
});

/** 组内当前值：受控 radio 的勾选来自宿主的 checked，组件只把它翻译成原语的组值。 */
function radioGroupValue(items: readonly DropdownItem[]): string {
    return items.find((item) => item.checked === true)?.value ?? "";
}

/** 项级几何：与滚动视口同心贴边，密度随 compact 档切换。 */
const itemBaseClass = "nb-ui-popover-item mb-1 flex h-[var(--control-h-sm)] w-full items-center justify-between gap-2.5 px-2.5 text-left outline-none cursor-pointer select-none transition-colors last:mb-0 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed data-[state=open]:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] text-[13px]";

function itemClass(item: DropdownItem): string {
    if (item.tone === "danger") {
        return "text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:text-[var(--status-danger)]";
    }
    if (item.active) {
        return "bg-[color-mix(in_srgb,var(--accent-main)_14%,transparent)] text-[var(--text-main)] font-medium";
    }
    return "text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] data-[highlighted]:text-[var(--text-main)]";
}

function itemClassList(item: DropdownItem): (string | Record<string, boolean>)[] {
    return [itemBaseClass, props.compact ? "text-[var(--text-xs)]" : "text-[var(--text-sm)]", itemClass(item)];
}
</script>

<template>
    <DropdownMenuRoot :modal="false" :open="props.open" @update:open="handleOpenChange">
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
                :style="floatingPopoverStyle"
                :class="[popoverClasses, props.menuClass]"
            >
                <!-- 滚动视口（自适应双向渐隐 + 隐藏原生滚动条） -->
                <div
                    :ref="setViewportRef"
                    class="clean-dropdown-viewport w-full"
                    :class="[viewportClasses, isScrollable ? 'pr-1.5' : '']"
                    :style="viewportStyle"
                    @scroll="handleViewportScroll"
                >
                    <template v-for="node in menuNodes" :key="node.key">
                        <DropdownMenuSeparator
                            v-if="node.kind === 'separator'"
                            class="h-[1px] my-1 mx-1 bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)]"
                        />

                        <!-- 受控 radio：同组连排合成一个 group，选谁由宿主的 checked 决定 -->
                        <DropdownMenuRadioGroup
                            v-else-if="node.kind === 'radio-group'"
                            :model-value="radioGroupValue(node.items)"
                        >
                            <DropdownMenuRadioItem
                                v-for="item in node.items"
                                :key="item.value"
                                :value="item.value"
                                :disabled="item.disabled"
                                :class="itemClassList(item)"
                                @select="handleSelect(item)"
                            >
                                <span class="inline-flex min-w-0 items-center gap-2">
                                    <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                    <span class="truncate">{{ item.label }}</span>
                                </span>
                                <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                                    <DropdownMenuItemIndicator>
                                        <span class="i-lucide-check h-3.5 w-3.5"></span>
                                    </DropdownMenuItemIndicator>
                                </span>
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>

                        <!-- 受控 checkbox：勾选态同样只读宿主的 checked -->
                        <DropdownMenuCheckboxItem
                            v-else-if="node.kind === 'checkbox'"
                            :model-value="node.item.checked === true"
                            :disabled="node.item.disabled"
                            :class="itemClassList(node.item)"
                            @select="handleSelect(node.item)"
                        >
                            <span class="inline-flex min-w-0 items-center gap-2">
                                <span v-if="node.item.iconClass" :class="[node.item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                <span class="truncate">{{ node.item.label }}</span>
                            </span>
                            <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                                <DropdownMenuItemIndicator>
                                    <span class="i-lucide-check h-3.5 w-3.5"></span>
                                </DropdownMenuItemIndicator>
                            </span>
                        </DropdownMenuCheckboxItem>

                        <!-- 一层子菜单：父项只展开，不执行 select -->
                        <DropdownMenuSub v-else-if="node.kind === 'submenu'">
                            <DropdownMenuSubTrigger
                                :disabled="node.item.disabled"
                                :class="itemClassList(node.item)"
                            >
                                <span class="inline-flex min-w-0 items-center gap-2">
                                    <span v-if="node.item.iconClass" :class="[node.item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                    <span class="truncate">{{ node.item.label }}</span>
                                </span>
                                <span
                                    v-if="node.item.rightIconClass"
                                    :class="[node.item.rightIconClass, 'h-3.5 w-3.5 shrink-0 opacity-70']"
                                ></span>
                                <span v-else class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0 opacity-70"></span>
                            </DropdownMenuSubTrigger>

                            <DropdownMenuPortal>
                                <DropdownMenuSubContent
                                    position="popper"
                                    side="right"
                                    align="start"
                                    :side-offset="props.sideOffset"
                                    :avoid-collisions="true"
                                    :collision-padding="8"
                                    :style="floatingPopoverStyle"
                                    :class="[popoverClasses, props.menuClass]"
                                >
                                    <div class="clean-dropdown-viewport w-full" :style="submenuViewportStyle">
                                        <template v-for="child in submenuNodes[node.key] ?? []" :key="child.key">
                                            <DropdownMenuSeparator
                                                v-if="child.kind === 'separator'"
                                                class="h-[1px] my-1 mx-1 bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)]"
                                            />

                                            <DropdownMenuRadioGroup
                                                v-else-if="child.kind === 'radio-group'"
                                                :model-value="radioGroupValue(child.items)"
                                            >
                                                <DropdownMenuRadioItem
                                                    v-for="item in child.items"
                                                    :key="item.value"
                                                    :value="item.value"
                                                    :disabled="item.disabled"
                                                    :class="itemClassList(item)"
                                                    @select="handleSelect(item)"
                                                >
                                                    <span class="inline-flex min-w-0 items-center gap-2">
                                                        <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                                        <span class="truncate">{{ item.label }}</span>
                                                    </span>
                                                    <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                                                        <DropdownMenuItemIndicator>
                                                            <span class="i-lucide-check h-3.5 w-3.5"></span>
                                                        </DropdownMenuItemIndicator>
                                                    </span>
                                                </DropdownMenuRadioItem>
                                            </DropdownMenuRadioGroup>

                                            <DropdownMenuCheckboxItem
                                                v-else-if="child.kind === 'checkbox'"
                                                :model-value="child.item.checked === true"
                                                :disabled="child.item.disabled"
                                                :class="itemClassList(child.item)"
                                                @select="handleSelect(child.item)"
                                            >
                                                <span class="inline-flex min-w-0 items-center gap-2">
                                                    <span v-if="child.item.iconClass" :class="[child.item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                                    <span class="truncate">{{ child.item.label }}</span>
                                                </span>
                                                <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                                                    <DropdownMenuItemIndicator>
                                                        <span class="i-lucide-check h-3.5 w-3.5"></span>
                                                    </DropdownMenuItemIndicator>
                                                </span>
                                            </DropdownMenuCheckboxItem>

                                            <DropdownMenuItem
                                                v-else-if="child.kind === 'item'"
                                                :disabled="child.item.disabled"
                                                :class="itemClassList(child.item)"
                                                @select="handleSelect(child.item)"
                                            >
                                                <span class="inline-flex min-w-0 items-center gap-2">
                                                    <span v-if="child.item.iconClass" :class="[child.item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                                    <span class="truncate">{{ child.item.label }}</span>
                                                </span>
                                                <span v-if="child.item.rightIconClass" :class="[child.item.rightIconClass, 'h-3.5 w-3.5 shrink-0 opacity-70']"></span>
                                                <span v-else-if="child.item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)] tracking-wider">
                                                    {{ child.item.shortcut }}
                                                </span>
                                            </DropdownMenuItem>
                                        </template>
                                    </div>
                                </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                        </DropdownMenuSub>

                        <DropdownMenuItem
                            v-else
                            :disabled="node.item.disabled"
                            :class="itemClassList(node.item)"
                            @select="handleSelect(node.item)"
                        >
                            <span class="inline-flex min-w-0 items-center gap-2">
                                <span v-if="node.item.iconClass" :class="[node.item.iconClass, 'h-4 w-4 shrink-0 opacity-80']"></span>
                                <span class="truncate">{{ node.item.label }}</span>
                            </span>

                            <span v-if="node.item.rightIconClass" :class="[node.item.rightIconClass, 'h-3.5 w-3.5 shrink-0 opacity-70']"></span>
                            <span v-else-if="node.item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)] tracking-wider">
                                {{ node.item.shortcut }}
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
