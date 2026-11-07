<script setup lang="ts">
/** 状态栏（同名 .md）：项目名、布局记录的问题与面板显隐按钮；只发事件，不执行命令。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {useWorkbenchText} from "../text";
import type {WorkbenchTextKey} from "../../shared/text";
import type {StripEntry} from "../items/registry";
import WorkbenchItemStrip from "./WorkbenchItemStrip.vue";

export interface StatusBarProblem {
    readonly record: string;
    readonly kind: "unread" | "unsaved";
    readonly code: string;
}

defineOptions({name: "WorkbenchStatusBar"});

const props = withDefaults(defineProps<{
    project: string | null;
    panelHidden: boolean;
    panelToggleDisabled?: boolean;
    problems?: ReadonlyArray<StatusBarProblem>;
    /** 贡献的条目（外壳四输出 35）：左侧的排在项目名与布局问题之后，右侧的排在“显示面板”之前。 */
    items?: StripEntry[];
}>(), {panelToggleDisabled: false, problems: () => [], items: () => []});

const emit = defineEmits<{
    (event: "toggle-panel"): void;
    (event: "retry", record: string): void;
    (event: "discard", record: string): void;
    (event: "run-item", itemId: string): void;
}>();

const leftItems = computed(() => props.items.filter((item) => item.alignment === "left"));
const rightItems = computed(() => props.items.filter((item) => item.alignment === "right"));

const text = useWorkbenchText();

/** 常见失败码的可读原因（目录里 `statusBar.reasons` 下的键）；不认识的码原样显示。 */
const REASON_KEYS: Readonly<Record<string, WorkbenchTextKey>> = {
    "unavailable": "statusBar.reasons.unavailable",
    "conflict": "statusBar.reasons.conflict",
    "unknown-outcome": "statusBar.reasons.unknown-outcome",
    "io-error": "statusBar.reasons.io-error",
    "corrupt": "statusBar.reasons.corrupt",
    "unsupported-version": "statusBar.reasons.unsupported-version",
    "provider-stopped": "statusBar.reasons.provider-stopped",
};

const reason = (code: string): string => (Object.hasOwn(REASON_KEYS, code) ? text(REASON_KEYS[code]!) : code);

/** 有修改没保存上的优先：用户刚做的修改可能丢，比“正在用默认布局”更要紧。 */
const shown = computed(() => props.problems.find((problem) => problem.kind === "unsaved") ?? props.problems[0] ?? null);
const problemText = computed(() => {
    const problem = shown.value;
    if (problem === null) return "";
    return text(problem.kind === "unsaved" ? "statusBar.unsaved" : "statusBar.unread", {reason: reason(problem.code)});
});
</script>

<template>
    <footer class="workbench-status-bar" :aria-label="text('statusBar.label')" data-workbench-status-bar>
        <div class="workbench-status-bar__left">
            <span class="workbench-status-bar__project" data-status-project>{{ project ?? text('statusBar.noProject') }}</span>
            <template v-if="shown !== null">
                <span class="workbench-status-bar__problem" role="status" :title="problemText" data-status-problem>{{ problemText }}</span>
                <template v-if="shown.kind === 'unsaved'">
                    <Button size="sm" variant="ghost" focus-ring="inset" class="workbench-status-bar__button" @click="emit('retry', shown.record)">{{ text('common.retry') }}</Button>
                    <Button size="sm" variant="ghost" focus-ring="inset" class="workbench-status-bar__button" @click="emit('discard', shown.record)">{{ text('statusBar.discard') }}</Button>
                </template>
            </template>
            <WorkbenchItemStrip :entries="leftItems" :item-height="20" align="start" @run="(id) => emit('run-item', id)" />
        </div>
        <WorkbenchItemStrip :entries="rightItems" :item-height="20" align="end" @run="(id) => emit('run-item', id)" />
        <div class="workbench-status-bar__right">
            <Button
                size="sm"
                variant="ghost"
                focus-ring="inset"
                class="workbench-status-bar__button"
                :disabled="panelToggleDisabled"
                data-shell-focus-target="panel-toggle"
                @click="emit('toggle-panel')"
            >{{ panelHidden ? text('statusBar.showPanel') : text('statusBar.hidePanel') }}</Button>
        </div>
    </footer>
</template>

<style scoped>
.workbench-status-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 22px;
    min-width: 0;
    padding-inline: var(--space-3) var(--space-1);
    overflow: hidden;
    /* 同标题栏：卡片外壳里落在窗体底上、不画顶线（ui/workbench-shell.md 输出 38）。 */
    background: var(--shell-chrome-surface, var(--bg-panel));
    border-top: var(--border-w) solid var(--shell-chrome-line, var(--divider));
    color: var(--text-secondary);
    font-size: var(--text-2xs);
    line-height: 1;
    user-select: none;
}

.workbench-status-bar__left {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
}

.workbench-status-bar__project {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-status-bar__problem {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--status-warning);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 总在最右（docs/specs/ui/workbench-shell.md 输出 35）：右侧没有条目时条目带不占宽度，不能靠它撑。 */
.workbench-status-bar__right {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    margin-inline-start: auto;
}

/* 状态栏只有 22px：按钮压到条内高度，字号随状态栏。 */
.workbench-status-bar__button {
    height: 20px;
    padding-inline: var(--space-1);
    font-size: inherit;
}
</style>
