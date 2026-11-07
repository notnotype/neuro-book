<script setup lang="ts">
/** 资源管理器的虚拟树（同名 .md）。 */
import {OverlayScrollbar} from "@notnotype/nb-ui/components";
import {createDragSession, useLayoutExtent} from "@notnotype/nb-layout/vue";
import type {DragSession, DropFeedbackPreview} from "@notnotype/nb-layout/vue";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch} from "vue";

import {dropKey} from "../actions/drop";
import type {WorkbenchFileDropHost} from "nbook/plugins/workbench/shared/contracts";

import type {DropAction, DropOver} from "../actions/drop";
import type {KeyOutcome} from "../controller";
import {useExplorerText} from "../text";
import {resolveTreeTarget, treeSourceAt} from "../tree-drag";
import type {TreeDragTarget} from "../tree-drag";
import {parentAddress} from "../tree/address";
import type {TreeKey} from "../tree/keys";
import type {MotionNote} from "../tree/motion";
import {displayLabel} from "../tree/rows";
import type {Row} from "../tree/rows";
import type {Modifiers} from "../tree/selection";
import {clampTop, renderedRows, revealTop} from "../tree/window";
import ExplorerRow from "./ExplorerRow.vue";

const props = defineProps<{
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    label: string;
    handleKey: (key: TreeKey, page: number) => KeyOutcome;
    /** 项目根显示的作品名；不给时显示“项目”。 */
    projectTitle?: string | null;
    /** 正在内联输入的行：新建的输入行或改名的资源行，以及名字、错误文字与是否在提交。 */
    editing?: {readonly id: string; readonly name: string; readonly error: string | null; readonly busy: boolean} | null;
    /** 拖动过了门槛：返回 false 时不起拖。缺省不能拖。 */
    startDrag?: (id: string) => boolean;
    /** 这个落点此刻的动作，只读。缺省没有落点。 */
    previewDrop?: (over: DropOver | null) => DropAction;
    /** 拖动中：被拖的源（行 id）与最后显示的落点动作；不在拖动为 null。 */
    drag?: {readonly sources: ReadonlyArray<string>; readonly action: DropAction} | null;
    /** 缩进参考线：不画、悬停或有焦点时画、一直画；默认 `hover`。 */
    indentGuides?: "none" | "hover" | "always";
    /** 设置“隐藏 Markdown 扩展名”；默认 false。 */
    hideMarkdownExtension?: boolean;
    /** 宿主最近一次提交的结构变化预告：之后的刷新里认出这些地址才放动画。 */
    motion?: MotionNote | null;
}>();

const text = useExplorerText();

const emit = defineEmits<{
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    (event: "retry", address: string): void;
    (event: "focus-change", focused: boolean): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
    (event: "drag-hover", over: DropOver | null): void;
    (event: "drag-drop", over: DropOver | null): void;
    (event: "drag-cancel"): void;
    /** 拖动中指针在收起的目录行中段停了 600 毫秒：展开它。 */
    (event: "drag-expand", id: string): void;
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

/**
 * 加深的那一段参考线：焦点行（没有焦点时取第一个选中行）与它连续的同层兄弟（中间夹着的更深的行也算），加深的是它们上级
 * 的那一层。焦点在根或根的直接子项上时没有可加深的线。
 */
const guideRange = computed((): {readonly lo: number; readonly hi: number; readonly level: number} | null => {
    let anchor = focusIndex.value;
    if (anchor < 0) anchor = props.selected.length === 0 ? -1 : props.rows.findIndex((row) => row.id === props.selected[0]);
    const row = anchor < 0 ? undefined : props.rows[anchor];
    if (row === undefined || row.depth < 2) return null;
    let lo = anchor;
    let hi = anchor;
    while (lo > 0 && (props.rows[lo - 1] as Row).depth >= row.depth) lo -= 1;
    while (hi < props.rows.length - 1 && (props.rows[hi + 1] as Row).depth >= row.depth) hi += 1;
    return {lo, hi, level: row.depth - 1};
});
const guideActiveAt = (index: number): number | null => {
    const range = guideRange.value;
    return range !== null && index >= range.lo && index <= range.hi ? range.level : null;
};
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

/**
 * 行高变了（主题、字号）：同一个 scrollTop 在新行高下指向别的行，按锚点换算，行内偏移按行高等比缩放。要在内容高度随
 * 新行高改变、浏览器夹紧滚动位置并发出 scroll 之前读锚点，所以这里不等布局，直接用旧锚点算。
 */
watch(rowHeight, (height, previous) => {
    if (anchor === null || previous === undefined || previous <= 0) return;
    const index = props.rows.findIndex((row) => row.id === anchor?.id);
    if (index < 0) return;
    const top = index * height + Math.min(anchor.offset * (height / previous), height - 1);
    void nextTick(() => {
        setScroll(clampTop(top, props.rows.length, height, viewport.value));
        remember();
    });
});

/**
 * 焦点换了一行（键盘移动、点击）或开始编辑另一行时，把它滚入视口。按 id 的变化触发，不按下标：前方插入或删除行只
 * 改变下标，那时由上面的锚点保持阅读位置，不能被拉回焦点行。
 */
const reveal = (id: string | null | undefined): void => {
    if (id == null) return;
    void nextTick(() => {
        const index = props.rows.findIndex((row) => row.id === id);
        if (index < 0) return;
        setScroll(revealTop(index, rowHeight.value, viewport.value, scrollTop.value));
        remember();
    });
};
watch(() => props.editing?.id, reveal);
watch(() => props.focus, reveal);

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
    if (row.kind === "edit") return;
    emit("row-press", row.id, {toggle: event.ctrlKey || event.metaKey, range: event.shiftKey}, part);
};

