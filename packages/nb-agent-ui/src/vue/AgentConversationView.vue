<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {Button, DropdownMenu, IconButton, OverlayScrollbar, Popover, Spinner} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import type {
    AgentConversationContext,
    AgentConversationServices,
    AgentViewAction,
    MessageView,
    AgentLocale,
    AgentViewMode,
} from "../types";
import type {AgentViewRegistry} from "../registry";
import {assignTurnKeys, reuseTurnGroups, splitIntoTurnGroups} from "../conversation-turns";
import {useStreamScroll} from "@notnotype/nb-ui/composables";
import AgentConversationTurn from "./stream/AgentConversationTurn.vue";
import AgentRawView from "./stream/AgentRawView.vue";
import AgentConversationComposer from "./composer/AgentConversationComposer.vue";
import AgentStatusBar from "./composer/AgentStatusBar.vue";
import AgentWizard from "./wizard/AgentWizard.vue";
import OriginalImagePreviewDialog from "./parts/OriginalImagePreviewDialog.vue";
import {provideAgentView} from "./host";
import type {AgentViewRenderers} from "./host";
import type {PreviewImageRequest, ViewAction} from "./view-action";

const props = withDefaults(defineProps<{
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    viewMode?: AgentViewMode;
    teleportTarget?: string | false;
    /** 没有宿主注入翻译端口时的界面语言，缺省 zh-CN；有注入时以端口为准（见 `text.ts`）。 */
    locale?: AgentLocale;
    renderers?: AgentViewRenderers;
    /** 是否显示顶栏；宿主页面自有标题时传 false，原始视图的切换入口随之没有，用 viewMode 控制。 */
    header?: boolean;
    /** 运行中过程的展开方式：缺省折叠；live 时运行中的思维链与工具组逐步展开。 */
    processDisclosure?: "collapsed" | "live";
    /** 输入框版式：缺省两层；`inline` 正文与控件同一行（AgentConversationComposer.md 的“单行版式”）。 */
    composerLayout?: "stacked" | "inline";
    /** 输入框下面的状态栏；宿主有自己的用量显示时不要（nb-story）。 */
    statusBar?: boolean;
    /** 有 `sessions` 插槽时点标题弹出下拉，放切换会话的面板。 */
    newSession?: boolean;
}>(), {
    viewMode: undefined,
    teleportTarget: false,
    locale: undefined,
    renderers: () => ({}),
    header: true,
    processDisclosure: "collapsed",
    composerLayout: "stacked",
    statusBar: false,
    newSession: false,
});

const slots = defineSlots<{
    /** 点标题弹出的下拉里放的内容（会话面板）。 */
    sessions?: () => unknown;
}>();

const emit = defineEmits<{
    (e: "action", action: AgentViewAction): void;
    (e: "update:viewMode", mode: AgentViewMode): void;
}>();

const {t} = provideAgentView({locale: () => props.locale, renderers: () => props.renderers});

// ─── 视图模式 ───────────────────────────────────────────────────────────

const sessionsOpen = ref(false);
const localViewMode = ref<AgentViewMode>("turns");
const currentViewMode = computed(() => props.viewMode ?? localViewMode.value);

function setViewMode(mode: AgentViewMode) {
    localViewMode.value = mode;
    emit("update:viewMode", mode);
}

const overflowItems = computed<DropdownMenuItemData[]>(() => [{
    id: "toggle-view-mode",
    label: currentViewMode.value === "raw" ? t("header.turnsView") : t("header.rawView"),
    iconClass: currentViewMode.value === "raw" ? "i-lucide-list-collapse" : "i-lucide-list",
}]);

function onOverflowSelect(value: string) {
    if (value === "toggle-view-mode") {
        setViewMode(currentViewMode.value === "raw" ? "turns" : "raw");
    }
}

// ─── 轮次 ───────────────────────────────────────────────────────────────

