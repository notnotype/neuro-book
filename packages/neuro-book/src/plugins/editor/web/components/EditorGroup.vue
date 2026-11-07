<script setup lang="ts">
/**
 * 一个标签的内容（同名 .md）：内容层里每个标签一块，空的编辑组一块。标签移到别的组时这块内容不重建，`groupId` 跟着变。面包屑、进度条与状态条只有组此刻显示的那块才画；
 * 其余的只留控件，由内容层停放。提示条与标签条在 `EditorGroupHead`。
 */
import {Banner, Button, Kbd} from "@notnotype/nb-ui/components";
import type {BannerTone} from "@notnotype/nb-ui/components";
import {computed, provide, useTemplateRef} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import type {EditorArea, EditorControlHandle} from "../area";
import type {EditorState} from "../editor-registry";
import {BINARY_TAB_EDITOR} from "../editors";
import type {EmptyTip} from "../empty-tips";
import {pageIdOf} from "../pages";
import type {EditorPageSource} from "../pages";
import {useEditorText} from "../text";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";

import {formatResource} from "nbook/plugins/files/shared/contracts";
import {editorToolbarSlotKey} from "../../shared/contracts";

import {nameOf, resourceOf} from "../documents/address";
import {LOST_TAB_ADDRESS} from "../groups/groups";
import EditorBreadcrumbs from "./EditorBreadcrumbs.vue";
import type {BreadcrumbListing, BreadcrumbSegment} from "./EditorBreadcrumbs.vue";
import {useEditorGroupRoot} from "./useEditorGroupRoot";
import type {EditorIntent} from "./useEditorGroupRoot";

const props = withDefaults(defineProps<{
    area: EditorArea;
    /** 这个标签现在所在的编辑组。 */
    groupId: string;
    /** 这块内容属于哪个标签；null 是空的编辑组。 */
    tabId: string | null;
    /** 编辑器此刻的组件：不在、未交付或已交付（docs/specs/workbench/editor.md 输出 40）。 */
    control: (editor: string) => EditorState;
    pages?: EditorPageSource | null;
    /** 组里没有标签时显示的提示（已按可用性筛好）。 */
    emptyTips?: ReadonlyArray<EmptyTip>;
    /** 面包屑（设置 `nbook.editor/breadcrumbs`，输出 60）；缺省开。 */
    breadcrumbs?: boolean;
    /** 作品名（面包屑的第一段）；未绑定作品时为 null，写“作品”。 */
    workTitle?: string | null;
}>(), {pages: null, emptyTips: () => [], breadcrumbs: true, workTitle: null});
const port = useText();
const t = useEditorText();

/** 点了空态里的一条提示：交出它的命令，由宿主执行（组件不执行命令）。 */
const emit = defineEmits<{(event: "intent", intent: EditorIntent): void; (event: "run-tip", command: string): void}>();

/**
 * 这块内容真正所在的组：组级的读取都按它。属性 `groupId` 是它此刻画在哪块面板上，实时布局预览时是预览的组，那边的活动文档不是这个标签的。
 */
const ownGroup = computed(() => (props.tabId === null ? props.groupId : props.area.groups.find(props.tabId)?.group.id ?? props.groupId));

const root = useEditorGroupRoot({area: () => props.area, groupId: () => ownGroup.value, intent: (intent) => emit("intent", intent), root: "section"});

// 这几个值都比引用或布尔：别的标签变了（切换、记光标）时这块内容不重画。开着几十个标签时这一点要紧。
const tab = computed(() => (props.tabId === null ? null : props.area.groups.find(props.tabId)?.tab ?? null));
/** 这块内容是组此刻显示的那块：它是组的活动标签，或者组是空的。 */
const current = computed(() => props.tabId === null || props.area.groups.find(props.tabId)?.group.active === props.tabId);
/** 下面的面包屑、横幅、失败原因都只为组此刻显示的那块算：不活动的标签不读文档状态，也不画。 */
const activeTab = computed(() => (current.value ? tab.value : null));
const document = computed(() => (current.value ? props.area.documentOf(ownGroup.value) : null));
/** 活动文件标签的文件条目：字节标签也有（删除、订阅结束的提示用它）。 */
const file = computed(() => (current.value ? props.area.fileOf(ownGroup.value) : null));
/** 只为留着控件的标签取绑定：取绑定会打开文档，恢复出来、没活动过的标签不读。 */
const mounted = computed(() => props.tabId !== null && props.area.mountedControls.value.has(props.tabId));
const binding = computed(() => (props.tabId !== null && mounted.value ? props.area.tabBinding(props.tabId) : null));
const writable = computed(() => props.tabId !== null && mounted.value && props.area.tabWritable(props.tabId));
const active = computed(() => props.area.groups.activeGroup.value === ownGroup.value);

