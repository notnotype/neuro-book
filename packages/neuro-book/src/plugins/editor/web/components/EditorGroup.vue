<script setup lang="ts">
/** 一个编辑组（同名 .md）：标签条、状态条、进度条与控件。 */
import {Banner, Button, ContextMenu, Kbd} from "@notnotype/nb-ui/components";
import type {BannerTone, ContextMenuItem} from "@notnotype/nb-ui/components";
import {computed, inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, useTemplateRef, watch} from "vue";
import type {Component} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";
import TitleActions from "nbook/ui/menus/TitleActions.vue";
import {buttonBudget} from "nbook/ui/menus/title-actions";
import type {TitleActionsModel} from "nbook/ui/menus/title-actions";

import type {EditorArea, EditorControlHandle} from "../area";
import type {EditorState} from "../editor-registry";
import {BINARY_TAB_EDITOR} from "../editors";
import type {EmptyTip} from "../empty-tips";
import {EDITOR_TITLE_MAX_BUTTONS, EDITOR_TITLE_TAB_RESERVE} from "../title-actions";
import type {TabMenuEntry} from "../tab-menu";
import {pageIdOf} from "../pages";
import type {EditorPageSource} from "../pages";
import {useEditorText} from "../text";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";

import {formatResource} from "nbook/plugins/files/shared/contracts";
import {CODE_EDITOR, editorBackgroundKey, editorToolbarSlotKey, MARKDOWN_EDITOR} from "../../shared/contracts";
import BackgroundLayer from "nbook/ui/background/BackgroundLayer.vue";
import {backgroundColorIsLegible, documentAppearance, setEditorTransparent, useDocumentThemeVersion} from "nbook/ui/background/document-colors";
import {useBackgroundImage} from "nbook/ui/background/use-background-image";

import {nameOf, resourceOf} from "../documents/address";
import {tabHints} from "../tab-hints";
import {tabLabel} from "../tab-label";
import EditorBreadcrumbs from "./EditorBreadcrumbs.vue";
import type {BreadcrumbListing, BreadcrumbSegment} from "./EditorBreadcrumbs.vue";
import EditorTabBar from "./EditorTabBar.vue";
import type {TabItem} from "./EditorTabBar.vue";

const props = withDefaults(defineProps<{
    area: EditorArea;
    groupId: string;
    /** 编辑器此刻的组件：不在、未交付或已交付（docs/specs/workbench/editor.md 输出 40）。 */
    control: (editor: string) => EditorState;
    pages?: EditorPageSource | null;
    /** 组里没有标签时显示的提示（已按可用性筛好）。 */
    emptyTips?: ReadonlyArray<EmptyTip>;
    /** 标签条右侧的标题动作：只有活动组拿到，别的组为 null（docs/specs/workbench/editor.md 输出 34）。 */
    titleActions?: EditorGroupTitleActions | null;
    /** 标签的右键菜单（输出 57）；没有时右键不出菜单。 */
    tabMenu?: EditorGroupTabMenu | null;
    /** 多行标签（设置 `nbook.editor/wrapTabs`，输出 54）；缺省开。 */
    wrapTabs?: boolean;
    /** 面包屑（设置 `nbook.editor/breadcrumbs`，输出 60）；缺省开。 */
    breadcrumbs?: boolean;
    /** 作品名（面包屑的第一段）；未绑定作品时为 null，写“作品”。 */
    workTitle?: string | null;
}>(), {pages: null, emptyTips: () => [], titleActions: null, tabMenu: null, wrapTabs: true, breadcrumbs: true, workTitle: null});
const port = useText();
const t = useEditorText();

/** 点了空态里的一条提示：交出它的命令，由宿主执行（组件不执行命令）。点了标题动作、标签菜单的一项：交出它的 key。 */
const emit = defineEmits<{(event: "run-tip", command: string): void; (event: "title-action", key: string): void; (event: "tab-menu", tabId: string, key: string): void}>();

