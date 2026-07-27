<script setup lang="ts">
import {computed, nextTick, onMounted, provide, ref} from "vue";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import RpProseSelectionOverlay from "nbook/app/components/novel-ide/rp/RpProseSelectionOverlay.vue";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {createWorkspaceImageResolver} from "nbook/app/utils/workspace-image-url";

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 760;

/**
 * RP 正文阅读面板：右侧可收起侧栏，按 Tick 顺序连续展示 rp.writer 的最终正文，
 * 达到"边跑团边读小说"的效果。数据来自 GET /api/projects/rp/prose 聚合端点。
 */
const props = defineProps<{
    projectPath: string;
    open: boolean;
    width: number;
}>();

const emit = defineEmits<{
    (e: "update:width", value: number): void;
    /** 选区生图请求（RpProseSelectionOverlay 上抛，宿主打开生图面板）。 */
    (e: "generate-illustration", payload: {tickDir: string; anchorText: string; occurrence: number; text: string}): void;
}>();

/** prose.md 里的相对路径插图（assets/illustrations/...）重写为 raw serve URL。 */
const resolveImageSrc = computed(() => createWorkspaceImageResolver(props.projectPath));

type RpTickProseDto = {
    tick: number;
    dir: string;
    title: string;
    content: string;
    updatedAt: number;
};

const items = ref<RpTickProseDto[]>([]);
const loading = ref(false);
/** 面板内可恢复的加载错误（非空时展示在面板内，不打全局通知）。 */
const loadError = ref("");
/** 正在高亮定位的 Tick 目录名（reveal 后短暂高亮，空串表示无）。 */
const highlightedDir = ref("");
const scrollRef = ref<HTMLElement | null>(null);
const resizeHandleRef = ref<HTMLElement | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

// 正文渲染复用 AgentMarkdownContent，这里自备 DOMPurify 供其注入使用
const sanitizeHtml = ref<((html: string) => string) | null>(null);
provide("sanitizeHtml", sanitizeHtml);
onMounted(async () => {
    try {
        const {default: createDOMPurify} = await import("dompurify");
        const purifier = createDOMPurify(window);
        sanitizeHtml.value = (html) => purifier.sanitize(html) as string;
    } catch (error) {
        console.error("加载 DOMPurify 失败，正文按未消毒 Markdown 渲染", error);
    }
});

const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width),
    minSize: MIN_PANEL_WIDTH,
    maxSize: MAX_PANEL_WIDTH,
    edge: "left",
    enabled: computed(() => props.open),
    onResizeEnd: (width) => emit("update:width", width),
});
const prosePanelStyle = computed(() => props.open ? panelStyle.value : {width: "0px"});

const totalChars = computed(() => items.value.reduce((sum, item) => sum + item.content.length, 0));

/** Tick 展示标签：000000 视为序幕，其余按幕计。 */
function tickLabel(item: RpTickProseDto): string {
    return item.tick === 0 ? "序幕" : `第 ${item.tick} 幕`;
}

/** 拉取正文列表；新增内容时自动滚到底部（跟读最新进度）。 */
async function refresh(): Promise<void> {
    if (!props.projectPath || loading.value) return;
    loading.value = true;
    const previousCount = items.value.length;
    const previousUpdatedAt = items.value.at(-1)?.updatedAt ?? 0;
    try {
        const page = await $fetch<{items: RpTickProseDto[]}>("/api/projects/rp/prose", {
            query: {projectPath: props.projectPath},
        });
        items.value = page.items;
        loadError.value = "";
        const latest = page.items.at(-1);
        if (page.items.length > previousCount || (latest && latest.updatedAt > previousUpdatedAt)) {
            await nextTick();
            scrollToBottom();
        }
    } catch (error) {
        loadError.value = resolveApiErrorMessage(error, "读取跑团正文失败");
    } finally {
        loading.value = false;
    }
}

