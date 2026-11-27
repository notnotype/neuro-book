<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {Button, Dialog, IconButton, ImagePreviewDialog, OverlayScrollbar, Spinner} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import type {
    ContextInspectionView,
    SessionTreeView,
    AgentConversationContext,
    AgentConversationServices,
    AgentViewAction,
    MessageView,
    AgentLocale,
    AgentViewMode,
    AgentWelcomeView,
    PendingInputView,
} from "../types";
import {visibleEntries} from "../registry";
import type {AgentViewRegistry, HeaderActionEntry} from "../registry";
import type {StatusLineSetting} from "../status-line";
import {assignTurnKeys, reuseTurnGroups, splitIntoTurnGroups} from "../conversation-turns";
import {localDayIndex} from "../format";
import {dividersBefore} from "../stream-dividers";
import {useStreamScroll} from "@notnotype/nb-ui/composables";
import AgentConversationTurn from "./stream/AgentConversationTurn.vue";
import AgentRawView from "./stream/AgentRawView.vue";
import AgentStreamDivider from "./stream/AgentStreamDivider.vue";
import AgentWelcome from "./stream/AgentWelcome.vue";
import AgentConversationComposer from "./composer/AgentConversationComposer.vue";
import AgentConversationHead from "./head/AgentConversationHead.vue";
import AgentStatusBar from "./composer/AgentStatusBar.vue";
import AgentContextInspector from "./panels/AgentContextInspector.vue";
import AgentSessionTree from "./panels/AgentSessionTree.vue";
import AgentWizard from "./wizard/AgentWizard.vue";
import AgentDock from "./wizard/AgentDock.vue";
import {isDocked, isApproval, isModeSwitch, rememberKey} from "../wizard";
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
    /** 顶层会话时头的左边放新建按钮。 */
    newSession?: boolean;
    /** 把头的三列送到视图之外（工作台面板头的标题区，同名 .md 的“顶栏”）；不给时画在内容顶上。 */
    headTargets?: {readonly start: HTMLElement; readonly title: HTMLElement; readonly end: HTMLElement; readonly anchor: HTMLElement} | null;
    /** 头是宿主窗口的拖动区（宿主自绘窗口头时，交给 `AgentConversationHead` 的 `windowDrag`）。 */
    headWindowDrag?: boolean;
    /** 会话列表开着没有；可选受控，不传时视图自持。 */
    sessionsOpen?: boolean;
    /** 没选会话时头上的图标：新会话会用的 Profile。 */
    draftProfile?: {readonly name: string; readonly icon: string} | null;
    /** 没有消息时的第一屏（AgentWelcome）；不给时写“还没有消息”。 */
    welcome?: AgentWelcomeView | null;
    /** 用户的状态栏设置（显隐与次序，见 `status-line.ts`）；给了才有右键菜单，宿主处理 `statusLine.toggle`、`statusLine.openSettings`。 */
    statusLine?: StatusLineSetting;
    /** 头的右列最后画“关闭”，点了发 `close`：宿主把对话放在可关的面板里时用。 */
    closable?: boolean;
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
    headTargets: null,
    headWindowDrag: false,
    sessionsOpen: undefined,
    draftProfile: null,
    welcome: null,
    closable: false,
});

const slots = defineSlots<{
    /** 点标题弹出的下拉里放的内容（会话面板）。`close` 关下拉：切了会话之后不该还开着。 */
    sessions?: (scope: {close: () => void}) => unknown;
    /** 头的右列最前面，宿主放的入口（子代理入口）。 */
    "head-trailing"?: () => unknown;
}>();

const emit = defineEmits<{
    (e: "action", action: AgentViewAction): void;
    (e: "update:viewMode", mode: AgentViewMode): void;
    (e: "update:sessionsOpen", open: boolean): void;
    /** 点了头上的“关闭”（`closable` 时才有）。 */
    (e: "close"): void;
    /** 输入框里按了 Esc（补全菜单开着、输入法组字时不发）：宿主可以拿它关掉放对话的面板。 */
    (e: "escape"): void;
}>();

const {t, text} = provideAgentView({locale: () => props.locale, renderers: () => props.renderers});

// ─── 视图模式 ───────────────────────────────────────────────────────────

const localSessionsOpen = ref(false);
const sessionsOpen = computed(() => props.sessionsOpen ?? localSessionsOpen.value);

function setSessionsOpen(open: boolean): void {
    localSessionsOpen.value = open;
    emit("update:sessionsOpen", open);
}

const localViewMode = ref<AgentViewMode>("turns");
const currentViewMode = computed(() => props.viewMode ?? localViewMode.value);

