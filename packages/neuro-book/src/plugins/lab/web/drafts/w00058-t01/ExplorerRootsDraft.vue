<script setup lang="ts">
/**
 * w00058 t01 第 1 轮静态稿：资源管理器加上 Agent 的注册方案以后的样子（同名 .md）。行的结构与样式照 ExplorerRow 抄：
 * 展开箭头、文件图标、名字、淡色副标题、行尾状态列；只在“当前会话”的标记与只读标记上出候选。
 */
import {Tooltip} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import FileIcon from "nbook/ui/file-icons/FileIcon.vue";

import {rowsOf} from "./samples";
import type {DraftScene} from "./samples";

const props = withDefaults(defineProps<{
    scene?: DraftScene;
    /** 当前会话、当前 Profile 怎么标：行尾强调色圆点、会话图标染强调色、名字后的“当前”字样。 */
    marker?: "dot" | "icon" | "badge";
    /** 只读的根怎么标：行尾锁、名字后的“只读”字样。 */
    readonlyMark?: "lock" | "text";
    /** 树有没有焦点：选中行的底色跟着变（与 ExplorerRow 相同）。 */
    focused?: boolean;
}>(), {scene: "overview", marker: "dot", readonlyMark: "lock", focused: true});

const rows = computed(() => rowsOf(props.scene));

const INDENT = 12;
const indent = (depth: number): string => `${String(8 + depth * INDENT)}px`;
const guideLeft = (level: number): string => `${String(16 + level * INDENT)}px`;
const guides = (depth: number): number[] => Array.from({length: Math.max(0, depth - 1)}, (_, at) => at + 1);

</script>

<template>
    <div class="explorer-draft h-full w-full overflow-hidden py-1 text-[var(--text-main)]" :data-focused="focused ? '' : undefined" role="tree" aria-label="文件">
        <template v-for="row in rows" :key="row.id">
            <div v-if="row.kind === 'divider'" class="explorer-draft__divider" role="separator" aria-hidden="true"></div>
            <div
                v-else-if="row.kind === 'root'"
                class="explorer-draft__row explorer-draft__row--root"
                role="treeitem"
                :aria-expanded="row.expanded"
                :title="`${row.scheme}://`"
                :style="{paddingLeft: indent(0)}"
            >
                <span class="explorer-draft__twisty"><span class="i-lucide-chevron-right h-3.5 w-3.5" :class="row.expanded ? 'rotate-90' : ''"></span></span>
                <span class="min-w-0 shrink truncate">{{ row.label }}</span>
                <span v-if="row.readonly && readonlyMark === 'text'" class="explorer-draft__tag">只读</span>
                <span class="ml-auto flex shrink-0 items-center gap-1 pl-1">
                    <Tooltip v-if="row.readonly && readonlyMark === 'lock'" text="只读">
                        <span class="i-lucide-lock h-3 w-3 text-[var(--text-muted)]" role="img" aria-label="只读"></span>
                    </Tooltip>
                </span>
            </div>
            <div
                v-else-if="row.kind === 'more' || row.kind === 'empty'"
                class="explorer-draft__row text-xs text-[var(--text-muted)]"
                :class="row.kind === 'more' ? 'explorer-draft__row--more' : ''"
                :role="row.kind === 'more' ? 'treeitem' : 'none'"
                :style="{paddingLeft: indent(row.depth)}"
            >
                <span class="explorer-draft__twisty"></span>
                <!-- 占一个文件图标的宽：字与同层的名字对齐。 -->
                <span class="h-4 w-4 shrink-0" aria-hidden="true"></span>
                <span class="truncate">{{ row.label }}</span>
            </div>
            <div
                v-else
                class="explorer-draft__row text-sm"
                role="treeitem"
                :aria-selected="row.selected === true"
                :aria-expanded="row.expandable ? row.expanded === true : undefined"
                :data-current="row.current ? '' : undefined"
                :style="{paddingLeft: indent(row.depth)}"
            >
                <span v-for="level in guides(row.depth)" :key="level" class="explorer-draft__guide" :style="{left: guideLeft(level)}" aria-hidden="true"></span>
                <span class="explorer-draft__twisty">
                    <span v-if="row.expandable" class="i-lucide-chevron-right h-3.5 w-3.5" :class="row.expanded ? 'rotate-90' : ''"></span>
                </span>
                <span
                    v-if="row.icon === 'session'"
                    class="h-4 w-4 shrink-0"
                    :class="[row.current && marker === 'icon' ? 'i-lucide-message-circle-more explorer-draft__session--current' : 'i-lucide-message-circle text-[var(--text-muted)]']"
                    aria-hidden="true"
                ></span>
                <FileIcon v-else :icon="row.icon" />
                <span class="min-w-0 shrink truncate" :class="[row.dim ? 'text-[var(--text-muted)]' : '', row.current && marker !== 'badge' ? 'font-medium' : '']">{{ row.label }}</span>
                <span v-if="row.current && marker === 'badge'" class="explorer-draft__badge">当前</span>
                <span class="ml-auto flex shrink-0 items-center gap-1 pl-1">
                    <Tooltip v-if="row.readonly" text="只读">
                        <span class="i-lucide-lock h-3 w-3 text-[var(--text-muted)]" role="img" aria-label="只读"></span>
                    </Tooltip>
                    <span v-if="row.current && marker === 'dot'" class="explorer-draft__dot" role="img" :aria-label="row.icon === 'session' ? '当前会话' : '当前 Profile'"></span>
                </span>
            </div>
        </template>
    </div>
</template>

<style scoped>
/* 与 ExplorerRow 同一套：行高 26、圆角取控件圆角、悬停与选中的底色同 ExplorerRow 的 scoped 样式。 */
.explorer-draft__row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 26px;
    margin-inline: 4px;
    padding-right: 8px;
    border-radius: var(--radius-control);
    cursor: default;
    user-select: none;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.explorer-draft__row:hover {
    background: var(--bg-hover);
}

.explorer-draft__row[aria-selected="true"] {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.explorer-draft:not([data-focused]) .explorer-draft__row[aria-selected="true"] {
    background: color-mix(in srgb, var(--text-main) 8%, var(--bg-hover));
    color: var(--text-main);
}

.explorer-draft__row--root {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
}

.explorer-draft__row--more {
    cursor: pointer;
}

.explorer-draft__row--more:hover {
    color: var(--text-main);
}

.explorer-draft__twisty {
    display: flex;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
}

/* 组间分隔：一条淡线，上下各留半行，不加组标题（Task README 决定第 4 行第 1 条）。 */
.explorer-draft__divider {
    height: 1px;
    margin: 6px 12px;
    background: var(--divider);
}

/* 候选“圆点”：行尾状态列里一枚强调色实心点，与状态图标同列、同尺寸档。 */
.explorer-draft__dot {
    width: 6px;
    height: 6px;
    margin-inline: 4px;
    border-radius: 999px;
    background: var(--accent-main);
}

/* 候选“图标”：会话一层的图标统一是会话图标，当前的那个换成带点的样式并染强调色。 */
.explorer-draft__session--current {
    color: var(--accent-main);
}

/* 候选“字样”：名字后的小字，强调色，不加底色（不往行上贴色）。 */
.explorer-draft__badge {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--accent-text);
}

.explorer-draft__tag {
    flex-shrink: 0;
    font-weight: 400;
}

.explorer-draft__guide {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: color-mix(in srgb, var(--text-main) 18%, transparent);
    opacity: 0;
}

.explorer-draft:hover .explorer-draft__guide {
    opacity: 1;
}
</style>
