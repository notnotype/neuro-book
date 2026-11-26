<script setup lang="ts">
/**
 * 编辑组的 Lab 集成场景（docs/specs/workbench/editor.md，同名 .md）：产品里同一个编辑器区控制器、组与标签模型、
 * 文档模型与控件，文件客户端换成内存适配器（`explorer-scene/memory-files.ts`，与真实 Files 对过契约）；编辑组摆在工作台同一张表面上，拖动也是工作台的手势，
 * 布局文档放在内存里。保存、外部改写、外部删除都真的改变场景数据；切场景时控制器与订阅一起释放。场景 `split` 先拆成两组；场景 `empty` 不打开文件，空态带上
 * 与产品同样的三行提示（产品里由插件按命令可用性筛出，这里是固定样例），点了只记事件。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {applyGestureCommit, projectLayoutDoc, setFloatRect} from "@notnotype/nb-workbench-layout";
import type {GridExtent} from "@notnotype/nb-layout";
import type {LayoutFloatRect} from "@notnotype/nb-workbench-layout";
import {computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref, shallowRef, useTemplateRef, watch} from "vue";
import type {Component} from "vue";

import {createEditorArea} from "nbook/plugins/editor/web/area";
import EditorGroup from "nbook/plugins/editor/web/components/EditorGroup.vue";
import EditorGroupHead from "nbook/plugins/editor/web/components/EditorGroupHead.vue";
import EditorHost from "nbook/plugins/editor/web/components/EditorHost.vue";
import {createMemoryEditorPanels, editorTabIdOf} from "nbook/plugins/workbench/shared/editor-panels";
import WorkbenchDragFeedback from "nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue";
import WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import type {EditorTabDrag} from "nbook/plugins/workbench/web/contracts";
import {isEntryAction} from "nbook/plugins/workbench/web/entry-drop";
import {createLayoutDrag} from "nbook/plugins/workbench/web/layout-drag";
import type {LayoutDrag} from "nbook/plugins/workbench/web/layout-drag";
import {createLayoutPolicy, EDITOR_GROUP_MINIMUM, layoutProjectionOptions} from "nbook/plugins/workbench/web/state/layout-constraints";
import type {EmptyTip} from "nbook/plugins/editor/web/empty-tips";
import type {EditorState} from "nbook/plugins/editor/web/editor-registry";
import {createAssetUrls, markdownAssetsKey} from "nbook/plugins/markdown/web/parts/asset-urls";
import {markdownStickersKey} from "nbook/plugins/markdown/web/parts/stickers";
import {SyntaxCatalog, syntaxCatalogKey} from "nbook/plugins/markdown/web/syntax-catalog";
import {CODE_EDITOR, editorMenusKey, MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
import {editorText} from "nbook/plugins/editor/shared/text";

import {useLabEventSink} from "../../lab-event-sink";
import type {LabFixtureProps} from "../../lab-subject";
import LabFixtureControls from "../../LabFixtureControls.vue";
import {createMemoryFiles} from "../explorer-scene/memory-files";
import {LAB_STICKER_TEXT, labStickers} from "../lab-stickers";
import {provideEditorText} from "./editor-text";
import {createLabEditorMenus} from "./lab-editor-menus";

const props = defineProps<LabFixtureProps>();
/** 界面语言只由场景决定（场景 `english` 用英文），端口注入给后代的编辑器区。 */
const text = provideEditorText(props.scene);
const record = useLabEventSink();

/** 方言场景的正文：各种方言、提示块、任务列表与原样内容在编辑器里的样子（docs/specs/workspace/markdown-dialect.md）。 */
const DIALECT = [
    "# 方言一览",
    "",
    "她抬头<comment body=\"这里节奏太快\">看了他一眼</comment>，远处站着<ruby text=\"hàn zì\">汉字</ruby>先生，<mark>高亮</mark>、<span style=\"color: #ef4444\">红字</span>与 x<sup>2</sup>。",
    "",
    "<comment body=\"整段视角混乱\">",
    "老人走向祭坛。",
    "",
    "风里带着灰烬的味道。",
    "</comment>",
    "",
    "<bilingual text=\"老人缓缓走向祭坛。\">",
    "The old man walked toward the altar.",
    "</bilingual>",
    "",
    "<align value=\"center\">*— 在记忆断裂的地方，世界重新开始。—*</align>",
    "",
    "> [!NOTE]",
    "> 普通的提示。",
    "",
    "> [!TIP] 小技巧",
    "> 写短句。",
    "",
    "> [!IMPORTANT]",
    "> 重要的事。",
    "",
    "> [!WARNING]- 伏笔（默认折叠）",
    "> 她其实早就知道。",
    "",
    "> [!CAUTION]+ 注意",
    "> 不要改这一章的时间线。",
    "",
    "- [ ] 待办",
    "- [x] 完成",
    "",
    "按 <kbd>Ctrl</kbd>+<kbd>S</kbd> 保存，公式 $x^2$，脚注[^1]。",
    "",
    "<div class=\"note\">",
    "未知的 HTML 块原样保留。",
    "</div>",
    "",
    "<html>",
    "<div style=\"padding: 8px\">状态面板</div>",
    "</html>",
    "",
    "[^1]: 脚注内容。",
    "",
    "她翻开[<comment body=\"出场\">林雪</comment>的设定](../设定/林雪.md)，又看了[外部的资料](https://example.com)。",
    "",
    "![封面](images/封面.png) ![外面的图](../../外面.png)",
    "",
].join("\n");

