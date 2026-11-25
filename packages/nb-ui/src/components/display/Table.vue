<script setup lang="ts" generic="Row extends object">
import {computed} from "vue";
import type {HTMLAttributes} from "vue";

import {useUiText} from "../../text-port";
import Spinner from "../display/Spinner.vue";
import EmptyState from "../display/EmptyState.vue";

// 轻量数据表：列配置 + 行数据的展示型表格（排序、选择、分页交给消费方组合）。
// 单元格默认直接插值 row[column.key]，自定义渲染用具名插槽 `cell-<columnKey>`。
export type TableColumn<R> = {
    key: keyof R & string;
    label: string;
    /** CSS 宽度，如 "120px" / "20%"；缺省自动分配 */
    width?: string;
    align?: "left" | "center" | "right";
    /** 表格设了 nowrap 时这一列仍换行（长文本列）；nowrap 为假时没有作用 */
    wrap?: boolean;
};
export type TableDensity = "default" | "compact";

const props = withDefaults(defineProps<{
    columns: TableColumn<Row>[];
    rows: Row[];
    /** 行 key 字段；缺省退化为行下标（行会增删时建议提供） */
    rowKey?: keyof Row & string;
    loading?: boolean;
    emptyText?: string;
    /** 行悬停高亮 */
    hoverable?: boolean;
    density?: TableDensity;
    /** 表头吸顶：根承担两个方向的滚动并占满父容器的高度（Table.md 的“布局与状态”） */
    stickyHeader?: boolean;
    /** 单元格不换行，列宽按内容算、放不下时横向滚动；列可以用 wrap 例外（Table.md 的“布局与状态”） */
    nowrap?: boolean;
} & /* @vue-ignore */ HTMLAttributes>(), {
    loading: false,
    hoverable: true,
    density: "default",
    stickyHeader: false,
    nowrap: false,
});

const emit = defineEmits<{
    (e: "row-click", row: Row, index: number): void;
}>();

// 插槽返回类型按 Vue 约定用 any；value 因列名是运行时字符串无法静态求值，用 unknown
defineSlots<{
    empty?: () => any;
} & {
    [name: `cell-${string}`]: (props: {row: Row; value: unknown; index: number}) => any;
}>();

const text = useUiText();
const emptyTitle = computed(() => props.emptyText ?? text("table.empty"));

function rowKeyOf(row: Row, index: number): string {
    if (props.rowKey) {
        return String(row[props.rowKey]);
    }
    return String(index);
}

function alignClass(column: TableColumn<Row>): string {
    if (column.align === "right") {
        return "text-right";
    }
    if (column.align === "center") {
        return "text-center";
    }
    return "text-left";
}

/*
 * 吸顶只能贴在最近的滚动容器上：根一旦横向 overflow 就是滚动容器，外面再包一层竖向滚动，表头贴的是根而不是外层，
 * 所以吸顶时由根自己承担竖向滚动。border-collapse 下行的边框不跟着吸顶的单元格走，下边线改由表头单元格的内阴影画，
 * 表头那一行不再画边框，免得没滚动时叠成两条线。
 */
const STICKY_HEAD_CELL = "sticky top-0 z-[1] bg-[var(--bg-panel)] shadow-[inset_0_-1px_0_var(--border-color)]";

function cellPaddingClass(): string {
    return props.density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";
}

/* 不换行写在 Table 自己的单元格上，不由外层用穿透选择器加：那样会连插槽里使用方放的子表格一起改，也没法逐列关掉。 */
function wrapClass(column: TableColumn<Row>): string {
    return props.nowrap && !column.wrap ? "whitespace-nowrap" : "";
}
</script>

<template>
    <!-- 表格容器：窄屏横向滚动；吸顶时两个方向都在这里滚动 -->
    <div
        class="w-full"
        :class="props.stickyHeader ? 'h-full min-h-0 overflow-auto' : 'overflow-x-auto'"
    >
        <table class="w-full border-collapse text-sm">
            <thead>
                <tr :class="props.stickyHeader ? '' : 'border-b border-[var(--border-color)]'">
                    <th
                        v-for="column in props.columns"
                        :key="column.key"
                        scope="col"
                        class="whitespace-nowrap px-3 py-2 text-xs font-medium text-[var(--text-muted)]"
                        :class="[alignClass(column), props.stickyHeader ? STICKY_HEAD_CELL : '']"
                        :style="{width: column.width}"
                    >{{ column.label }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-if="props.loading">
                    <td :colspan="props.columns.length" class="px-3 py-10 text-center">
                        <Spinner show-label />
                    </td>
                </tr>
                <tr v-else-if="props.rows.length === 0">
                    <td :colspan="props.columns.length">
                        <slot name="empty">
                            <EmptyState :title="emptyTitle" />
                        </slot>
                    </td>
                </tr>
                <tr
                    v-else
                    v-for="(row, rowIndex) in props.rows"
                    :key="rowKeyOf(row, rowIndex)"
                    class="border-b border-[var(--border-color)] transition-colors last:border-b-0"
                    :class="props.hoverable ? 'hover:bg-[var(--bg-hover)]' : ''"
                    @click="emit('row-click', row, rowIndex)"
                >
                    <td v-for="column in props.columns" :key="column.key" class="text-[var(--text-secondary)]" :class="[alignClass(column), cellPaddingClass(), wrapClass(column)]">
                        <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]" :index="rowIndex">{{ row[column.key] }}</slot>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
