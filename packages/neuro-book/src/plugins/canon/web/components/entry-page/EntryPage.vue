<script setup lang="ts">
/**
 * 条目页的骨架（docs/specs/canon/author-ui.md 输出 6 到 9、27）：页头、几行状态说明、分页条；分页的内容由宿主放进默认插槽。
 * 受控：位置、“按计划”、当前分页都由宿主给，交互时发出新值。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch} from "vue";

import {Button, ContextMenu, DropdownMenu, IconButton, Input, Tabs} from "@notnotype/nb-ui/components";
import type {ContextMenuItem, TabsItem} from "@notnotype/nb-ui/components";

import type {LineOption} from "../../../shared/reads";
import type {PositionChapter} from "../../positions";
import {useCanonText} from "../../text";
import EntryPageNav from "./EntryPageNav.vue";
import type {EntryTab} from "./entry-tabs";
import ViewPointPicker from "./ViewPointPicker.vue";
import WorldBanners from "./WorldBanners.vue";

export type EntryPageStatus = "loading" | "failed" | "missing" | "deleted" | "normal";

const props = withDefaults(defineProps<{
    status: EntryPageStatus;
    name?: string;
    summary?: string;
    /** 马甲条目的本体（输出 6 的“是谁：某某”）。 */
    sameAs?: {readonly id: string; readonly name: string} | null;
    /** “在看”菜单里的章（`positions.ts` 的 `positionChapters`）；没有章时剧情进度只有“最初”。 */
    chapters?: readonly PositionChapter[];
    /** 位置选择的值（`positions.ts` 的 `positionValue`）。 */
    position?: string;
    planned?: boolean;
    /** 作品里有计划中的情节：时间点里才出“算上计划中的情节”，没有章时也要出时间点（输出 7）。默认 false。 */
    canPlan?: boolean;
    /** 页头的写入在途：别名的加与去暂不可用（不吞掉点击）。默认 false。 */
    busy?: boolean;
    /** 在所选位置上还没出场（输出 8）。 */
    notAppeared?: boolean;
    /** 选过的那一章被删掉了，位置已经回到缺省（输出 7）。 */
    positionGone?: boolean;
    disconnected?: boolean;
    /** 世界只读的原因（输出 28）；可以写时为空。 */
    readOnly?: string;
    /** 分页：设定组与文字一段、看法一段（输出 9）。 */
    tabs?: readonly EntryTab[];
    /** 能加的设定组（适用的在前，去掉过的写“恢复”）：右键菜单的下一级；空时不出“＋”。默认空。 */
    addable?: readonly {readonly value: string; readonly label: string}[];
    tab?: string;
    /** 页头“更多”里的“删除条目”可用（输出 19）；写不了时不可用。 */
    deletable?: boolean;
    /** 可选的线（输出 34）；只有主线时“在看”不提线。 */
    lineOptions?: readonly LineOption[];
    /** 窗口在看的线；空串是按章节自动。 */
    line?: string;
    /** 这一页按自己的位置实际读的线。 */
    resolvedLine?: string;
    /** 页头的写入入口（名字、简介、别名、移动、加或去设定组、恢复）都出；默认 false。 */
    editable?: boolean;
    /** 写入入口现在不可用的原因（按计划开着、世界只读、别人独占）：入口禁用、悬停提示是它。默认空（可用）。 */
    editReason?: string;
    /** 读取位置上的别名。 */
    aliases?: readonly string[];
    /** 当前是一个数据分页时，这组设定的名字：“更多”里多一项“去掉这组设定”。默认空。 */
    removableGroup?: string;
    /** 位置、线与“按计划”现在不能换的原因（有没提交的主文字，输出 46）：“在看”不可用、悬停提示是它。默认空（能换）。 */
    positionLocked?: string;
    /** 要两栏的宽度（主文字开着预览，输出 48）：滚动区放得下两栏时页头与内容列放宽。默认 false。 */
    wide?: boolean;
    /** 设定组分页的几种看法（输出 54），第一个是缺省；空时分页上没有看法菜单。默认空。 */
    looks?: readonly {readonly value: string; readonly label: string}[];
    /** 选中的那一页现在的看法（`looks` 里的值）。默认空串（缺省的那个）。 */
    look?: string;
}>(), {looks: () => [], look: "", wide: false, positionLocked: "", deletable: false, name: "", summary: "", sameAs: null, chapters: () => [], position: "", planned: false, notAppeared: false, positionGone: false, disconnected: false, readOnly: "", tabs: () => [], tab: "", lineOptions: () => [], line: "", resolvedLine: "main", canPlan: false, busy: false, addable: () => [], editable: false, editReason: "", aliases: () => [], removableGroup: ""});

