<script setup lang="ts">
import {computed, ref} from "vue";
import {onClickOutside} from "@vueuse/core";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import {
    PLOT_THREAD_STATUS_LABELS,
    PLOT_THREAD_TONE_STYLES,
    type PlotThreadPanelScene,
    type PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

type ThreadFilterMode = "all" | "main" | "support" | "active" | "draft" | "paused" | "unmounted" | "pinned";

const props = defineProps<{
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    selectedThreadId: string | null;
    search: string;
    mode: ThreadFilterMode;
    pinnedThreadIds: string[];
}>();

const emit = defineEmits<{
    (e: "update:search", value: string): void;
    (e: "update:mode", value: ThreadFilterMode): void;
    (e: "selectThread", threadId: string): void;
    (e: "editThread", threadId: string): void;
    (e: "createThread"): void;
    (e: "toggleThreadPin", threadId: string): void;
    (e: "toggleThreadMain", threadId: string): void;
    (e: "deleteThread", threadId: string): void;
}>();

const modeItems: Array<{value: ThreadFilterMode; label: string}> = [
    {value: "all", label: "全部"},
    {value: "main", label: "主线"},
    {value: "support", label: "支线"},
    {value: "active", label: "进行中"},
    {value: "draft", label: "草稿"},
    {value: "paused", label: "暂停"},
    {value: "unmounted", label: "未挂载"},
    {value: "pinned", label: "已 Pin"},
];
const threadStatusClass: Record<PlotThreadPanelThread["status"], string> = {
    active: "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]",
    archived: "border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]",
    done: "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]",
    draft: "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
    paused: "border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]",
};

const filterPanelOpen = ref(false);
const filterPanelRef = ref<HTMLElement | null>(null);
const filterButtonRef = ref<HTMLButtonElement | null>(null);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);

const selectedThread = computed(() => props.threads.find((thread) => thread.id === props.selectedThreadId) ?? null);
const threadSceneMap = computed(() => {
    const map = new Map<string, number>();
    for (const scene of props.scenes) {
        map.set(scene.threadId, (map.get(scene.threadId) ?? 0) + 1);
    }
    return map;
});
const pinnedThreadSet = computed(() => new Set(props.pinnedThreadIds));
const filteredThreads = computed(() => {
    const keyword = props.search.trim().toLowerCase();
    return props.threads.filter((thread) => {
        const matchedKeyword = keyword.length === 0
            || thread.title.toLowerCase().includes(keyword)
            || thread.summary.toLowerCase().includes(keyword)
            || thread.tags.some((tag) => tag.toLowerCase().includes(keyword));
        const matchedMode = props.mode === "all"
            || (props.mode === "main" && thread.isMainThread)
            || (props.mode === "support" && !thread.isMainThread)
            || (props.mode === "active" && thread.status === "active")
            || (props.mode === "draft" && thread.status === "draft")
            || (props.mode === "paused" && thread.status === "paused")
            || (props.mode === "unmounted" && !thread.phaseId)
            || (props.mode === "pinned" && pinnedThreadSet.value.has(thread.id));
        return matchedKeyword && matchedMode;
    });
});
const pinnedThreads = computed(() => filteredThreads.value.filter((thread) => pinnedThreadSet.value.has(thread.id)));
const normalThreads = computed(() => filteredThreads.value.filter((thread) => !pinnedThreadSet.value.has(thread.id)));
const statusCounts = computed(() => props.threads.reduce<Record<string, number>>((map, thread) => {
    map[thread.status] = (map[thread.status] ?? 0) + 1;
    return map;
}, {}));
const mainThreadCount = computed(() => props.threads.filter((thread) => thread.isMainThread).length);

/**
 * 打开或收起筛选面板。
 */
function toggleFilterPanel(): void {
    filterPanelOpen.value = !filterPanelOpen.value;
}

/**
 * 关闭筛选面板。
 */
function closeFilterPanel(): void {
    filterPanelOpen.value = false;
}

/**
 * 打开 Thread 上下文菜单。
 */
function openThreadMenu(thread: PlotThreadPanelThread, event: MouseEvent): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = [
        {label: "编辑 Thread", iconClass: "i-lucide-pencil-line", action: () => emit("editThread", thread.id)},
        {label: pinnedThreadSet.value.has(thread.id) ? "取消 Pin" : "Pin 到顶部", iconClass: "i-lucide-pin", action: () => emit("toggleThreadPin", thread.id)},
        {label: thread.isMainThread ? "取消主线" : "设为主线", iconClass: "i-lucide-crown", action: () => emit("toggleThreadMain", thread.id)},
        {separator: true},
        {label: "复制标题", iconClass: "i-lucide-copy", action: () => copyThreadTitle(thread.title)},
        {label: "新建支线", iconClass: "i-lucide-git-branch-plus", action: () => emit("createThread")},
        {label: "删除 Thread", iconClass: "i-lucide-trash-2", danger: true, action: () => emit("deleteThread", thread.id)},
    ];
    contextMenuVisible.value = true;
}