/** 批注场景的正文（docs/specs/workbench/markdown-editing.md 输出 28–35）：短的、多行的、重叠的、块的、挨得很近的几条。 */
const COMMENTS = [
    "# 第一章 雾港",
    "",
    "雾是从海上来的。凌晨四点，码头的灯一盏一盏熄下去，林汐把缆绳在手上绕了两圈，听见身后有人踩着湿木板走近。",
    "",
    "“船今天不出。”周砚说。他的声音比雾还轻，<comment body=\"这个比喻和第三章重复了，换一个。\">像是怕惊动什么</comment>。",
    "",
    "林汐没有回头。<comment body=\"这里节奏太快：读者还不知道两人的过去。先补一句动作，再接这句。&#10;（第二行：可以让她先把缆绳放下，再往下写。）\">她知道他说的不是船。</comment>缆绳在她掌心里勒出一道白印，她松开手，又攥紧。",
    "",
    "<comment body=\"整段视角混乱，需要重写\">",
    "",
    "潮水退到第三根桩子的时候，灯塔的光扫过来，<comment body=\"信的来历要在第二章埋伏笔。\">照见他手里攥着的那封信</comment>。",
    "",
    "信封的一角已经被雾气洇软了。",
    "",
    "</comment>",
    "",
    "<comment body=\"外层\">她把<comment body=\"内层：同一段文字上盖了两条批注\">信</comment>收进袖口</comment>，转身走向灯塔。",
    "",
].join("\n");

/** 批注的显示场景（输出 37）：重叠两层、三层，块批注里套行内批注，块批注盖着表格。 */
const COMMENT_OVERLAP = [
    "# 重叠与块批注的显示",
    "",
    "两条批注盖住同一段：<comment body=\"外层\"><comment body=\"内层\">同一段文字</comment>被外层盖着</comment>。",
    "",
    "三层：<comment body=\"一\"><comment body=\"二\">她看了<comment body=\"三\">他一眼</comment>，没说话</comment>，转身</comment>走了。",
    "",
    "<comment body=\"整段的意见\">",
    "",
    "块批注里的第一段，<comment body=\"其中一句\">这一句另有批注</comment>。",
    "",
    "块批注里的第二段，样式与没有批注的段落一样，没有边框也没有缩进。",
    "",
    "</comment>",
    "",
    "<comment body=\"这张表要改\">",
    "",
    "| 时间 | 事件 |",
    "| --- | --- |",
    "| 凌晨四点 | 灯熄 |",
    "",
    "</comment>",
    "",
    "最后一段没有批注，用来对照左缘。",
    "",
].join("\n");