function setViewMode(mode: AgentViewMode) {
    localViewMode.value = mode;
    emit("update:viewMode", mode);
}

// ─── 登记的顶栏动作（Spec“顶栏”）：允许常驻的按 order 取前两个放在顶栏，其余收进溢出菜单 ───

const headerActions = computed(() => visibleEntries(props.registry.list("headerActions"), props.ctx));
const pinnedActions = computed(() => headerActions.value.filter((entry) => entry.pinnable).slice(0, 2));
const menuActions = computed(() => headerActions.value.filter((entry) => !pinnedActions.value.includes(entry)));

/** 名字后面跟角标数（有才写）。 */
function headerLabel(entry: HeaderActionEntry): string {
    const badge = entry.badge?.(props.ctx) ?? null;
    return badge === null || badge === 0 ? text(entry.label) : `${text(entry.label)} (${String(badge)})`;
}

/** 目标是面板的在构造注册表时就被拒绝了（`registry.ts`），这里只有 action。 */
function runHeaderAction(entry: HeaderActionEntry): void {
    if (entry.target.kind === "action") emit("action", entry.target.action);
}

const pinnedHead = computed(() => pinnedActions.value.map((entry) => ({id: entry.id, icon: entry.icon, label: headerLabel(entry)})));

function onHeaderAction(id: string): void {
    const entry = pinnedActions.value.find((item) => item.id === id);
    if (entry !== undefined) runHeaderAction(entry);
}

/** 溢出菜单里登记项的 id 加前缀，不与内置项撞名。 */
const HEADER_PREFIX = "header:";

const overflowItems = computed<DropdownMenuItemData[]>(() => [
    ...(props.ctx.interaction.canInspectContext === true ? [{id: "context", label: t("panel.context.title"), iconClass: "i-lucide-gauge"}] : []),
    ...(props.ctx.interaction.canOpenTree === true ? [{id: "tree", label: t("panel.tree.open"), iconClass: "i-lucide-git-fork"}] : []),
    ...menuActions.value.map((entry) => ({id: `${HEADER_PREFIX}${entry.id}`, label: headerLabel(entry), iconClass: entry.icon})),
    {
        id: "toggle-view-mode",
        label: currentViewMode.value === "raw" ? t("header.turnsView") : t("header.rawView"),
        iconClass: currentViewMode.value === "raw" ? "i-lucide-list-collapse" : "i-lucide-list",
    },
]);

function selectSession(sessionId: string): void {
    emit("action", {type: "session.select", sessionId});
}

function onOverflowSelect(value: string) {
    if (value.startsWith(HEADER_PREFIX)) {
        const entry = menuActions.value.find((item) => `${HEADER_PREFIX}${item.id}` === value);
        if (entry !== undefined) runHeaderAction(entry);
    }
    else if (value === "toggle-view-mode") {
        setViewMode(currentViewMode.value === "raw" ? "turns" : "raw");
    }
    else if (value === "context") {
        openInspector();
    }
    else if (value === "tree") {
        treeOpen.value = true;
        emit("action", {type: "tree.refresh"});
    }
}

// ─── 面板 ───────────────────────────────────────────────────────────────

/** 开着哪个弹窗是纯界面状态，归视图；数据归宿主，打开时要、关掉时放（Spec 的“面板与弹窗”）。 */
const inspectorOpen = ref(false);
const IDLE_INSPECTION: ContextInspectionView = {state: "idle"};

function openInspector(): void {
    inspectorOpen.value = true;
    emit("action", {type: "context.refresh"});
}

function onInspectorOpen(open: boolean): void {
    inspectorOpen.value = open;
    if (!open) emit("action", {type: "context.closed"});
}

const treeOpen = ref(false);
const LOADING_TREE: SessionTreeView = {state: "loading", loaded: 0};

function onTreeOpen(open: boolean): void {
    treeOpen.value = open;
    if (!open) emit("action", {type: "tree.closed"});
}

function onTreeActivate(id: string): void {
    emit("action", {type: "tree.activate", entryId: id});
    onTreeOpen(false);
}

// 换了会话：弹窗里的数据不再是这个会话的。
watch(() => props.ctx.session?.id, () => {
    if (inspectorOpen.value) onInspectorOpen(false);
    if (treeOpen.value) onTreeOpen(false);
});

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

/**
 * 轮与轮之间的线（`ctx.dividers`，同名 Spec 的“分轮视图”）：按首条消息 id 索引。线上的日子按 `now` 的日序号写，宿主每秒换 `now`
 * 时日序号不变，线不重画。
 */