/** 面包屑的段（输出 60）：活动标签是文件时，根 › 目录 › 文件；页面标签与空组没有。 */
const crumbs = computed((): {segments: BreadcrumbSegment[]; parent: string | null} => {
    const tab = activeTab.value;
    if (!props.breadcrumbs || tab === null || tab.kind === "page") return {segments: [], parent: null};
    const {scheme, path} = resourceOf(tab.address);
    const parts = path.split("/");
    const root = formatResource({scheme, path: ""});
    const segments: BreadcrumbSegment[] = [{kind: "root", label: scheme === "project" ? (props.workTitle ?? t("root.project")) : t("root.user"), address: root}];
    for (let index = 0; index < parts.length - 1; index += 1) segments.push({kind: "dir", label: parts[index] as string, address: formatResource({scheme, path: parts.slice(0, index + 1).join("/")})});
    segments.push({kind: "file", label: parts.at(-1) ?? "", address: tab.address, icon: fileIconForName(parts.at(-1) ?? "")});
    return {segments, parent: segments.at(-2)?.address ?? null};
});
const outline = computed(() => (props.breadcrumbs && current.value ? props.area.handleOf(ownGroup.value)?.outline?.value ?? null : null));
const listCrumb = async (address: string, signal: AbortSignal): Promise<BreadcrumbListing> => {
    const result = await props.area.list(address, signal);
    if (!result.ok) return {ok: false, reason: result.detail === "" ? result.code : result.detail};
    const {scheme, path} = resourceOf(address);
    // 内容根的清单文件不列（资源管理器缺省也不显示它）。
    return {ok: true, entries: result.value.entries.filter((entry) => entry.role !== "manifest").map((entry) => ({name: entry.name, kind: entry.kind, address: formatResource({scheme, path: path === "" ? entry.name : `${path}/${entry.name}`})}))};
};
/** 面包屑交还焦点：给本组的编辑器；控件还没交出句柄（还在加载）时给本组的活动标签，不让焦点掉到页面根上。 */
const returnFocus = (): void => {
    const handle = props.area.handleOf(ownGroup.value);
    if (handle !== null) handle.focus();
    else window.document.querySelector<HTMLElement>(`[data-editor-group-head="${CSS.escape(ownGroup.value)}"] [data-editor-tab][aria-selected="true"]`)?.focus();
};
const crumbFocus = computed(() => (props.area.breadcrumbFocus.value?.group === ownGroup.value ? props.area.breadcrumbFocus.value.seq : 0));

type GroupBanner = {readonly tone: BannerTone; readonly text: string; readonly actions: ReadonlyArray<{readonly id: string; readonly label: string; readonly run: () => void}>};