const context = (row: Row, event: MouseEvent): void => {
    focusTree();
    if (row.kind === "root" || row.kind === "entry") emit("row-context", row.id, event.clientX, event.clientY);
};

// ---- 拖动：手势是 nb-layout 的会话，来源与落点在 `tree-drag.ts`，判定与提交在控制器。 ----

/**
 * 指针下的落点与画反馈要用的几何：行的矩形；移入目录时还要那个目录在树里的整段范围，按交出落点那一刻的树矩形与滚动位置
 * 换算（之后滚动会先撤下落点，不会用到过期的几何）。
 */
interface Hovered {
    readonly over: DropOver;
    /** 这次判定时的动作，给会话做放下比较用的快照；画反馈读控制器写回的 `props.drag.action`。 */
    readonly action: DropAction;
    readonly rect: {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number};
    readonly tree: DOMRect;
    readonly scrollTop: number;
}
const gesture = shallowRef<DragSession<string, Hovered> | null>(null);
const hovered = computed(() => gesture.value?.state.value?.drop ?? null);
const pointer = computed(() => gesture.value?.state.value?.point ?? null);
const overOf = (target: TreeDragTarget | null): Hovered | null => {
    if (target === null || root.value === null) return null;
    const tree = root.value.getBoundingClientRect();
    const geometry = {rect: target.kind === "editor" ? tree : target.rect, tree, scrollTop: root.value.scrollTop};
    const withAction = (over: DropOver): Hovered => ({over, action: props.previewDrop?.(over) ?? {kind: "none"}, ...geometry});
    if (target.kind === "blank") return withAction({kind: "blank"});
    if (target.kind === "editor") return withAction({kind: "editor", host: target.host, drop: target.drop});
    const row = props.rows.find((candidate) => candidate.id === target.id);
    return row === undefined ? null : withAction({kind: "row", id: target.id, offset: target.offset, x: target.x});
};

/** 停留展开：指针停在收起的目录行中段 600 毫秒（docs/specs/workbench/files-explorer.md 的“拖动”）。落点换了重新计时。 */
const EXPAND_HOVER_MS = 600;
let expandTimer: ReturnType<typeof setTimeout> | null = null;
let expandFor = "";
/** 正在计时的目录行：它的箭头在计时里匀速转到朝下（有动画时才标）。 */
const expandPending = ref("");
const clearExpand = (): void => {
    if (expandTimer !== null) clearTimeout(expandTimer);
    expandTimer = null;
    expandFor = "";
    expandPending.value = "";
};
// 只在落点动作是“移入这个目录”时计时：拖着目录停在它自己身上（没有落点）不展开。
watch([hovered, () => props.drag?.action], ([next, action]) => {
    const over = next?.over;
    const row = over?.kind === "row" && action?.kind === "move" && action.target === over.id ? props.rows.find((candidate) => candidate.id === over.id) : undefined;
    const waiting = row !== undefined && (row.kind === "root" || row.kind === "entry") && !row.expanded && (row.kind === "root" || row.expandable) ? row.id : "";
    if (waiting === expandFor) return;
    clearExpand();
    if (waiting === "") return;
    expandFor = waiting;
    if (motionMs("--motion-base") > 0) expandPending.value = waiting;
    expandTimer = setTimeout(() => {
        expandTimer = null;
        expandFor = "";
        expandPending.value = "";
        emit("drag-expand", waiting);
    }, EXPAND_HOVER_MS);
});
onBeforeUnmount(clearExpand);

