<script setup lang="ts">
import {
    DialogContent,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
    type PointerDownOutsideEvent,
} from "reka-ui";
import {computed, mergeProps, nextTick, ref, useId, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {useTeleportTarget} from "../../composables/useTeleportTarget";
import {usePopupScroll} from "../../composables/usePopupScroll";
import MenuRow from "./MenuRow.vue";
import PopupScrollbar from "./PopupScrollbar.vue";
import Kbd from "../display/Kbd.vue";
import Spinner from "../display/Spinner.vue";
import {moveRoving, rovingMove, type RovingMove} from "../../utils/roving";
import {useCloseHandoff} from "../feedback/close-handoff";
import type {OverlayCloseReason} from "../shared-types";

/**
 * 输入筛选、挑选一项的浮层（命令面板基座）：纯受控，不持数据。
 *
 * 组件只报告请求——`update:query` / `update:activeId` / `accept` / `close`——候选项顺序、
 * 查询含义、活动项与执行时机全归宿主；`>` 命令与 `:` 行号的前缀解析不在这里。
 * 宿主的配套义务：列表变化时先保留仍然有效的 activeId，失效就选第一个 enabled，空列表给 null。
 */
export type QuickPickItem = Readonly<{
    id: string;
    label: string;
    description?: string;
    category?: string;
    iconClass?: string;
    shortcut?: string;
    disabled?: boolean;
    /** 原 label 的 UTF-16 [start, endExclusive)，只用来标亮命中片段，不解析任何标记语言 */
    labelMatches?: readonly (readonly [number, number])[];
}>;

/** `QuickPick` 发出的关闭原因：`OverlayCloseReason` 的子集。 */
export type QuickPickCloseReason = Extract<OverlayCloseReason, "escape" | "outside">;

export type QuickPickProps = {
    open: boolean;
    query: string;
    items: readonly QuickPickItem[];
    activeId: string | null;
    title: string;
    placeholder: string;
    emptyText: string;
    message?: string;
    loading?: boolean;
    teleportTarget?: string;
    restoreFocus?: boolean;
    /** 变化且面板打开时重新聚焦输入框；宿主用它把焦点从别处唤回 */
    focusRequest?: number;
};

const props = withDefaults(defineProps<QuickPickProps>(), {
    message: "",
    loading: false,
    teleportTarget: undefined,
    restoreFocus: true,
    focusRequest: 0,
});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "update:query", value: string): void;
    (event: "update:activeId", value: string | null): void;
    (event: "accept", id: string): void;
    (event: "request-close", reason: QuickPickCloseReason): void;
    (event: "closed"): void;
}>();

// attrs 透传到浮层面板根（$attrs 显式绑定）；aria 关系由本组件自己写入，不受调用点覆盖
defineOptions({inheritAttrs: false});

const instanceId = useId();
const inputId = `nb-quick-pick-${instanceId}`;
const listboxId = `${inputId}-listbox`;

const inputRef = ref<HTMLInputElement | null>(null);

const handoff = useCloseHandoff(() => props.open);
let previouslyFocused: HTMLElement | null = null;

const activeItem = computed(() => props.items.find((item) => item.id === props.activeId && !item.disabled) ?? null);
/** 有一项带图标时，其余项也留出图标列，名称左边对齐。 */
const iconColumn = computed(() => props.items.some((item) => item.iconClass));
const activeDescendant = computed(() => (activeItem.value === null ? undefined : optionId(activeItem.value.id)));

const panelStyle = computed(() => ({
    zIndex: NB_Z_INDEX.commandPalette,
    width: "min(640px, calc(100cqw - 24px))",
    top: "clamp(16px, 8cqh, 72px)",
    maxHeight: "min(560px, calc(100cqh - 48px))",
}));

const teleportTo = useTeleportTarget(() => props.teleportTarget);

watch(() => props.focusRequest, () => {
    if (props.open) inputRef.value?.focus();
});

const scroll = usePopupScroll();

// 活动项更新后滚进视野（只滚候选列表这一层）；空列表与非活动项都不动滚动位置
watch(() => props.activeId, async () => {
    await nextTick();
    const id = activeDescendant.value;
    if (id === undefined) return;
    scroll.reveal(document.getElementById(id));
});

function optionId(itemId: string): string {
    return `${listboxId}-option-${itemId}`;
}

function onOpenAutoFocus(event: Event): void {
    // Reka 在这一刻还没把焦点移进内容树：此刻的 activeElement 就是「打开前焦点」
    const active = document.activeElement;
    previouslyFocused = active instanceof HTMLElement && active !== document.body ? active : null;
    event.preventDefault();
    inputRef.value?.focus();
}