const banner = computed((): GroupBanner | null => {
    const current = file.value;
    if (current === null) return null;
    if (binding.value?.kind === "text" && binding.value.unresolved()) {
        return {tone: "warning", text: t("banner.unresolved"), actions: [
            {id: "adopt", label: t("banner.adopt"), run: () => props.area.resolve(ownGroup.value, "adopt-current")},
            {id: "keep", label: t("banner.keep"), run: () => props.area.resolve(ownGroup.value, "keep-view")},
        ]};
    }
    const blocked = binding.value?.kind === "text" ? current.blocked.value.get(binding.value.token) : undefined;
    if (blocked !== undefined) {
        const excerpt = blocked.excerpt === "" ? "" : t("banner.unrepresentableExcerpt", {excerpt: blocked.excerpt});
        return {tone: "danger", text: t("banner.unrepresentable", {index: blocked.index, excerpt}), actions: [
            {id: "locate", label: t("banner.locate"), run: () => props.area.locate(ownGroup.value)},
            {id: "adopt", label: t("banner.adopt"), run: () => props.area.unblock(ownGroup.value)},
        ]};
    }
    if (current.conflict.value !== null) {
        return {tone: "danger", text: t("banner.conflict"), actions: [
            {id: "reload", label: t("banner.reload"), run: () => void props.area.revert()},
            {id: "overwrite", label: t("banner.overwrite"), run: () => void props.area.overwrite()},
        ]};
    }
    if (current.ended.value !== null) return {tone: "danger", text: t("banner.ended", {reason: current.ended.value}), actions: []};
    if (current.status.value === "deleted") return {tone: "warning", text: current.dirty.value ? t("banner.deleted") : t("banner.deletedClean"), actions: []};
    if (current.diskChanged.value) return {tone: "warning", text: t("banner.diskChanged"), actions: [{id: "reload", label: t("banner.reload"), run: () => void props.area.revert()}]};
    const problem = current.saveProblem.value;
    if (problem !== null) return {tone: "danger", text: problem.code === "unknown-outcome" ? t("banner.saveUnknown") : t("banner.saveFailed", {reason: problem.detail || problem.code}), actions: []};
    return null;
});

/** 读取失败：不是 UTF-8 文本时说明原因、不给重试（输出 37 第 3 步），其余给重试。 */
const failure = computed((): {readonly text: string; readonly retry: boolean} | null => {
    const current = document.value;
    if (current === null || current.status.value !== "failed") return null;
    if (current.failure.value?.code === "not-text") return {text: t("document.notText", {name: nameOf(current.target.value.path)}), retry: false};
    // 与保存失败的提示一样给文件服务的说明，没有说明时才给失败码。
    const problem = current.failure.value;
    return {text: t("document.openFailed", {name: nameOf(current.target.value.path), reason: problem?.detail || problem?.code || ""}), retry: true};
});

/**
 * 活动文件标签的编辑器不能渲染的原因：已知二进制（输出 37 第 1 步）、编辑器不在了、还没交付（输出 40）。能渲染为 null。
 */
const unavailable = computed((): "binary" | "gone" | "pending" | null => {
    const tab = activeTab.value;
    if (tab === null || tab.kind === "page") return null;
    if (tab.editor === BINARY_TAB_EDITOR) return "binary";
    const state = props.control(tab.editor).kind;
    return state === "ready" ? null : state;
});

/** 活动标签是页面时的页面 id；文件标签为 null。 */
const pageId = computed(() => (activeTab.value === null ? null : pageIdOf(activeTab.value.address)));
/** 铺场景图的状态（docs/specs/theme/skins.md 输出 4）：没开文件，或活动页声明了要。主题没有场景时这一层不显示。 */
const showsScene = computed(() => props.tabId === null || (pageId.value !== null && props.pages?.scene(pageId.value) === true));
const pageComponent = computed(() => (pageId.value === null ? null : props.pages?.component(pageId.value) ?? null));
/** 这个标签的记录丢了（docs/specs/ui/workbench-layout.md 输出 34）：说明原因，关掉就好。 */
const lost = computed(() => activeTab.value?.address === LOST_TAB_ADDRESS);

/**
 * 这个标签的控件：编辑器已交付、标签在留着控件的范围里才挂。换编辑器时换一个控件。写成至多一项的列表，模板里 `v-for` 的变量是这一项：
 * 控件卸载时才发的 `ready(null)` 要记到它挂上时的标签与编辑器，这时这个计算值可能已经是空的或已经换了。
 */
const controls = computed(() => {
    const shown = tab.value;
    if (props.tabId === null || !mounted.value || shown === null || shown.kind === "page" || shown.editor === BINARY_TAB_EDITOR) return [];
    const state = props.control(shown.editor);
    return state.kind === "ready" ? [{tabId: props.tabId, editor: shown.editor, component: state.component, label: nameOf(shown.address)}] : [];
});

const toolbarSlot = useTemplateRef<HTMLElement>("toolbarSlot");
provide(editorToolbarSlotKey, toolbarSlot);
</script>