const emit = defineEmits<{
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
    (event: "update:tab", value: string): void;
    (event: "update:line", value: string): void;
    (event: "open-entry", id: string): void;
    (event: "retry"): void;
    /** 选了“更多”里的“删除条目”。 */
    (event: "delete"): void;
    /** 点了名字、简介：宿主在这个元素上打开就地改的浮层（输出 38）。 */
    (event: "edit-name", anchor: HTMLElement): void;
    (event: "edit-summary", anchor: HTMLElement): void;
    /** 加一个别名（输入框里回车）或去掉一个（标签上的 ×）。 */
    (event: "aliases", change: {readonly add?: readonly string[]; readonly remove?: readonly string[]}): void;
    /** “更多”里的“移动到……”“添加一组设定……”“去掉这组设定”。 */
    (event: "move"): void;
    /** 选了右键菜单里的一组设定：宿主直接加上（输出 38）。 */
    (event: "add-component", type: string): void;
    /** 右键菜单打开了：宿主记下这时条目的版本，加的时候带它（输出 43）。 */
    (event: "add-open"): void;
    /** 点了“＋”或竖排的“添加一组设定”：宿主开“添加设定组”的对话框（输出 38，`AddComponentDialog`）。 */
    (event: "add-dialog"): void;
    (event: "remove-component"): void;
    /** 已删除页上的“恢复”。 */
    (event: "restore"): void;
    /** 在看法菜单（选中的分页上的箭头，或分页的右键菜单）里选了一种看法。 */
    (event: "update:look", value: string): void;
}>();

defineSlots<{
    /** 当前分页的内容。 */
    default?(): unknown;
    /** 页头之下、分页内容之上：确认条（各分页共用这一处）。 */
    bar?(): unknown;
    /** 条目已删除时，“已删除”与恢复按钮下面：这个条目还留着的没提交的主文字。 */
    deleted?(): unknown;
}>();

const blockedReason = computed(() => (props.editReason === "" ? undefined : props.editReason));
/** “在看”有得选才出：有章（不止“最初”一个位置）、作品里有计划，或不止一条线（设计语言“此刻没用的，就不出现”）。 */
const showViewPoint = computed(() => props.chapters.length > 0 || props.canPlan || props.lineOptions.length > 1);
const menuItems = computed(() => [
    ...(props.editable
        ? [
              {id: "move", label: text("entry.moveTo"), iconClass: "i-lucide-folder-input", disabled: blockedReason.value !== undefined},
              ...(props.removableGroup === "" ? [] : [{id: "remove-component", label: text("entry.removeComponent", {name: props.removableGroup}), iconClass: "i-lucide-minus", disabled: blockedReason.value !== undefined}]),
              {id: "sep-delete", label: "", separator: true},
          ]
        : []),
    {id: "delete", label: text("entry.delete"), iconClass: "i-lucide-trash-2", tone: "danger" as const, disabled: !props.deletable},
]);
const onMenu = (id: string): void => {
    if (id === "delete") emit("delete");
    else if (id === "move") emit("move");
    else if (id === "remove-component") emit("remove-component");
};

/* ---------- 分页：横排或竖排、“＋”、右键菜单（输出 9、38） ---------- */

