<script setup lang="ts" generic="Row extends object">
import {computed, ref, watch} from "vue";

import {useUiText} from "../../text-port";
import {useDelayedVisibility} from "../../composables/useDelayedVisibility";
import Button from "../controls/Button.vue";
import Pagination from "../navigation/Pagination.vue";
import EmptyState from "./EmptyState.vue";
import Spinner from "./Spinner.vue";
import Table from "./Table.vue";
import type {TableColumn, TableDensity} from "./Table.vue";

// 带工具条与分页的数据表格：受控，只发事件。合同见同名 DataTable.md。
const props = withDefaults(defineProps<{
    columns: TableColumn<Row>[];
    rows: Row[];
    rowKey?: keyof Row & string;
    total: number | null;
    pageSize: number;
    loading?: boolean;
    error?: string;
    emptyText?: string;
    retryLabel?: string;
    density?: TableDensity;
}>(), {
    loading: false,
    density: "compact",
});

const page = defineModel<number>("page", {required: true});

const emit = defineEmits<{
    retry: [];
    "row-click": [row: Row, index: number];
}>();

// 插槽返回类型按 Vue 约定用 any；cell-<key> 与 Table 的同名插槽形状相同，原样转过去。
defineSlots<{
    filters?: () => any;
    actions?: () => any;
    empty?: () => any;
    count?: (props: {from: number; to: number; total: number | null}) => any;
} & {
    [name: `cell-${string}`]: (props: {row: Row; value: unknown; index: number}) => any;
}>();

const text = useUiText();

/**
 * 加载指示延时出现、出现后停够最短时长（frontend.md 的“加载态延时显示”）。
 * 判据是请求飞出去以后已经等过这么久，所以从 loading 变真算起，不看屏幕上有没有行。
 */
const loadingVisible = useDelayedVisibility(() => props.loading);

const pageCount = computed(() => (props.total === null || props.total <= 0 ? 1 : Math.ceil(props.total / props.pageSize)));
/** 分页条自己会把越界的页码夹到边界显示，条数的起点按同一个夹过的值算，两边对得上。 */
const shownPage = computed(() => Math.min(Math.max(Math.round(page.value) || 1, 1), pageCount.value));
/*
 * 区间按这一页实际拿到的行算，不按页码乘每页条数：页码越界、这一页没有行时（例如删掉了最后一页的唯一一行），
 * 按页码算会写出“第 61 到 65 条”，表格区却是空的。没有行时 from、to 都是 0，页脚只写总数。
 */
const range = computed(() => {
    const total = props.total;
    if (total === null || total <= 0 || props.rows.length === 0) return {from: 0, to: 0, total};
    const from = (shownPage.value - 1) * props.pageSize + 1;
    return {from, to: Math.min(total, from + props.rows.length - 1), total};
});

/*
 * 表格区里的内容。出错优先：出错时就算还有旧行也不显示，免得原因与旧数据并排、看不出哪个是现在的。
 * 没有行又在加载是首次加载（或换筛选时使用方清掉了旧行）；不在加载、没有行就是空。
 */
type BodyState = "error" | "initial" | "empty" | "rows";
const bodyState = computed<BodyState>(() => {
    if (props.error) return "error";
    if (props.rows.length === 0) return props.loading ? "initial" : "empty";
    if (props.total === 0) return "empty";
    return "rows";
});

/** 盖在表格区上的那一层；首次加载与翻页加载都要等延时过了才出现。 */
type Layer = "error" | "spinner" | "empty" | "mask" | null;
const layer = computed<Layer>(() => {
    switch (bodyState.value) {
        case "error": return "error";
        case "empty": return "empty";
        case "initial": return loadingVisible.value ? "spinner" : null;
        case "rows": return loadingVisible.value ? "mask" : null;
    }
    return null;
});

const tableRows = computed(() => (bodyState.value === "rows" ? props.rows : []));
const paginationDisabled = computed(() => props.total === null || props.total <= 0);
const loadingText = computed(() => text("spinner.loading"));