/** 打开着的标签菜单：被右击的标签、位置与打开时的身份；身份变了（标签关闭、换组、换编辑器）就关上（输出 57）。 */
const tabMenuState = shallowRef<{readonly tabId: string; readonly x: number; readonly y: number; readonly identity: string} | null>(null);
const openTabMenu = (tabId: string, x: number, y: number): void => {
    const identity = props.tabMenu?.identity(tabId) ?? null;
    tabMenuState.value = identity === null ? null : {tabId, x, y, identity};
};
watch(() => (tabMenuState.value === null ? null : props.tabMenu?.identity(tabMenuState.value.tabId) ?? null), (identity) => {
    if (tabMenuState.value !== null && identity !== tabMenuState.value.identity) tabMenuState.value = null;
});
const tabMenuItems = computed((): ContextMenuItem[] => {
    const opened = tabMenuState.value;
    if (opened === null) return [];
    return (props.tabMenu?.entries(opened.tabId) ?? []).map((entry) => (entry.kind === "separator"
        ? {separator: true}
        : {
            label: entry.label,
            disabled: entry.disabled,
            ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}),
            ...(entry.reason === null ? {} : {title: entry.reason}),
            action: () => emit("tab-menu", opened.tabId, entry.key),
        }));
});

/** 标签条一行的宽度：标题动作按它决定放几个按钮，标签条至少留一个截断标签的宽度（输出 34）。 */
const header = ref<HTMLElement | null>(null);
const headerWidth = ref<number | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
    const element = header.value;
    if (element === null || typeof ResizeObserver !== "function") return;
    observer = new ResizeObserver(() => {
        headerWidth.value = element.clientWidth > 0 ? element.clientWidth : null;
    });
    observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());

const titleModel = computed((): TitleActionsModel | null => (props.titleActions === null ? null : props.titleActions.model(buttonBudget(headerWidth.value, EDITOR_TITLE_TAB_RESERVE, EDITOR_TITLE_MAX_BUTTONS))));
const hasTitleActions = computed(() => titleModel.value !== null && (titleModel.value.buttons.length > 0 || titleModel.value.menu.length > 0));

const group = computed(() => props.area.groups.groups.value.find((candidate) => candidate.id === props.groupId) ?? null);
const activeTab = computed(() => group.value?.tabs.find((tab) => tab.id === group.value?.active) ?? null);
const document = computed(() => props.area.documentOf(props.groupId));
/** 活动文件标签的文件条目：字节标签也有（删除、订阅结束的提示用它）。 */
const file = computed(() => props.area.fileOf(props.groupId));
const binding = computed(() => props.area.binding(props.groupId));
const active = computed(() => props.area.groups.activeGroup.value === props.groupId);

const tabs = computed((): TabItem[] => {
    const shown = (group.value?.tabs ?? []).map((tab) => ({tab, page: pageIdOf(tab.address), label: tabLabel(props.area, tab, port, props.pages)}));
    // 同名提示只看文件标签（输出 56）。
    const hints = tabHints(shown.flatMap(({tab, page, label}) => (page === null && tab.kind === "file" ? [{id: tab.id, label, address: tab.address, editor: tab.editor}] : [])), {
        root: (scheme) => t(scheme === "project" ? "root.project" : "root.user"),
        editor: (id) => port.t(props.area.editors.declaration(id)?.title ?? id),
    });
    return shown.map(({tab, page, label}): TabItem => ({
        id: tab.id,
        label,
        title: page === null ? tab.address : label,
        preview: tab.preview,
        dirty: props.area.documents.get(tab.address)?.dirty.value === true,
        active: tab.id === group.value?.active,
        pinned: tab.kind === "file" && tab.pinned === true,
        icon: page === null ? fileIconForName(nameOf(tab.address)) : null,
        hint: hints.get(tab.id) ?? null,
    }));
});

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
const outline = computed(() => (props.breadcrumbs ? props.area.handleOf(props.groupId)?.outline?.value ?? null : null));
const listCrumb = async (address: string, signal: AbortSignal): Promise<BreadcrumbListing> => {
    const result = await props.area.list(address, signal);
    if (!result.ok) return {ok: false, reason: result.detail === "" ? result.code : result.detail};
    const {scheme, path} = resourceOf(address);
    // 内容根的清单文件不列（资源管理器缺省也不显示它）。
    return {ok: true, entries: result.value.entries.filter((entry) => entry.role !== "manifest").map((entry) => ({name: entry.name, kind: entry.kind, address: formatResource({scheme, path: path === "" ? entry.name : `${path}/${entry.name}`})}))};
};
/** 面包屑交还焦点：给本组的编辑器；控件还没交出句柄（还在加载）时给本组的活动标签，不让焦点掉到页面根上。 */
const section = ref<HTMLElement | null>(null);
const returnFocus = (): void => {
    const handle = props.area.handleOf(props.groupId);
    if (handle !== null) handle.focus();
    else section.value?.querySelector<HTMLElement>("[data-editor-tab][aria-selected=\"true\"]")?.focus();
};
const crumbFocus = computed(() => (props.area.breadcrumbFocus.value?.group === props.groupId ? props.area.breadcrumbFocus.value.seq : 0));

