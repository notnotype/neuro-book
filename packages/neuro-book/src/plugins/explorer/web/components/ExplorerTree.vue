<script setup lang="ts">
/** 资源管理器的虚拟树（同名 .md）。 */
import {useLayoutExtent} from "@notnotype/nb-ui/composables";
import {computed, nextTick, ref, useId, watch} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {KeyOutcome} from "../controller";
import type {TreeKey} from "../tree/keys";
import type {Row} from "../tree/rows";
import type {Modifiers} from "../tree/selection";
import {clampTop, renderedRows, revealTop} from "../tree/window";
import ExplorerRow from "./ExplorerRow.vue";

const props = defineProps<{
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    locale: DisplayLocale;
    label: string;
    handleKey: (key: TreeKey, page: number) => KeyOutcome;
    /** 正在内联输入的行：新建的输入行或改名的资源行，以及名字、错误文字与是否在提交。 */
    editing?: {readonly id: string; readonly name: string; readonly error: string | null; readonly busy: boolean} | null;
}>();

const emit = defineEmits<{
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    (event: "retry", address: string): void;
    (event: "focus-change", focused: boolean): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
}>();

/** 探针还没量出尺寸（没有布局的环境）时的行高与视口高度。 */
const FALLBACK_ROW_HEIGHT = 26;
const FALLBACK_VIEWPORT = 600;

const root = ref<HTMLElement | null>(null);
const probe = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(root);
const probeExtent = useLayoutExtent(probe);
const prefix = useId();

const rowHeight = computed(() => (probeExtent.value !== null && probeExtent.value.height > 0 ? probeExtent.value.height : FALLBACK_ROW_HEIGHT));
/** 视图停放时尺寸为零：沿用最后一次的正尺寸，不让窗口缩成空、也不改记住的滚动位置。 */
const viewport = ref(FALLBACK_VIEWPORT);
watch(extent, (next) => {
    if (next !== null && next.height > 0) viewport.value = next.height;
}, {immediate: true});

const scrollTop = ref(0);
const treeFocused = ref(false);

const selectedSet = computed(() => new Set(props.selected));
const focusIndex = computed(() => (props.focus === null ? -1 : props.rows.findIndex((row) => row.id === props.focus)));
const editIndex = computed(() => (props.editing == null ? -1 : props.rows.findIndex((row) => row.id === props.editing?.id)));
const rendered = computed(() => renderedRows({count: props.rows.length, rowHeight: rowHeight.value, viewport: viewport.value, scrollTop: scrollTop.value, keep: [focusIndex.value, editIndex.value]}).map((index) => ({index, row: props.rows[index] as Row})));
const page = computed(() => Math.max(1, Math.floor(viewport.value / rowHeight.value)));

const domId = (id: string): string => `${prefix}-${encodeURIComponent(id)}`;
const activeDescendant = computed(() => (focusIndex.value < 0 ? undefined : domId(props.focus as string)));

/** 滚动锚点：首个可见行与行内偏移。行变了时按它还原阅读位置。 */
let anchor: {id: string; offset: number} | null = null;
const remember = (): void => {
    const index = Math.floor(scrollTop.value / rowHeight.value);
    const row = props.rows[index];
    anchor = row === undefined ? null : {id: row.id, offset: scrollTop.value - index * rowHeight.value};
};

const setScroll = (top: number): void => {
    const element = root.value;
    scrollTop.value = top;
    if (element !== null && Math.abs(element.scrollTop - top) > 0.5) element.scrollTop = top;
};

watch(() => props.rows, (rows) => {
    let top = scrollTop.value;
    if (anchor !== null) {
        const index = rows.findIndex((row) => row.id === anchor?.id);
        if (index >= 0) top = index * rowHeight.value + anchor.offset;
    }
    void nextTick(() => {
        setScroll(clampTop(top, rows.length, rowHeight.value, viewport.value));
        remember();
    });
});