onMounted(() => {
    const element = root.value;
    if (element === null) return;
    gesture.value = createDragSession<string, Hovered>({
        root: element,
        // 用户自己滚动或行变了而指针没动：指针下已经不是显示的那一行，撤下落点（files-explorer 验收 15）。
        scroll: "withdraw",
        autoScroll: {element},
        sourceAt: (target) => treeSourceAt(element, target),
        activate: (id) => props.startDrag?.(id) ?? false,
        resolve: ({top, point}) => overOf(resolveTreeTarget(element, top, point)),
        actionKey: (drop) => dropKey(drop.action),
        commit: (drop) => emit("drag-drop", drop.over),
        onEnd: (end, last) => {
            if (end.kind === "committed") return;
            if (end.kind === "no-action" || end.reason !== "disposed") flyBack(last.point);
            emit("drag-cancel");
        },
        onActiveChange: (active) => element.toggleAttribute("data-explorer-dragging", active),
    });
    // 同步：边缘滚动中松手时，“发布”和“放下”在同一个调用栈里，控制器比较的“最后显示的动作”要在放下之前写好。
    watch(gesture.value.state, (next) => {
        if (next === null) clearExpand();
        else emit("drag-hover", next.drop?.over ?? null);
    }, {flush: "sync"});
});
onBeforeUnmount(() => gesture.value?.dispose());

/** 主题的动画时长（毫秒）；系统减少动态效果时为 0，没有布局的环境也当 0。 */
function motionMs(name: "--motion-base" | "--motion-fast" | "--motion-move"): number {
    const element = root.value;
    if (element === null) return 0;
    const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
    return value > 0 ? value : 0;
}

/**
 * 过渡窗口（docs/specs/workbench/files-explorer.md 的“动画”）：树是虚拟列表，滚动时窗口两端也有行进出，不能一律做进出
 * 动画。只在展开的目录变了、或认出了宿主预告的结构变化之后的一个 `--motion-move` 里打 `data-motion`，样式只在这时让新出现
 * 的行从上方滑下并淡入、离开的行反向、其余行的位置跟着过渡。watch 在渲染之前跑，标记与新行同一次渲染出现，进场的过渡才有
 * 起点。系统减少动态效果时时长是 0，不打。
 */
const moving = ref(false);
let movingTimer: ReturnType<typeof setTimeout> | null = null;
/** 动画结束后多留这么久再撤标记：离开的行可能晚一帧开始过渡，撤早了会被截断。 */
const MOTION_SLACK_MS = 100;
const pulseMotion = (): void => {
    // 按行里最长的过渡算（位移是 `--motion-move`）：标记撤早了，离开的行会跳回原位闪一下。
    const duration = motionMs("--motion-move");
    if (duration <= 0) return;
    if (movingTimer !== null) clearTimeout(movingTimer);
    moving.value = true;
    movingTimer = setTimeout(() => {
        moving.value = false;
        movingTimer = null;
    }, duration + MOTION_SLACK_MS);
};
const expandedIds = computed(() => props.rows.flatMap((row) => ((row.kind === "root" || row.kind === "entry") && row.expanded ? [row.id] : [])).join("\n"));
watch(expandedIds, pulseMotion);

/**
 * 认预告：预告到达时记下移动源此刻的位置；之后每次刷新对一遍，认出的项放动画并划掉，`NOTE_TTL_MS` 内没认完的丢掉。
 * - 移动：新地址出现（调整顺序是同一行换了位置）时，那一行从原位置滑过来（FLIP：先用 `transform` 放回原位、不带过渡地
 *   渲染一帧，再撤掉，让过渡把它带到新位置）并亮一下；原地址的行离开时不放离场动画（它“就是”滑过来的那一行）。新旧地址
 *   都看不见（放进了收起的目录）时，最近的可见上级目录行亮一下。
 * - 新建与粘贴：新行出现时亮一下（进场动画由过渡窗口给）。删除：行离开时打开过渡窗口。
 */