/** 横排的项：第一个看法前画一条分隔（`data-segment-start`）；能换看法的带菜单，选中的那一页不在缺省看法时写看法名。 */
const tabItems = computed<TabsItem[]>(() => {
    const firstView = props.tabs.findIndex((item) => item.segment === "view");
    return props.tabs.map((item, index) => ({
        value: item.value,
        label: item.label,
        iconClass: item.iconClass,
        id: tabId(item.value),
        controls: PANEL_ID,
        ...(item.count === undefined ? {} : {count: item.count}),
        ...(index === firstView && index > 0 ? {attrs: {"data-segment-start": ""}} : {}),
        ...(hasLooks(item) ? {menu: {open: lookMenu.value?.value === item.value}} : {}),
        ...(hasLooks(item) && item.value === props.tab && lookNote.value !== "" ? {note: lookNote.value} : {}),
    }));
});

/* ---------- 看法菜单（输出 9、54） ---------- */

const hasLooks = (item: EntryTab): boolean => item.looks === true && props.looks.length > 0;
/** 不在缺省看法（第一个）时写在分页上的看法名。 */
const lookNote = computed(() => (props.look === "" || props.look === props.looks[0]?.value ? "" : (props.looks.find((item) => item.value === props.look)?.label ?? "")));
/**
 * 看法菜单：贴着选中的分页（横排的标签或竖排那一行）开，归这一层，两种排法共用一个；与右键菜单各自一份状态，开一个时关另一个。
 * 菜单开着再点同一页是关（`ContextMenu` 的 `anchor` 不把这一下当成点外面）。换了选中的分页、换了排法时关上：锚已经不是它了。
 */
const lookMenu = shallowRef<{readonly value: string; readonly anchor: HTMLElement; readonly x: number; readonly y: number} | null>(null);
const toggleLookMenu = (value: string, anchor: HTMLElement): void => {
    if (lookMenu.value !== null) {
        lookMenu.value = null;
        return;
    }
    context.value = null;
    const box = anchor.getBoundingClientRect();
    lookMenu.value = {value, anchor, x: box.left, y: box.bottom + 4};
};
const lookItems = computed<ContextMenuItem[]>(() => props.looks.map((item) => ({label: item.label, type: "radio" as const, checked: item.value === (props.look === "" ? props.looks[0]?.value : props.look), action: () => emit("update:look", item.value)})));
/** 选了、Escape、Tab 关上时焦点回到选中的分页；点外面关上时焦点已经随作者落到别处，不抢回。 */
const closeLookMenu = (reason: "select" | "escape" | "tab" | "outside"): void => {
    lookMenu.value = null;
    if (reason !== "outside") void nextTick(() => document.getElementById(tabId(props.tab))?.focus());
};
const canAdd = computed(() => props.editable && props.addable.length > 0);

// 右键一页：先选中它，菜单里是“添加一组设定”（下一级列出能加的）与这一页是设定组时的“去掉这组设定”。
const context = shallowRef<{readonly value: string; readonly x: number; readonly y: number} | null>(null);
const openContext = (value: string, at: {readonly x: number; readonly y: number}): void => {
    if (!props.editable) return;
    emit("update:tab", value);
    lookMenu.value = null;
    context.value = {value, ...at};
    // 右键菜单里也有“添加一组设定”：同“＋”，打开时让宿主记下条目的版本。
    if (canAdd.value) emit("add-open");
};
const onStripContext = (event: MouseEvent): void => {
    const value = (event.target as Element | null)?.closest<HTMLElement>("[data-tab-value]")?.dataset.tabValue;
    if (value === undefined || !props.editable) return;
    event.preventDefault();
    openContext(value, {x: event.clientX, y: event.clientY});
};
const contextItems = computed<ContextMenuItem[]>(() => {
    const target = props.tabs.find((item) => item.value === context.value?.value);
    const disabled = blockedReason.value !== undefined;
    return [
        ...(canAdd.value ? [{label: text("entry.addComponentShort"), iconClass: "i-lucide-plus", disabled, ...(disabled ? {title: blockedReason.value} : {}), children: props.addable.map((item) => ({label: item.label, action: () => emit("add-component", item.value)}))}] : []),
        ...(target !== undefined && hasLooks(target) ? [...(canAdd.value ? [{separator: true}] : []), ...lookItems.value] : []),
        ...(target?.removable === true ? [{separator: true}, {label: text("entry.removeComponent", {name: target.label}), iconClass: "i-lucide-minus", disabled, ...(disabled ? {title: blockedReason.value} : {}), action: () => emit("remove-component")}] : []),
    ];
});