watch(editIndex, (index) => {
    if (index < 0) return;
    void nextTick(() => {
        setScroll(revealTop(index, rowHeight.value, viewport.value, scrollTop.value));
        remember();
    });
});

watch(focusIndex, (index) => {
    if (index < 0) return;
    void nextTick(() => {
        setScroll(revealTop(index, rowHeight.value, viewport.value, scrollTop.value));
        remember();
    });
});

const onScroll = (): void => {
    if (root.value === null) return;
    // 停放（尺寸为零）期间浏览器可能把滚动位置夹成零：不记它。
    if (root.value.clientHeight === 0) return;
    scrollTop.value = root.value.scrollTop;
    remember();
};

const focusTree = (): void => {
    root.value?.focus({preventScroll: true});
};

const onKeydown = (event: KeyboardEvent): void => {
    // 行里的按钮与输入框自己处理按键。
    if (event.target !== root.value) return;
    const outcome = props.handleKey({key: event.key, shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey, alt: event.altKey}, page.value);
    if (outcome === "none") return;
    event.preventDefault();
    if (outcome === "handled") return;
    // 键盘打开的右键菜单落在焦点行下方。
    const element = document.getElementById(domId(outcome.menu));
    const rect = element?.getBoundingClientRect();
    emit("row-context", outcome.menu, (rect?.left ?? 0) + 24, rect?.bottom ?? 0);
};

const onFocus = (event: FocusEvent): void => {
    if (event.target !== root.value) return;
    treeFocused.value = true;
    emit("focus-change", true);
};

const onBlur = (event: FocusEvent): void => {
    if (event.target !== root.value) return;
    treeFocused.value = false;
    emit("focus-change", false);
};

const press = (row: Row, event: MouseEvent, part: "twisty" | "row"): void => {
    focusTree();
    if (row.kind === "status" || row.kind === "edit") return;
    emit("row-press", row.id, {toggle: event.ctrlKey || event.metaKey, range: event.shiftKey}, part);
};

const context = (row: Row, event: MouseEvent): void => {
    focusTree();
    if (row.kind === "root" || row.kind === "entry") emit("row-context", row.id, event.clientX, event.clientY);
};

defineExpose({focus: focusTree});
</script>

<template>
    <div
        ref="root"
        role="tree"
        tabindex="0"
        aria-multiselectable="true"
        :aria-label="label"
        :aria-activedescendant="activeDescendant"
        class="explorer-tree relative h-full min-h-0 overflow-y-auto overflow-x-hidden outline-none"
        data-explorer-tree
        @scroll="onScroll"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
    >
        <div ref="probe" class="nb-ui-control-h-sm pointer-events-none invisible absolute left-0 top-0 w-px" aria-hidden="true"></div>
        <div class="relative w-full" :style="{height: `${String(rows.length * rowHeight)}px`}">
            <ExplorerRow
                v-for="item in rendered"
                :key="item.row.id"
                class="absolute left-0 right-0"
                :style="{top: `${String(item.index * rowHeight)}px`}"
                :row="item.row"
                :locale="locale"
                :dom-id="domId(item.row.id)"
                :selected="selectedSet.has(item.row.id)"
                :active="treeFocused && item.row.id === focus"
                :height="rowHeight"
                :edit="editing != null && editing.id === item.row.id ? editing : null"
                @edit-input="(name) => emit('edit-input', name)"
                @edit-commit="emit('edit-commit')"
                @edit-cancel="emit('edit-cancel')"
                @press="(event, part) => press(item.row, event, part)"
                @activate="(item.row.kind === 'root' || item.row.kind === 'entry') && emit('row-activate', item.row.id)"
                @context="(event) => context(item.row, event)"
                @retry="item.row.kind === 'status' && emit('retry', item.row.parent)"
            />
        </div>
    </div>
</template>

<style scoped>
.explorer-tree {
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-main) 24%, transparent) transparent;
}
</style>