/** 滚动定位到指定 Tick（配合消息里的 prose 链接），并短暂高亮。 */
async function reveal(dir: string): Promise<void> {
    if (!items.value.some((item) => item.dir === dir)) {
        await refresh();
    }
    await nextTick();
    const section = scrollRef.value?.querySelector<HTMLElement>(`[data-tick-dir="${CSS.escape(dir)}"]`);
    if (!section) return;
    section.scrollIntoView({behavior: "smooth", block: "start"});
    highlightedDir.value = dir;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { highlightedDir.value = ""; }, 2200);
}

function scrollToBottom(): void {
    const container = scrollRef.value;
    if (container) container.scrollTop = container.scrollHeight;
}

void refresh();

defineExpose({refresh, reveal});
</script>

<template>
    <!-- RP 正文阅读面板（右侧可收起） -->
    <aside
        class="relative flex h-full shrink-0 flex-col overflow-hidden border-l bg-[var(--bg-panel)] transition-[width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="[props.open ? 'border-[var(--border-color)] opacity-100' : 'pointer-events-none border-transparent opacity-0', isResizing ? 'select-none transition-none' : '']"
        :style="prosePanelStyle"
    >
        <div v-if="props.open" ref="resizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
            <div class="ml-0.5 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="isResizing ? 'opacity-100' : ''"></div>
        </div>

        <!-- 面板标题栏 -->
        <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-2.5">
            <div class="min-w-0">
                <div class="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-main)]">
                    <span class="i-lucide-book-open-text h-4 w-4 text-[var(--accent-main)]"></span>
                    跑团正文
                </div>
                <div class="text-[11px] text-[var(--text-muted)]">{{ items.length }} 段 · 约 {{ totalChars }} 字</div>
            </div>
            <button type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40" title="刷新正文" :disabled="loading" @click="void refresh()">
                <span :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-4 w-4"></span>
            </button>
        </div>

        <!-- 正文滚动区 -->
        <div ref="scrollRef" class="relative min-h-0 flex-1 overflow-y-auto px-5 py-4 custom-scrollbar" :class="isResizing ? 'pointer-events-none select-none' : ''">
            <div v-if="loadError" class="mb-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[12px] text-[var(--status-danger)]">
                {{ loadError }}
            </div>

            <div v-if="items.length === 0 && !loading && !loadError" class="mt-10 rounded-md border border-dashed border-[var(--border-color)] px-4 py-8 text-center text-[12px] leading-relaxed text-[var(--text-muted)]">
                尚无正文。<br>开始跑团后，每个 Tick 的最终正文会依次出现在这里。
            </div>

            <section
                v-for="item in items"
                :key="item.dir"
                :data-tick-dir="item.dir"
                class="mb-6 scroll-mt-3 rounded-lg px-1 transition-colors duration-500"
                :class="highlightedDir === item.dir ? 'bg-[var(--accent-bg)]/45' : ''"
            >
                <!-- Tick 分隔标题 -->
                <div class="mb-2 flex items-baseline gap-2 border-b border-[var(--border-color)]/60 pb-1.5">
                    <span class="shrink-0 text-[12px] font-semibold tracking-wide text-[var(--accent-text)]">{{ tickLabel(item) }}</span>
                    <span class="min-w-0 truncate text-[12px] text-[var(--text-secondary)]">{{ item.title }}</span>
                    <span class="ml-auto shrink-0 font-mono text-[10px] text-[var(--text-muted)]">#{{ String(item.tick).padStart(3, "0") }}</span>
                </div>
                <AgentMarkdownContent :content="item.content" :resolve-image-src="resolveImageSrc" class="rp-prose-body" />
            </section>

            <!-- 选区生图浮动按钮 -->
            <RpProseSelectionOverlay :container="scrollRef" :enabled="props.open" @generate="emit('generate-illustration', $event)" />
        </div>
    </aside>
</template>

<style scoped>
/* 小说式阅读排版：行距放宽、字号略升 */
.rp-prose-body :deep(p) {
    margin: 0.65rem 0;
    font-size: 14.5px;
    line-height: 1.9;
    color: var(--text-main);
}
</style>