/** 页边的槽位场景（输出 33）：短段加短批注、下一段有无批注、同一段三条批注、一行的标题与紧挨的列表项、很长的段落加很长的批注、表格里同一行两条批注。 */
const COMMENT_SLOTS = [
    "# 页边的槽位",
    "",
    "这一段只有一条短批注，下一段没有批注，所以它可以长到两倍段高。<comment body=\"一句话。\">这一句有批注</comment>",
    "",
    "这一段没有批注，上面那条批注可以借它的地方。",
    "",
    "这一段有批注，紧接着的下一段也有批注，所以它不能借别人的地方，意见太长时在末尾省略。<comment body=\"这条意见比较长：它在页边里最多放到这一段那么高，放不下的部分在末尾省略，点卡片可以展开看全文。这条意见比较长：它在页边里最多放到这一段那么高。\">这里有批注</comment>",
    "",
    "<comment body=\"这一段有三条批注，合用一个槽位。\">第一条</comment>、<comment body=\"第二条：用右上角的 ‹ › 在同一段的批注之间切换。\">第二条</comment>、<comment body=\"第三条。\">第三条</comment>在同一段里。",
    "",
    "## 一行的标题<comment body=\"一行的短段也放得下一行意见。\">有批注</comment>",
    "",
    "- 紧挨着的列表项<comment body=\"列表项一\">甲</comment>",
    "- 列表项之间没有间距<comment body=\"列表项二\">乙</comment>",
    "- 第三项<comment body=\"列表项三\">丙</comment>",
    "",
    "这一段很长很长：灯塔的光一圈一圈扫过海面，雾被它撕开又合上，码头上的缆绳在潮水里一松一紧，远处的货轮拉了一声长笛，像是在催促什么，又像是在告别什么。林汐站在桩子旁边，听着木板在脚下吱呀作响，想起很多年前也是这样的夜晚。<comment body=\"这条意见很长，用来看很高的段落配很长的意见是什么样子：第一，这一段已经很高了，页边里的卡片最小高度封顶，不会拖出一张和整段一样高的空卡；第二，意见比卡片放得下的行数长时在末尾省略；第三，点卡片展开，卡片在原地向下长到全文，浮在后面的槽位上面；第四，展开时别的卡片一动不动。\">想起很多年前</comment>也是这样的夜晚。",
    "",
    "| 时间 | 事件 |",
    "| --- | --- |",
    "| 凌晨<comment body=\"表格按行算一段。\">四点</comment> | 灯熄<comment body=\"同一行的另一个格子，并进同一个槽位。\">了</comment> |",
    "| 清晨 | 雾散 |",
    "",
    "最后一段没有批注。",
    "",
].join("\n");

const memory = createMemoryFiles({
    project: [
        ["chapters/第一章.md", "# 第一章\n\n天色将晚，她推开了门。\n"],
        ["chapters/第二章.md", "# 第二章\n\n雨下了一整夜。\n"],
        ["notes/设定.json", "{\n  \"城市\": \"临川\"\n}\n"],
        ["chapters/方言.md", DIALECT],
        ["chapters/批注.md", COMMENTS],
        ["chapters/批注-重叠.md", COMMENT_OVERLAP],
        ["chapters/批注-槽位.md", COMMENT_SLOTS],
        ["chapters/表情.md", LAB_STICKER_TEXT],
    ],
    user: [],
});

const panels = createMemoryEditorPanels();
const area = createEditorArea({
    files: memory.files,
    clock: systemClock,
    panels,
    workspaceKey: "lab",
    generation: 1,
    initial: null,
    report: (error) => record("error", error instanceof Error ? error.message : String(error)),
    // 场景 `recycle`：每种编辑器只留 2 个控件，不用真开 21 个标签就能看回收（docs/specs/workbench/editor.md 术语“视图”）。
    ...(props.scene === "recycle" ? {mountedControlsPerEditor: 2} : {}),
});
if (props.scene === "dialect") {
    area.open("project://chapters/方言.md", {mode: "permanent"});
} else if (props.scene === "stickers") {
    area.open("project://chapters/表情.md", {mode: "permanent"});
} else if (props.scene === "comments" || props.scene === "comments-margin") {
    area.open("project://chapters/批注.md", {mode: "permanent"});
} else if (props.scene === "comments-overlap") {
    area.open("project://chapters/批注-重叠.md", {mode: "permanent"});
} else if (props.scene === "comments-slots") {
    area.open("project://chapters/批注-槽位.md", {mode: "permanent"});
} else if (props.scene !== "empty") {
    area.open("project://chapters/第一章.md", {mode: "permanent"});
    area.open("project://chapters/第二章.md", {mode: "preview"});
}
if (props.scene === "recycle") {
    area.open("project://chapters/方言.md", {mode: "permanent"});
    for (const path of ["chapters/第一章.md", "chapters/第二章.md", "notes/设定.json"]) area.open(`project://${path}`, {mode: "permanent", editor: CODE_EDITOR});
}
if (props.scene === "split") {
    area.split("right");
    area.open("project://notes/设定.json", {mode: "permanent"});
}
if (props.scene === "unrepresentable") {
    // 写不出（docs/specs/workbench/editor.md 输出 61）：第二章读到后让这个视图写不出，看组顶部的提示、“定位”与“采用当前正文”，
    // 关闭标签时的询问没有“保存”。真实输入很难构造出写不出，这里直接经绑定登记。
    const stop = watch(() => {
        const group = area.groups.activeGroup.value;
        const binding = area.binding(group);
        return binding?.kind === "text" && area.documentOf(group)?.status.value === "ready" ? binding : null;
    }, (binding) => {
        if (binding === null) return;
        binding.block({reason: "段首的 HTML 会被读成 HTML 块", from: 0, to: 6, index: 1, excerpt: "第二章", fallback: "# 第二章\n\n雨下了一整夜。\n"});
        queueMicrotask(() => stop());
    }, {immediate: true});
}