type GroupBanner = {readonly tone: BannerTone; readonly text: string; readonly actions: ReadonlyArray<{readonly id: string; readonly label: string; readonly run: () => void}>};

const banner = computed((): GroupBanner | null => {
    const current = file.value;
    if (current === null) return null;
    if (binding.value?.kind === "text" && binding.value.unresolved()) {
        return {tone: "warning", text: t("banner.unresolved"), actions: [
            {id: "adopt", label: t("banner.adopt"), run: () => props.area.resolve(props.groupId, "adopt-current")},
            {id: "keep", label: t("banner.keep"), run: () => props.area.resolve(props.groupId, "keep-view")},
        ]};
    }
    const blocked = binding.value?.kind === "text" ? current.blocked.value.get(binding.value.token) : undefined;
    if (blocked !== undefined) {
        const excerpt = blocked.excerpt === "" ? "" : t("banner.unrepresentableExcerpt", {excerpt: blocked.excerpt});
        return {tone: "danger", text: t("banner.unrepresentable", {index: blocked.index, excerpt}), actions: [
            {id: "locate", label: t("banner.locate"), run: () => props.area.locate(props.groupId)},
            {id: "adopt", label: t("banner.adopt"), run: () => props.area.unblock(props.groupId)},
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

const onReady = (editor: string, handle: EditorControlHandle | null): void => props.area.registerHandle(props.groupId, editor, handle);

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
const pageComponent = computed(() => (pageId.value === null ? null : props.pages?.component(pageId.value) ?? null));

// 控件按编辑器各挂一个：换文档只换绑定，不重建控件；同组另一种控件停放（不卸载、不可见）。只挂已交付的编辑器。
const controls = computed((): Array<{readonly editor: string; readonly component: Component}> => {
    const present = new Set<string>();
    for (const tab of group.value?.tabs ?? []) if (tab.kind === "file" && tab.editor !== BINARY_TAB_EDITOR) present.add(tab.editor);
    return [...present].flatMap((editor) => {
        const state = props.control(editor);
        return state.kind === "ready" ? [{editor, component: state.component}] : [];
    });
});

export interface EditorGroupTabMenu {
    /** 标签的菜单项；标签已不在为 null。 */
    readonly entries: (tabId: string) => ReadonlyArray<TabMenuEntry> | null;
    /** 菜单身份；标签已不在为 null。 */
    readonly identity: (tabId: string) => string | null;
}

export interface EditorGroupTitleActions {
    /** 拿到标题动作的组（活动组）。 */
    readonly group: string;
    /** 按组给出的按钮个数拼好的标题动作。 */
    readonly model: (maxButtons: number) => TitleActionsModel;
    /** “⋯”的菜单身份：活动组、活动标签与地址。 */
    readonly identity: string;
}

const toolbarSlot = useTemplateRef<HTMLElement>("toolbarSlot");
provide(editorToolbarSlotKey, toolbarSlot);

/** 正文背景（docs/specs/ui/backgrounds.md 输出 1）：只有 Markdown 与源码编辑器透出，图片查看器这些不是长文。 */
const backgroundSource = inject(editorBackgroundKey, null);
const backgroundImage = useBackgroundImage(() => {
    const setting = backgroundSource?.setting.value;
    if (setting?.kind !== "image") return null;
    const url = backgroundSource?.url(setting.image) ?? null;
    return url === null ? null : {url, fit: setting.fit, blur: setting.blur, scrim: setting.scrim};
}, (error) => backgroundSource?.report(error));
const backgroundTheme = useDocumentThemeVersion();
const backgroundColor = computed(() => {
    const setting = backgroundSource?.setting.value;
    if (setting?.kind !== "color") return null;
    void backgroundTheme.value;
    const color = setting[documentAppearance()];
    return backgroundColorIsLegible(color) ? color : null;
});
const showsBackground = computed(() => {
    const editor = binding.value?.editor;
    return (editor === MARKDOWN_EDITOR || editor === CODE_EDITOR) && (backgroundImage.active.value !== null || backgroundColor.value !== null);
});
const transparentOwner = Symbol("editor-group");
watch(showsBackground, (on) => setEditorTransparent(transparentOwner, on), {immediate: true});
onBeforeUnmount(() => setEditorTransparent(transparentOwner, false));
</script>

<template>
    <section
        ref="section"
        class="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--editor-inner-surface,var(--panel-surface))]"
        :class="active ? '' : 'opacity-[0.98]'"
        :aria-label="t('area.label')"
        :data-editor-group="groupId"
        :data-editor-group-active="active ? '' : undefined"
        @focusin="area.focusGroup(groupId)"
        @pointerdown="(event: PointerEvent) => event.button === 0 && area.focusGroup(groupId)"
    >
        <!-- 标签多时标签条自己横向滚动，标题动作固定在右侧、不随之滚动。 -->
        <div ref="header" class="editor-group__header">
            <EditorTabBar
                class="editor-group__tabs"
                :tabs="tabs"
                :label="t('area.tabsLabel')"
                :close-label="(name: string) => t('tab.close', {name})"
                :unpin-label="(name: string) => t('tab.unpin', {name})"
                :unsaved-label="t('tab.unsaved')"
                :pinned-label="t('tab.pinned')"
                :wrap="wrapTabs"
                :group-active="active"
                @activate="(id: string) => area.activate(id)"
                @keep="(id: string) => area.keep(id)"
                @unpin="(id: string) => area.setPinned(id, false)"
                @close="(id: string) => void area.close(id)"
                @move="(id: string, delta: -1 | 1) => area.groups.move(id, delta)"
                @menu="openTabMenu"
            />
            <ContextMenu :open="tabMenuState !== null" :x="tabMenuState?.x ?? 0" :y="tabMenuState?.y ?? 0" :items="tabMenuItems" @request-close="tabMenuState = null" />
            <TitleActions
                v-if="hasTitleActions"
                class="editor-group__title-actions"
                :model="titleModel!"
                :identity="titleActions!.identity"
                :more-label="t('area.moreActions')"
                data-editor-title-actions
                @run="(key: string) => emit('title-action', key)"
            />
        </div>
        <div class="flex min-w-0 shrink-0 items-center bg-[var(--editor-inner-surface,var(--panel-surface))]">
            <EditorBreadcrumbs
                v-if="crumbs.segments.length > 0"
                class="min-w-0 flex-[1_1_160px]"
                :segments="crumbs.segments"
                :parent="crumbs.parent"
                :outline="outline"
                :list="listCrumb"
                :focus-seq="crumbFocus"
                @open="(address: string) => void area.open(address, {mode: 'preview', group: groupId})"
                @reveal="(binding: string, version: number, id: string) => void area.handleOf(groupId)?.revealHeading?.(binding, version, id)"
                @escape="returnFocus"
            />
            <div ref="toolbarSlot" class="flex min-w-0 shrink" data-editor-toolbar-slot></div>
        </div>
        <div class="relative h-0.5 shrink-0 overflow-hidden" aria-hidden="true">
            <div v-if="area.progress(groupId)" class="editor-group__progress absolute inset-y-0 w-1/3 bg-[var(--accent-main)]" data-editor-progress></div>
        </div>
        <!-- 进度条本身只是装饰：同一时刻给读屏一句可播报的“正在读取”。 -->
        <p v-if="area.progress(groupId)" class="sr-only" role="status">{{ t("area.loading") }}</p>
        <Banner v-if="banner !== null" class="shrink-0" :tone="banner.tone" :message="banner.text" data-editor-banner>
            <template v-if="banner.actions.length > 0" #actions>
                <Button v-for="action in banner.actions" :key="action.id" size="sm" variant="secondary" :data-editor-banner-action="action.id" @click="action.run()">{{ action.label }}</Button>
            </template>
        </Banner>
        <div class="relative min-h-7 flex-1" :aria-busy="area.progress(groupId) ? 'true' : undefined" data-editor-content>
            <BackgroundLayer
                v-if="showsBackground && backgroundImage.active.value !== null"
                :url="backgroundImage.active.value.url"
                :fit="backgroundImage.active.value.fit"
                :blur="backgroundImage.active.value.blur"
                :alpha="backgroundImage.active.value.alpha"
            />
            <BackgroundLayer v-else-if="showsBackground" :url="null" :color="backgroundColor" />
            <div v-if="activeTab === null" class="editor-group__empty" data-editor-empty>
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
            <div v-if="pageId !== null" class="absolute inset-0 overflow-auto" :data-editor-page="pageId">
                <component :is="pageComponent" v-if="pageComponent !== null" :context="pages!.context" />
                <p v-else class="flex h-full items-center justify-center px-6 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]" data-editor-page-missing>{{ t("page.missing") }}</p>
            </div>
            <template v-for="mounted in controls" :key="mounted.editor">
                <div v-show="binding !== null && binding.editor === mounted.editor" class="absolute inset-0" :data-editor-kind="mounted.editor">
                    <component
                        :is="mounted.component"
                        :binding="binding !== null && binding.editor === mounted.editor ? binding : null"
                        :host="area.controlSlot(groupId, mounted.editor)"
                        :readonly="!area.viewWritable(groupId)"
                        :visible="binding !== null && binding.editor === mounted.editor"
                        :label="activeTab === null ? '' : nameOf(activeTab.address)"
                        :locale="port.locale.value"
                        @ready="(handle: EditorControlHandle | null) => onReady(mounted.editor, handle)"
                        @focus="(focused: boolean) => (area.focused.value = focused)"
                    />
                </div>
            </template>
        </div>
    </section>
</template>

<style scoped>
/* 标签条与标题动作一行：标签条占剩下的宽度、放不下时自己横向滚动，标题动作不收缩（docs/specs/workbench/editor.md 输出 34）。 */
/*
 * 标签条一行到三行（输出 54）：组矮的时候先收它（flex 可收缩、至少一行），正文至少留一行字的高度、提示条不收缩，标签区
 * 在自己里面纵向滚动。底色与标签条同一档，标题动作落在最后一行的右侧。
 */
.editor-group__header {
    display: flex;
    flex: 0 1 auto;
    align-items: stretch;
    min-height: 34px;
    overflow: hidden;
    background: var(--editor-tabs-surface);
}

.editor-group__tabs {
    min-width: 0;
    flex: 1 1 auto;
}

.editor-group__title-actions {
    align-self: flex-end;
    height: 34px;
    padding-inline: var(--space-1) var(--space-2);
    /* 悬停时显示（输出 58）：鼠标在组上、焦点在组里或“⋯”打开时；仍占位、仍能 Tab 到。 */
    opacity: 0;
    transition: opacity 100ms linear;
}

[data-editor-group]:hover .editor-group__title-actions,
[data-editor-group]:focus-within .editor-group__title-actions,
.editor-group__title-actions:has([aria-expanded="true"]) {
    opacity: 1;
}

@media (hover: none) {
    .editor-group__title-actions {
        opacity: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .editor-group__title-actions {
        transition: none;
    }
}

/* 空态（docs/specs/workbench/editor.md 输出 32）：正中一个淡色的图形标志，下面几行提示，说明靠右、按键或位置靠左。 */
.editor-group__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 36px;
    height: 100%;
    padding: 24px;
    overflow: hidden;
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
    /* 背景层是定位元素，不定位的提示会被它盖住。 */
    position: relative;
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
