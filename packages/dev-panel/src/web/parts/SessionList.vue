<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {ref} from "vue";
import {isPlainClick} from "../host/routes.js";
import type {SessionRow, SessionTone} from "../host/sessions-list.js";
import ActionLink from "./ActionLink.vue";

/** 会话页的左列表：通知一行、Agent 会话、其它 pane（只读）、无主的运行的入口、不在本仓库的会话。契约见同名 .md。 */
withDefaults(defineProps<{
    agents: SessionRow[];
    panes: SessionRow[];
    elsewhere: SessionRow[];
    /** 选中的：pane 号，或 "notify"（右栏显示通知）；没选为 null。 */
    selected: string | null;
    /** 要处理的通知条数（与顶栏同一个口径）。 */
    attention: number;
    unownedRuns: number;
    /** 窄的左栏：行里只留标题、状态与 pane 号。 */
    compact?: boolean;
}>(), {compact: false});
const emit = defineEmits<{select: [paneId: string]; notify: []; navigate: [href: string]}>();
const elsewhereOpen = ref(false);
const hrefOf = (paneId: string) => `/live/sessions?pane=${encodeURIComponent(paneId)}`;
function follow(event: MouseEvent, run: () => void): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    run();
}
const TONE_CLASS: Record<SessionTone, string> = {blocked: "nbdev-warn", working: "nbdev-accent", done: "nbdev-ok", idle: "nbdev-secondary", unknown: "nbdev-secondary", absent: "nbdev-empty", ended: "nbdev-empty", pane: "nbdev-secondary"};
</script>

<template>
    <nav class="flex min-h-full flex-col gap-0.5 py-2" aria-label="会话与窗格">
        <a :href="'/live/sessions?view=notify'" class="nbdev-session-notify mx-2 mb-1" :class="{'nbdev-session-sel': selected === 'notify', 'nbdev-session-notify-hot': attention > 0}" :aria-current="selected === 'notify' ? 'page' : undefined" @click="follow($event, () => emit('notify'))">
            <span class="i-lucide-bell size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 font-semibold">通知<template v-if="attention > 0"> · {{ attention }} 条要处理</template></span>
            <span class="i-lucide-chevron-right size-4 shrink-0 opacity-60" aria-hidden="true" />
        </a>
        <h2 class="nbdev-session-group">Agent 会话 · {{ agents.length }}<Badge tone="accent" variant="outline" size="sm">临时</Badge></h2>
        <p v-if="agents.length === 0" class="nbdev-empty px-4 py-1">本仓库里没有 Agent 会话</p>
        <template v-for="row in agents" :key="row.key">
            <a v-if="row.selectable && row.paneId" :href="hrefOf(row.paneId)" class="nbdev-session-row" :class="{'nbdev-session-sel': selected === row.paneId}" :aria-current="selected === row.paneId ? 'page' : undefined" @click="follow($event, () => emit('select', row.paneId!))">
                <span class="nbdev-session-dot" :class="`nbdev-dot-${row.tone}`" aria-hidden="true" />
                <span class="nbdev-session-title" :title="row.title">{{ row.title }}</span>
                <span class="nbdev-session-state" :class="TONE_CLASS[row.tone]">{{ row.stateLabel }}</span>
                <span class="nbdev-session-sub">
                    <span>{{ row.agent }}</span><span class="font-mono">{{ row.paneId }}</span>
                    <template v-if="!compact">
                        <span v-for="task in row.tasks" :key="task.label" class="nbdev-session-chip" :class="{'opacity-55': task.stale}">{{ task.label }}</span>
                        <span v-if="row.runs > 0">{{ row.runs }} 个运行</span>
                        <span v-if="row.tasks.length === 0 && row.runs === 0" class="nbdev-empty">没有租约</span>
                    </template>
                </span>
            </a>
            <div v-else class="nbdev-session-row nbdev-session-off" :title="row.detail ?? undefined">
                <span class="nbdev-session-dot" :class="`nbdev-dot-${row.tone}`" aria-hidden="true" />
                <span class="nbdev-session-title" :class="{'line-through': row.tone === 'ended'}">{{ row.title }}</span>
                <span class="nbdev-session-state" :class="TONE_CLASS[row.tone]">{{ row.stateLabel }}</span>
                <span class="nbdev-session-sub">
                    <span>{{ row.agent }}</span><span v-if="row.detail">{{ row.detail }}</span>
                    <span v-for="task in row.tasks" :key="task.label" class="nbdev-session-chip">{{ task.label }}</span>
                    <span>不能打开</span>
                </span>
            </div>
        </template>
        <h2 class="nbdev-session-group mt-2">其它窗格（只读）· {{ panes.length }}</h2>
        <p v-if="panes.length === 0" class="nbdev-empty px-4 py-1">本仓库里没有别的窗格</p>
        <a v-for="row in panes" :key="row.key" :href="hrefOf(row.paneId!)" class="nbdev-session-row" :class="{'nbdev-session-sel': selected === row.paneId}" :aria-current="selected === row.paneId ? 'page' : undefined" @click="follow($event, () => emit('select', row.paneId!))">
            <span class="nbdev-session-dot nbdev-dot-pane" aria-hidden="true" />
            <span class="nbdev-session-title" :title="row.title">{{ row.title }}</span>
            <span class="nbdev-session-state nbdev-secondary">只看</span>
            <span class="nbdev-session-sub"><span class="font-mono">{{ row.paneId }}</span><span v-if="row.detail && !compact">{{ row.detail }}</span></span>
        </a>
        <div class="nbdev-divider mt-auto flex flex-col gap-1 border-t px-4 pt-2 pb-1">
            <span class="nbdev-secondary flex flex-wrap items-center gap-1">{{ unownedRuns === 0 ? "没有无主的运行" : `${unownedRuns} 个无主的运行` }}<ActionLink href="/live/runs" icon="i-lucide-activity" @navigate="(href) => emit('navigate', href)">去“在跑”看</ActionLink></span>
            <template v-if="elsewhere.length > 0">
                <button type="button" class="nbdev-secondary flex items-center gap-1 self-start" :aria-expanded="elsewhereOpen" @click="elsewhereOpen = !elsewhereOpen">
                    <span :class="elsewhereOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" aria-hidden="true" />不在本仓库的会话 · {{ elsewhere.length }}（只列出）
                </button>
                <ul v-if="elsewhereOpen" class="nbdev-note flex flex-col gap-1 pl-5">
                    <li v-for="row in elsewhere" :key="row.key" class="break-words">{{ row.title }} · {{ row.agent }} · <span class="font-mono">{{ row.paneId }}</span> · {{ row.stateLabel }} · {{ row.detail }}</li>
                </ul>
            </template>
        </div>
    </nav>