/**
 * 翻页加载时旧行被遮罩盖着，这时行不可交互：键盘也走不到被盖住的行内按钮。
 * 加载完、遮罩还在停最短时长时，底下已经是新行，不再挡操作（设计语言“动效的行为”第 2 条的同一个道理）。
 */
const rowsInert = computed(() => layer.value === "mask" && props.loading);

const bodyRef = ref<HTMLElement | null>(null);
/*
 * 新的一批行到了就回到顶部：Table 的根是滚动容器，也是表格区的第一个子元素。按 rows 的引用判断，不按页码：
 * 换筛选时页码不变也要回顶；翻页加载期间旧行留着、引用没变，不会先跳一下。
 */
watch(() => props.rows, () => {
    const scroller = bodyRef.value?.firstElementChild;
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
}, {flush: "post"});

/*
 * 焦点在表格区里、表格区换了内容以后没地方落时，接到表格区自己身上（tabindex="-1"），不让它掉回 body：
 * 点了“重试”，出错层随之离场；遮罩盖上来，行变成 inert；行换了一批，焦点所在的行内按钮被移走。
 * 离场的层在过渡期间还在文档里、焦点也还在里面，所以层换了就算没地方落，不等它被移除。
 * pre 在换内容之前记下焦点在哪，post 在换完之后判断。焦点原本不在表格区里时不动焦点。
 */
let focusBefore: {element: Element; inLayer: boolean} | null = null;
watch([layer, tableRows], () => {
    const body = bodyRef.value;
    const active = document.activeElement;
    focusBefore = body && active && active !== body && body.contains(active)
        ? {element: active, inLayer: active.closest(".nb-data-table-layer") !== null}
        : null;
}, {flush: "pre"});
watch([layer, tableRows], ([nextLayer], [previousLayer]) => {
    const before = focusBefore;
    focusBefore = null;
    if (!before) return;
    const lost = document.activeElement !== before.element
        || before.element.closest("[inert]") !== null
        || (before.inLayer && nextLayer !== previousLayer);
    if (lost) bodyRef.value?.focus({preventScroll: true});
}, {flush: "post"});
</script>

<template>
    <div class="nb-data-table">
        <div class="nb-data-table-bar">
            <div class="nb-data-table-bar-start"><slot name="filters" /></div>
            <div class="nb-data-table-bar-end"><slot name="actions" /></div>
        </div>
        <div ref="bodyRef" class="nb-data-table-body" tabindex="-1" :aria-busy="props.loading ? 'true' : undefined">
            <Table
                sticky-header
                nowrap
                :inert="rowsInert || undefined"
                :columns="props.columns"
                :rows="tableRows"
                :row-key="props.rowKey"
                :density="props.density"
                @row-click="(row, index) => emit('row-click', row, index)"
            >
                <template #empty><span /></template>
                <template v-for="column in props.columns" :key="column.key" #[`cell-${column.key}`]="cell">
                    <slot :name="`cell-${column.key}`" v-bind="cell">{{ cell.value }}</slot>
                </template>
            </Table>
            <Transition name="nb-data-table-layer">
                <div v-if="layer" :key="layer" class="nb-data-table-layer" :class="`is-${layer}`">
                    <div v-if="layer === 'error'" role="alert" class="nb-data-table-state">
                        <EmptyState :title="props.error">
                            <template #icon><span class="i-lucide-circle-alert h-5 w-5 text-[var(--status-danger)]" aria-hidden="true" /></template>
                            <template #action>
                                <Button variant="secondary" size="sm" @click="emit('retry')">{{ props.retryLabel ?? text('dataTable.retry') }}</Button>
                            </template>
                        </EmptyState>
                    </div>
                    <div v-else-if="layer === 'empty'" class="nb-data-table-state">
                        <slot name="empty"><EmptyState :title="props.emptyText ?? text('table.empty')" /></slot>
                    </div>
                    <Spinner v-else-if="layer === 'spinner'" show-label :label="loadingText" />
                    <span v-else class="sr-only" role="status">{{ loadingText }}</span>
                </div>
            </Transition>
        </div>
        <div class="nb-data-table-foot">
            <span class="nb-data-table-count">
                <slot name="count" v-bind="range">
                    <template v-if="range.total === null">{{ text("dataTable.countUnknown") }}</template>
                    <template v-else-if="range.from === 0">{{ text("dataTable.countTotal", {total: range.total}) }}</template>
                    <template v-else>
                        <span class="nb-data-table-count-full">{{ text("dataTable.count", {from: range.from, to: range.to, total: range.total}) }}</span>
                        <span class="nb-data-table-count-short">{{ text("dataTable.countTotal", {total: range.total}) }}</span>
                    </template>
                </slot>
            </span>
            <Pagination v-model="page" class="nb-data-table-pager" :page-count="pageCount" :disabled="paginationDisabled" />
        </div>
    </div>