// 加别名：点“添加别名”出一个输入框，回车或失焦时非空就加上（已有的不再加），Escape 放弃。收起先于发出：回车以后输入框卸载
// 引起的失焦不再加一次。
const adding = ref(false);
const aliasDraft = ref("");
const aliasBox = ref<HTMLElement | null>(null);
const startAlias = async (): Promise<void> => {
    adding.value = true;
    aliasDraft.value = "";
    await nextTick();
    aliasBox.value?.querySelector("input")?.focus();
};
const commitAlias = (): void => {
    if (!adding.value) return;
    const alias = aliasDraft.value.trim();
    adding.value = false;
    if (alias !== "" && !props.aliases.includes(alias)) emit("aliases", {add: [alias]});
};
const cancelAlias = (): void => {
    adding.value = false;
};

/**
 * 量三个尺寸：页头吸顶时的高度、滚动区看得到的高度与宽度。前两个写成根上的 CSS 变量，给分页里要吸在页头下面的东西（主文字
 * 的预览栏，输出 48；竖排的分页）用；页头不吸顶（窄屏）时高度是 0。宽度决定分页竖排还是横排、`wide` 生不生效。滚动区是最近的会纵向滚动的上级（编辑区的
 * 页面容器），本组件只量它、不改它。
 */
const root = ref<HTMLElement | null>(null);
const header = ref<HTMLElement | null>(null);
const sticky = shallowRef({top: 0, viewport: 0, width: 0});
let scroller: HTMLElement | null = null;
let sizes: ResizeObserver | null = null;
const measure = (): void => {
    const head = header.value;
    const top = head !== null && getComputedStyle(head).position === "sticky" ? head.offsetHeight : 0;
    const viewport = scroller?.clientHeight ?? 0;
    const width = scroller?.clientWidth ?? 0;
    if (top !== sticky.value.top || viewport !== sticky.value.viewport || width !== sticky.value.width) sticky.value = {top, viewport, width};
};
const scrollParent = (from: HTMLElement): HTMLElement | null => {
    for (let element = from.parentElement; element !== null; element = element.parentElement) {
        const overflow = getComputedStyle(element).overflowY;
        if (overflow === "auto" || overflow === "scroll") return element;
    }
    return null;
};
onMounted(() => {
    if (root.value === null || typeof ResizeObserver === "undefined") return;
    scroller = scrollParent(root.value);
    sizes = new ResizeObserver(measure);
    if (scroller !== null) sizes.observe(scroller);
    // 先量一次：分页竖排还是横排在第一次画之前就定，不先画横排再跳成竖排。
    measure();
    if (header.value !== null) sizes.observe(header.value);
});
// 页头只在读到条目以后才有：出现、换掉时改量新的那个。
watch(header, (now, before) => {
    if (before !== null) sizes?.unobserve(before);
    if (now !== null) sizes?.observe(now);
    measure();
}, {flush: "post"});
onBeforeUnmount(() => sizes?.disconnect());
const stickyStyle = computed(() => ({"--entry-page-sticky-top": `${String(sticky.value.top)}px`, ...(sticky.value.viewport > 0 ? {"--entry-page-viewport": `${String(sticky.value.viewport)}px`} : {})}));
/**
 * 分页竖排（输出 9）：滚动区不窄于 1040 时换成内容左边的竖排，窄于 1024 时换回页头下面的横排，两个阈值之间保持原样，宽度在
 * 临界处抖动时不来回切。竖排时导航与间距（200 像素）算进列宽：页头跨整列，内容在导航右边，净宽仍是 760。
 */