<template>
    <section
        ref="section"
        class="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--panel-surface)]"
        :class="active ? '' : 'opacity-[0.98]'"
        :aria-label="t('area.label')"
        :data-editor-group="current ? ownGroup : undefined"
        :data-editor-group-active="current && active ? '' : undefined"
        @keydown="root.onKeydown"
        @focusin="root.onFocusIn"
        @focusout="root.onFocusOut"
        @pointerdown="root.onPointerDown"
    >
        <div class="flex min-w-0 shrink-0 items-center bg-[var(--panel-surface)]">
            <EditorBreadcrumbs
                v-if="crumbs.segments.length > 0"
                class="min-w-0 flex-[1_1_160px]"
                :segments="crumbs.segments"
                :parent="crumbs.parent"
                :outline="outline"
                :list="listCrumb"
                :focus-seq="crumbFocus"
                @open="(address: string) => void area.open(address, {mode: 'preview', group: ownGroup, reveal: 'cursor'})"
                @reveal="(binding: string, version: number, id: string) => void area.handleOf(ownGroup)?.revealHeading?.(binding, version, id)"
                @escape="returnFocus"
            />
            <div ref="toolbarSlot" class="flex min-w-0 shrink" data-editor-toolbar-slot></div>
        </div>
        <div class="relative h-0.5 shrink-0 overflow-hidden" aria-hidden="true">
            <div v-if="current && area.progress(ownGroup)" class="editor-group__progress absolute inset-y-0 w-1/3 bg-[var(--accent-main)]" data-editor-progress></div>
        </div>
        <!-- 进度条本身只是装饰：同一时刻给读屏一句可播报的“正在读取”。 -->
        <p v-if="current && area.progress(ownGroup)" class="sr-only" role="status">{{ t("area.loading") }}</p>
        <Banner v-if="banner !== null" class="shrink-0" :tone="banner.tone" :message="banner.text" data-editor-banner>
            <template v-if="banner.actions.length > 0" #actions>
                <Button v-for="action in banner.actions" :key="action.id" size="sm" variant="secondary" :data-editor-banner-action="action.id" @click="action.run()">{{ action.label }}</Button>
            </template>
        </Banner>
        <div class="relative min-h-7 flex-1" :aria-busy="current && area.progress(ownGroup) ? 'true' : undefined" data-editor-content>
            <div v-if="showsScene" class="editor-group__scene" aria-hidden="true" data-editor-scene></div>
            <div v-if="tabId === null" class="editor-group__empty" data-editor-empty>
                <NeuroBookMark class="editor-group__mark" decorative />
                <div v-if="emptyTips.length > 0" class="editor-group__tips">
                    <button v-for="tip in emptyTips" :key="tip.command" type="button" class="editor-group__tip nb-ui-focus-ring" :data-editor-empty-tip="tip.command" @click="emit('run-tip', tip.command)">
                        <span class="editor-group__tip-label">{{ tip.label }}</span>
                        <span v-if="tip.keys !== null" class="editor-group__tip-keys"><Kbd v-for="key in tip.keys" :key="key">{{ key }}</Kbd></span>
                        <span v-else class="editor-group__tip-hint">{{ tip.hint }}</span>
                    </button>
                </div>
            </div>
            <div v-else-if="unavailable === 'binary' || unavailable === 'gone'" class="flex flex-col items-start gap-2 p-6 text-sm" role="alert" :data-editor-unavailable="unavailable">
                <p>{{ t(unavailable === "binary" ? "document.binary" : "document.editorGone", {name: activeTab === null ? "" : nameOf(activeTab.address)}) }}</p>
                <Button v-if="unavailable === 'gone'" size="sm" variant="secondary" data-editor-reopen-default @click="area.reopenWithDefault()">{{ t("document.reopenDefault") }}</Button>
            </div>
            <!-- 编辑器还没交付：800 毫秒内空白，之后才说明（与读取的进度条同一规则，输出 6、40）。 -->
            <p v-else-if="unavailable === 'pending'" class="editor-group__pending" role="status" data-editor-pending>{{ t("document.editorLoading") }}</p>
            <div v-else-if="failure !== null" class="flex flex-col items-start gap-2 p-6 text-sm" role="alert" data-editor-failure>
                <p>{{ failure.text }}</p>
                <Button v-if="failure.retry" size="sm" variant="secondary" @click="document !== null && area.documents.retry(document)">{{ t("document.retry") }}</Button>
            </div>
            <!-- 页面标签：渲染页面贡献的组件；贡献方停了时说明，不显示别的。 -->
            <div v-if="pageId !== null" class="absolute inset-0 overflow-auto" :class="showsScene ? 'editor-group__on-scene' : ''" :data-editor-page="pageId">
                <component :is="pageComponent" v-if="pageComponent !== null" :context="pages!.context" />
                <p v-else-if="lost" class="flex h-full items-center justify-center px-6 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]" data-editor-tab-lost>{{ t("tab.lostBody") }}</p>
                <p v-else class="flex h-full items-center justify-center px-6 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]" data-editor-page-missing>{{ t("page.missing") }}</p>
            </div>
            <div v-for="item in controls" v-show="binding !== null" :key="item.editor" class="absolute inset-0" :data-editor-kind="item.editor">
                <component
                    :is="item.component"
                    :binding="binding"
                    :host="area.tabControlSlot(item.tabId, item.editor)"
                    :readonly="!writable"
                    :visible="current && binding !== null"
                    :label="item.label"
                    :locale="port.locale.value"
                    @ready="(handle: EditorControlHandle | null) => area.registerTabHandle(item.tabId, item.editor, handle)"
                    @focus="(focused: boolean) => (area.focused.value = focused)"
                />
            </div>
        </div>
    </section>
