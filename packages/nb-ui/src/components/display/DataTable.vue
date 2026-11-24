<script setup lang="ts" generic="Row extends object">
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {useUiText} from "../../text-port";
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
 * 加载指示的延时（frontend.md 的“加载态延时显示”），单位毫秒。
 * 判据是请求飞出去以后已经等过这么久，所以从 loading 变真算起，不看屏幕上有没有行。
 */
const LOADING_DELAY = 200;

const loadingVisible = ref(false);
let loadingTimer: ReturnType<typeof setTimeout> | undefined;

function clearLoadingTimer(): void {
    if (loadingTimer !== undefined) clearTimeout(loadingTimer);
    loadingTimer = undefined;
}

watch(() => props.loading, (loading) => {
    clearLoadingTimer();
    if (!loading) {
        loadingVisible.value = false;
        return;
    }
    loadingTimer = setTimeout(() => {
        loadingTimer = undefined;
        loadingVisible.value = true;
    }, LOADING_DELAY);
}, {immediate: true});

onBeforeUnmount(clearLoadingTimer);

const pageCount = computed(() => (props.total === null || props.total <= 0 ? 1 : Math.ceil(props.total / props.pageSize)));
/** 分页条自己会把越界的页码夹到边界显示，条数按同一个夹过的值算，两边对得上。 */
const shownPage = computed(() => Math.min(Math.max(Math.round(page.value) || 1, 1), pageCount.value));
const range = computed(() => {
    const total = props.total;
    if (total === null || total <= 0) return {from: 0, to: 0, total};
    return {from: (shownPage.value - 1) * props.pageSize + 1, to: Math.min(total, shownPage.value * props.pageSize), total};
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
        case "rows": return props.loading && loadingVisible.value ? "mask" : null;
    }
    return null;
});

const tableRows = computed(() => (bodyState.value === "rows" ? props.rows : []));
const paginationDisabled = computed(() => props.total === null || props.total <= 0);
const loadingText = computed(() => text("spinner.loading"));

const bodyRef = ref<HTMLElement | null>(null);
// 翻页时表格区回到顶部：Table 的根是滚动容器，也是表格区的第一个子元素。
watch(page, () => {
    const scroller = bodyRef.value?.firstElementChild;
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
}, {flush: "post"});
</script>

<template>
    <div class="nb-data-table">
        <div class="nb-data-table-bar">
            <div class="nb-data-table-bar-start"><slot name="filters" /></div>
            <div class="nb-data-table-bar-end"><slot name="actions" /></div>
        </div>
        <div ref="bodyRef" class="nb-data-table-body" :aria-busy="props.loading ? 'true' : undefined">
            <Table
                sticky-header
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
                    <template v-else-if="range.total === 0">{{ text("dataTable.countTotal", {total: 0}) }}</template>
                    <template v-else>
                        <span class="nb-data-table-count-full">{{ text("dataTable.count", {from: range.from, to: range.to, total: range.total}) }}</span>
                        <span class="nb-data-table-count-short">{{ text("dataTable.countTotal", {total: range.total}) }}</span>
                    </template>
                </slot>
            </span>
            <Pagination v-model="page" :page-count="pageCount" :disabled="paginationDisabled" />
        </div>
    </div>
</template>

<style scoped>
/*
 * 三块的高度在各种状态下都不变：工具条与页脚 flex: none，表格区 flex: 1 占满剩下的高度，
 * 状态只换表格区里面的内容（DataTable.md 的“布局”“状态”）。容器查询按组件自己的宽度切条数的写法。
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
    container-type: inline-size;
}

.nb-data-table-bar,
.nb-data-table-foot {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-5);
    padding: 0 calc(var(--space-5) + var(--space-1));
}

/* 至少一行 48px；放不下时换行，高度随宽度变，不随状态变。 */
.nb-data-table-bar {
    flex-wrap: wrap;
    min-height: 48px;
    padding-block: var(--space-3);
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

.nb-data-table-foot {
    height: 48px;
    user-select: none;
}

.nb-data-table-body {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0 var(--space-4);
}

/*
 * Table 默认让单元格换行，窄容器里会把列挤到一字一行。数据表格要每行一样高、放不下时横向滚动（DataTable.md 的“布局”），
 * 所以在这里关掉换行；Table 自己的默认不变。
 */
.nb-data-table-body :deep(td) {
    white-space: nowrap;
}

.nb-data-table-layer {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
}

/* 居中的状态不挡住表头与滚动条，只有里面的按钮可点；遮罩整块挡住，加载期间点不到旧行。 */
.nb-data-table-layer:not(.is-mask) {
    pointer-events: none;
}

.nb-data-table-layer:not(.is-mask) > * {
    pointer-events: auto;
}

.nb-data-table-layer.is-mask {
    background: color-mix(in srgb, var(--bg-panel) 55%, transparent);
}

.nb-data-table-state {
    max-width: 100%;
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

/* 条数是读数，翻页时整段换掉、不做过渡；等宽数字让位数相同的页之间宽度不跳。 */
.nb-data-table-count {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
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