function onCloseAutoFocus(event: Event): void {
    // 焦点归还与 closed 同一时刻：宿主收到 closed 时旧浮层已经交回焦点，不会再把焦点夺回去
    event.preventDefault();
    const restore = props.restoreFocus;
    const target = previouslyFocused;
    handoff.schedule(() => {
        if (restore && target?.isConnected) target.focus();
        emit("closed");
    });
}

function requestClose(reason: QuickPickCloseReason): void {
    if (!props.open) return;
    // 组件只报这一次请求：宿主不接就还是打开状态，下一次按键照常再报
    emit("request-close", reason);
    emit("update:open", false);
}

function onRootOpenChange(value: boolean): void {
    // Escape 与外点已由本组件消费；这里只转发别的关闭来源
    emit("update:open", value);
}

function onPointerDownOutside(event: PointerDownOutsideEvent): void {
    // 右键与 ctrl+左键不关面板（与 Reka 模态对话框的判断一致）
    if (event.detail.originalEvent.button !== 0) return;
    // 阻止 Reka 自己 dismiss：关闭只由宿主按 update:open / request-close 决定
    event.preventDefault();
    requestClose("outside");
}

function onQueryInput(event: Event): void {
    emit("update:query", (event.target as HTMLInputElement).value);
}

function onPanelKeydown(event: KeyboardEvent): void {
    switch (event.key) {
        case "Tab":
            // 焦点循环归 Reka FocusScope（与这段监听挂在同一元素上）；只挡下层 document / window 监听
            event.stopPropagation();
            return;
        case "Escape":
            event.preventDefault();
            event.stopPropagation();
            requestClose("escape");
            return;
        case "ArrowDown":
        case "ArrowUp":
        case "Home":
        case "End": {
            // Home、End 带 Ctrl/Cmd 时留给输入框的原生编辑行为
            if ((event.key === "Home" || event.key === "End") && (event.ctrlKey || event.metaKey)) return;
            const move = rovingMove(event.key, "vertical");
            if (move === null) return;
            event.preventDefault();
            event.stopPropagation();
            moveActive(move);
            return;
        }
        case "Enter":
            // 组合输入态的 Enter 属于输入法提交：不消费、不 accept
            if (event.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            acceptActive();
            return;
        default:
            return;
    }
}

function moveActive(action: RovingMove): void {
    const current = props.items.findIndex((item) => item.id === props.activeId);
    const next = moveRoving(props.items, current, action, (item) => item.disabled === true);
    const nextId = next >= 0 ? props.items[next]!.id : null;
    if (nextId !== props.activeId) emit("update:activeId", nextId);
}

function acceptActive(): void {
    if (props.loading) return;
    const item = activeItem.value;
    if (item === null) return;
    emit("accept", item.id);
}

function onItemPointerDown(event: PointerEvent): void {
    // 保留输入框焦点：不拦下指针默认行为，焦点会先离开输入框，键盘上下文随之断掉
    event.preventDefault();
}

/**
 * 只认指针真的移动：键盘滚动列表时，静止的鼠标底下换了一项，浏览器会补发 mouseenter，但不会发 pointermove；
 * 用 mouseenter 的话，按方向键滚到看不见的项时高亮会被鼠标抢回去。
 */
function onItemPointerMove(item: QuickPickItem): void {
    if (item.disabled || item.id === props.activeId) return;
    emit("update:activeId", item.id);
}

function onItemClick(item: QuickPickItem): void {
    if (item.disabled || props.loading) return;
    emit("accept", item.id);
}

function isActive(item: QuickPickItem): boolean {
    return activeItem.value?.id === item.id;
}

function metaText(item: QuickPickItem): string {
    return [item.category, item.description].filter((part) => part).join(" · ");
}

type LabelSegment = Readonly<{text: string; match: boolean}>;

function labelSegments(item: QuickPickItem): readonly LabelSegment[] {
    const ranges = safeMatchRanges(item.labelMatches, item.label);
    if (ranges.length === 0) return [{text: item.label, match: false}];
    const segments: LabelSegment[] = [];
    let cursor = 0;
    for (const [start, end] of ranges) {
        if (start > cursor) segments.push({text: item.label.slice(cursor, start), match: false});
        segments.push({text: item.label.slice(start, end), match: true});
        cursor = end;
    }
    if (cursor < item.label.length) segments.push({text: item.label.slice(cursor), match: false});
    return segments;
}

/** 越界、反向、重叠与劈开代理对的 range 一律忽略——只渲染安全文本，不做猜测性合并 */
function safeMatchRanges(
    matches: readonly (readonly [number, number])[] | undefined,
    label: string,
): readonly (readonly [number, number])[] {
    if (matches === undefined || matches.length === 0) return [];
    const sorted = matches
        .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end)
            && start >= 0 && start < end && end <= label.length
            && !isLowSurrogate(label.charCodeAt(start))
            && !isHighSurrogate(label.charCodeAt(end - 1)))
        .slice()
        .sort((left, right) => left[0] - right[0]);
    const ranges: (readonly [number, number])[] = [];
    for (const range of sorted) {
        const previous = ranges[ranges.length - 1];
        if (previous !== undefined && range[0] < previous[1]) continue;
        ranges.push(range);
    }
    return ranges;
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}
</script>