/**
 * 按轮次边界切好的消息；每一轮的整理、折叠与操作由 AgentConversationTurn 负责。消息没变的轮次沿用上一次的数组，
 * 宿主整体替换 ctx（例如每秒换 now）时它们不重新整理。上一次的结果只用来沿用，不参与渲染依赖。
 */
let previousTurnGroups: MessageView[][] = [];
const turnGroups = computed(() => {
    previousTurnGroups = reuseTurnGroups(previousTurnGroups, splitIntoTurnGroups(props.ctx.messages));
    return previousTurnGroups;
});

/** 上一次分配的 key 只用来让下一次沿用，不参与渲染依赖。 */
let previousTurnKeys = new Map<string, string>();
const turnKeys = computed(() => {
    previousTurnKeys = assignTurnKeys(turnGroups.value, previousTurnKeys);
    return previousTurnKeys;
});

// ─── 滚动与历史 ─────────────────────────────────────────────────────────

const streamRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);

const {following, scrollToLatest, recheckNearTop} = useStreamScroll({
    scroller: streamRef,
    content: contentRef,
    onNearTop: () => requestHistory(false),
});

// 切换会话后定位到最新内容；各轮的界面状态随组件的 key（含会话 id）一起重建。
watch(() => props.ctx.session?.id, () => {
    void nextTick(scrollToLatest);
});

const historyRow = computed(() => {
    const {hasMore, loading, error} = props.ctx.history;
    if (error !== null) {
        return "error";
    }
    if (loading) {
        return "loading";
    }
    return hasMore ? "more" : null;
});

/** 滚动触发的请求已经发出、宿主还没反映到 history 上；避免一次滚动连发。 */
let historyRequested = false;
watch(() => [props.ctx.history.loading, props.ctx.history.error, props.ctx.messages[0]?.id], () => {
    historyRequested = false;
});

// 一页加载完时高度可能不变（补上的内容都收在已收起的轮次里），不会触发滚动或尺寸校正，这里再看一次是否仍在顶部。
watch(() => props.ctx.history.loading, (loading, wasLoading) => {
    if (wasLoading && !loading) {
        recheckNearTop();
    }
});

/** 接近顶部时自动请求（失败后不自动重试）；用户点“更早的内容”或“重试”时是 explicit。 */
function requestHistory(explicit: boolean) {
    const {hasMore, loading, error} = props.ctx.history;
    if (!hasMore || loading || (!explicit && (historyRequested || error !== null))) {
        return;
    }
    historyRequested = true;
    emit("action", {type: "history.loadPrevious"});
}

// ─── 输入框 ─────────────────────────────────────────────────────────────

const composerRef = ref<InstanceType<typeof AgentConversationComposer> | null>(null);

function focusComposer() {
    composerRef.value?.focus();
}

/** 等用户时向导替换输入框的位置。输入框隐藏但不卸载：草稿和撤销栈都在。 */
const waitingForUser = computed(() => props.ctx.pendingInputs.length > 0);

// 全部答完：焦点回到输入框（docs/specs/agent/conversation.md 输出 11）。
watch(waitingForUser, (waiting, was) => {
    if (was && !waiting) void nextTick(focusComposer);
});

/**
 * 子组件的 action 都到这里。原图预览是纯界面行为，视图自己打开，宿主收不到；发了消息或命令（来自输入框，或宿主组件
 * 里的“追问”之类）就是要看接下来的回应，回到最新并恢复跟随，即使刚才在往上翻历史。
 */
function onAction(action: ViewAction) {
    if (action.type === "image.preview") {
        openPreview(action.image);
        return;
    }
    if (action.type === "composer.submit" || action.type === "command.run") scrollToLatest();
    emit("action", action);
}

// ─── 原图预览 ───────────────────────────────────────────────────────────

/**
 * 正在预览的图片。对话框关掉时归还 Markdown 图片的地址（`release`），但保留 `src`：已经画出来的图不受归还影响，
 * 关闭动画期间不会消失。换图、卸载时同样归还；每个地址只归还一次。
 */