const NOTE_TTL_MS = 1000;
interface Pending {
    moves: Array<{readonly from: string; readonly to: string; readonly fromTop: number | null}>;
    arrivals: Set<string>;
    departures: Set<string>;
}
let pending: Pending | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
/** 正在从原位置滑过来的行：id → 原位置减新位置（像素）。 */
const flips = ref(new Map<string, number>());
/** 滑过来或新出现的行（不放进场动画的那一种用 `movedIds` 区分）。 */
const movedIds = ref(new Set<string>());
const glowIds = ref(new Set<string>());
/** 移动的原地址：它的行离开时直接隐去。 */
const vanishing = new Set<string>();
let glowTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => props.motion, (note) => {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pending = null;
    if (note == null || motionMs("--motion-base") <= 0) return;
    const indexOf = new Map(props.rows.map((row, index) => [row.id, index]));
    pending = {
        moves: note.moves.map((move) => {
            const at = indexOf.get(move.from);
            return {...move, fromTop: at === undefined ? null : at * rowHeight.value};
        }),
        arrivals: new Set(note.arrivals),
        departures: new Set(note.departures),
    };
    for (const move of note.moves) if (move.from !== move.to) vanishing.add(move.from);
    pendingTimer = setTimeout(() => {
        pending = null;
        pendingTimer = null;
        vanishing.clear();
    }, NOTE_TTL_MS);
});
watch(() => props.rows, (rows) => {
    const waiting = pending;
    if (waiting === null) return;
    const indexOf = new Map(rows.map((row, index) => [row.id, index]));
    const nextFlips = new Map<string, number>();
    const moved = new Set<string>();
    const glows = new Set<string>();
    let matched = false;
    waiting.moves = waiting.moves.filter((move) => {
        const at = indexOf.get(move.to);
        const top = at === undefined ? null : at * rowHeight.value;
        if (move.from === move.to) {
            // 调整顺序：同一行换了位置才算到了，位置的过渡由窗口给。
            if (top === null || top === move.fromTop) return true;
            glows.add(move.to);
        } else if (top !== null) {
            if (move.fromTop !== null) nextFlips.set(move.to, move.fromTop - top);
            moved.add(move.to);
            glows.add(move.to);
        } else if (!indexOf.has(move.from) && !opened(move.to, rows, indexOf)) {
            const shown = nearestShown(move.to, indexOf);
            if (shown !== null) glows.add(shown);
        } else return true;
        matched = true;
        return false;
    });
    for (const address of [...waiting.arrivals]) {
        if (!indexOf.has(address)) continue;
        waiting.arrivals.delete(address);
        glows.add(address);
        matched = true;
    }
    for (const address of [...waiting.departures]) {
        if (indexOf.has(address)) continue;
        waiting.departures.delete(address);
        matched = true;
    }
    if (waiting.moves.length === 0 && waiting.arrivals.size === 0 && waiting.departures.size === 0) pending = null;
    if (!matched) return;
    pulseMotion();
    if (nextFlips.size > 0) {
        flips.value = nextFlips;
        movedIds.value = new Set([...movedIds.value, ...moved]);
        // 隔两帧再撤：带着原位置的那一帧要先算过样式，撤掉时才有过渡的起点。
        void nextTick(() => requestAnimationFrame(() => requestAnimationFrame(() => {
            flips.value = new Map();
        })));
    }
    if (glows.size > 0) {
        glowIds.value = glows;
        if (glowTimer !== null) clearTimeout(glowTimer);
        glowTimer = setTimeout(() => {
            glowIds.value = new Set();
            movedIds.value = new Set();
            glowTimer = null;
        }, motionMs("--motion-base") * 3 + MOTION_SLACK_MS);
    }
});
/** 地址的父目录行在列表里且展开着：新行迟早会列出来（两个目录的刷新先后到达），接着等。 */
function opened(address: string, rows: ReadonlyArray<Row>, indexOf: ReadonlyMap<string, number>): boolean {
    const parent = parentAddress(address);
    const at = parent === null ? undefined : indexOf.get(parent);
    const row = at === undefined ? undefined : rows[at];
    return row !== undefined && (row.kind === "root" || row.kind === "entry") && row.expanded;
}
/** 地址最近的、正在列表里的上级目录行（放进收起的目录时亮它）。 */
function nearestShown(address: string, indexOf: ReadonlyMap<string, number>): string | null {
    for (let current = parentAddress(address); current !== null; current = parentAddress(current)) if (indexOf.has(current)) return current;
    return null;
}
/** 移动的原地址的行离开时直接隐去，免得与滑过来的新行同时出现。 */
const onRowLeave = (element: Element): void => {
    const id = (element as HTMLElement).dataset.explorerRow;
    if (id !== undefined && vanishing.has(id)) (element as HTMLElement).style.visibility = "hidden";
};
const rowMotionStyle = (id: string): Record<string, string> => {
    const offset = flips.value.get(id);
    return offset === undefined ? {} : {transform: `translateY(${String(offset)}px)`, transition: "none"};
};
onBeforeUnmount(() => {
    for (const timer of [movingTimer, pendingTimer, glowTimer, returnTimer]) if (timer !== null) clearTimeout(timer);
});

