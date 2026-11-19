<script setup lang="ts">
/**
 * 侧栏“剧情”（docs/specs/plot/author-ui.md 输出 1）：“表”下面三张表，“剧情线”下面是种类为“剧情线”的条目。受控：剧情线与选中的那张表
 * 由宿主给，点了发事件。
 */
import type {AuthorName} from "../../core/author/knowing";
import {TABLE_TITLES} from "../pages";
import type {PlotTable} from "../pages";
import {usePlotText} from "../text";

const props = withDefaults(defineProps<{
    /** 窗口没有绑定项目。 */
    unbound?: boolean;
    /** 剧情线的条目 id，按条目树的顺序；还没读到时为 null。 */
    lines?: readonly string[] | null;
    names?: Readonly<Record<string, AuthorName>>;
    /** 最后显示出来的那张表。 */
    active?: PlotTable | null;
}>(), {unbound: false, lines: null, names: () => ({}), active: null});

const emit = defineEmits<{
    (event: "table", table: PlotTable): void;
    (event: "line", id: string): void;
}>();

const text = usePlotText();
const TABLES: readonly PlotTable[] = ["secrets", "ledger", "goals"];
const itemClass = (selected: boolean): string => `w-full truncate rounded-[var(--radius-control)] px-2 py-1 text-left text-[length:var(--text-sm)] ${selected ? "bg-[var(--bg-selected)] text-[var(--text-main)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`;
</script>

<template>
    <div class="flex flex-col gap-4 px-2 py-2" data-plot-sidebar>
        <p v-if="props.unbound" class="px-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("page.unbound") }}</p>
        <template v-else>
            <section :aria-label="text('sidebar.tables')">
                <h3 class="px-2 pb-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("sidebar.tables") }}</h3>
                <ul>
                    <li v-for="table in TABLES" :key="table">
                        <button type="button" :class="itemClass(props.active === table)" :aria-current="props.active === table ? 'page' : undefined" @click="emit('table', table)">{{ text(TABLE_TITLES[table]) }}</button>
                    </li>
                </ul>
            </section>
            <section :aria-label="text('sidebar.lines')">
                <h3 class="px-2 pb-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("sidebar.lines") }}</h3>
                <p v-if="props.lines !== null && props.lines.length === 0" class="px-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("sidebar.noLines") }}</p>
                <ul v-else-if="props.lines !== null">
                    <li v-for="line in props.lines" :key="line">
                        <button type="button" :class="itemClass(false)" @click="emit('line', line)">{{ props.names[line]?.name ?? line }}</button>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>
