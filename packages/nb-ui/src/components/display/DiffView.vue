<script setup lang="ts">
import {computed, ref, watch} from "vue";

import {diffRows, foldRows, hunkTexts} from "../../diff";
import type {DiffHunk, DiffPiece, DiffRow} from "../../diff";
import {useUiText} from "../../text-port";
import SegmentedControl from "../controls/SegmentedControl.vue";

const props = withDefaults(defineProps<{
    before: string;
    after: string;
    /** 标题行，例如文件路径。 */
    label?: string;
    /** 改动上下各留几行没变的内容。 */
    foldContext?: number;
}>(), {
    label: "",
    foldContext: 2,
});

defineSlots<{
    /** 每块改动末尾的动作。 */
    actions?: (scope: {hunk: DiffHunk; beforeText: string; afterText: string}) => unknown;
}>();

const mode = defineModel<"inline" | "split">("mode", {default: "inline"});

const text = useUiText();
const result = computed(() => diffRows(props.before, props.after));
const groups = computed(() => foldRows(result.value.rows, props.foldContext));
const unchanged = computed(() => result.value.hunks.length === 0);
const hunkScopes = computed(() => result.value.hunks.map((hunk) => ({hunk, ...hunkTexts(result.value.rows, hunk.index)})));
const modeOptions = computed(() => [
    {value: "inline", label: text("diffView.inline")},
    {value: "split", label: text("diffView.split")},
]);

// 展开状态只对这一份内容有效，内容变了行号就对不上了。
const openFolds = ref(new Set<number>());
const openRows = ref(new Set<number>());
watch(result, () => {
    openFolds.value = new Set();
    openRows.value = new Set();
});

/** 这一行是不是这块改动的最后一行：动作放在块的末尾。 */
function endsHunk(index: number): boolean {
    const row = result.value.rows[index]!;
    return row.hunk !== null && result.value.rows[index + 1]?.hunk !== row.hunk;
}

function piecesOf(row: DiffRow, side: "left" | "right", index: number): DiffPiece[] {
    const pieces = row[side] ?? [];
    return openRows.value.has(index) ? pieces.map(({text: pieceText, mark}) => ({text: pieceText, mark})) : pieces;
}
</script>

<template>
    <div class="nb-diff" :data-mode="mode">
        <div class="nb-diff__bar">
            <span v-if="props.label" class="nb-diff__label" :title="props.label">{{ props.label }}</span>
            <span v-if="unchanged" class="nb-diff__note">{{ text("diffView.unchanged") }}</span>
            <span v-else class="nb-diff__stat">
                <b class="nb-diff__added">+{{ result.stat.added }}</b>
                <b class="nb-diff__removed">−{{ result.stat.removed }}</b>
            </span>
            <span class="nb-diff__spacer" />
            <SegmentedControl v-model="mode" class="nb-diff__modes" size="xs" :options="modeOptions" :aria-label="text('diffView.mode')" />
        </div>
        <template v-for="group in groups" :key="group.start">
            <button
                v-if="group.type === 'fold' && !openFolds.has(group.start)"
                type="button"
                class="nb-diff__fold nb-ui-focus-ring-inset"
                @click="openFolds.add(group.start)"
            >
                {{ text("diffView.foldedLines", {count: group.rows.length}) }}
            </button>
            <template v-else>
                <template v-for="(row, offset) in group.rows" :key="group.start + offset">
                    <div class="nb-diff__row" :data-kind="row.kind">
                        <div v-for="side in (['left', 'right'] as const)" :key="side" class="nb-diff__cell" :data-side="side" :data-empty="row[side] === null ? 'true' : undefined">
                            <template v-if="row[side] !== null">
                                <span class="nb-diff__prefix" aria-hidden="true">{{ row.kind === "same" ? " " : side === "left" ? "−" : "+" }}</span>
                                <span class="nb-diff__text">
                                    <template v-for="(piece, index) in piecesOf(row, side, group.start + offset)" :key="index">
                                        <button
                                            v-if="piece.folded !== undefined"
                                            type="button"
                                            class="nb-diff__chars nb-ui-focus-ring-inset"
                                            @click="openRows.add(group.start + offset)"
                                        >{{ text("diffView.foldedChars", {count: piece.folded}) }}</button>
                                        <del v-else-if="piece.mark && side === 'left'">{{ piece.text }}</del>
                                        <ins v-else-if="piece.mark">{{ piece.text }}</ins>
                                        <template v-else>{{ piece.text }}</template>
                                    </template>
                                </span>
                            </template>
                        </div>
                    </div>
                    <div v-if="$slots.actions && endsHunk(group.start + offset)" class="nb-diff__actions">
                        <slot name="actions" :hunk="hunkScopes[row.hunk!]!.hunk" :before-text="hunkScopes[row.hunk!]!.beforeText" :after-text="hunkScopes[row.hunk!]!.afterText" />
                    </div>
                </template>
            </template>
        </template>
    </div>