const streamDividers = computed(() => dividersBefore(turnGroups.value, props.ctx.dividers));
const today = computed(() => localDayIndex(props.ctx.now));

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

/** 第一屏的开场指令：交给宿主换进输入框，再把焦点放过去，接着就能改或发。 */
function fillComposer(text: string): void {
    emit("action", {type: "composer.fill", text});
    void nextTick(focusComposer);
}

/** 档位按会话给（`ctx.interaction`）：停靠还是向导、能不能新建。 */
const placement = computed(() => props.ctx.interaction.placement ?? "wizard");
const canCreate = computed(() => props.ctx.interaction.canCreate !== false);
const showWelcome = computed(() => canCreate.value && props.ctx.messages.length === 0 && props.ctx.availability.status !== "loading" && props.welcome !== null);

/** 消息流滚到顶了没有：离开顶部才给顶端加渐隐。只在变化时写，滚动时不反复触发渲染。 */
const streamAtTop = ref(true);

function onStreamScroll(): void {
    const atTop = (streamRef.value?.scrollTop ?? 0) <= 0;
    if (atTop !== streamAtTop.value) streamAtTop.value = atTop;
}

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

/**
 * 等用户时向导替换输入框的位置。输入框隐藏但不卸载：草稿和撤销栈都在。只有阻塞的事项替换输入框；异步提问与子代理的事项进停靠区，
 * 输入框照常可用。
 */
const docked = (item: PendingInputView): boolean => placement.value === "dock" || isDocked(item);
const blockingInputs = computed(() => props.ctx.pendingInputs.filter((item) => !docked(item)));
const dockedInputs = computed(() => props.ctx.pendingInputs.filter(docked));
const dockRef = ref<InstanceType<typeof AgentDock> | null>(null);

/**
 * 停靠档里停靠区是唯一的应答处，答完一个时照向导的规则放焦点（docs/specs/agent/conversation.md 输出 11）：宿主去掉答过的事项、
 * 它的按钮随之卸载，这时焦点原本在停靠区里的，放到停靠区的容器上（不落到某个按钮上，免得接着按回车收起或替用户作答），都答完了回
 * 输入框。`flush: "pre"` 在界面更新之前看焦点还在不在里面。
 */
watch(() => ({session: props.ctx.session?.id ?? null, ids: dockedInputs.value.map((item) => item.id)}), (now, before) => {
    // 换了会话不算答完：两个会话的事项不能互相比。
    if (placement.value !== "dock" || now.session !== before.session || !before.ids.some((id) => !now.ids.includes(id))) return;
    const root = dockRef.value?.$el as HTMLElement | undefined;
    if (root?.contains(document.activeElement) !== true) return;
    void nextTick(() => {
        if (dockRef.value !== null && dockedInputs.value.length > 0) dockRef.value.focusRoot();
        else focusComposer();
    });
}, {flush: "pre"});
const waitingForUser = computed(() => blockingInputs.value.length > 0);

/**
 * 停靠区的读屏播报：视图层常驻的状态区（不随停靠区挂卸，否则第一次出现时读屏收不到），文字带来源。只在事项集合变化时换文字。
 */
const dockAnnouncement = computed(() => {
    const first = dockedInputs.value[0];
    if (first === undefined) return "";
    const what = isApproval(first) ? t("dock.what.approval", {tool: first.tool}) : isModeSwitch(first) ? t("dock.what.modeSwitch", {mode: first.toLabel}) : first.questions[0]?.question ?? "";
    const labelled = first.source === undefined ? what : t("dock.fromSubagent", {name: first.source.name, what});
    return t("dock.announce", {what: labelled, count: dockedInputs.value.length});
});

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
    if (placement.value === "dock" && action.type === "input.submit") rememberAlongside(action);
}

/**
 * 停靠档一次只显示一个事项、各自提交，向导里“本会话都批准”顺带选上同类的那一步没有了（`wizard.ts` 的 `choose`）。这里补上：同一会话
 * 里同一记住范围的其余审批照同一个决定一并提交。
 */
function rememberAlongside(action: Extract<ViewAction, {type: "input.submit"}>): void {
    const {resolutions} = action;
    if (resolutions.kind !== "approval" || (resolutions.decision !== "allow-session" && resolutions.decision !== "allow-always")) return;
    const chosen = dockedInputs.value.find((item) => item.id === action.batchKey);
    if (chosen === undefined || !isApproval(chosen)) return;
    const key = rememberKey(chosen);
    if (key === null) return;
    for (const item of dockedInputs.value) {
        if (item.id === chosen.id || !isApproval(item) || item.source?.sessionId !== chosen.source?.sessionId || rememberKey(item) !== key) continue;
        emit("action", {type: "input.submit", batchKey: item.id, resolutions: {kind: "approval", decision: resolutions.decision}, ...(item.source === undefined ? {} : {sessionId: item.source.sessionId})});
    }
}