/**
 * 取消时飞回原行的拖影（docs/specs/workbench/files-explorer.md 的“动画”）：从松手处移到第一个源行再淡出，之后卸载。源行不在
 * 渲染范围里时原地淡出。在拖影被收起之前（取消与放下的回调里）调用。
 */
const returning = ref<{readonly what: string; x: number; y: number; flying: boolean} | null>(null);
let returnTimer: ReturnType<typeof setTimeout> | null = null;
function flyBack(at: {readonly x: number; readonly y: number}): void {
    const from = ghostAt(at);
    const duration = motionMs("--motion-base");
    const first = props.drag?.sources[0];
    if (from === null || duration <= 0 || root.value === null || first === undefined) return;
    const element = root.value.querySelector<HTMLElement>(`[data-explorer-row="${CSS.escape(first)}"]`);
    const rect = element?.getBoundingClientRect();
    const depth = props.rows.find((row) => row.id === first)?.depth ?? 0;
    const to = rect === undefined ? {x: from.x, y: from.y} : {x: rect.left + LEVEL_X(depth) + 12, y: rect.top};
    returning.value = {what: from.what, x: from.x, y: from.y, flying: false};
    void nextTick(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        if (returning.value !== null) returning.value = {...returning.value, ...to, flying: true};
    })));
    if (returnTimer !== null) clearTimeout(returnTimer);
    returnTimer = setTimeout(() => {
        returning.value = null;
        returnTimer = null;
    }, Math.max(duration * 2, motionMs("--motion-move")) + MOTION_SLACK_MS);
}

// 控制器结束了这场拖动（切换显示、源或落点失效）：手势随之收场。
watch(() => props.drag == null, (ended) => {
    if (ended) gesture.value?.abort();
});
// 行变了而指针没动：指针下已经不是显示的那一行，撤下落点。
watch(() => props.rows, () => gesture.value?.invalidate());

/** 树外的落点：反馈归工作台画（矩形、插入线、分区与读屏），这里只报它。放下、取消、离开都是下面这个 `null`。 */
let shownHost: WorkbenchFileDropHost | null = null;
watch(() => {
    const over = hovered.value?.over;
    return props.drag?.action.kind === "open" && over?.kind === "editor" ? over : null;
}, (next) => {
    if (shownHost !== null && shownHost !== next?.host) shownHost.show(null);
    shownHost = next?.host ?? null;
    shownHost?.show(next?.drop ?? null);
}, {flush: "sync"});
onBeforeUnmount(() => shownHost?.show(null));

/** 缩进：与 `ExplorerRow` 的行内边距一致，第 d 层展开箭头的中线在行左边 16 + 12d 处。 */
const LEVEL_X = (depth: number): number => 16 + depth * 12;

/** 一行与它展开的全部子孙在行列表里占的范围（行内容坐标，与行的 `top` 同一坐标系）。 */
const bandOf = (id: string): {readonly top: number; readonly height: number} | null => {
    const first = props.rows.findIndex((row) => row.id === id);
    if (first < 0) return null;
    const depth = (props.rows[first] as Row).depth;
    let last = first;
    while (last + 1 < props.rows.length && (props.rows[last + 1] as Row).depth > depth) last += 1;
    return {top: first * rowHeight.value, height: (last - first + 1) * rowHeight.value};
};

/**
 * 树里的落点反馈（docs/specs/workbench/files-explorer.md 的“拖动”）：画在行的坐标系里，跟着行滚动、与行左右对齐。移入画
 * 目标目录的整段浅底、目录行再深一档；调整顺序与放到某个位置画缩进到落点那一层的插入线，接收目录的整段铺很浅的底。
 */