const RAIL_ENTER = 1040;
const RAIL_LEAVE = 1024;
const RAIL_WIDTH = 200;
const railOn = ref(false);
watch(() => sticky.value.width, (width) => {
    if (width >= RAIL_ENTER) railOn.value = true;
    else if (width < RAIL_LEAVE) railOn.value = false;
}, {immediate: true});
/** 主文字要两栏（`wide`）而宽度放不下导航加两栏时，先让出导航：编辑时左右分屏比竖排的分页要紧。 */
const rail = computed(() => railOn.value && props.tabs.length > 0 && !(props.wide && sticky.value.width < 880 + 64 + RAIL_WIDTH));
/**
 * 滚动区不窄于这个宽度才放宽：内容列左右各 32 像素的内边距，里面的编辑视图要 880 像素才左右分屏（`EntryTextEditor` 的容器
 * 查询）；竖排时再加上导航。窄于它时放宽了也还是上下排，页头与内容白白变一次宽度。
 */
const wideMin = computed(() => 880 + 64 + (rail.value ? RAIL_WIDTH : 0));
const column = computed(() => ["entry-page__column", ...(rail.value ? ["entry-page__column--rail"] : []), ...(props.wide && sticky.value.width >= wideMin.value ? ["entry-page__column--wide"] : [])]);

const text = useCanonText();
// 同一窗口里可能挂着几个条目页（拆分以后），id 要各不相同。
const PANEL_ID = `canon-entry-panel-${useId()}`;
const tabId = (value: string): string => `${PANEL_ID}-tab-${value}`;

/**
 * 换分页的过渡（输出 9）：旧内容淡出，新内容从切换方向那一边挪进来 12 像素并淡入，不补间高度。往后切（列表里靠后的一页）从后方进来，
 * 往前切从前方；横排时沿横轴，竖排（`rail`）时沿纵轴。时长取令牌；减弱动效时不挪，只淡入淡出（下面的媒体块）。方向在换内容之前定（`flush: "pre"`）。
 */
const tabShift = shallowRef({x: 0, y: 0});
watch(() => props.tab, (now, before) => {
    const order = props.tabs.map((item) => item.value);
    const distance = 12 * Math.sign(order.indexOf(now) - order.indexOf(before));
    tabShift.value = rail.value ? {x: 0, y: distance} : {x: distance, y: 0};
}, {flush: "pre"});
const panelStyle = computed(() => ({"--entry-page-tab-x": `${String(tabShift.value.x)}px`, "--entry-page-tab-y": `${String(tabShift.value.y)}px`}));
/**
 * 新内容进来之前（旧的已经淡出、还没画新的）：滚过了分页条的，让新的一页从吸顶的页头下沿开始，不从半中间开始（输出 9）。
 * 这里一读位置，浏览器就按空着的分页排一次版：页面变矮，滚动位置先被夹回，现在的版式（分页内容之后没有别的东西）多半已经回到
 * 页头下沿；夹不回来的（分页后面还有内容、页面仍比视口高）由下面再滚。没滚过的不动。这时画面上没有内容，跳一下看不出来。
 */
const alignPanel = (): void => {
    const panel = document.getElementById(PANEL_ID);
    if (scroller === null || panel === null) return;
    const gap = panel.getBoundingClientRect().top - (scroller.getBoundingClientRect().top + sticky.value.top);
    if (gap < 0) scroller.scrollTop += gap;
};

watch([rail, () => props.tab], () => {
    lookMenu.value = null;
});
// 两种排法是两套元素：焦点在分页上时直接换会落到 body，换完把焦点放到新那套的选中项上（同一页，按 id 找）。
watch(rail, async () => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || root.value?.contains(focused) !== true || focused.closest("[role='tablist']") === null) return;
    await nextTick();
    document.getElementById(tabId(props.tab))?.focus();
}, {flush: "pre"});
</script>