const preview = ref<{src: string; name: string; release: () => void} | null>(null);
const previewOpen = ref(false);
/** 正在换算的 Markdown 图片地址；又点了别的图片或视图卸载时取消，晚到的结果直接归还。 */
let pendingAsset: AbortController | null = null;

function releasePreview(): void {
    const current = preview.value;
    if (current === null) return;
    current.release();
    preview.value = {...current, release: () => {}};
}

function showPreview(next: {src: string; name: string; release: () => void}) {
    releasePreview();
    preview.value = next;
    previewOpen.value = true;
}

watch(previewOpen, (open) => {
    if (!open) releasePreview();
});

function openPreview(image: PreviewImageRequest) {
    pendingAsset?.abort();
    pendingAsset = null;
    if ("locator" in image) {
        const src = props.services.resolveAttachmentUrl?.(image.locator, "original") ?? null;
        if (src !== null) showPreview({src, name: image.name, release: () => {}});
        return;
    }
    const resolve = props.services.resolveMarkdownAsset;
    if (resolve === undefined) return;
    const controller = new AbortController();
    pendingAsset = controller;
    // 包一层 then：宿主的换算同步抛错时也走失败分支，不从点击处理里逸出。
    void Promise.resolve().then(() => resolve(image.markdownSrc, controller.signal)).then((asset) => {
        if (asset === null) return;
        if (controller.signal.aborted) {
            asset.release();
            return;
        }
        showPreview({src: asset.url, name: image.name, release: () => asset.release()});
    }, (error: unknown) => {
        // 被取消的那次按惯例以 AbortError 失败，不算取不到。
        if (controller.signal.aborted) return;
        // 换算失败与取不到一样不打开预览；视图没有诊断通道，留一条开发诊断。
        console.warn(`nb-agent-ui: 回复里的图片 ${image.markdownSrc} 取不到原图`, error);
    }).finally(() => {
        if (pendingAsset === controller) pendingAsset = null;
    });
}

onBeforeUnmount(() => {
    pendingAsset?.abort();
    releasePreview();
});

defineExpose({focusComposer, scrollToLatest});
</script>