// ─── 原图预览 ───────────────────────────────────────────────────────────

/** 表情另带复制的写法与放大到的尺寸（docs/specs/agent/stickers.md 输出 46）。 */
type PreviewShown = {src: string; name: string; release: () => void; copyText?: string; minSize?: number};

/**
 * 正在预览的图片。对话框关掉时归还 Markdown 图片的地址（`release`），但保留 `src`：已经画出来的图不受归还影响，
 * 关闭动画期间不会消失。换图、卸载时同样归还；每个地址只归还一次。
 */
const preview = ref<PreviewShown | null>(null);
const previewOpen = ref(false);
/** 正在换算的 Markdown 图片地址；又点了别的图片或视图卸载时取消，晚到的结果直接归还。 */
let pendingAsset: AbortController | null = null;

function releasePreview(): void {
    const current = preview.value;
    if (current === null) return;
    current.release();
    preview.value = {...current, release: () => {}};
}

function showPreview(next: PreviewShown) {
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
    if ("url" in image) {
        showPreview({src: image.url, name: image.name, release: () => {}, copyText: image.copyText, minSize: image.minSize});
        return;
    }
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
        <AgentConversationHead
            v-if="props.header"
            :ctx="props.ctx"
            :targets="props.headTargets"
            :new-session="props.newSession && canCreate"
            :has-sessions="slots.sessions !== undefined"
            :sessions-open="sessionsOpen"
            :draft-profile="props.draftProfile"
            :pinned="pinnedHead"
            :overflow-items="overflowItems"
            :closable="props.closable"
            :window-drag="props.headWindowDrag"
            @close="emit('close')"
            @select="selectSession"
            @create="emit('action', {type: 'session.create'})"
            @update:sessions-open="setSessionsOpen"
            @header-action="onHeaderAction"
            @overflow="onOverflowSelect"
        >
            <template v-if="slots.sessions" #sessions>
                <slot name="sessions" :close="() => setSessionsOpen(false)" />
            </template>
            <template v-if="slots['head-trailing']" #trailing>
                <slot name="head-trailing" />
            </template>
        </AgentConversationHead>

        <div class="acv-body">
            <!-- 消息流带 data-nb-agent="skip"：应用内 Agent 的界面快照不列消息内容（docs/specs/ui/agent-conversation-view.md“边界与兼容”）；输入框与状态栏在它外面，照常列出。 -->
            <div ref="streamRef" class="acv-stream" :class="{'acv-stream--faded': !streamAtTop}" data-agent-stream data-nb-agent="skip" @scroll.passive="onStreamScroll">
                <div ref="contentRef" class="acv-stream__content" :class="{'acv-stream__content--welcome': showWelcome}">
                    <!-- 其余 availability 的说明与恢复动作在输入框上方的横幅里，这里不重复 -->
                    <p v-if="props.ctx.messages.length === 0 && props.ctx.availability.status === 'loading'" class="acv-stream__empty" role="status">
                        <Spinner size="sm" :label="t('stream.loading')" />{{ t("stream.loading") }}
                    </p>
                    <AgentWelcome
                        v-else-if="showWelcome"
                        :welcome="props.welcome!"
                        :now="props.ctx.now"
                        :can-open-sessions="slots.sessions !== undefined"
                        @select="selectSession"
                        @open-sessions="setSessionsOpen(true)"
                        @starter="fillComposer"
                    />
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
                        <!-- 线与轮次是内容列的直接子元素（吃到封顶宽度）。线的 v-for 编译成固定在轮次前面的一个片段，线出现或消失时轮次不重新挂载。 -->
                        <template v-if="currentViewMode === 'turns'">
                            <template v-for="(group, index) in turnGroups" :key="`${props.ctx.session?.id ?? ''}:${turnKeys.get(group[0]!.id)}`">
                                <AgentStreamDivider
                                    v-for="divider in streamDividers.get(group[0]!.id) ?? []"
                                    :key="divider.kind"
                                    :kind="divider.kind"
                                    :at="divider.kind === 'day' ? divider.at : undefined"
                                    :today="today"
                                />
                                <AgentConversationTurn
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
                    <AgentWizard v-if="waitingForUser" :pending="blockingInputs" :state="props.ctx.wizardState" @action="onAction" />
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

        <!-- 停靠区在排队消息与可用性提示（输入框里）的上面；同步向导在时收成一条，排在它下面。 -->
        <!-- 按会话重建：换了会话，组件里的展开与看到第几个不带过去（状态由宿主按会话放回）。 -->
        <AgentDock v-if="dockedInputs.length > 0" ref="dockRef" :key="props.ctx.session?.id ?? ''" :items="dockedInputs" :state="props.ctx.dockState" :held="waitingForUser" @action="onAction" />
        <span class="sr-only" role="status">{{ dockAnnouncement }}</span>
        <AgentConversationComposer
            v-show="!waitingForUser"
            ref="composerRef"
            @escape="emit('escape')"
            :ctx="props.ctx"
            :services="props.services"
            :registry="props.registry"
            :layout="props.composerLayout"
            v-bind="{inert: waitingForUser}"
            @action="onAction"
        />
        <AgentStatusBar
            v-if="props.statusBar"
            :ctx="props.ctx"
            :registry="props.registry"
            v-bind="props.statusLine === undefined ? {} : {statusLine: props.statusLine}"
            @inspect="openInspector"
            @toggle="(id: string) => emit('action', {type: 'statusLine.toggle', id})"
            @open-settings="emit('action', {type: 'statusLine.openSettings'})"
        />
        <Dialog
            :open="inspectorOpen"
            size="default"
            :title="t('panel.context.title')"
            closable
            :show-footer="false"
            :teleport-target="props.teleportTarget"
            data-context-dialog
            @update:open="onInspectorOpen"
        >
            <template #header-extra>
                <IconButton size="sm" icon-class="i-lucide-refresh-cw" :title="t('panel.context.refresh')" :aria-label="t('panel.context.refresh')" data-context-refresh @click="emit('action', {type: 'context.refresh'})" />
            </template>
            <AgentContextInspector
                :inspection="props.ctx.panels.contextInspection ?? IDLE_INSPECTION"
                :system-prompt="props.ctx.panels.systemPrompt ?? null"
                :usage="props.ctx.usage"
                @load-system-prompt="emit('action', {type: 'systemPrompt.load', refresh: false})"
            />
        </Dialog>
        <Dialog
            :open="treeOpen"
            size="default"
            :title="t('panel.tree.title')"
            closable
            :show-footer="false"
            :teleport-target="props.teleportTarget"
            initial-focus="[data-tree-body]"
            data-tree-dialog
            @update:open="onTreeOpen"
        >
            <AgentSessionTree
                :tree="props.ctx.panels.sessionTree ?? LOADING_TREE"
                :can-activate="props.ctx.interaction.canMutateHistory && props.ctx.run.status === 'idle'"
                @activate="onTreeActivate"
                @copy="emit('action', {type: 'tree.copyId', entryId: $event})"
            />
        </Dialog>
        <ImagePreviewDialog
            v-if="preview !== null"
            v-model:open="previewOpen"
            :src="preview.src"
            :alt="preview.name"
            :copy-text="preview.copyText"
            :copy-label="preview.copyText === undefined ? undefined : t('stickerPreview.copy')"
            :min-size="preview.minSize ?? 0"
            :teleport-target="props.teleportTarget"
        />
    </section>
</template>

<style scoped>
/* 尺寸容器：停靠区的 40% 相对这里（它不在 `.acv-body` 里）。 */
.agent-conversation-view {
    container-type: size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    color: var(--text-main);
    font-size: var(--text-sm);
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
    /* 空态与加载说明是框架，不随消息流可选（nb-ui 规范的“文字能否选中”）。 */
    user-select: none;
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
    /* 消息、工具输出与提示都是内容；欢迎页、消息动作这些框架自己写了不可选（nb-ui 规范的“文字能否选中”）。 */
    user-select: text;
}

/* 消息在头下淡出（t29 决定 5）：离开顶部后顶端 16px 渐隐；在顶部时不渐隐，免得盖住第一条。遮罩只看透明度，颜色无关。 */
.acv-stream--faded {
    mask-image: linear-gradient(to bottom, transparent, currentColor 16px);
}

/* 第一屏在消息区里竖直居中。 */
.acv-stream__content--welcome {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 100%;
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
    transition: color var(--motion-fast) var(--ease-layout);
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
    animation: acv-appear var(--motion-fast) var(--ease-layout) var(--motion-base) both;
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
    transition: opacity var(--motion-fast) var(--ease-layout);
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