</template>

<style scoped>
/* 自身宽度决定能不能两栏：同一个组件可能在右栏，也可能在编辑区。 */
.nb-diff {
    container-type: inline-size;
    min-width: 0;
    /* clip 不建滚动容器：标题行要贴着外面的滚动容器吸顶。 */
    overflow: clip;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    line-height: 1.6;
}

.nb-diff__bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 2px 8px;
    border-bottom: var(--border-w, 1px) solid var(--border-color);
    background: var(--bg-subtle);
    color: var(--text-muted);
}

.nb-diff__label {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nb-diff__stat {
    display: inline-flex;
    flex-shrink: 0;
    gap: 6px;
}

.nb-diff__stat b {
    font-weight: var(--weight-medium);
}

.nb-diff__added {
    color: var(--status-success);
}

.nb-diff__removed {
    color: var(--status-danger);
}

.nb-diff__note {
    flex-shrink: 0;
}

.nb-diff__spacer {
    flex: 1;
}

.nb-diff__modes {
    display: none;
    flex-shrink: 0;
}

.nb-diff__cell {
    display: flex;
    padding: 1px 8px;
    color: var(--text-secondary);
}

/* 行内：一行一列；没变的行两侧相同，只留一份；一对改动上下叠放。 */
.nb-diff__row[data-kind="same"] .nb-diff__cell[data-side="left"],
.nb-diff__cell[data-empty] {
    display: none;
}

.nb-diff__prefix {
    flex-shrink: 0;
    width: 1ch;
    margin-right: 6px;
    user-select: none;
}

.nb-diff__text {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.nb-diff__row:not([data-kind="same"]) .nb-diff__cell[data-side="left"]:not([data-empty]) {
    background: color-mix(in srgb, var(--status-danger) 8%, transparent);
    color: var(--text-main);
}

.nb-diff__row:not([data-kind="same"]) .nb-diff__cell[data-side="right"]:not([data-empty]) {
    background: color-mix(in srgb, var(--status-success) 9%, transparent);
    color: var(--text-main);
}

.nb-diff__cell[data-side="left"] .nb-diff__prefix {
    color: var(--status-danger);
}

.nb-diff__cell[data-side="right"] .nb-diff__prefix {
    color: var(--status-success);
}

/* 整行增删靠底色，只有一对改动行才标到字；整行划线读不下去。 */
.nb-diff del,
.nb-diff ins {
    text-decoration: none;
}

.nb-diff__row[data-kind="change"] del {
    border-radius: 2px;
    background: color-mix(in srgb, var(--status-danger) 28%, transparent);
    text-decoration: line-through;
}

.nb-diff__row[data-kind="change"] ins {
    border-radius: 2px;
    background: color-mix(in srgb, var(--status-success) 30%, transparent);
}

.nb-diff__chars {
    margin: 0 2px;
    padding: 0 4px;
    border: 0;
    border-radius: 3px;
    font: inherit;
    background: var(--bg-subtle);
    color: var(--text-muted);
    cursor: pointer;
}

.nb-diff__chars:hover {
    color: var(--text-main);
}

.nb-diff__fold {
    display: block;
    width: 100%;
    padding: 1px 8px;
    border: 0;
    background: var(--bg-subtle);
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-2xs);
    text-align: left;
    cursor: pointer;
}

.nb-diff__fold:hover {
    color: var(--text-main);
}

.nb-diff__actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 2px 8px;
    border-bottom: var(--border-w, 1px) solid var(--divider);
}

/* 两栏：一行一对，左右天然对齐，也就不用同步滚动。放不下时退回行内，不看调用方选了什么。 */
@container (min-width: 700px) {
    .nb-diff__modes {
        display: inline-flex;
    }

    [data-mode="split"] .nb-diff__row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    [data-mode="split"] .nb-diff__row[data-kind="same"] .nb-diff__cell[data-side="left"],
    [data-mode="split"] .nb-diff__cell[data-empty] {
        display: flex;
    }

    [data-mode="split"] .nb-diff__cell[data-empty] {
        background: var(--bg-subtle);
    }

    [data-mode="split"] .nb-diff__cell[data-side="left"] {
        border-right: var(--border-w, 1px) solid var(--border-color);
    }
}
</style>