const MonacoControl = defineAsyncComponent(() => import("nbook/plugins/editor/web/components/MonacoControl.vue"));
// Markdown 控件要 nbook.markdown 交组件时给的方言目录：场景里没有外来方言，目录是空的，语言只有内置方言。
provide(syntaxCatalogKey, new SyntaxCatalog({get: () => null, list: () => []}, () => undefined));
// 图片地址：内存适配器没有字节路由，作品里的 png 一律给一张画出来的图。
const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#7287fd"/><text x="240" y="145" font-size="30" text-anchor="middle" fill="white">封面</text></svg>')}`;
// 表情：Lab 的表情目录（`lab-stickers.ts`）；场景 `stickers` 打开的文件里有几种写法。
provide(markdownStickersKey, labStickers());
provide(markdownAssetsKey, createAssetUrls({rawUrl: (address) => (address.endsWith(".png") ? PICTURE : null), watch: () => () => undefined}));
provide(editorMenusKey, createLabEditorMenus(area, text, {commentMargin: props.scene === "comments-margin" || props.scene === "comments-slots"}));
const MarkdownControl = defineAsyncComponent(() => import("nbook/plugins/markdown/web/components/MarkdownControl.vue"));
/** 只有内置的两个编辑器，组件直接给出（产品里由编辑器的登记表给出，`editor-registry.ts`）。 */
const controls: Readonly<Record<string, Component>> = {[CODE_EDITOR]: MonacoControl, [MARKDOWN_EDITOR]: MarkdownControl};
const control = (editor: string): EditorState => {
    const component = controls[editor];
    return component === undefined ? {kind: "gone"} : {kind: "ready", component};
};

const active = computed(() => area.activeDocument.value?.target.value.path ?? null);
const externalWrite = (): void => {
    if (active.value !== null) memory.externalWrite(active.value, `（另一个程序改写于 ${new Date().toLocaleTimeString()}）\n`);
};
const externalDelete = (): void => {
    if (active.value !== null) memory.externalDelete(active.value);
};
const reads = [{value: "normal", label: "正常"}, {value: "held", label: "扣住读取"}];
const setReads = (value: string | number | boolean | null): void => {
    memory.readsHeld.value = value === "held";
};
const emptyTips: ReadonlyArray<EmptyTip> = [
    {command: "nbook.quick-open.open-commands", label: text.t(editorText("tips.commands")), keys: ["Ctrl", "Shift", "P"], hint: null},
    {command: "nbook.files.new-file", label: text.t(editorText("tips.newFile")), keys: null, hint: text.t(editorText("tips.newFileWhere"))},
    {command: "nbook.help.welcome", label: text.t(editorText("tips.welcome")), keys: null, hint: text.t(editorText("tips.welcomeWhere"))},
];
const onIntent = (intent: string): void => {
    record("intent", intent);
    if (intent === "save") void area.save().then((result) => record("save", result.ok ? "ok" : text.t(result.reason)));
    if (intent === "close") {
        const tab = area.groups.activeTab();
        if (tab !== null) void area.close(tab.id);
    }
    if (intent === "split-right") area.split("right");
};

// ── 表面：产品的纯函数算呈现树，文档在内存里 ──