/**
 * 复制 Thread 标题。
 */
async function copyThreadTitle(title: string): Promise<void> {
    if (!navigator.clipboard) {
        return;
    }
    await navigator.clipboard.writeText(title);
}

onClickOutside(filterPanelRef, () => {
    closeFilterPanel();
}, {ignore: [filterButtonRef]});
</script>

<template>
    <!-- 工作台左侧检索与线程列表 -->
    <aside class="relative flex min-h-0 w-[292px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]/78">
        <div class="shrink-0 space-y-3 border-b border-[var(--border-color)] px-3 py-3">
            <div class="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2">
                <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                <input
                    :value="props.search"
                    type="text"
                    class="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                    placeholder="搜索线程、场景、标签..."
                    @input="emit('update:search', ($event.target as HTMLInputElement).value)"
                >
                <button ref="filterButtonRef" type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="筛选" @click="toggleFilterPanel">
                    <span class="i-lucide-list-filter h-3.5 w-3.5"></span>
                </button>
            </div>

            <section>
                <div class="mb-2 flex items-center justify-between text-[11px] font-semibold text-[var(--text-main)]">
                    <span>当前聚焦</span>
                    <button type="button" class="inline-flex h-5 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="emit('createThread')">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        Thread
                    </button>
                </div>
                <button
                    v-if="selectedThread"
                    type="button"
                    class="w-full rounded-md border border-[var(--border-accent)] bg-[var(--accent-bg)] px-3 py-2 text-left"
                    @click="emit('selectThread', selectedThread.id)"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="flex min-w-0 items-center gap-2">
                            <span class="i-lucide-crown h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ selectedThread.title }}</span>
                        </span>
                        <span class="flex shrink-0 items-center gap-1">
                            <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="threadStatusClass[selectedThread.status]">
                                {{ PLOT_THREAD_STATUS_LABELS[selectedThread.status] }}
                            </span>
                            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="编辑 Thread" @click.stop="emit('editThread', selectedThread.id)">
                                <span class="i-lucide-pencil-line h-3.5 w-3.5"></span>
                            </button>
                        </span>
                    </div>
                    <div class="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                        {{ selectedThread.isMainThread ? "主线" : "支线" }} · {{ threadSceneMap.get(selectedThread.id) ?? 0 }} 场景
                    </div>
                </button>
            </section>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
            <div class="mb-2 flex items-center justify-between text-[11px] font-semibold text-[var(--text-main)]">
                <span>线程列表（{{ filteredThreads.length }}）</span>
                <button type="button" class="inline-flex h-5 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="toggleFilterPanel">
                    <span class="i-lucide-sliders-horizontal h-3 w-3"></span>
                    管理
                </button>
            </div>

            <div v-if="pinnedThreads.length" class="mb-3 space-y-1.5 border-b border-[var(--border-color)] pb-3">
                <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Pinned</div>
                <button
                    v-for="thread in pinnedThreads"
                    :key="thread.id"
                    type="button"
                    class="w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                    :class="props.selectedThreadId === thread.id ? 'border-[var(--border-accent)] bg-[var(--accent-bg)]' : 'border-transparent bg-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                    @click="emit('selectThread', thread.id)"
                    @contextmenu.prevent.stop="openThreadMenu(thread, $event)"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="flex min-w-0 items-center gap-2">
                            <span class="i-lucide-pin h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ thread.title }}</span>
                        </span>
                        <span class="flex shrink-0 items-center gap-1">
                            <span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" :class="thread.isMainThread ? 'workbench-main-chip' : PLOT_THREAD_TONE_STYLES[thread.tone].chipClass">
                                {{ thread.isMainThread ? "主线" : "支线" }}
                            </span>
                            <button type="button" class="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="编辑 Thread" @click.stop="emit('editThread', thread.id)">
                                <span class="i-lucide-pencil-line h-3 w-3"></span>
                            </button>
                        </span>
                    </div>
                    <div class="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        <span>{{ threadSceneMap.get(thread.id) ?? 0 }} 场景</span>
                        <span class="ml-auto">{{ PLOT_THREAD_STATUS_LABELS[thread.status] }}</span>
                    </div>
                </button>
            </div>

            <div class="space-y-1.5">
                <button
                    v-for="thread in normalThreads"
                    :key="thread.id"
                    type="button"
                    class="w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                    :class="props.selectedThreadId === thread.id ? 'border-[var(--border-accent)] bg-[var(--accent-bg)]' : 'border-transparent bg-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                    @click="emit('selectThread', thread.id)"
                    @contextmenu.prevent.stop="openThreadMenu(thread, $event)"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="flex min-w-0 items-center gap-2">
                            <span :class="thread.isMainThread ? 'i-lucide-crown text-[var(--accent-main)]' : 'i-lucide-waypoints text-[var(--text-muted)]'" class="h-3.5 w-3.5 shrink-0"></span>
                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ thread.title }}</span>
                        </span>
                        <span class="flex shrink-0 items-center gap-1">
                            <span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" :class="thread.isMainThread ? 'workbench-main-chip' : PLOT_THREAD_TONE_STYLES[thread.tone].chipClass">
                                {{ thread.isMainThread ? "主线" : "支线" }}
                            </span>
                            <button type="button" class="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="编辑 Thread" @click.stop="emit('editThread', thread.id)">
                                <span class="i-lucide-pencil-line h-3 w-3"></span>
                            </button>
                        </span>
                    </div>
                    <div class="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        <span>{{ threadSceneMap.get(thread.id) ?? 0 }} 场景</span>
                        <span class="ml-auto">{{ PLOT_THREAD_STATUS_LABELS[thread.status] }}</span>
                    </div>
                </button>
            </div>
        </div>

        <transition name="fade">
            <div v-if="filterPanelOpen" ref="filterPanelRef" class="absolute left-[calc(100%+8px)] top-3 z-40 w-[260px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 shadow-2xl">
                <div class="flex justify-end">
                    <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" @click="closeFilterPanel">
                        <span class="i-lucide-x h-3.5 w-3.5"></span>
                    </button>
                </div>

                <div class="mt-1 space-y-2">
                    <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">筛选模式</div>
                    <div class="flex flex-wrap gap-1.5">
                        <button
                            v-for="item in modeItems"
                            :key="item.value"
                            type="button"
                            class="rounded-md border px-2.5 py-1 text-[11px] transition-colors"
                            :class="props.mode === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                            @click="emit('update:mode', item.value)"
                        >
                            {{ item.label }}
                        </button>
                    </div>
                </div>

                <div class="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-2">
                        <div class="text-[10px] text-[var(--text-muted)]">Threads</div>
                        <div class="font-semibold text-[var(--text-main)]">{{ props.threads.length }}</div>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-2">
                        <div class="text-[10px] text-[var(--text-muted)]">Scenes</div>
                        <div class="font-semibold text-[var(--text-main)]">{{ props.scenes.length }}</div>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-2">
                        <div class="text-[10px] text-[var(--text-muted)]">Main</div>
                        <div class="font-semibold text-[var(--text-main)]">{{ mainThreadCount }}</div>
                    </div>
                </div>

                <div class="mt-3 space-y-1.5">
                    <div class="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span>状态分布</span>
                        <button type="button" class="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-main)]" @click="emit('update:mode', 'all')">重置</button>
                    </div>
                    <div class="grid grid-cols-2 gap-1.5 text-[11px]">
                        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">进行中 {{ statusCounts.active ?? 0 }}</div>
                        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">草稿 {{ statusCounts.draft ?? 0 }}</div>
                        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">暂停 {{ statusCounts.paused ?? 0 }}</div>
                        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">完成 {{ statusCounts.done ?? 0 }}</div>
                    </div>
                </div>

                <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                    <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 hover:bg-[var(--bg-hover)]" @click="emit('createThread')">新建 Thread</button>
                    <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 hover:bg-[var(--bg-hover)]" @click="emit('update:search', '')">清空搜索</button>
                </div>

                <div class="mt-3 border-t border-[var(--border-color)] pt-3">
                    <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">已 Pin</div>
                    <div class="mt-1 max-h-28 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                        <div v-for="thread in props.threads.filter((item) => pinnedThreadSet.has(item.id))" :key="thread.id" class="flex items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px]">
                            <span class="min-w-0 truncate">{{ thread.title }}</span>
                            <button type="button" class="text-[var(--text-muted)] hover:text-[var(--text-main)]" @click="emit('toggleThreadPin', thread.id)">取消</button>
                        </div>
                        <div v-if="!props.threads.some((item) => pinnedThreadSet.has(item.id))" class="rounded-md border border-dashed border-[var(--border-color)] px-2 py-2 text-center text-[10px] text-[var(--text-muted)]">
                            还没有 Pin 的 Thread
                        </div>
                    </div>
                </div>
            </div>
        </transition>

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="contextMenuVisible = false"
        />
    </aside>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
}

.workbench-main-chip {
    border: 1px solid color-mix(in srgb, var(--accent-main) 42%, transparent);
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    color: color-mix(in srgb, var(--accent-main) 88%, var(--accent-text));
}
</style>