</template>

<style scoped>
/*
 * 三块的高度在各种状态下都不变：工具条与页脚 flex: none，表格区 flex: 1 占满剩下的高度，
 * 状态只换表格区里面的内容（DataTable.md 的“布局”“状态”）。
 * 根上的高度、底色与圆角是 scoped 样式，不在层里，使用方传的原子类压不过它们（DataTable.md 的“注意事项”）。
 */
.nb-data-table {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
}

/*
 * 工具条与页脚都至少一行 48px，放不下时换行，高度随宽度变，不随状态变。
 * 显式 border-box：nb-ui 不带 reset，宿主没有全局 border-box 时，最小高度加上内边距会多出一截。
 */
.nb-data-table-bar,
.nb-data-table-foot {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    box-sizing: border-box;
    gap: var(--space-5);
    min-height: 48px;
    padding: var(--space-3) calc(var(--space-5) + var(--space-1));
}

.nb-data-table-bar-start,
.nb-data-table-bar-end {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.nb-data-table-bar-end {
    margin-left: auto;
}

/*
 * 页脚一行放得下条数与分页条时就是一行；放不下时条数一行、分页条一行（靠右），不截断条数。
 * 是否折行只看页脚自己拿到的宽度（flex 换行），容器查询也设在页脚上而不是根上：
 * 根设了 inline-size 容器，放进 flex 行或按内容定宽的上下文时宽度会塌成 0。
 */
.nb-data-table-foot {
    row-gap: var(--space-2);
    container-type: inline-size;
    user-select: none;
}

.nb-data-table-pager {
    margin-left: auto;
}

/* 程序接住焦点用的容器（tabindex="-1"），不是可操作的控件，不画焦点环。 */
.nb-data-table-body {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0 var(--space-4);
    outline: none;
}

.nb-data-table-layer {
    position: absolute;
    inset: 0;
    display: flex;
}

/* 用自动外边距居中而不是 grid 居中：内容比表格区高时自动外边距归零，从顶部排起，而不是两头都溢出去。 */
.nb-data-table-layer > * {
    margin: auto;
}

/* 居中的状态不挡住表头与滚动条，只有里面的内容可点；遮罩整块挡住，加载期间点不到旧行。 */
.nb-data-table-layer:not(.is-mask) {
    pointer-events: none;
}

.nb-data-table-layer:not(.is-mask) > * {
    pointer-events: auto;
}

.nb-data-table-layer.is-mask {
    background: color-mix(in srgb, var(--bg-panel) 55%, transparent);
}

/* 容器矮、状态比表格区高时在自己里面滚动，不越过表格区盖住页脚。 */
.nb-data-table-state {
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    max-height: 100%;
    overflow: auto;
}

.nb-data-table-layer-enter-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}

.nb-data-table-layer-leave-active {
    transition: opacity var(--motion-fast) var(--ease-dialog-leave);
}

.nb-data-table-layer-enter-from,
.nb-data-table-layer-leave-to {
    opacity: 0;
}

/*
 * 条数是读数，翻页时整段换掉、不做过渡；等宽数字让位数相同的页之间宽度不跳。
 * 不加省略号：截断的总数读起来像另一个数。放不下时由页脚折行，不由它收窄。
 */
.nb-data-table-count {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.nb-data-table-count-short {
    display: none;
}

@container (width < 480px) {
    .nb-data-table-count-full {
        display: none;
    }

    .nb-data-table-count-short {
        display: inline;
    }
}
</style>