<template>
    <article ref="root" class="min-h-full" :style="stickyStyle" :data-wide="props.wide ? '' : undefined" data-entry-page>
        <WorldBanners :disconnected="props.disconnected" :read-only="props.readOnly" @retry="emit('retry')" />
        <p v-if="props.status === 'loading'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-muted)]" role="status" aria-busy="true">{{ text("entries.loading") }}</p>
        <p v-else-if="props.status === 'failed'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ text("world.failed") }}</p>
        <p v-else-if="props.status === 'missing'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.missing") }}</p>
        <div v-else-if="props.status === 'deleted'" class="mx-auto max-w-[760px] px-8 py-6">
            <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-secondary)]">{{ props.name }}</h1>
            <p class="mt-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.deleted") }}</p>
            <Button variant="primary" v-if="props.editable" class="mt-3" size="sm" :disabled="blockedReason !== undefined" :title="blockedReason" data-entry-restore @click="emit('restore')">{{ text("entry.restore") }}</Button>
            <slot name="deleted" />
        </div>
        <template v-else>
            <!-- 窄屏上页头换成几行，吸顶会占掉大半个视口，只在宽屏吸顶。 -->
            <header ref="header" class="z-[1] border-b border-[var(--divider)] bg-[var(--panel-surface)] pt-5 min-[481px]:sticky min-[481px]:top-0">
                <div class="mx-auto flex flex-wrap items-start gap-x-4 gap-y-2" :class="column">
                    <div class="min-w-0 flex-1 basis-64">
                        <div class="flex flex-wrap items-baseline gap-x-2">
                            <!-- 名字、简介本身就是按钮：点了在原处出浮层改（输出 38）。浅底用负外边距，悬停与聚焦不挪字；铅笔一直占位、只换透明度。
                                 最大宽度要补上负外边距吃掉的 12 像素：h1 按按钮的外边距盒定宽，只写 max-w-full 时按钮比自己的内容窄 12 像素，名字一字一行。 -->
                            <h1 class="m-0 min-w-0 text-[length:var(--text-xl)] font-semibold text-[var(--text-main)]">
                                <button
                                    v-if="props.editable"
                                    type="button"
                                    class="entry-editable -mx-1.5 inline-flex max-w-[calc(100%_+_0.75rem)] items-center gap-1.5 px-1.5 text-left"
                                    :disabled="blockedReason !== undefined"
                                    :title="blockedReason"
                                    :aria-label="`${text('entry.editName')}：${props.name}`"
                                    data-edit="entry.name"
                                    @click="(event: MouseEvent) => emit('edit-name', event.currentTarget as HTMLElement)"
                                >
                                    <span class="min-w-0 break-words">{{ props.name }}</span><span class="entry-editable__pencil i-lucide-pencil size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                                </button>
                                <template v-else>{{ props.name }}</template>
                            </h1>
                            <span v-if="props.sameAs !== null" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                                {{ text("entry.sameAs") }}<button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open-entry', props.sameAs.id)">{{ props.sameAs.name }}</button>
                            </span>
                        </div>
                        <button
                            v-if="props.editable"
                            type="button"
                            class="entry-editable -mx-1.5 mt-1 flex max-w-[calc(100%_+_0.75rem)] items-center gap-1.5 px-1.5 text-left text-[length:var(--text-sm)]"
                            :class="props.summary === '' ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'"
                            :disabled="blockedReason !== undefined"
                            :title="blockedReason"
                            :aria-label="props.summary === '' ? text('entry.addSummary') : `${text('entry.editSummary')}：${props.summary}`"
                            data-edit="entry.summary"
                            @click="(event: MouseEvent) => emit('edit-summary', event.currentTarget as HTMLElement)"
                        >
                            <span class="min-w-0">{{ props.summary === "" ? text("entry.addSummary") : props.summary }}</span><span class="entry-editable__pencil i-lucide-pencil size-3 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                        </button>
                        <p v-else-if="props.summary !== ''" class="mt-1 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ props.summary }}</p>
                        <!-- 别名与“在看”一行：“在看”贴在内容上面，管的是下面这些值是哪一刻的（输出 7）。没得选时不出（只有“最初”、没有计划、只有主线）。 -->
                        <div v-if="props.aliases.length > 0 || props.editable || showViewPoint" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                            <ul v-if="props.aliases.length > 0 || props.editable" class="flex min-w-0 flex-wrap items-center gap-1.5" :aria-label="text('entry.aliases')" data-entry-aliases>
                                <li v-for="alias in props.aliases" :key="alias" class="flex h-6 items-center gap-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-subtle)] pl-2.5 pr-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                                    {{ alias }}
                                    <IconButton v-if="props.editable" size="xs" icon-class="i-lucide-x" :disabled="blockedReason !== undefined || props.busy" :aria-label="text('entry.removeAlias', {alias})" :title="blockedReason ?? text('entry.removeAlias', {alias})" @click="emit('aliases', {remove: [alias]})" />
                                </li>
                                <li v-if="props.editable" ref="aliasBox">
                                    <Input v-if="adding" v-model="aliasDraft" size="sm" class="w-32" :aria-label="text('entry.newAlias')" :placeholder="text('entry.newAlias')" @keydown.enter.prevent="commitAlias()" @keydown.escape.prevent="cancelAlias()" @blur="commitAlias()" />
                                    <Button v-else size="sm" variant="ghost" :disabled="blockedReason !== undefined || props.busy" :title="blockedReason" @click="startAlias()"><span class="i-lucide-plus size-3.5" aria-hidden="true" />{{ text("entry.addAlias") }}</Button>
                                </li>
                            </ul>
                            <ViewPointPicker
                                v-if="showViewPoint"
                                class="ml-auto max-[480px]:ml-0 max-[480px]:w-full"
                                :chapters="props.chapters"
                                :position="props.position"
                                :planned="props.planned"
                                :can-plan="props.canPlan"
                                :locked="props.positionLocked"
                                :not-appeared="props.notAppeared"
                                :position-gone="props.positionGone"
                                :line-options="props.lineOptions"
                                :line="props.line"
                                :resolved-line="props.resolvedLine"
                                @update:position="(value: string) => emit('update:position', value)"
                                @update:planned="(value: boolean) => emit('update:planned', value)"
                                @update:line="(value: string) => emit('update:line', value)"
                            />
                        </div>
                    </div>
                    <!-- 条目自己的“更多”，与名字同一行靠右。 -->
                    <div class="shrink-0">
                        <DropdownMenu align="end" :items="menuItems" @select="onMenu">
                            <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text('entry.more')" :title="text('entry.more')" />
                        </DropdownMenu>
                    </div>
                </div>
                <!-- 一组设定一个分页，分页会比一行多：放不下时分页条自己横向滚动，每页照旧写名字（触屏上没有悬停提示，只剩图标认不出是哪一页；author-ui 输出 9）。宽时换成内容左边的竖排。 -->
                <div v-if="!rail" class="mx-auto mt-3 flex items-end gap-1" :class="column" @contextmenu="onStripContext">
                    <Tabs class="entry-page__tabs min-w-0 flex-[0_1_auto]" size="sm" :baseline="false" :aria-label="text('entry.tabs.label')" :items="tabItems" :model-value="props.tab" @update:model-value="(value: string) => emit('update:tab', value)" @menu="toggleLookMenu" />
                    <!-- “＋”在分页条外面、紧跟着它：分页条里只能是分页（ARIA 的 tablist）。 -->
                    <IconButton
                        v-if="canAdd"
                        class="mb-1 shrink-0"
                        size="sm"
                        icon-class="i-lucide-plus"
                        :disabled="blockedReason !== undefined"
                        :aria-label="text('entry.addComponentShort')"
                        :title="blockedReason ?? text('entry.addComponentShort')"
                        aria-haspopup="dialog"
                        data-add-component
                        @click="emit('add-dialog')"
                    />
                </div>
                <div v-else class="h-4" />
            </header>
            <div class="mx-auto py-5" :class="[column, rail ? 'entry-page__body--rail' : '']">
                <EntryPageNav
                    v-if="rail"
                    class="entry-page__nav"
                    :items="props.tabs"
                    :model-value="props.tab"
                    :can-add="canAdd"
                    :add-reason="blockedReason ?? ''"
                    :tab-id="tabId"
                    :panel-id="PANEL_ID"
                    :menus="props.looks.length > 0"
                    :menu-open="lookMenu !== null"
                    :note="lookNote"
                    @update:model-value="(value: string) => emit('update:tab', value)"
                    @add-toggle="emit('add-dialog')"
                    @context="openContext"
                    @menu="toggleLookMenu"
                />
                <div class="min-w-0">
                    <slot name="bar" />
                    <div :id="PANEL_ID" role="tabpanel" :aria-labelledby="tabId(props.tab)" :style="panelStyle">
                        <Transition name="entry-page-tab" mode="out-in" @before-enter="alignPanel">
                            <div :key="props.tab" data-tab-content>
                                <slot />
                            </div>
                        </Transition>
                    </div>
                </div>
            </div>
        </template>
        <ContextMenu :open="context !== null" :x="context?.x ?? 0" :y="context?.y ?? 0" :items="contextItems" @update:open="(open: boolean) => open || (context = null)" />
        <ContextMenu :open="lookMenu !== null" :x="lookMenu?.x ?? 0" :y="lookMenu?.y ?? 0" :items="lookItems" :anchor="lookMenu?.anchor ?? null" @request-close="closeLookMenu" />
    </article>