const NO_VIEWS = new Map();
const POLICY = createLayoutPolicy();
const doc = computed(() => panels.document());
const extent = shallowRef<GridExtent | null>(null);
const projectionOptions = computed(() => layoutProjectionOptions({doc: doc.value, catalog: NO_VIEWS, viewportWidth: extent.value?.width ?? 0}));
const projection = computed(() => projectLayoutDoc(doc.value, projectionOptions.value));
/** 手势落账：和产品的 store 一样经库的入口写回（workbench-layout 输出 49）。 */
const commitGesture = (before: Readonly<Record<string, GridExtent>>, after: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void => {
    panels.apply((current) => ({ok: true, doc: applyGestureCommit(current, projection.value, {before, after, collapsed}).doc}));
};

const host = ref<HTMLElement | null>(null);
const floatPreview = shallowRef<{readonly panel: string; readonly rect: LayoutFloatRect} | null>(null);
const floats = computed(() => doc.value.floats.map(({panel, rect}) => ({id: panel, rect: floatPreview.value?.panel === panel ? floatPreview.value.rect : rect})));
const tabDrag = shallowRef<EditorTabDrag | null>(null);
const drag = shallowRef<LayoutDrag | null>(null);
const feedback = useTemplateRef<InstanceType<typeof WorkbenchDragFeedback>>("feedback");
const surface = useTemplateRef<InstanceType<typeof WorkbenchSurface>>("surface");
onMounted(() => {
    drag.value = createLayoutDrag({
        root: host.value!,
        doc: () => doc.value,
        catalog: () => NO_VIEWS,
        policy: () => POLICY,
        projection: () => projectionOptions.value,
        extent: () => extent.value,
        maximized: () => null,
        enabled: () => true,
        editorTabs: () => tabDrag.value,
        titleOnly: () => false,
        ownHead: () => false,
        sectors: () => true,
        feel: () => "indicator",
        cardShrink: () => "strip",
        cardRefresh: () => "display",
        // 落点指示（`feel` 是 indicator）：不走实时布局，用不到网格。
        grid: () => null,
        showPreview: () => undefined,
        moveGhost: (point) => feedback.value?.moveGhost(point),
        floats: () => floats.value,
        markFloatMove: (panel, rect) => {
            floatPreview.value = panel === null || rect === undefined ? null : {panel, rect};
        },
        placeFloat: (panel, offset) => surface.value?.placeFloat(panel, offset),
        floatMinimum: () => EDITOR_GROUP_MINIMUM,
        commit: (source, action, part, keyboard) => {
            // 这个场景没有活动栏：没有入口的落点。
            if (isEntryAction(action) || source.kind === "container") return;
            if (source.kind === "panel") {
                if (action.kind === "float") panels.apply((current) => setFloatRect(current, {panel: source.panel, rect: action.rect}));
                else tabDrag.value?.dropPanel(source.panel, action, part, keyboard);
                return;
            }
            const tabId = editorTabIdOf(source.tab);
            if (tabId !== null) tabDrag.value?.drop(tabId, action, part, keyboard);
        },
    });
});
const dragState = computed(() => drag.value?.session.state.value ?? null);
const dragGhost = computed(() => {
    const current = dragState.value;
    const tabId = current === null || current.source.kind !== "tab" ? null : editorTabIdOf(current.source.tab);
    return tabId === null ? null : (tabDrag.value?.ghost(tabId) ?? null);
});
const dropPreview = computed(() => {
    const drop = dragState.value?.drop ?? null;
    return drop === null ? null : {areaRect: drop.preview.areaRect, entryRect: null, indicator: drop.preview.indicator, orientation: drop.preview.orientation};
});

onBeforeUnmount(() => {
    drag.value?.dispose();
    area.dispose();
    memory.dispose();
});
</script>

<template>
    <div ref="host" class="h-full w-full" data-lab-subject>
        <WorkbenchSurface
            ref="surface"
            class="h-full w-full"
            :doc="doc"
            :projection="projection"
            :floats="floats"
            :maximized="null"
            :disabled="false"
            context-key="lab-editor"
            @extent="(next) => (extent = next)"
            @gesture-commit="commitGesture"
        >
            <template #head="{panelId}">
                <EditorGroupHead :area="area" :group-id="panelId" :wrap-tabs="props.input?.props?.wrapTabs !== false" @intent="onIntent" />
            </template>
            <template #content="{contentKey, panelId}">
                <EditorGroup :area="area" :group-id="panelId" :tab-id="editorTabIdOf(contentKey)" :control="control" :empty-tips="emptyTips" @intent="onIntent" @run-tip="(command: string) => record('run-tip', command)" />
            </template>
        </WorkbenchSurface>
        <EditorHost :area="area" :wrap-tabs="props.input?.props?.wrapTabs !== false" :attach-tab-drag="(next: EditorTabDrag | null) => (tabDrag = next)" />
        <WorkbenchDragFeedback ref="feedback" :ghost="dragGhost" :preview="dropPreview" label="" :kind="dragState?.drop?.action.kind ?? ''" :sectors="dragState?.drop?.sectors ?? null" />
    </div>
    <LabFixtureControls>
        <div class="flex flex-wrap items-center gap-3 text-xs" data-lab-editor-controls>
            <span class="text-[var(--text-secondary)]">正文读取</span>
            <SegmentedControl :model-value="memory.readsHeld.value ? 'held' : 'normal'" :options="reads" aria-label="正文读取" size="sm" @update:model-value="setReads" />
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-lab-editor-external-write @click="externalWrite">外部改写当前文件</button>
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-lab-editor-external-delete @click="externalDelete">外部删除当前文件</button>
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="area.open('project://notes/设定.json', {mode: 'preview'})">打开设定.json</button>
        </div>
    </LabFixtureControls>
</template>