const dropMarks = computed(() => {
    const action = props.drag?.action;
    if (action === undefined || hovered.value === null) return null;
    if (action.kind === "move") {
        const band = bandOf(action.target);
        return band === null ? null : {kind: action.kind, band, header: {top: band.top, height: rowHeight.value}, line: null};
    }
    if (action.kind === "reorder" || action.kind === "place") {
        const under = props.rows.findIndex((row) => row.id === action.line.row);
        if (under < 0) return null;
        const band = bandOf(action.kind === "reorder" ? action.parent : action.target);
        return {kind: action.kind, band, header: null, line: {top: (under + 1) * rowHeight.value, left: LEVEL_X(action.line.depth)}};
    }
    return null;
});

const nameOfRow = (id: string): string => {
    const row = props.rows.find((candidate) => candidate.id === id);
    if (row?.kind === "entry") return displayLabel(row, props.hideMarkdownExtension === true);
    if (row?.kind === "root") return row.scheme === "project" ? (props.projectTitle ?? text("tree.projectRoot")) : text("tree.userRoot");
    return id;
};

/** 跟着指针的说明：动作（移入哪里、放到谁的前后、在这一组打开）；没有落点时只写被拖的东西。 */
const dropLabel = computed(() => {
    const action = props.drag?.action;
    if (action === undefined || action.kind === "none") return "";
    if (action.kind === "open") return action.skipped > 0 ? text("tree.drop.openSome", {label: action.drop.label, skipped: action.skipped}) : action.drop.label;
    if (action.kind === "move") return text(action.ordered ? "tree.drop.intoLast" : "tree.drop.into", {name: nameOfRow(action.target)});
    const name = nameOfRow(action.anchor.id);
    // 换了接收目录（有源不在这一层）才说移入哪里。
    const into = action.kind === "place" && (props.drag?.sources ?? []).some((source) => parentOf(source) !== action.target);
    if (into) return text(action.anchor.side === "after" ? "tree.drop.afterInto" : "tree.drop.beforeInto", {name, target: nameOfRow(action.target)});
    return text(action.anchor.side === "after" ? "tree.drop.after" : "tree.drop.before", {name});
});
/** 行 id 的父目录：资源行带着；源都是资源行。 */
const parentOf = (id: string): string | null => {
    const row = props.rows.find((candidate) => candidate.id === id);
    return row?.kind === "entry" ? row.parent : null;
};

/** 拖影：指针右侧偏下的小浮块，写被拖的名字（多项写“N 项”）与动作；贴近指针，又不挡住指针所指那一行的名字开头。 */
const ghostAt = (at: {readonly x: number; readonly y: number}) => {
    const sources = props.drag?.sources;
    if (sources === undefined || sources.length === 0) return null;
    const what = sources.length === 1 ? nameOfRow(sources[0] as string) : text("tree.dragItems", {count: sources.length});
    return {x: at.x + 12, y: at.y + 4, what, action: dropLabel.value};
};
const ghost = computed(() => (pointer.value === null ? null : ghostAt(pointer.value)));

const dragSources = computed(() => new Set(props.drag?.sources ?? []));

defineExpose({focus: focusTree});
</script>