</template>

<style scoped>
/*
 * 页头、分页条与内容列同一个上限，放宽时一起变（主文字左右分屏，输出 48）。放宽后内容列净宽 1496 像素，两栏各约 736，不超过
 * 一栏时的 760。上限的变化不加过渡：过渡的中途内容列会越过左右分屏的分界，版式在动画中间跳一下。
 */
/* 内边距放在列里面：页头、分页与内容左边对齐，内容净宽 760（人物分页的短资料两列排得开）。竖排时加上导航与间距。 */
.entry-page__column {
    --entry-page-rail: 0px;
    max-width: calc(760px + 64px + var(--entry-page-rail));
    padding-inline: 32px;
}
.entry-page__column--rail {
    --entry-page-rail: 200px;
}
.entry-page__column--wide {
    max-width: calc(1496px + 64px + var(--entry-page-rail));
}
.entry-page__body--rail {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    column-gap: 32px;
}
/* 换分页（输出 9）：退场只淡出，进场从切换方向那一边挪进来并淡入；减弱动效时只淡入淡出、不挪（Vue 的 Transition 仍隔两帧才换上，同 nb-ui-switch）。 */
.entry-page-tab-leave-active {
    transition: opacity var(--motion-fast) var(--ease-dialog-leave);
}
.entry-page-tab-enter-active {
    transition: opacity var(--motion-base) var(--ease-layout), transform var(--motion-base) var(--ease-layout);
}
.entry-page-tab-leave-to {
    opacity: 0;
}
.entry-page-tab-enter-from {
    opacity: 0;
    transform: translate(var(--entry-page-tab-x, 0px), var(--entry-page-tab-y, 0px));
}
@media (prefers-reduced-motion: reduce) {
    .entry-page-tab-enter-from {
        transform: none;
    }
}
/* 竖排的分页吸在页头下面，内容往下滚时它还在。 */
.entry-page__nav {
    position: sticky;
    top: calc(var(--entry-page-sticky-top, 0px) + 20px);
    align-self: start;
}
/* 横排的两段之间一条竖线，画在第一个看法的左边。 */
.entry-page__tabs :deep([data-segment-start]) {
    margin-left: 17px;
    position: relative;
}
.entry-page__tabs :deep([data-segment-start])::before {
    content: "";
    position: absolute;
    left: -9px;
    top: 30%;
    bottom: 30%;
    width: 1px;
    background: var(--divider);
}
@media (max-width: 480px) {
    .entry-page__column {
        padding-inline: 16px;
    }
}
.entry-editable {
    border-radius: var(--radius-control);
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.entry-editable:hover:not(:disabled),
.entry-editable:focus-visible {
    background: var(--bg-hover);
}
.entry-editable__pencil {
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.entry-editable:hover:not(:disabled) .entry-editable__pencil,
.entry-editable:focus-visible .entry-editable__pencil {
    opacity: 1;
}
</style>
