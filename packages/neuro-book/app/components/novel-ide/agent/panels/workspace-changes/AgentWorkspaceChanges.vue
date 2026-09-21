<script setup lang="ts">
import {computed} from "vue";
import type {WorkspaceHistoryDiffState} from "../../composables/useAgentWorkspaceChanges";
import type {WorkspaceHistoryDiffChangeDto, WorkspaceHistoryDiffDto, WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";

const props = defineProps<{
    projectRoot: string | null;
    groups: WorkspaceHistoryInboxGroupDto[];
    loading: boolean;
    error: string | null;
    expanded: boolean;
    selectedPath: string | null;
    busyPath: string | null;
    acceptingAll: boolean;
    diffStateFor: (group: WorkspaceHistoryInboxGroupDto) => WorkspaceHistoryDiffState;
}>();

const emit = defineEmits<{
    (e: "update:expanded", value: boolean): void;
    (e: "select-group", group: WorkspaceHistoryInboxGroupDto): void;
    (e: "accept-group", group: WorkspaceHistoryInboxGroupDto): void;
    (e: "accept-all"): void;
    (e: "refresh"): void;
    (e: "open-full"): void;
    (e: "open-file", path: string): void;
}>();

const {t} = useI18n();

const visibleGroups = computed(() => props.groups.slice(0, 6));
const visible = computed(() => Boolean(props.projectRoot && (props.loading || props.groups.length > 0 || props.error)));

/** 展开/收起 Composer 上方的变更摘要。 */
function toggleExpanded(): void {
    emit("update:expanded", !props.expanded);
}

/** 展开前从零高度开始，避免自适应布局直接跳到最终尺寸。 */
function handleBodyBeforeEnter(element: Element): void {
    const body = element as HTMLElement;
    body.style.height = "0px";
    body.style.opacity = "0";
}

/** 使用真实内容高度播放展开动画，内部滚动视口不参与尺寸计算。 */
function handleBodyEnter(element: Element): void {
    const body = element as HTMLElement;
    void body.offsetHeight;
    body.style.height = `${body.scrollHeight}px`;
    body.style.opacity = "1";
}

/** 收起前锁定当前像素高度，防止 auto 高度在离场时立即归零。 */
function handleBodyBeforeLeave(element: Element): void {
    const body = element as HTMLElement;
    body.style.height = `${body.offsetHeight}px`;
    body.style.opacity = "1";
}

/** 从已锁定的真实高度平滑收起。 */
function handleBodyLeave(element: Element): void {
    const body = element as HTMLElement;
    void body.offsetHeight;
    body.style.height = "0px";
    body.style.opacity = "0";
}

/** 过渡完成或被快速切换打断后清理内联样式。 */
function resetBodyTransition(element: Element): void {
    const body = element as HTMLElement;
    body.style.height = "";
    body.style.opacity = "";
}

/** 将 diff 分段拆成适合紧凑预览的逐行数据。 */
function previewLines(changes: WorkspaceHistoryDiffChangeDto[]): Array<{kind: "added" | "removed" | "context"; text: string}> {
    return changes.flatMap((change) => {
        const kind = change.added ? "added" as const : change.removed ? "removed" as const : "context" as const;
        return change.value
            .split("\n")
            .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
            .map((line) => ({kind, text: line}));
    });
}

/** 读取一个 group 当前 revision 的 diff 结果。 */
function diffFor(group: WorkspaceHistoryInboxGroupDto): WorkspaceHistoryDiffDto | null {
    return props.diffStateFor(group).result;
}

/** 读取可展示的安全 diff 分支。 */
function availableDiff(group: WorkspaceHistoryInboxGroupDto): Extract<WorkspaceHistoryDiffDto, {status: "available"}> | null {
    const diff = diffFor(group);
    return diff?.status === "available" ? diff : null;
}
</script>

<template>
    <!-- Agent Composer 文件变更摘要：默认收起，小型安全 diff 按需展开 -->
    <Transition name="workspace-card">
        <section v-if="visible" class="mb-1.5 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-[var(--elevation-raised)]">
            <!-- 摘要标题与批量操作 -->
            <div class="flex min-h-7 items-center gap-1.5 px-2 py-1">
                <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left outline-none transition-colors hover:text-[var(--text-main)] focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]" :aria-expanded="props.expanded" @click="toggleExpanded">
                    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]">
                        <span class="i-lucide-file-diff h-3 w-3"></span>
                    </span>
                    <span class="min-w-0 flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                        {{ props.loading && props.groups.length === 0 ? t("agent.workspaceChanges.checking") : t("agent.workspaceChanges.title", {count: props.groups.length}) }}
                    </span>
                    <span v-if="props.groups[0]" class="max-w-[38%] truncate font-mono text-[10px] text-[var(--text-muted)]" :title="props.groups[0].path">{{ props.groups[0].path }}</span>
                    <span class="i-lucide-chevron-down h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform duration-200" :class="props.expanded ? 'rotate-180' : ''"></span>
                </button>
                <button v-if="props.groups.length > 0" type="button" class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-1.5 text-[10px] font-medium text-[var(--status-success)] transition-all duration-150 hover:border-[var(--status-success)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45" :disabled="props.acceptingAll || props.busyPath !== null" @click="emit('accept-all')">
                    <span :class="props.acceptingAll ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-check-check'" class="h-2.5 w-2.5"></span>
                    <span>{{ t("agent.workspaceChanges.acceptAll") }}</span>
                </button>
            </div>

            <Transition
                name="workspace-body"
                @before-enter="handleBodyBeforeEnter"
                @enter="handleBodyEnter"
                @after-enter="resetBodyTransition"
                @enter-cancelled="resetBodyTransition"
                @before-leave="handleBodyBeforeLeave"
                @leave="handleBodyLeave"
                @after-leave="resetBodyTransition"
                @leave-cancelled="resetBodyTransition"
            >
                <!-- 折叠外壳只负责裁切动画，内部滚动视口保持稳定高度与 gutter。 -->
                <div v-if="props.expanded" class="workspace-body-shell">
                    <div class="workspace-body-clip">
                        <div class="workspace-scroll custom-scrollbar max-h-[26rem] overflow-y-auto border-t border-[var(--border-color)]">
                            <p v-if="props.error" class="m-1.5 rounded border border-[var(--status-danger)] px-2 py-1 text-[10px] text-[var(--status-danger)]">{{ props.error }}</p>
                            <TransitionGroup v-else name="workspace-row" tag="div" class="relative">
                                <article v-for="group in visibleGroups" :key="`${group.path}:${group.revision}`" class="border-b border-[var(--border-color)] last:border-b-0">
                                    <div class="flex min-h-6 items-center gap-1.5 px-2 py-1 transition-colors hover:bg-[var(--bg-hover)]">
                                        <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]" :aria-expanded="props.selectedPath === group.path" @click="emit('select-group', group)">
                                            <span class="i-lucide-file h-3 w-3 shrink-0 text-[var(--text-muted)]"></span>
                                            <span class="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-main)]" :title="group.path">{{ group.path }}</span>
                                            <span class="shrink-0 rounded bg-[var(--bg-subtle)] px-1 py-px text-[10px] text-[var(--text-muted)]">{{ t("agent.workspaceChanges.entryCount", {count: group.entries.length}) }}</span>
                                            <span class="i-lucide-chevron-right h-2.5 w-2.5 text-[var(--text-muted)] transition-transform duration-150" :class="props.selectedPath === group.path ? 'rotate-90' : ''"></span>
                                        </button>
                                        <button type="button" class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded border border-[var(--border-color)] px-1.5 text-[10px] font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent-main)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:opacity-45" :disabled="group.endHash === null" :title="group.endHash === null ? t('agent.workspaceChanges.openDeleted') : t('agent.workspaceChanges.openFile')" @click="emit('open-file', group.path)">
                                            <span class="i-lucide-external-link h-2.5 w-2.5"></span>
                                            <span>{{ t("agent.workspaceChanges.open") }}</span>
                                        </button>
                                        <button type="button" class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded border border-[var(--status-success-border)] px-1.5 text-[10px] font-medium text-[var(--status-success)] transition-all duration-150 hover:bg-[var(--status-success-bg)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45" :disabled="props.busyPath !== null || props.acceptingAll" @click="emit('accept-group', group)">
                                            <span :class="props.busyPath === group.path ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-check'" class="h-2.5 w-2.5"></span>
                                            <span>{{ t("agent.workspaceChanges.accept") }}</span>
                                        </button>
                                    </div>

                                    <Transition name="workspace-diff">
                                        <div v-if="props.selectedPath === group.path" class="workspace-diff border-t border-[var(--border-color)] bg-[var(--bg-subtle)] px-2 py-1.5">
                                            <p v-if="props.diffStateFor(group).loading" class="text-[10px] text-[var(--text-muted)]">{{ t("agent.workspaceChanges.loadingDiff") }}</p>
                                            <p v-else-if="props.diffStateFor(group).error" class="text-[10px] text-[var(--status-danger)]">{{ props.diffStateFor(group).error }}</p>
                                            <template v-else-if="diffFor(group)?.status === 'available'">
                                                <div class="workspace-diff-scroll custom-scrollbar max-h-60 overflow-auto rounded border border-[var(--border-color)] bg-[var(--panel-surface)] font-mono text-[10px] leading-4">
                                                    <div v-for="(line, index) in previewLines(availableDiff(group)?.changes ?? [])" :key="index" class="flex min-w-max px-1.5" :class="line.kind === 'added' ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]' : line.kind === 'removed' ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'text-[var(--text-muted)]'">
                                                        <span class="mr-1.5 select-none">{{ line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " " }}</span>
                                                        <span class="whitespace-pre">{{ line.text }}</span>
                                                    </div>
                                                </div>
                                            </template>
                                            <p v-else-if="diffFor(group)?.status === 'blocked'" class="rounded border border-[var(--status-warning)] px-2 py-1 text-[10px] text-[var(--status-warning)]">{{ t("agent.workspaceChanges.blocked") }}</p>
                                            <p v-else-if="diffFor(group)?.status === 'too_large'" class="text-[10px] text-[var(--text-muted)]">{{ t("agent.workspaceChanges.tooLarge") }}</p>
                                            <p v-else-if="diffFor(group)?.status === 'unavailable'" class="text-[10px] text-[var(--text-muted)]">{{ t("agent.workspaceChanges.unavailable") }}</p>
                                        </div>
                                    </Transition>
                                </article>
                            </TransitionGroup>

                            <div class="flex min-h-6 items-center justify-between border-t border-[var(--border-color)] bg-[var(--bg-subtle)] px-2 py-1">
                                <span class="text-[10px] text-[var(--text-muted)]">{{ t("agent.workspaceChanges.inlineHint") }}</span>
                                <button type="button" class="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--accent-text)] transition-opacity hover:opacity-70" @click="emit('open-full')">
                                    <span>{{ t("agent.workspaceChanges.openFull") }}</span>
                                    <span class="i-lucide-arrow-up-right h-2.5 w-2.5"></span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>
        </section>
    </Transition>
</template>

<style scoped>
.workspace-card-enter-active,
.workspace-card-leave-active {
    transition: opacity 160ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.workspace-card-enter-from,
.workspace-card-leave-to {
    opacity: 0;
    transform: translateY(4px);
}

.workspace-body-shell {
    overflow: hidden;
}

.workspace-body-enter-active,
.workspace-body-leave-active {
    transition: height 220ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms ease;
    will-change: height, opacity;
}

.workspace-body-clip {
    min-height: 0;
    overflow: hidden;
}

.workspace-scroll,
.workspace-diff-scroll {
    scrollbar-gutter: stable;
    overscroll-behavior: contain;
}

.workspace-diff-enter-active,
.workspace-diff-leave-active {
    transition: opacity 140ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.workspace-diff-enter-from,
.workspace-diff-leave-to {
    opacity: 0;
    transform: translateY(-2px);
}

.workspace-row-enter-active,
.workspace-row-leave-active,
.workspace-row-move {
    transition: opacity 160ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.workspace-row-enter-from,
.workspace-row-leave-to {
    opacity: 0;
    transform: translateX(4px);
}

.workspace-row-leave-active {
    position: absolute;
    width: 100%;
}

@media (prefers-reduced-motion: reduce) {
    .workspace-card-enter-active,
    .workspace-card-leave-active,
    .workspace-body-enter-active,
    .workspace-body-leave-active,
    .workspace-diff-enter-active,
    .workspace-diff-leave-active,
    .workspace-row-enter-active,
    .workspace-row-leave-active,
    .workspace-row-move {
        transition-duration: 1ms;
    }
}
</style>