</template>

<style scoped>
.nbdev-session-group {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem 0.25rem;
    font-size: var(--text-2xs);
    color: var(--text-secondary);
}
.nbdev-session-row {
    display: grid;
    grid-template-columns: 0.625rem minmax(0, 1fr) auto;
    column-gap: 0.5rem;
    row-gap: 0.125rem;
    margin: 0 0.5rem;
    padding: 0.5rem 0.625rem;
    border: var(--border-w, 1px) solid transparent;
    border-radius: var(--radius-control);
    color: var(--text-main);
}
a.nbdev-session-row:hover {
    background: var(--bg-hover);
}
.nbdev-session-sel {
    background: var(--accent-bg);
    border-color: color-mix(in srgb, var(--accent-main) 35%, transparent);
}
.nbdev-session-off {
    color: var(--text-muted);
}
.nbdev-session-dot {
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 0.4rem;
    border-radius: 9999px;
}
.nbdev-dot-blocked { background: var(--status-warning); }
.nbdev-dot-working { background: var(--accent-main); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-main) 20%, transparent); }
.nbdev-dot-done { background: var(--status-success); }
.nbdev-dot-idle, .nbdev-dot-unknown { border: 1.5px solid var(--text-muted); }
.nbdev-dot-absent, .nbdev-dot-ended { background: var(--divider); }
.nbdev-dot-pane { border: 1.5px dashed var(--text-secondary); border-radius: 2px; }
.nbdev-session-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}
.nbdev-session-state {
    font-size: var(--text-2xs);
    white-space: nowrap;
}
.nbdev-session-sub {
    grid-column: 2 / 4;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.nbdev-session-chip {
    border: 1px dashed color-mix(in srgb, var(--accent-main) 60%, transparent);
    border-radius: 9999px;
    padding: 0 0.4rem;
    font-size: var(--text-2xs);
}
.nbdev-session-notify {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    border: var(--border-w, 1px) solid transparent;
    border-radius: var(--radius-control);
    color: var(--text-main);
    background: var(--bg-subtle);
}
.nbdev-session-notify-hot {
    background: color-mix(in srgb, var(--status-warning) 16%, transparent);
    color: var(--status-warning);
}
</style>