<template>
    <DialogRoot :open="props.open" :modal="true" @update:open="onRootOpenChange">
        <DialogPortal :to="teleportTo()">
            <!-- 透明遮罩与面板同为命令面板层级、面板在后绘制：外点落在遮罩上被消费，不穿透底层 -->
            <DialogOverlay class="fixed inset-0" :style="{zIndex: NB_Z_INDEX.commandPalette}" />
            <!-- 面板没有描述节点：先清掉 Reka 默认指向描述 id 的 aria-describedby（否则引用悬空并告警），宿主显式传入时仍以宿主为准 -->
            <DialogContent
                :aria-describedby="undefined"
                v-bind="mergeProps($attrs, {onKeydown: onPanelKeydown})"
                :style="panelStyle"
                class="nb-ui-popover-surface nb-ui-menu-surface fixed inset-x-0 mx-auto flex flex-col gap-[var(--space-2)] overflow-hidden text-[var(--text-main)] outline-none"
                :class="{ 'nb-ui-popover-motion': props.open }"
                @open-auto-focus="onOpenAutoFocus"
                @close-auto-focus="onCloseAutoFocus"
                @pointer-down-outside="onPointerDownOutside"
            >
                <DialogTitle class="sr-only">{{ props.title }}</DialogTitle>

                <input
                    :id="inputId"
                    ref="inputRef"
                    class="nb-ui-native-input nb-ui-control nb-ui-control-h-md nb-ui-control-px w-full shrink-0 rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[length:var(--text-sm)] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                    type="text"
                    role="combobox"
                    autocomplete="off"
                    spellcheck="false"
                    :aria-expanded="props.open ? 'true' : 'false'"
                    :aria-controls="listboxId"
                    :aria-activedescendant="activeDescendant"
                    :aria-label="props.placeholder"
                    :placeholder="props.placeholder"
                    :value="props.query"
                    @input="onQueryInput"
                >

                <div :ref="scroll.setViewport" class="nb-ui-popover-scroll" :class="scroll.fadeClass.value" :style="scroll.viewportStyle.value" @scroll="scroll.onScroll">
                    <ul :id="listboxId" role="listbox" :aria-label="props.title" class="list-none p-0 m-0">
                        <li
                            v-for="item in props.items"
                            :id="optionId(item.id)"
                            :key="item.id"
                            role="option"
                            :aria-selected="isActive(item) ? 'true' : 'false'"
                            :aria-disabled="item.disabled ? 'true' : undefined"
                            class="nb-ui-menu-item"
                            :data-highlighted="isActive(item) ? '' : undefined"
                            :data-disabled="item.disabled ? '' : undefined"
                            @pointerdown="onItemPointerDown"
                            @pointermove="onItemPointerMove(item)"
                            @click="onItemClick(item)"
                        >
                            <MenuRow :lead-column="iconColumn" :icon="item.iconClass" :hint="metaText(item) || undefined">
                                <template #label>
                                    <span class="nb-ui-menu-item__label">
                                        <template v-for="(segment, index) in labelSegments(item)" :key="index">
                                            <span v-if="segment.match" class="font-medium text-[var(--accent-main)]">{{ segment.text }}</span>
                                            <template v-else>{{ segment.text }}</template>
                                        </template>
                                    </span>
                                </template>
                                <template #trailing><Kbd v-if="item.shortcut" size="sm">{{ item.shortcut }}</Kbd></template>
                            </MenuRow>
                        </li>
                    </ul>
                    <p
                        v-if="props.items.length === 0 && !props.loading"
                        class="px-[var(--space-2)] py-3 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]"
                    >{{ props.emptyText }}</p>
                </div>
                <PopupScrollbar :scroll="scroll" />

                <div class="flex shrink-0 items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-muted)]" role="status" aria-live="polite">
                    <Spinner v-if="props.loading" size="sm" />
                    <span v-if="props.message !== ''">{{ props.message }}</span>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