<template>
    <!-- 滚动条叠在树上、不占宽度（docs/specs/workbench/views.md 输出 12）：树本身是滚动元素，滚动条是它的兄弟。 -->
    <div class="explorer-tree-host relative h-full min-h-0">
        <div
            ref="root"
            role="tree"
            tabindex="0"
            aria-multiselectable="true"
            :aria-label="label"
            :aria-activedescendant="activeDescendant"
            class="explorer-tree relative h-full min-h-0 overflow-y-auto overflow-x-hidden outline-hidden"
            :style="{'--explorer-row-height': `${String(rowHeight)}px`, '--explorer-expand-delay': `${String(EXPAND_HOVER_MS)}ms`}"
            data-explorer-tree
            :data-motion="moving ? '' : undefined"
            :data-guides="indentGuides ?? 'hover'"
            @scroll="onScroll"
            @keydown="onKeydown"
            @focus="onFocus"
            @blur="onBlur"
        >
            <div ref="probe" class="nb-ui-control-h-sm pointer-events-none invisible absolute left-0 top-0 w-px" aria-hidden="true"></div>
            <TransitionGroup name="explorer-row" tag="div" class="explorer-tree__rows relative w-full" :style="{height: `${String(rows.length * rowHeight)}px`}" data-explorer-rows @before-leave="onRowLeave">
                <!-- 行左右留出视图外框给的内边距（nbook 是 6px）：悬停与选中的底色是圆角块，不贴着侧栏的边，块边与别的视图的内容边对齐。 -->
                <ExplorerRow
                    v-for="item in rendered"
                    :key="item.row.id"
                    class="explorer-tree__row absolute"
                    :style="{top: `${String(item.index * rowHeight)}px`, ...rowMotionStyle(item.row.id)}"
                    :row="item.row"
                    :project-title="projectTitle ?? null"
                    :dom-id="domId(item.row.id)"
                    :selected="selectedSet.has(item.row.id)"
                    :active="treeFocused && item.row.id === focus"
                    :height="rowHeight"
                    :edit="editing != null && editing.id === item.row.id ? editing : null"
                    :hide-markdown-extension="hideMarkdownExtension === true"
                    :guide-active="guideActiveAt(item.index)"
                    :data-explorer-drag-source="dragSources.has(item.row.id) ? '' : undefined"
                    :data-motion-moved="movedIds.has(item.row.id) ? '' : undefined"
                    :data-motion-glow="glowIds.has(item.row.id) ? '' : undefined"
                    :data-expand-pending="expandPending === item.row.id ? '' : undefined"
                    @edit-input="(name) => emit('edit-input', name)"
                    @edit-commit="emit('edit-commit')"
                    @edit-cancel="emit('edit-cancel')"
                    @press="(event, part) => press(item.row, event, part)"
                    @activate="(item.row.kind === 'root' || item.row.kind === 'entry') && emit('row-activate', item.row.id)"
                    @context="(event) => context(item.row, event)"
                    @retry="item.row.kind !== 'edit' && emit('retry', item.row.id)"
                />
            </TransitionGroup>
            <div
                v-if="dropMarks"
                class="explorer-drop pointer-events-none absolute top-0"
                aria-hidden="true"
                :data-explorer-drop="dropMarks.kind"
            >
                <div v-if="dropMarks.band" class="explorer-drop__band" :data-kind="dropMarks.kind" :style="{top: `${dropMarks.band.top}px`, height: `${dropMarks.band.height}px`}" data-explorer-drop-band></div>
                <div v-if="dropMarks.header" class="explorer-drop__header" :style="{top: `${dropMarks.header.top}px`, height: `${dropMarks.header.height}px`}"></div>
                <div v-if="dropMarks.line" class="explorer-drop__line" :style="{top: `${dropMarks.line.top - 1}px`, left: `${dropMarks.line.left}px`}" data-explorer-drop-line></div>
            </div>
            <Teleport to="body">
                <div v-if="ghost" class="explorer-drag-ghost" :style="{left: `${ghost.x}px`, top: `${ghost.y}px`}" aria-hidden="true" data-explorer-drag-ghost>
                    <div class="truncate font-medium">{{ ghost.what }}</div>
                    <div v-if="ghost.action" class="truncate text-[var(--text-muted)]" data-explorer-drag-action>{{ ghost.action }}</div>
                </div>
                <div
                    v-if="returning"
                    class="explorer-drag-ghost explorer-drag-ghost--returning"
                    :data-flying="returning.flying ? '' : undefined"
                    :style="{left: `${returning.x}px`, top: `${returning.y}px`}"
                    aria-hidden="true"
                    data-explorer-drag-return
                >
                    <div class="truncate font-medium">{{ returning.what }}</div>
                </div>
                <!-- 读屏播报落点动作：反馈层自己的标签不用（说明画在拖影里），播报放在这里。 -->
                <span class="explorer-drag-live" aria-live="polite" aria-atomic="true" data-explorer-drop-live>{{ drag ? dropLabel : "" }}</span>
            </Teleport>
        </div>
        <OverlayScrollbar :target="root" />
    </div>
</template>

<style scoped>
/* 宽度由左右两边定：行组件根上的 `w-full` 会让右边越出 6px，压进滚动条的槽位被裁掉。 */
.explorer-tree__row {
    left: var(--view-inset-inline, 6px);
    right: var(--view-inset-inline, 6px);
    width: auto;
}

.explorer-tree[data-explorer-dragging] {
    cursor: grabbing;
}