<template>
    <section class="agent-conversation-view">
        <header v-if="props.header" class="acv-header">
            <span
                v-if="props.ctx.session"
                :class="[props.ctx.session.profileIcon, 'acv-header__icon']"
                aria-hidden="true"
            />
            <Popover v-if="slots.sessions" v-model:open="sessionsOpen" side="bottom" align="start" content-class="acv-header__sessions">
                <template #trigger>
                    <button type="button" class="acv-header__title acv-header__title--button" :title="props.ctx.session?.summary || undefined" data-header-sessions :aria-expanded="sessionsOpen">
                        <span class="acv-header__name">{{ props.ctx.session ? (props.ctx.session.title || t("header.untitled")) : t("header.noSession") }}</span>
                        <span class="i-lucide-chevron-down acv-header__chevron" aria-hidden="true" />
                    </button>
                </template>
                <slot name="sessions" />
            </Popover>
            <div v-else class="acv-header__title" :title="props.ctx.session?.summary || undefined">
                <span class="acv-header__name">{{ props.ctx.session ? (props.ctx.session.title || t("header.untitled")) : t("header.noSession") }}</span>
                <span v-if="props.ctx.session" class="acv-header__profile">{{ props.ctx.session.profileName }}</span>
            </div>
            <span v-if="slots.sessions && props.ctx.session" class="acv-header__profile">{{ props.ctx.session.profileName }}</span>
            <span v-if="slots.sessions" class="acv-header__spacer" />
            <IconButton v-if="props.newSession" icon-class="i-lucide-plus" size="sm" :title="t('header.newSession')" :aria-label="t('header.newSession')" data-header-new @click="emit('action', {type: 'session.create'})" />
            <DropdownMenu :items="overflowItems" root-class="acv-header__more" align="end" @select="onOverflowSelect">
                <IconButton icon-class="i-lucide-ellipsis" size="sm" :title="t('header.more')" :aria-label="t('header.more')" />
            </DropdownMenu>
        </header>

        <div class="acv-body">
            <div ref="streamRef" class="acv-stream" data-agent-stream>
                <div ref="contentRef" class="acv-stream__content">
                    <!-- 其余 availability 的说明与恢复动作在输入框上方的横幅里，这里不重复 -->
                    <p v-if="props.ctx.messages.length === 0 && props.ctx.availability.status === 'loading'" class="acv-stream__empty" role="status">
                        <Spinner size="sm" :label="t('stream.loading')" />{{ t("stream.loading") }}
                    </p>
                    <p v-else-if="props.ctx.messages.length === 0" class="acv-stream__empty">
                        {{ t("stream.empty") }}
                    </p>

                    <template v-else>
                        <!-- 更早的内容：也是开头不完整的第一轮的开头标记 -->
                        <div v-if="historyRow" class="acv-history" :data-history="historyRow">
                            <p v-if="historyRow === 'error'" class="acv-history__error" role="alert">
                                <span class="i-lucide-circle-alert acv-history__icon" aria-hidden="true" />
                                <span>{{ props.ctx.history.error }}</span>
                                <Button size="sm" variant="subtle" icon-class="i-lucide-rotate-cw" @click="requestHistory(true)">
                                    {{ t("history.retry") }}
                                </Button>
                            </p>
                            <p v-else-if="historyRow === 'loading'" class="acv-history__loading" role="status">
                                <Spinner size="sm" :label="t('history.loading')" />{{ t("history.loading") }}
                            </p>
                            <button v-else type="button" class="acv-history__more" @click="requestHistory(true)">
                                {{ t("history.more") }}
                            </button>
                        </div>

                        <!-- 分轮视图 -->
                        <template v-if="currentViewMode === 'turns'">
                            <AgentConversationTurn
                                v-for="(group, index) in turnGroups"
                                :key="`${props.ctx.session?.id ?? ''}:${turnKeys.get(group[0]!.id)}`"
                                :messages="group"
                                :ctx="props.ctx"
                                :services="props.services"
                                :registry="props.registry"
                                :latest="index === turnGroups.length - 1"
                                :first="index === 0"
                                :process-disclosure="props.processDisclosure"
                                @action="onAction"
                            />
                        </template>

                        <!-- 原始视图：一条消息一个块，系统条目全部可见 -->
                        <AgentRawView
                            v-else
                            :messages="props.ctx.messages"
                            :ctx="props.ctx"
                            :services="props.services"
                            :registry="props.registry"
                            @action="onAction"
                        />
                    </template>
                    <AgentWizard v-if="waitingForUser" :pending="props.ctx.pendingInputs" :state="props.ctx.wizardState" @action="onAction" />
                </div>
            </div>

            <Transition name="acv-fade">
                <!-- 按钮浮在消息上：secondary 的底色是半透明的，垫一层不透明的浮层底，下面的字不透出来。 -->
                <span v-if="!following && props.ctx.messages.length > 0" class="acv-jump">
                    <Button
                        size="sm"
                        variant="secondary"
                        icon-class="i-lucide-arrow-down"
                        data-jump-latest
                        @click="scrollToLatest"
                    >
                        {{ t("stream.jumpToLatest") }}
                    </Button>
                </span>
            </Transition>
            <!-- 叠加的滚动条不占宽度：气泡、输入框、状态栏的右边才对得齐，内容变长时也不重排（docs/specs/workbench/views.md 输出 12）。 -->
            <OverlayScrollbar :target="streamRef" />
        </div>

        <AgentConversationComposer
            v-show="!waitingForUser"
            ref="composerRef"
            :ctx="props.ctx"
            :services="props.services"
            :registry="props.registry"
            :layout="props.composerLayout"
            v-bind="{inert: waitingForUser}"
            @action="onAction"
        />
        <AgentStatusBar v-if="props.statusBar" :ctx="props.ctx" :registry="props.registry" />
        <OriginalImagePreviewDialog
            v-if="preview !== null"
            v-model="previewOpen"
            :src="preview.src"
            :alt="preview.name"
            :teleport-target="props.teleportTarget"
        />
    </section>