</template>

<style scoped>
/* 变量名见 src/ui/theme/skin-vars.ts。没有场景的主题不写 data-nb-skin-scene，这一层不占地方。 */
.editor-group__scene {
    display: none;
}

:global([data-nb-skin-scene] .editor-group__scene) {
    position: absolute;
    inset: 0;
    display: block;
    background-image: var(--skin-scene);
    background-position: var(--skin-empty-position, center);
    background-repeat: no-repeat;
    background-size: cover;
    pointer-events: none;
}

@media (prefers-contrast: more), (forced-colors: active) {
    :global([data-nb-skin-scene] .editor-group__scene) {
        display: none;
    }
}

/* 空态（docs/specs/workbench/editor.md 输出 32）：正中一个淡色的图形标志，下面几行提示，说明靠右、按键或位置靠左。 */
.editor-group__empty {
    /* 场景层是定位元素，不定位的内容会被它盖住。 */
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 36px;
    height: 100%;
    padding: 24px;
    overflow: hidden;
}

/* 内容往场景的留白上偏（输出 4）。要写在 `.editor-group__empty` 之后：两条特异性相同，它的 padding 简写会盖掉这里。 */
:global([data-nb-skin-scene] .editor-group__on-scene),
:global([data-nb-skin-scene] .editor-group__empty) {
    padding-inline-end: var(--skin-empty-shift, 0);
}

/* 组被拆得很矮时标志先缩（宽随高），提示不被挤掉。 */
.editor-group__mark {
    flex: 0 1 132px;
    min-height: 32px;
    height: auto;
    color: color-mix(in srgb, var(--text-main) 9%, transparent);
}

.editor-group__tips {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 14px;
    row-gap: 2px;
    font-size: var(--text-sm);
}

/* 每行是一个按钮：跨两列并沿用外层的列（subgrid），两列在各行之间对齐，按钮本身仍可聚焦。 */
.editor-group__tip {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    padding: 4px 8px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    text-align: left;
}

.editor-group__tip:hover {
    background: var(--bg-hover);
}

.editor-group__tip-label {
    text-align: right;
}

.editor-group__tip-keys {
    display: flex;
    gap: 3px;
}

.editor-group__tip-hint {
    color: var(--text-muted);
}

.editor-group__pending {
    padding: 24px;
    font-size: var(--text-sm);
    color: var(--text-muted);
    opacity: 0;
    animation: editor-group-reveal 1ms linear 800ms forwards;
}

@keyframes editor-group-reveal {
    to {
        opacity: 1;
    }
}

.editor-group__progress {
    animation: editor-group-progress 1.2s var(--ease-standard) infinite;
}

@keyframes editor-group-progress {
    from {
        left: -33%;
    }

    to {
        left: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .editor-group__progress {
        animation: none;
        left: 0;
        width: 100%;
        opacity: 0.6;
    }
}
</style>