/* 被拖的行淡化图标与文字，看得出拖走的是哪几行；缩进参考线不淡，竖线上不留缺口。起拖与结束时渐变。 */
.explorer-tree__row > :deep(:not(.explorer-guide)) {
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.explorer-tree__row[data-explorer-drag-source] > :deep(:not(.explorer-guide)) {
    opacity: 0.45;
}

/*
 * 落点反馈与行同一坐标系：浅底在行的下面（不压字），插入线在行的上面。行容器是 z-index 1 的层，反馈层不建层，浅底 0、
 * 插入线 2 与它比较。这些层级只在树里比：树自成层叠上下文，否则行会盖住挂在 body 上、没有 z-index 的菜单与浮层。
 */
.explorer-tree {
    isolation: isolate;
}

.explorer-tree__rows {
    z-index: 1;
}

.explorer-drop {
    left: var(--view-inset-inline, 6px);
    right: var(--view-inset-inline, 6px);
}

.explorer-drop__band,
.explorer-drop__header {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 0;
    border-radius: var(--radius-control);
}

.explorer-drop__band {
    background: color-mix(in srgb, var(--accent-main) 9%, transparent);
}

/* 调整顺序与放到某个位置时，接收目录的浅底更浅：主角是插入线。 */
.explorer-drop__band:not([data-kind="move"]) {
    background: color-mix(in srgb, var(--accent-main) 7%, transparent);
}

.explorer-drop__header {
    background: color-mix(in srgb, var(--accent-main) 9%, transparent);
}

.explorer-drop__line {
    position: absolute;
    right: 0;
    z-index: 2;
    height: 2px;
    margin-left: 3px;
    border-radius: 999px;
    background: var(--accent-main);
}

/* 左端的空心圆标出层级：圆心在那一层展开箭头的中线上。 */
.explorer-drop__line::before {
    content: "";
    position: absolute;
    left: -7px;
    top: -3px;
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    border: 2px solid var(--accent-main);
    border-radius: 50%;
    background: var(--bg-panel, var(--bg-app));
}

.explorer-drag-live {
    position: fixed;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

/* 拖影：跟着指针、不挡指针下的命中，画在最上层。 */
.explorer-drag-ghost {
    position: fixed;
    z-index: 9500;
    max-width: 260px;
    padding: 4px 8px;
    border-radius: var(--radius-control);
    border: var(--border-w) solid var(--panel-outline);
    background: var(--bg-panel);
    box-shadow: var(--elevation-menu, var(--elevation-popover));
    color: var(--text-main);
    font-size: var(--text-xs);
    line-height: 1.5;
    pointer-events: none;
    animation: explorer-ghost-in var(--motion-fast) var(--ease-layout);
}

/* 起拖：拖影从略小放大并淡入。 */
@keyframes explorer-ghost-in {
    from {
        opacity: 0;
        transform: scale(0.96);
    }
}

/* 取消：拖影移回第一个源行，到了再淡出。 */
.explorer-drag-ghost--returning {
    animation: none;
}

.explorer-drag-ghost--returning[data-flying] {
    opacity: 0;
    transition: left var(--motion-move) var(--ease-layout), top var(--motion-move) var(--ease-layout), opacity var(--motion-fast) var(--ease-layout) var(--motion-base);
}

.explorer-tree[data-motion] .explorer-tree__row {
    transition: top var(--motion-move) var(--ease-layout), opacity var(--motion-base) var(--ease-layout), transform var(--motion-move) var(--ease-layout), background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}

/* 从原位置滑过来的行不放进场动画：它的起点是原位置，不是上方一行。 */
.explorer-tree[data-motion] .explorer-row-enter-from:not([data-motion-moved]),
.explorer-tree[data-motion] .explorer-row-leave-to {
    opacity: 0;
    transform: translateY(calc(-1 * var(--explorer-row-height)));
}

/* 放下、新建与粘贴后亮一下：盖一层强调色再淡去，不动行自己的底色（选中、悬停）。 */
.explorer-tree__row[data-motion-glow]::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--accent-main) 24%, transparent);
    pointer-events: none;
    opacity: 0;
    animation: explorer-glow calc(var(--motion-base) * 3) var(--ease-layout);
}

@keyframes explorer-glow {
    from {
        opacity: 1;
    }
    to {
        opacity: 0;
    }
}

/* 停留展开的计时里箭头匀速转到朝下，转完正好展开；计时取消时按箭头自己的过渡转回。 */
.explorer-tree__row[data-expand-pending] :deep([data-explorer-twisty] > span) {
    transform: rotate(90deg);
    transition: transform var(--explorer-expand-delay) linear;
}

/* 缩进参考线的显示（行里的 `.explorer-guide` 读这个变量）：悬停档在鼠标位于树上或树里有焦点时显示。 */
.explorer-tree[data-guides="always"],
.explorer-tree[data-guides="hover"]:hover,
.explorer-tree[data-guides="hover"]:focus-within {
    --explorer-guide-opacity: 1;
}

</style>
