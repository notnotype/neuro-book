<script setup lang="ts">
import {
    DialogContent,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
    type PointerDownOutsideEvent,
} from "reka-ui";
import {computed, nextTick, ref, useId, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import Kbd from "../display/Kbd.vue";
import Spinner from "../display/Spinner.vue";
import {moveHighlight, type HighlightAction} from "../form/option-highlight";
import {useCloseHandoff} from "./close-handoff";

/**
 * 全局快速输入浮层（S4 命令面板基座）：纯受控，不持数据。
 *
 * 组件只报告请求——`update:query` / `update:activeId` / `accept` / `close`——候选项顺序、
 * 查询含义、活动项与执行时机全归宿主；`>` 命令与 `:` 行号的前缀解析不在这里。
 * 宿主的配套义务：列表变化时先保留仍然有效的 activeId，失效就选第一个 enabled，空列表给 null。
 */
export type QuickInputItem = Readonly<{
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

export type QuickInputCloseReason = "escape" | "outside";

export type QuickInputProps = {
    open: boolean;
    query: string;
    items: readonly QuickInputItem[];
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

const props = withDefaults(defineProps<QuickInputProps>(), {
    message: "",
    loading: false,
    teleportTarget: "body",
    restoreFocus: true,
    focusRequest: 0,
});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "update:query", value: string): void;
    (event: "update:activeId", value: string | null): void;
    (event: "accept", id: string): void;
    (event: "close", reason: QuickInputCloseReason): void;
    (event: "closed"): void;
}>();

// attrs 透传到浮层面板根（$attrs 显式绑定）；aria 关系由本组件自己写入，不受调用点覆盖
defineOptions({inheritAttrs: false});

const instanceId = useId();
const inputId = `nb-quick-input-${instanceId}`;
const listboxId = `${inputId}-listbox`;

const inputRef = ref<HTMLInputElement | null>(null);

const handoff = useCloseHandoff(() => props.open);
let previouslyFocused: HTMLElement | null = null;

const activeItem = computed(() => props.items.find((item) => item.id === props.activeId && !item.disabled) ?? null);
const activeDescendant = computed(() => (activeItem.value === null ? undefined : optionId(activeItem.value.id)));

const panelStyle = computed(() => ({
    zIndex: NB_Z_INDEX.commandPalette,
    width: "min(640px, calc(100vw - 24px))",
    top: "clamp(16px, 8vh, 72px)",
    maxHeight: "min(560px, calc(100dvh - 48px))",
    borderRadius: "14px",
    "--nb-popover-radius": "14px",
}));

// 与 DialogWindow 同一取法：选择器在当前上下文（如 Lab）不存在时回退 body，
// 否则 Teleport 会静默不渲染整块浮层。
const portalTarget = computed(() => {
    if (typeof document !== "undefined" && document.querySelector(props.teleportTarget) !== null) {
        return props.teleportTarget;
    }
    return "body";
});

watch(() => props.focusRequest, () => {
    if (props.open) inputRef.value?.focus();
});

// 活动项更新后滚进视野；空列表与非活动项都不动滚动位置
watch(() => props.activeId, async () => {
    await nextTick();
    const id = activeDescendant.value;
    if (id === undefined) return;
    const option = document.getElementById(id);
    if (typeof option?.scrollIntoView === "function") option.scrollIntoView({block: "nearest"});
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

function requestClose(reason: QuickInputCloseReason): void {
    if (!props.open) return;
    // 组件只报这一次请求：宿主不接就还是打开状态，下一次按键照常再报
    emit("update:open", false);
    emit("close", reason);
}

function onRootOpenChange(value: boolean): void {
    // Escape 与外点已由本组件消费；这里只转发别的关闭来源
    emit("update:open", value);
}

function onPointerDownOutside(event: PointerDownOutsideEvent): void {
    // 右键与 ctrl+左键不关面板（与 Reka 模态对话框的判断一致）
    if (event.detail.originalEvent.button !== 0) return;
    // 阻止 Reka 自己 dismiss：关闭只由宿主按 update:open / close 决定
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
            event.preventDefault();
            event.stopPropagation();
            moveActive(event.key === "ArrowDown" ? "next" : "prev");
            return;
        case "Home":
        case "End":
            // Ctrl/Cmd 组合留给原生编辑行为
            if (event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            moveActive(event.key === "Home" ? "first" : "last");
            return;
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

function moveActive(action: HighlightAction): void {
    const current = props.items.findIndex((item) => item.id === props.activeId);
    const next = moveHighlight(props.items.map((item) => ({disabled: item.disabled})), current, action);
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

function onItemMouseEnter(item: QuickInputItem): void {
    if (item.disabled || item.id === props.activeId) return;
    emit("update:activeId", item.id);
}

function onItemClick(item: QuickInputItem): void {
    if (item.disabled || props.loading) return;
    emit("accept", item.id);
}

function isActive(item: QuickInputItem): boolean {
    return activeItem.value?.id === item.id;
}

function metaText(item: QuickInputItem): string {
    return [item.category, item.description].filter((part) => part).join(" · ");
}

type LabelSegment = Readonly<{text: string; match: boolean}>;

function labelSegments(item: QuickInputItem): readonly LabelSegment[] {
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
        <DialogPortal :to="portalTarget">
            <!-- 透明遮罩与面板同为 S4 层级、面板在后绘制：外点落在遮罩上被消费，不穿透底层 -->
            <DialogOverlay class="fixed inset-0" :style="{zIndex: NB_Z_INDEX.commandPalette}" />
            <DialogContent
                v-bind="$attrs"
                :style="panelStyle"
                class="nb-ui-popover-surface fixed inset-x-0 mx-auto flex flex-col gap-[var(--space-2)] overflow-hidden p-[var(--space-3)] text-[var(--text-main)] outline-none"
                :class="{ 'nb-ui-popover-motion': props.open }"
                @open-auto-focus="onOpenAutoFocus"
                @close-auto-focus="onCloseAutoFocus"
                @pointer-down-outside="onPointerDownOutside"
                @keydown="onPanelKeydown"
            >
                <DialogTitle class="sr-only">{{ props.title }}</DialogTitle>

                <input
                    :id="inputId"
                    ref="inputRef"
                    class="nb-ui-native-input nb-ui-control nb-ui-control-h-md nb-ui-control-px w-full shrink-0 rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-sm)] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
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

                <div class="nb-ui-popover-scroll min-h-0 flex-1">
                    <ul :id="listboxId" role="listbox" :aria-label="props.title" class="list-none p-0 m-0">
                        <li
                            v-for="item in props.items"
                            :id="optionId(item.id)"
                            :key="item.id"
                            role="option"
                            :aria-selected="isActive(item) ? 'true' : 'false'"
                            :aria-disabled="item.disabled ? 'true' : undefined"
                            class="nb-ui-popover-item flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-1.5 text-[var(--text-sm)] select-none"
                            :class="item.disabled
                                ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
                                : isActive(item)
                                    ? 'cursor-pointer bg-[var(--overlay-item-active)] text-[var(--text-main)]'
                                    : 'cursor-pointer text-[var(--text-secondary)]'"
                            @pointerdown="onItemPointerDown"
                            @mouseenter="onItemMouseEnter(item)"
                            @click="onItemClick(item)"
                        >
                            <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 shrink-0" aria-hidden="true"></span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate">
                                    <template v-for="(segment, index) in labelSegments(item)" :key="index">
                                        <span v-if="segment.match" class="font-medium text-[var(--accent-main)]">{{ segment.text }}</span>
                                        <template v-else>{{ segment.text }}</template>
                                    </template>
                                </span>
                                <span
                                    v-if="metaText(item) !== ''"
                                    class="block truncate text-[var(--text-xs)] text-[var(--text-muted)]"
                                >{{ metaText(item) }}</span>
                            </span>
                            <Kbd v-if="item.shortcut" size="sm">{{ item.shortcut }}</Kbd>
                        </li>
                    </ul>
                    <p
                        v-if="props.items.length === 0 && !props.loading"
                        class="px-[var(--space-2)] py-3 text-center text-[var(--text-sm)] text-[var(--text-muted)]"
                    >{{ props.emptyText }}</p>
                </div>

                <div class="flex shrink-0 items-center gap-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-muted)]" role="status" aria-live="polite">
                    <Spinner v-if="props.loading" size="sm" />
                    <span v-if="props.message !== ''">{{ props.message }}</span>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
