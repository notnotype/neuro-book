<script setup lang="ts">
/** 状态栏（同名 .md）：项目名、布局记录的问题与面板显隐按钮；只发事件，不执行命令。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {StripEntry} from "../items/registry";
import WorkbenchItemStrip from "./WorkbenchItemStrip.vue";

export interface StatusBarProblem {
    readonly record: string;
    readonly kind: "unread" | "unsaved";
    readonly code: string;
}

defineOptions({name: "WorkbenchStatusBar"});

const props = withDefaults(defineProps<{
    locale: DisplayLocale;
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

const TEXT = {
    label: {"zh-CN": "状态栏", "en-US": "Status bar"},
    noProject: {"zh-CN": "未打开项目", "en-US": "No project open"},
    showPanel: {"zh-CN": "显示面板", "en-US": "Show Panel"},
    hidePanel: {"zh-CN": "隐藏面板", "en-US": "Hide Panel"},
    unsaved: {"zh-CN": "布局未保存：{reason}", "en-US": "Layout not saved: {reason}"},
    unread: {"zh-CN": "布局未读取，正在用默认布局（{reason}）", "en-US": "Layout not loaded; using the default ({reason})"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
    discard: {"zh-CN": "放弃", "en-US": "Discard"},
} satisfies Record<string, LocalizedText>;

/** 常见失败码的可读原因；不认识的码原样显示。 */
const REASONS: Readonly<Record<string, LocalizedText>> = {
    "unavailable": {"zh-CN": "存储暂时不可用", "en-US": "storage is unavailable"},
    "conflict": {"zh-CN": "与别的窗口的修改冲突", "en-US": "conflicts with another window"},
    "unknown-outcome": {"zh-CN": "不确定是否已保存", "en-US": "unknown whether it was saved"},
    "io-error": {"zh-CN": "读写出错", "en-US": "read or write error"},
    "corrupt": {"zh-CN": "记录已损坏", "en-US": "the record is corrupt"},
    "unsupported-version": {"zh-CN": "记录的版本不支持", "en-US": "unsupported record version"},
    "provider-stopped": {"zh-CN": "存储服务已停止", "en-US": "storage has stopped"},
};

const text = (value: LocalizedText): string => localize(value, props.locale);
const reason = (code: string): string => (REASONS[code] === undefined ? code : text(REASONS[code]));

/** 有修改没保存上的优先：用户刚做的修改可能丢，比“正在用默认布局”更要紧。 */
const shown = computed(() => props.problems.find((problem) => problem.kind === "unsaved") ?? props.problems[0] ?? null);
const problemText = computed(() => {
    const problem = shown.value;
    if (problem === null) return "";
    return text(formatText(problem.kind === "unsaved" ? TEXT.unsaved : TEXT.unread, {reason: reason(problem.code)}));
});
</script>

<template>
    <footer class="workbench-status-bar" :aria-label="text(TEXT.label)" data-workbench-status-bar>
        <div class="workbench-status-bar__left">
            <span class="workbench-status-bar__project" data-status-project>{{ project ?? text(TEXT.noProject) }}</span>
            <template v-if="shown !== null">
                <span class="workbench-status-bar__problem" role="status" :title="problemText" data-status-problem>{{ problemText }}</span>
                <template v-if="shown.kind === 'unsaved'">
                    <Button size="sm" variant="ghost" class="workbench-status-bar__button" @click="emit('retry', shown.record)">{{ text(TEXT.retry) }}</Button>
                    <Button size="sm" variant="ghost" class="workbench-status-bar__button" @click="emit('discard', shown.record)">{{ text(TEXT.discard) }}</Button>
                </template>
            </template>
            <WorkbenchItemStrip :locale="locale" :entries="leftItems" :item-height="20" align="start" @run="(id) => emit('run-item', id)" />
        </div>
        <WorkbenchItemStrip :locale="locale" :entries="rightItems" :item-height="20" align="end" @run="(id) => emit('run-item', id)" />
        <div class="workbench-status-bar__right">
            <Button
                size="sm"
                variant="ghost"
                class="workbench-status-bar__button"
                :disabled="panelToggleDisabled"
                data-shell-focus-target="panel-toggle"
                @click="emit('toggle-panel')"
            >{{ panelHidden ? text(TEXT.showPanel) : text(TEXT.hidePanel) }}</Button>
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
    background: var(--bg-panel);
    border-top: var(--border-w) solid var(--divider);
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

.workbench-status-bar__right {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
}

/* 状态栏只有 22px：按钮压到条内高度，字号随状态栏。 */
.workbench-status-bar__button {
    height: 20px;
    padding-inline: var(--space-1);
    font-size: inherit;
}
</style>