</template>

<style scoped>
.agent-conversation-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    color: var(--text-main);
    font-size: var(--text-sm);
}

.acv-header {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border-bottom: var(--border-w, 1px) solid var(--border-color);
}

.acv-header__icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
}

/* 390 宽时标题区域不小于 160px（docs/specs/ui/agent-conversation-view.md“顶栏”）。 */
.acv-header__title {
    flex: 1;
    min-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-header__title--button {
    display: inline-flex;
    flex: 0 1 auto;
    min-width: 0;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.acv-header__title--button:hover {
    background: var(--bg-hover);
}

.acv-header__title--button .acv-header__name {
    overflow: hidden;
    text-overflow: ellipsis;
}

.acv-header__chevron {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.acv-header__spacer {
    flex: 1;
}

:global(.acv-header__sessions) {
    width: min(420px, 90vw);
    height: min(480px, 70vh);
    padding: 0;
}

.acv-header__name {
    font-weight: var(--weight-medium);
}

.acv-header__profile {
    margin-left: 8px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

:global(.acv-header__more) {
    position: relative;
    display: inline-block;
}

/* 向导的 60cqh 相对这里。 */
.acv-body {
    container-type: size;
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

.acv-stream__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 40px 0;
    color: var(--text-muted);
}

/*
 * 流式追加内容时滚动条出现与否不应挤动内容。
 * 关掉浏览器自带的滚动锚定，阅读位置统一由 useStreamScroll 校正，两者不会各修一次。
 */
.acv-stream {
    min-height: 0;
    flex: 1;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 20px 12px 12px;
    overflow-anchor: none;
}

/* 面板拉宽时正文行过长难读，每轮限宽居中。 */
.acv-stream__content > * {
    max-width: 800px;
    margin-inline: auto;
}

/*
 * 历史行三种状态高度一致，切换时下面的内容不动。
 * 更早的内容插在它后面、它自己不动，所以不能当阅读锚点，否则插入后下面的内容会被推走。
 */
.acv-history {
    overflow-anchor: none;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    margin-bottom: 16px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-history__more {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    border-radius: var(--radius-control);
    color: inherit;
    transition: color var(--motion-fast) var(--ease-standard);
}

.acv-history__more::before,
.acv-history__more::after {
    content: "";
    flex: 1;
    border-top: var(--border-w, 1px) solid var(--divider);
}

.acv-history__more:hover {
    color: var(--text-secondary);
}

.acv-history__more:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
}

/* 读得快时什么都不出现：加载指示延后一个 --motion-base（约 200ms）才淡入。 */
.acv-history__loading {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    animation: acv-appear var(--motion-fast) var(--ease-standard) var(--motion-base) both;
}

.acv-history__error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px 8px;
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.acv-history__icon {
    width: 14px;
    height: 14px;
}

@keyframes acv-appear {
    from {
        opacity: 0;
    }
}

/* 浮在消息流底部正中；左右为 0 加自动外边距居中，不占用按钮自己的按压缩放 transform。 */
.acv-jump {
    position: absolute;
    right: 0;
    bottom: 12px;
    left: 0;
    width: fit-content;
    margin-inline: auto;
    display: flex;
    border-radius: 6px;
    background: var(--overlay-surface);
    box-shadow: var(--elevation-raised);
}

.acv-fade-enter-active,
.acv-fade-leave-active {
    transition: opacity var(--motion-fast) var(--ease-standard);
}

.acv-fade-enter-from,
.acv-fade-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .acv-history__loading {
        animation-duration: 0s;
    }

    .acv-fade-enter-active,
    .acv-fade-leave-active {
        transition: none;
    }
}
</style>
