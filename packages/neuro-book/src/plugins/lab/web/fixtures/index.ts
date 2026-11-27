import type {Component} from "vue";

import type ExplorerFeedback from "nbook/plugins/explorer/web/components/ExplorerFeedback.vue";
import type EditorGroupHead from "nbook/plugins/editor/web/components/EditorGroupHead.vue";
import type HtmlPreview from "nbook/plugins/html-preview/web/components/HtmlPreview.vue";
import type ImageViewer from "nbook/plugins/image-viewer/web/components/ImageViewer.vue";
import type EditorBreadcrumbs from "nbook/plugins/editor/web/components/EditorBreadcrumbs.vue";
import type CodeInput from "nbook/plugins/editor/web/components/CodeInput.vue";
import type EditorPageBreadcrumbs from "nbook/plugins/editor/web/components/EditorPageBreadcrumbs.vue";
import type ChangePage from "nbook/plugins/canon/web/components/ChangePage.vue";
import type BreakExclusiveDialog from "nbook/plugins/canon/web/components/BreakExclusiveDialog.vue";
import type ConfirmBar from "nbook/plugins/canon/web/components/ConfirmBar.vue";
import type EntryPage from "nbook/plugins/canon/web/components/EntryPage.vue";
import type EntryText from "nbook/plugins/canon/web/components/EntryText.vue";
import type {EntryTextBlock, EntryTextValue} from "nbook/plugins/canon/web/components/entry-text";
import type EntryTree from "nbook/plugins/canon/web/components/EntryTree.vue";
import type FieldTable from "nbook/plugins/canon/web/components/FieldTable.vue";
import type EntryPicker from "nbook/plugins/canon/web/components/EntryPicker.vue";
import type ImageInput from "nbook/plugins/canon/web/components/ImageInput.vue";
import type MoveDialog from "nbook/plugins/canon/web/components/MoveDialog.vue";
import type ElementDialog from "nbook/plugins/canon/web/components/ElementDialog.vue";
import type EntryTextEditor from "nbook/plugins/canon/web/components/EntryTextEditor.vue";
import type EntryRichInput from "nbook/plugins/canon/web/components/EntryRichInput.vue";
import type PlainSourceInput from "nbook/plugins/canon/web/components/PlainSourceInput.vue";
import type TextConflictDialog from "nbook/plugins/canon/web/components/TextConflictDialog.vue";
import type FieldInput from "nbook/plugins/canon/web/components/FieldInput.vue";
import type NewEntryDialog from "nbook/plugins/canon/web/components/NewEntryDialog.vue";
import type PageNotices from "nbook/plugins/canon/web/components/PageNotices.vue";
import type EntryPageNav from "nbook/plugins/canon/web/components/EntryPageNav.vue";
import type AddComponentDialog from "nbook/plugins/canon/web/components/AddComponentDialog.vue";
import type ComponentChecklist from "nbook/plugins/canon/web/components/ComponentChecklist.vue";
import type ComponentAgentView from "nbook/plugins/canon/web/components/ComponentAgentView.vue";
import type ComponentRawView from "nbook/plugins/canon/web/components/ComponentRawView.vue";
import type OriginList from "nbook/plugins/canon/web/components/OriginList.vue";
import type PanelView from "nbook/plugins/canon/web/components/PanelView.vue";
import type PendingDetail from "nbook/plugins/canon/web/components/PendingDetail.vue";
import type PendingView from "nbook/plugins/canon/web/components/PendingView.vue";
import type PlotList from "nbook/plugins/canon/web/components/PlotList.vue";
import type ReceiptPage from "nbook/plugins/canon/web/components/ReceiptPage.vue";
import type RecordForm from "nbook/plugins/canon/web/components/RecordForm.vue";
import type SuggestInput from "nbook/plugins/canon/web/components/SuggestInput.vue";
import type CanonImage from "nbook/plugins/canon/web/components/CanonImage.vue";
import type CharacterCard from "nbook/plugins/canon/web/components/CharacterCard.vue";
import type LookCard from "nbook/plugins/canon/web/components/LookCard.vue";
import type RevertDialog from "nbook/plugins/canon/web/components/RevertDialog.vue";
import type RevisionsView from "nbook/plugins/canon/web/components/RevisionsView.vue";
import type ViewPointPicker from "nbook/plugins/canon/web/components/ViewPointPicker.vue";
import type WorldBanners from "nbook/plugins/canon/web/components/WorldBanners.vue";
import type GoalGroup from "nbook/plugins/plot/web/components/GoalGroup.vue";
import type NodeBand from "nbook/plugins/plot/web/components/NodeBand.vue";
import type PeoplePicker from "nbook/plugins/plot/web/components/PeoplePicker.vue";
import type PlotSidebar from "nbook/plugins/plot/web/components/PlotSidebar.vue";
import type ReadFailure from "nbook/plugins/plot/web/components/ReadFailure.vue";
import type SecretsMatrix from "nbook/plugins/plot/web/components/SecretsMatrix.vue";
import type {AuthorAttitude, AuthorGoal} from "nbook/plugins/plot/core/author/goals";
import type {AuthorDegree} from "nbook/plugins/plot/core/author/knowing";
import type {SecretRow} from "nbook/plugins/plot/core/author/secrets";
import type {Role} from "nbook/plugins/plot/core/foreshadowing";
import type MarkdownImageCard from "nbook/plugins/markdown/web/components/menus/MarkdownImageCard.vue";
import type EditorTabBar from "nbook/plugins/editor/web/components/EditorTabBar.vue";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import type ExplorerRow from "nbook/plugins/explorer/web/components/ExplorerRow.vue";
import type ExplorerTree from "nbook/plugins/explorer/web/components/ExplorerTree.vue";
import type FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";
import type FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {InlineChip} from "@notnotype/nb-markdown/chip";
import type {MarkdownDisplay, MarkdownImage} from "@notnotype/nb-markdown/display";
import type {PromptAttachmentStrip, PromptEditor, PromptPasteFrame, PromptTextView} from "@notnotype/nb-markdown/prompt";
import type {MarkdownProperties} from "@notnotype/nb-markdown/editor";
import type {PropertyDescription} from "nbook/plugins/markdown/web/properties-catalog";
import type BookCard from "nbook/plugins/projects/web/components/BookCard.vue";
import type WelcomePage from "nbook/plugins/projects/web/components/WelcomePage.vue";
import type BookCover from "nbook/plugins/projects/web/components/BookCover.vue";
import type BookshelfPage from "nbook/plugins/projects/web/components/BookshelfPage.vue";
import type FileBrowser from "nbook/plugins/projects/web/components/FileBrowser.vue";
import type PathPickerDialog from "nbook/plugins/projects/web/components/PathPickerDialog.vue";
import type ProjectInfoDialog from "nbook/plugins/projects/web/components/ProjectInfoDialog.vue";
import type FirstRunWizard from "nbook/plugins/desktop/web/components/FirstRunWizard.vue";
import {FIRST_RUN_THUMBNAILS} from "nbook/plugins/desktop/web/first-run-assets";
import type ShelfCards from "nbook/plugins/projects/web/components/ShelfCards.vue";
import type ShelfDesk from "nbook/plugins/projects/web/components/ShelfDesk.vue";
import type ShelfList from "nbook/plugins/projects/web/components/ShelfList.vue";
import type PluginsPage from "nbook/plugins/plugins/web/components/PluginsPage.vue";
import type AddProviderDialog from "nbook/plugins/models/web/components/AddProviderDialog.vue";
import type AllModelsView from "nbook/plugins/models/web/components/AllModelsView.vue";
import type CapabilityIcons from "nbook/plugins/models/web/components/CapabilityIcons.vue";
import type HeadersEditor from "nbook/plugins/models/web/components/HeadersEditor.vue";
import type ManageModelsDialog from "nbook/plugins/models/web/components/ManageModelsDialog.vue";
import type ModelEditDialog from "nbook/plugins/models/web/components/ModelEditDialog.vue";
import type ModelRow from "nbook/plugins/models/web/components/ModelRow.vue";
import type ProviderDetail from "nbook/plugins/models/web/components/ProviderDetail.vue";
import type ProviderHeader from "nbook/plugins/models/web/components/ProviderHeader.vue";
import type ApiDetectResults from "nbook/plugins/models/web/components/ApiDetectResults.vue";
import type ProviderIcon from "nbook/plugins/models/web/components/ProviderIcon.vue";
import type ProviderLogo from "nbook/ui/provider-icons/ProviderLogo.vue";
import type ProviderRail from "nbook/plugins/models/web/components/ProviderRail.vue";
import type PermissionRulesPage from "nbook/plugins/agent/web/components/PermissionRulesPage.vue";
import type StatusLinePage from "nbook/plugins/agent/web/components/StatusLinePage.vue";
import type ProfileDetail from "nbook/plugins/agent/web/components/ProfileDetail.vue";
import type ProfileRail from "nbook/plugins/agent/web/components/ProfileRail.vue";
import type ImportConflictDialog from "nbook/plugins/stickers/web/components/ImportConflictDialog.vue";
import type PackFields from "nbook/plugins/stickers/web/components/PackFields.vue";
import type StickerFields from "nbook/plugins/stickers/web/components/StickerFields.vue";
import type StickerGrid from "nbook/plugins/stickers/web/components/StickerGrid.vue";
import type StickerPackNameDialog from "nbook/plugins/stickers/web/components/StickerPackNameDialog.vue";
import type StickerPackRail from "nbook/plugins/stickers/web/components/StickerPackRail.vue";
import type StickerPickerPanel from "nbook/plugins/stickers/web/components/StickerPickerPanel.vue";
import type StickerSlot from "nbook/plugins/stickers/web/components/StickerSlot.vue";
import type StickerPacksPage from "nbook/plugins/stickers/web/components/StickerPacksPage.vue";
import {extraKey, railGroups, stickerKey} from "nbook/plugins/stickers/web/pack-view";
import type {GridItem} from "nbook/plugins/stickers/web/pack-view";
import type BackgroundCommandCard from "nbook/plugins/agent/web/components/BackgroundCommandCard.vue";
import type SubagentCard from "nbook/plugins/agent/web/components/SubagentCard.vue";
import type SubagentsEntry from "nbook/plugins/agent/web/components/SubagentsEntry.vue";
import type ContactCover from "nbook/plugins/agent/web/components/ContactCover.vue";
import type DeskCompanion from "nbook/plugins/agent/web/components/DeskCompanion.vue";
import type NewProfileDialog from "nbook/plugins/agent/web/components/NewProfileDialog.vue";
import type SkillInitDialog from "nbook/plugins/agent/web/components/SkillInitDialog.vue";
import type SkillsSettingsPage from "nbook/plugins/agent/web/components/SkillsSettingsPage.vue";
import type {SkillEntry} from "nbook/plugins/agent/shared/skills";
import type ProfileSettingsPage from "nbook/plugins/agent/web/components/ProfileSettingsPage.vue";
import type ProfileToolsSection from "nbook/plugins/agent/web/components/ProfileToolsSection.vue";
import type AddToolsDialog from "nbook/plugins/agent/web/components/AddToolsDialog.vue";
import type ProvidersPage from "nbook/plugins/models/web/components/ProvidersPage.vue";
import type ApiKeyField from "nbook/plugins/web-tools/web/components/ApiKeyField.vue";
import type NetworkPage from "nbook/plugins/network/web/components/NetworkPage.vue";
import type SearchSettingsPage from "nbook/plugins/web-tools/web/components/SearchSettingsPage.vue";
import type RolesPage from "nbook/plugins/models/web/components/RolesPage.vue";
import type WorksSettingsPage from "nbook/plugins/projects/web/components/WorksSettingsPage.vue";
import type {ShelfItem} from "nbook/plugins/projects/shared/shelf";
import type SettingsWindow from "nbook/plugins/settings/web/components/SettingsWindow.vue";
import type NeuroBookLockup from "nbook/ui/brand/NeuroBookLockup.vue";
import type NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";
import type NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";
import type JsonViewer from "nbook/ui/JsonViewer.vue";
import type HighlightedText from "nbook/ui/settings/HighlightedText.vue";
import type SettingsNotice from "nbook/ui/settings/SettingsNotice.vue";
import type SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";
import type SettingsSaveBar from "nbook/ui/settings/SettingsSaveBar.vue";
import type SettingsPageList from "nbook/ui/settings/SettingsPageList.vue";
import type SettingsActionRow from "nbook/ui/settings/SettingsActionRow.vue";
import type SettingsRow from "nbook/ui/settings/SettingsRow.vue";
import type SkillChip from "nbook/ui/SkillChip.vue";
import type ThemeEditor from "nbook/plugins/workbench/web/components/theme-editor/ThemeEditor.vue";
import type ThemeSettingsPage from "nbook/plugins/workbench/web/components/theme-editor/ThemeSettingsPage.vue";
import type WorkbenchCommandPalette from "nbook/plugins/workbench/web/components/WorkbenchCommandPalette.vue";
import type WorkbenchNotificationsView from "nbook/plugins/workbench/web/components/WorkbenchNotificationsView.vue";
import type TasksView from "nbook/plugins/tasks/web/components/TasksView.vue";
import type TasksHover from "nbook/plugins/tasks/web/components/TasksHover.vue";
import type WorkbenchDragFeedback from "nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue";
import type WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import type WorkbenchPanelHead from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type WorkbenchRegionStrip from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import type WorkbenchToolStrip from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type WorkbenchFloatRailHandle from "nbook/plugins/workbench/web/components/WorkbenchFloatRailHandle.vue";
import type WorkbenchItemStrip from "nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue";
import type WorkbenchTitleBar from "nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue";
import type WorkbenchStatusBar from "nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue";
import type WorkbenchViewFrame from "nbook/plugins/workbench/web/components/WorkbenchViewFrame.vue";
import type TitleActions from "nbook/ui/menus/TitleActions.vue";
import {localeSetting} from "nbook/plugins/settings/shared/contracts";
import {appearanceSetting} from "nbook/plugins/workbench/shared/contracts";

import type CollapsibleSidePanel from "../components/CollapsibleSidePanel.vue";
import type EventLogPanel from "../components/EventLogPanel.vue";
import type FixtureExample from "../components/FixtureExample.vue";
import type HighlightBox from "../components/HighlightBox.vue";
import type MarkdownView from "../components/MarkdownView.vue";
import type SurfaceTierDemo from "../components/SurfaceTierDemo.vue";
import type ViewportCanvas from "../components/ViewportCanvas.vue";
import type {LabInputOf, LabJsonPropOf, LabSlotOf} from "../lab-subject";
import {draftFixtures} from "../drafts";
import {defineLabFixture} from "./define";

import {EXPLORER_ROWS, manyRows, UNBOUND_ROWS} from "./explorer-rows";
import {withExplorerText} from "./explorer-scene/explorer-text";
import {withProjectsText} from "./projects-scene/projects-text";
import {withDesktopText} from "./desktop-scene/desktop-text";
import {withAgentPageText} from "./agent-scene/agent-page-text";
import {detailOf, SAMPLES, sampleById, summaryOf} from "./stickers-scene/samples";
import {withStickersPageText} from "./stickers-scene/stickers-text";
import {SAMPLE_PROFILES, SAMPLE_TOOL_CANDIDATES, SAMPLE_WRITER_TOOLS} from "./agent-scene/profile-samples";
import {CARD_SAMPLES, COMMAND_SAMPLES, ENTRY_PROFILES, sampleProps} from "./agent-scene/subagent-samples";
import {withModelsText} from "./models-scene/models-text";
import {withWebText} from "./web-tools-scene/web-text";
import {generatedRows, SAMPLE_CANDIDATES, SAMPLE_DETECTION, SAMPLE_PROVIDERS, SAMPLE_ROWS, SAMPLE_TEMPLATES, sampleRow, SOURCE_AT} from "./models-scene/sample";
import {withSettingsText} from "./settings-scene/settings-text";
import {withWorkbenchText} from "./workbench-scene/workbench-text";
import {withNbookMarkdownHost} from "./markdown-host";
import {withMarkdownSceneText} from "./markdown-text";
import {nbAgentUiFixtures} from "./nb-agent-ui";
import {nbFormFixtures} from "./nb-form";
import {nbLayoutFixtures} from "./nb-layout";
import {LAB_STICKER_TEXT} from "./lab-stickers";
import {nbUiFixtures} from "./nb-ui";
import {PROMPT_LAB_THUMBNAILS, promptAttachmentStripScenes, promptEditorScenes, promptPasteFrameScenes, promptTextViewScenes} from "./prompt-scene/scenes";
import {SHELF_COVER_SRC, SHELF_ITEMS, SHELF_ITEM_REVISING, SHELF_NOW} from "./shelf-fixture-data";
import {rowDemoSettings, sceneThemeSetting, SETTINGS_WINDOW_SCENES, snippetsSettings} from "./settings-scene/scene-settings";
import {createSubjectFixture, defineSubjectFixture} from "./subject-fixture";

/** `declared` 开头的几个场景里的属性声明（输出 59、60）：键只在那些场景里出现，别的属性面板场景不受影响。 */
const PROPERTY_DECLARATIONS: Readonly<Record<string, PropertyDescription>> = {
    叙事视角: {icon: "i-lucide-eye", label: "视角"},
    截稿日: {icon: "i-lucide-calendar-clock", kind: "date"},
    预计字数: {kind: "number"},
    定稿: {kind: "checkbox"},
    关键词: {icon: "i-lucide-tags", kind: "list"},
    人物别名: {icon: "i-lucide-users", label: "出场人物与他们的别名（含绰号、尊称与外号，写在这里是为了让设定插件能按名字找到人）"},
    人物关系: {icon: "i-lucide-eye", label: "人物之间的关系"},
    pov: {icon: "i-lucide-eye", label: "Point of view"},
    due: {kind: "date", label: "Due date"},
};

/** 属性面板的样例：一章的五个属性，每种类型一个，开头一行注释。 */
const PROPERTIES_SAMPLE = "---\n# 第十二章\n视角: 林雪\n时间: 2025-12-21\n地点: [青石镇, 北山]\n字数目标: 4000\n已定稿: false\n---\n";

/** MarkdownDisplay 场景用的回复：每种内置方言各一段，加引用小块、外部链接与图片。 */
const DISPLAY_REPLY = [
    "我读了[<comment body=\"她第一次出场\">林</comment>雪](/设定/林雪.md)的设定和[第三章](/正文/第三章.md)，有三处可以改：",
    "",
    "1. 开头<ruby text=\"jì tán\">祭坛</ruby>的描写偏长，==可以压到两句==。",
    "2. 对话里的 <kbd>Ctrl</kbd> 是笔误，H<sub>2</sub>O 与 x<sup>2</sup> 也要统一写法。",
    "",
    "> [!WARNING]- 伏笔会提前暴露",
    "> 第二段直接说出了她的来历，读者在第五章前不该知道。",
    "",
    "<align value=\"center\">",
    "—— 改写示例 ——",
    "</align>",
    "",
    "<bilingual text=\"老人缓缓走向祭坛。\">",
    "The old man walked slowly toward the altar.",
    "</bilingual>",
    "",
    "<html>",
    "<div style=\"padding:8px;border:1px solid #ccc\"><b>人物卡</b>：林雪，二十岁</div>",
    "</html>",
    "",
    "![示意图](/资料/地图.png)",
    "",
    "参考：[写作手册](https://example.com/guide)。",
].join("\n");

/**
 * 场景登记。这不是第二份组件清单——组件清单由 component-index 扫文档得到，
 * 这里只补文档里没有的东西：一个组件可以摆出哪几个场景。两者按组件名对上。
 */

/** Skill 页的场景数据：长短不一的名字放在一起，看徽标与按钮是否落在同一列。 */
const SKILL_PAGE_ENTRIES: readonly SkillEntry[] = [
    {id: "user.style-guide", name: "style-guide", description: "按本书的文风规则改写一段：人称、时态、对白格式与禁用词。", source: "user", location: "skills://user.style-guide/SKILL.md", status: "ready", license: "MIT"},
    {id: "user.epub-export", name: "epub-export", description: "把选中的章节导成 EPUB，带目录、封面与脚注。", source: "user", location: "skills://user.epub-export/SKILL.md", status: "needs-init"},
    {id: "user.lore-check", name: "lore-check", description: "对照人物卡与设定集，找出正文里前后矛盾的地方。", source: "user", location: "skills://user.lore-check/SKILL.md", status: "needs-init", problem: {code: "install-failed", detail: "error: GET https://registry.npmjs.org/epub-gen-memory - ETIMEDOUT"}},
    {id: "user.tts-preview", name: "tts-preview", description: "用本机的语音合成朗读选中的一段，听对白的节奏。", source: "user", location: "skills://user.tts-preview/SKILL.md", status: "initializing"},
    {id: "user.outline", name: "outline", description: "", source: "user", location: "skills://user.outline/SKILL.md", status: "invalid", problem: {code: "name-mismatch", name: "outline-helper"}},
    {id: "user.voice-check-with-a-much-longer-name", name: "voice-check-with-a-much-longer-name", description: "逐段检查叙述视角有没有串，标出越界的句子。", source: "user", location: "skills://user.voice-check-with-a-much-longer-name/SKILL.md", status: "ready", external: {python: true, uvMissing: true, compatibility: "需要 Python 3.11 以上与 uv；朗读用的 espeak-ng 要自己装"}, metadata: {author: "林默", version: "0.3"}},
    {id: "acme.docs.pdf-extract", name: "pdf-extract", description: "从扫描的 PDF 里抽出正文与页码，按章分段。", source: "plugin", plugin: {id: "acme.docs", title: "文档工具"}, location: "skills://acme.docs.pdf-extract/SKILL.md", status: "ready"},
    {id: "acme.docs.raw-notes", name: "raw-notes", description: "把采访录音的转写整理成按人物分的笔记。", source: "plugin", plugin: {id: "acme.docs", title: "文档工具"}, location: "skills://acme.docs.raw-notes/SKILL.md", status: "invalid", problem: {code: "plugin-skill-unbuilt"}},
    // 没有显示名的插件，组头写插件 id；id 很长时组头要折行，不撑出页面。
    {id: "someverylongpublishername.averyveryverylongpluginnamewithoutbreaks.lint", name: "lint", description: "按本书的禁用词表检查选中的章节。", source: "plugin", plugin: {id: "someverylongpublishername.averyveryverylongpluginnamewithoutbreaks", title: null}, location: "skills://someverylongpublishername.averyveryverylongpluginnamewithoutbreaks.lint/SKILL.md", status: "ready"},
    {id: "builtin.chapter-summary", name: "chapter-summary", description: "给一章写三五句提要，写进章节的元数据。", source: "builtin", location: "skills://builtin.chapter-summary/SKILL.md", status: "ready"},
];
export type LabScene = {
    id: string;
    label: string;
    /** 运行时消费的宽化输入；登记入口负责把它约束到组件类型。 */
    input?: {props?: Record<string, unknown>; model?: Record<string, unknown>; slots?: Record<string, boolean>};
};

declare const LAB_FIXTURE_BRAND: unique symbol;

export type LabFixture = {
    /** 与组件文档同名 */
    component: string;
    scenes: LabScene[];
    /** 没有可登记 JSON 数据 prop 的组件可声明无输入理由；运行期能力仍由 fixture 绑定。 */
    noInput?: string;
    /** fixture 为哪些插槽备了预设内容。 */
    slots?: readonly string[];
    load: () => Promise<Component>;
    readonly [LAB_FIXTURE_BRAND]: true;
};

export type LabFixtureDefinition<C> = {
    component: string;
    load: () => Promise<Component>;
} & (
    | {
        noInput?: never;
        slots?: readonly LabSlotOf<C>[];
        scenes: Array<{id: string; label: string; input: LabInputOf<C>}>;
    }
    | ([LabJsonPropOf<C>] extends [never] ? {
        noInput: string;
        slots?: never;
        scenes: Array<{id: string; label: string; input?: never}>;
    } : never)
);

export {defineLabFixture} from "./define";

/**
 * fixture 在被检视的那个零件上加 `data-lab-subject`，Lab 据此画常亮描边。
 *
 * 没有它 Lab 分不出哪块是零件、哪块是 fixture 自己搭的台子——多数 fixture 都带工具栏
 * 和说明文字。零件是单根节点时直接写在标签上即可，Vue 会把它落到根 DOM 节点。
 * 不标也能检查，只是无法把复合 fixture 的主要零件作为优先定位目标。
 */
// Lab 场景在选择时才加载：避免一次导入所有产品组件和纯内存 fixture。

export const labFixtures: LabFixture[] = [
    // 草稿区：每个 Task 一个目录，各自登记（见 ../drafts/index.ts）。
    ...draftFixtures,
    defineLabFixture<typeof CollapsibleSidePanel>({
        component: "CollapsibleSidePanel", slots: ["default", "actions"],
        scenes: [
            {id: "default", label: "展开", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "collapsed", label: "收起", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: true}, slots: {default: true, actions: true}}},
            {id: "right", label: "靠右", input: {props: {title: "检视", collapsedWidth: 40, side: "right", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "content", label: "内容层", input: {props: {title: "检视", collapsedWidth: 40, side: "left", layer: "content"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "long", label: "长内容", input: {props: {title: "很长的一列条目", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
        ],
        load: async () => (await import("./CollapsibleSidePanelFixture.vue")).default,
    }),
    defineLabFixture<typeof ViewportCanvas>({
        component: "ViewportCanvas", slots: ["default"],
        scenes: [
            {id: "phone", label: "手机 390×844", input: {props: {minSize: 200, showSize: true}, model: {width: 390, height: 844}, slots: {default: true}}},
            {id: "tablet", label: "平板 768×1024", input: {props: {minSize: 200, showSize: true}, model: {width: 768, height: 1024}, slots: {default: true}}},
            {id: "free", label: "不限尺寸", input: {props: {minSize: 200, showSize: true}, model: {width: 0, height: 0}, slots: {default: true}}},
        ],
        load: async () => (await import("./ViewportCanvasFixture.vue")).default,
    }),
    defineLabFixture<typeof MarkdownView>({
        component: "MarkdownView", scenes: [
            {id: "prose", label: "常规正文", input: {props: {source: "## 小标题\n\n一段普通正文，里面有 **粗体**、*斜体* 和 `行内代码`。\n\n- 列表第一项\n- 列表第二项\n\n> 引用块\n\n[外部链接](https://example.com)"}}},
            {id: "table", label: "表格与代码", input: {props: {source: "| 列 A | 列 B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst answer: number = 42;\n```"}}},
            {id: "html", label: "内嵌 HTML（会被净化）", input: {props: {source: "下面这行的脚本会被净化掉，什么都不会发生：\n\n<script>alert(1)<\/script>\n\n<b>这个粗体标签是允许的</b>"}}},
            {id: "empty", label: "空文本", input: {props: {source: ""}}},
        ], load: async () => (await import("./MarkdownViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EventLogPanel>({
        component: "EventLogPanel", scenes: [
            {id: "mixed", label: "有负载与无负载混排", input: {props: {emptyText: "还没有事件", entries: [{id: "click-1", name: "click", payload: {count: 1}}, {id: "update-1", name: "update:modelValue"}]}}},
            {id: "empty", label: "空列表", input: {props: {emptyText: "还没有事件", entries: []}}},
        ], load: async () => (await import("./EventLogPanelFixture.vue")).default,
    }),
    defineLabFixture<typeof HighlightBox>({
        component: "HighlightBox", scenes: [
            {id: "subject", label: "零件档（实线）", input: {props: {label: "EventLogPanel  320 × 180", tone: "subject", rect: {top: 80, left: 80, width: 260, height: 120}}}},
            {id: "probe", label: "探针档（虚线）", input: {props: {label: "div.flex.items-center  296 × 28", tone: "probe", rect: {top: 80, left: 80, width: 296, height: 28}}}},
            {id: "no-label", label: "只画框不带标签", input: {props: {label: "", tone: "subject", rect: {top: 80, left: 80, width: 200, height: 200}}}},
            {id: "none", label: "没有要框的东西", input: {props: {label: "看不见我", tone: "subject", rect: null}}},
        ], load: async () => (await import("./HighlightBoxFixture.vue")).default,
    }),
    defineLabFixture<typeof FixtureExample>({
        component: "FixtureExample",
        slots: ["extra"],
        scenes: [
            {
                id: "default",
                label: "默认受控卡片（居中与标准材质示范）",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "active",
                label: "激活态与高亮外框",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "busy",
                label: "忙碌呼吸状态",
                input: {
                    props: {
                        title: "正在生成第三卷剧情推演",
                        description: "后台正在计算角色动机转移概率矩阵与未回收伏笔拓扑图...",
                        status: "busy",
                        count: 99,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "warning",
                label: "警告冲突状态",
                input: {
                    props: {
                        title: "检测到人物性格设定冲突",
                        description: "角色「沈屿」在第二章的对话用词与素材库口吻约定存在 2 处偏差。",
                        status: "warning",
                        count: 2,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: false},
                },
            },
            {
                id: "disabled",
                label: "禁用态",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: true,
                    },
                    slots: {extra: false},
                },
            },
        ],
        load: async () => (await import("./FixtureExampleFixture.vue")).default,
    }),
    defineLabFixture<typeof JsonViewer>({
        component: "JsonViewer", scenes: [
            {id: "object", label: "对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {id: "chapter-01", title: "第一章", wordCount: 3182, tags: ["草稿", "待审"], meta: {createdAt: "2026-08-01T10:00:00Z", author: null, pinned: false}}}}},
            {id: "array", label: "数组", input: {props: {readOnly: false, maxHeight: 320}, model: {value: [{tool: "read_file", ok: true, ms: 12}, {tool: "write_file", ok: false, ms: 340}, {tool: "list_dir", ok: true, ms: 3}]}}},
            {id: "text", label: "未写完的字符串", input: {props: {readOnly: false, maxHeight: 320}, model: {value: '{\n  "unfinished": tru'}}},
            {id: "empty", label: "空对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {}}}},
        ], load: async () => (await import("./JsonViewerFixture.vue")).default,
    }),
    defineLabFixture<typeof SurfaceTierDemo>({
        component: "SurfaceTierDemo", noInput: "该组件没有可编辑输入",
        scenes: [{id: "default", label: "5 档对照"}],
        load: async () => (await import("./SurfaceTierDemoFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchCommandPalette>({
        component: "WorkbenchCommandPalette",
        noInput: "命令面板由场景的局部命令宿主驱动，没有可登记的 JSON 输入",
        scenes: [
            {id: "command-navigation", label: "命令与行号导航"},
            {id: "readonly", label: "只读文档"},
            {id: "commands-unavailable", label: "无活动编辑器"},
        ],
        load: async () => (await import("./WorkbenchCommandPaletteFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchSurface>({
        component: "WorkbenchSurface",
        // 文档与呈现树由夹具自己算（它扮演工作台），不是 JSON 输入；输入只是占位（类型要求登记必填的 doc、projection），夹具不读它。断言见 e2e/lab-workbench-surface.e2e.ts。
        scenes: (() => {
            const leaf = {kind: "leaf" as const, id: "g0", ref: "panel:g0"};
            const base = {
                contextKey: "lab:surface",
                doc: {version: 1 as const, tree: {version: 2 as const, root: {...leaf, size: {width: 0, height: 0}}}, panels: {g0: {role: "editor" as const, tabs: [], active: null}}, floats: [], hiddenBars: [], currentEditor: "g0"},
                projection: {input: leaf, strips: [], rails: []},
            };
            return [
                {id: "default", label: "侧栏、两个编辑组、右栏、面板（平铺）", input: {props: base}},
                {id: "cards", label: "卡片：缝、圆角、相连按邻接算；右栏与右轨相连，隐藏、显示时角接过去", input: {props: base}},
                {id: "view-head", label: "标题区：右栏的视图接管面板头（左、中、右三列）", input: {props: base}},
            ];
        })(),
        load: async () => (await import("./WorkbenchSurfaceFixture.vue")).default,
    }),
    defineSubjectFixture<typeof WorkbenchPanelHead>({
        component: "WorkbenchPanelHead",
        events: ["activate", "action", "context-menu", "toggle-fold", "own-head-inset"],
        writeBack: {activate: {layer: "props", key: "active"}},
        class: "w-full",
        scenes: (() => {
            const tab = (id: string, label: string, icon: string) => ({id: `view:${id}`, label, icon});
            const tabs = [tab("files", "资源管理器", "i-lucide-files"), tab("search", "搜索", "i-lucide-search"), tab("outline", "大纲", "i-lucide-list-tree"), tab("chat", "对话", "i-lucide-message-square"), tab("output", "输出", "i-lucide-terminal")];
            const named = [
                {id: "float", label: "浮动", icon: "i-lucide-picture-in-picture-2", disabled: false},
                {id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false, pressed: false},
                {id: "hide", label: "隐藏", icon: "i-lucide-x", disabled: false},
            ];
            const base = {panelId: "sidebar", label: "侧栏", moreLabel: "更多", active: "view:files"};
            // 分节只写标题（输出 20）：能收成标题行时标题前有展开标记，整行是开关；框架按钮悬停才出，Lab 里指针移上去看。
            const section = {...base, panelId: "section:files", tabs: tabs.slice(0, 1), titleOnly: true, frameActions: named.slice(0, 2)};
            return [
                {id: "default", label: "几个标签、框架按钮", input: {props: {...base, tabs: tabs.slice(0, 3), frameActions: named}}},
                {id: "many", label: "标签多：放不下时逐级让位（拖窄画布看）", input: {props: {...base, tabs, frameActions: named}}},
                {id: "anonymous", label: "无名面板：没有隐藏按钮", input: {props: {...base, panelId: "p-1", label: "面板", tabs: tabs.slice(0, 2), frameActions: named.slice(0, 2)}}},
                {id: "disabled", label: "框架按钮不可用", input: {props: {...base, tabs: tabs.slice(0, 2), frameActions: [{...named[0]!, disabled: true, reason: "这个视图不能浮动"}, named[1]!, named[2]!]}}},
                {id: "empty", label: "没有标签：显示名称", input: {props: {...base, tabs: [], active: null, frameActions: named}}},
                {id: "section", label: "分节：只写标题，不能收起（底部面板的、区域唯一的）", input: {props: section}},
                {id: "fold-open", label: "分节：展开着，标题前的标记朝下", input: {props: {...section, fold: {collapsed: false}}}},
                {id: "fold-collapsed", label: "分节：收成标题行，标记朝右、标题退成次要字色", input: {props: {...section, fold: {collapsed: true}}}},
                {id: "fold-long", label: "分节：英文长标题被截断，标记不被挤掉", input: {props: {...section, tabs: [tab("files", "Workspace Explorer With A Rather Long Title", "i-lucide-files")], fold: {collapsed: false}}}},
                {id: "fold-maximized", label: "分节：最大化着，没有标记，还原按钮按下、一直显示", input: {props: {...section, frameActions: [named[0]!, {...named[1]!, label: "还原", pressed: true}]}}},
                {id: "fold-view-head", label: "分节：视图接管标题区，展开标记是左列最前面单独的按钮", input: {props: {...section, viewHead: {key: "c:1", popup: {expanded: false}}, fold: {collapsed: false}, foldLabel: "收起 资源管理器"}}},
                // 视图自绘头（workbench/views.md 输出 19 的“自绘头”）：盖在内容顶上的一条，只有右端按钮；标题按钮按 Tab 聚焦才在左上角出现。
                {id: "own-head", label: "浮动窗视图自绘头：右端只有按钮，标题聚焦才出现", input: {props: {...section, panelId: "p-float", ownHead: {band: 40}, actionsShown: true, frameActions: [{id: "dock", label: "回到停靠", icon: "i-lucide-panel-right-close", disabled: false}]}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchToolStrip>({
        component: "WorkbenchToolStrip",
        events: ["select", "run-item"],
        class: "h-full",
        scenes: (() => {
            // 只含一个视图的容器：入口就是这个视图的，能拖。
            const entry = (viewId: string, label: string, icon: string, current: boolean) => ({id: `view:${viewId}`, label, icon, tooltip: label, viewId, current, pressed: current});
            const entries = [
                // 声明的容器，含两个视图：悬停文字写出它们，不起拖。
                {id: "nbook.workbench.project", label: "项目", icon: "i-lucide-folder-kanban", tooltip: "项目：会话、资源管理器", viewId: null, current: true, pressed: true},
                entry("search", "搜索", "i-lucide-search", false),
                entry("outline", "大纲", "i-lucide-list-tree", false),
                // 成员视图的声明不在：名称是视图 id，没有图标可取，画占位图标。
                {id: "view:example.gone", label: "example.gone", icon: null, tooltip: "example.gone", viewId: "example.gone", current: false, pressed: false},
            ];
            const items = [
                {id: "profile", title: "个人资料尚未开放", icon: "i-lucide-user", interactive: false, pressed: null, disabledReason: null},
                {id: "settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: true, disabledReason: null},
                {id: "sync", title: "同步", icon: "i-lucide-refresh-cw", interactive: true, pressed: null, disabledReason: "没有打开项目"},
            ];
            const base = {label: "活动栏", moreLabel: "更多"};
            return [
                {id: "default", label: "一个容器一个入口：当前容器按下，声明不在的画占位图标，底段全局项", input: {props: {...base, entries, items}}},
                {id: "many", label: "容器多：放不下时后面的收进“更多”，当前容器的总在外面", input: {props: {...base, entries: [...Array.from({length: 24}, (_, index) => entry(`v${String(index)}`, `视图 ${String(index)}`, "i-lucide-square", false)), entry("last", "排在最后的当前容器", "i-lucide-star", true)], items}}},
                {id: "empty", label: "侧栏里没有容器", input: {props: {...base, entries: [], items}}},
                {id: "right", label: "右轨：右栏的容器，没有全局项，提示朝左开", input: {props: {...base, label: "右栏", region: "auxiliarybar" as const, joined: true, entries: entries.slice(0, 2)}}},
                {id: "right-english", label: "Right rail, English tooltips", input: {props: {label: "Secondary side bar", moreLabel: "More", region: "auxiliarybar" as const, entries: [{id: "view:messages", label: "Messages", icon: "i-lucide-message-square", tooltip: "Messages: conversations with bots and agents", viewId: "messages", current: true, pressed: true}, {id: "view:outline", label: "Outline", icon: "i-lucide-list-tree", tooltip: "Outline", viewId: "outline", current: false, pressed: false}]}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue"),
    }),
    defineLabFixture<typeof WorkbenchFloatRailHandle>({
        component: "WorkbenchFloatRailHandle",
        scenes: [
            {id: "default", label: "浮动窗里展开的视图段（260），手柄在它内侧；往左拖变宽、键盘左右每次 10", input: {props: {width: 260, bounds: {minimum: 200, maximum: 420, width: 260}, revision: "lab", label: "调整视图段的宽度"}}},
            {id: "narrowest", label: "拖到最窄 200", input: {props: {width: 200, bounds: {minimum: 200, maximum: 420, width: 260}, revision: "lab", label: "调整视图段的宽度"}}},
        ],
        load: async () => (await import("./WorkbenchFloatRailHandleFixture.vue")).default,
    }),
    defineSubjectFixture<typeof WorkbenchRegionStrip>({
        component: "WorkbenchRegionStrip",
        events: ["select", "context-menu"],
        class: "h-[32px] w-full",
        scenes: (() => {
            const entry = (id: string, label: string, icon: string, current = false) => ({id: `view:${id}`, label, icon, tooltip: label, viewId: id, current, pressed: current});
            const bottom = [entry("tasks", "后台任务", "i-lucide-list-checks", true), entry("notifications", "通知", "i-lucide-bell"), entry("output", "输出", "i-lucide-terminal")];
            const base = {moreLabel: "更多", dragHint: "按空格拿起，方向键移动，回车放下"};
            return [
                {id: "titles", label: "底部面板：标题入口，当前容器带下划线", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: bottom}}},
                {id: "narrow", label: "放不下：给并进来的头留 160px，后面的入口收进“更多”，当前容器的总在外面（拖窄画布看）", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: [...bottom, entry("problems", "问题", "i-lucide-circle-alert"), entry("terminal", "终端", "i-lucide-square-terminal")], headMinWidth: 160}}},
                {id: "hidden", label: "区域隐藏着：没有按下的入口", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: bottom.map((item) => ({...item, pressed: false}))}}},
                {id: "dragging", label: "拖动中：被拖的入口留着位置、看不见，拖着的视图放下会并进的入口高亮", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: bottom, placeholder: "view:output", highlighted: "view:notifications"}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue"),
    }),
    defineLabFixture<typeof ThemeEditor>({
        component: "ThemeEditor",
        scenes: [
            {id: "empty", label: "还没有我的主题", input: {props: {themes: [], closable: true}}},
            {id: "loading", label: "正在读取我的主题", input: {props: {themes: [], closable: true}}},
            {id: "basic", label: "基本信息", input: {props: {themes: [], closable: true}}},
            {id: "colors", label: "配色（主色、分组、行内对比度）", input: {props: {themes: [], closable: true}}},
            {id: "dark", label: "配色，编辑暗色", input: {props: {themes: [], closable: true}}},
            {id: "fonts", label: "字体", input: {props: {themes: [], closable: true}}},
            {id: "chrome", label: "活动栏与画框", input: {props: {themes: [], closable: true}}},
            {id: "scene", label: "场景与取景（还没有场景图）", input: {props: {themes: [], closable: true}}},
            {id: "scene-full", label: "场景与取景（有工作态场景、提供者未发布）", input: {props: {themes: [], closable: true}}},
            {id: "icons", label: "图标（有两个覆盖）", input: {props: {themes: [], closable: true}}},
            {id: "icons-empty", label: "图标（还没有覆盖）", input: {props: {themes: [], closable: true}}},
            {id: "contrast", label: "对比度检查：没有不合格项", input: {props: {themes: [], closable: true}}},
            {id: "failing", label: "对比度检查：弱化文字太淡", input: {props: {themes: [], closable: true}}},
            {id: "colors-english", label: "配色，英文界面", input: {props: {themes: [], closable: true}}},
        ],
        load: async () => withWorkbenchText((await import("./ThemeEditorFixture.vue")).default, ["colors-english"]),
    }),
    defineLabFixture<typeof ThemeSettingsPage>({
        component: "ThemeSettingsPage",
        scenes: (() => {
            const entry = (id: string, plugin: string, title: string, titleEn: string, colors?: Record<string, string>) => ({id, plugin, declaration: {title: {"zh-CN": title, "en-US": titleEn}, base: "nbook" as const, light: colors === undefined ? {} : {colors}, dark: {}}});
            const builtin = [entry("nbook", "nbook.workbench", "NeuroBook", "NeuroBook"), entry("macos", "nbook.workbench", "macOS", "macOS")];
            const mine = [entry("user:00000000-0000-4000-8000-000000000001", "user", "夜读", "Night reading", {"--bg-main": "#f3ead8", "--text-main": "#2e261c", "--accent-main": "#8a5a24"}), entry("user:00000000-0000-4000-8000-000000000002", "user", "雨窗", "Rainy window", {"--bg-main": "#dfe8ee", "--text-main": "#1c2a36", "--accent-main": "#3b6f8f"})];
            return [
                {id: "empty", label: "还没有我的主题", input: {props: {themes: builtin, currentId: "nbook", appearance: "light"}}},
                {id: "mine", label: "两套我的主题，其中一套在用", input: {props: {themes: [...builtin, ...mine], currentId: "user:00000000-0000-4000-8000-000000000001", appearance: "light"}}},
                {id: "mine-english", label: "英文界面", input: {props: {themes: [...builtin, ...mine], currentId: "nbook", appearance: "light"}}},
            ];
        })(),
        load: async () => withWorkbenchText(createSubjectFixture<typeof ThemeSettingsPage>((await import("nbook/plugins/workbench/web/components/theme-editor/ThemeSettingsPage.vue")).default, {events: ["open"], class: "w-full max-w-[720px] p-6"}), ["mine-english"]),
    }),
    defineLabFixture<typeof TasksView>({
        component: "TasksView",
        scenes: (() => {
            // 集成场景：内存里的任务仓库由包装组件建；输入只是占位，场景不读它。
            const placeholder = {props: {context: {id: "nbook.tasks.list", generation: 1, visible: {value: false}, location: {value: "panel" as const}}}};
            return [
                {id: "mixed", label: "会话、项目与应用三种组（右栏隐藏时的宽度）", input: placeholder},
                {id: "mixed-tall", label: "拉高看全：会话块、等你处理、项目组与应用组", input: placeholder},
                {id: "mixed-all-tall", label: "全部项目：每个项目一组", input: placeholder},
                {id: "mixed-narrow", label: "默认布局的宽度", input: placeholder},
                {id: "mixed-phone-tall", label: "390 宽：每件两行", input: placeholder},
                {id: "mixed-collapsed-tall", label: "一个会话块收起", input: placeholder},
                {id: "mixed-cancelling-stopping-tall", label: "一件正在取消、一行正在停止", input: placeholder},
                {id: "mixed-more-tall", label: "另有 12 件没有列出、其他项目还有 1 件在运行", input: placeholder},
                {id: "empty", label: "没有任务", input: placeholder},
                {id: "mixed-tall-english", label: "英文界面", input: placeholder},
                {id: "mixed-phone-tall-english", label: "英文界面，390 宽", input: placeholder},
                {id: "mixed-phone-long-english", label: "英文界面，390 宽，拉长到应用组", input: placeholder},
                {id: "elsewhere", label: "当前项目没有、其他项目还有 3 件在运行", input: placeholder},
            ];
        })(),
        load: async () => (await import("./tasks-scene/TasksFixture.vue")).default,
    }),
    defineLabFixture<typeof TasksHover>({
        component: "TasksHover",
        noInput: "唯一的属性是任务仓库，不是场景能写的数据；包装组件在内存里建一份",
        scenes: [{id: "hover", label: "五件在跑、列出三件：确定与不确定进度，末尾写还有几件"}],
        load: async () => (await import("./tasks-scene/TasksFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchNotificationsView>({
        component: "WorkbenchNotificationsView",
        scenes: (() => {
            // 集成场景：真实的通知服务与中心由包装组件建；输入只是占位，场景不读它。
            const placeholder = {props: {context: {id: "nbook.workbench.notifications", generation: 1, visible: {value: false}, location: {value: "panel" as const}}}};
            return [
                {id: "mixed", label: "五条：两条没看过、带动作与详情（右栏隐藏时的宽度）", input: placeholder},
                {id: "mixed-narrow", label: "默认布局的宽度", input: placeholder},
                {id: "empty", label: "没有通知", input: placeholder},
            ];
        })(),
        load: async () => withWorkbenchText((await import("./workbench-scene/NotificationsViewFixture.vue")).default),
    }),
    defineLabFixture<typeof WorkbenchStatusBar>({
        component: "WorkbenchStatusBar",
        scenes: [
            {id: "no-project", label: "未打开项目", input: {props: {project: null, panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "project", label: "项目名", input: {props: {project: "长篇小说《雾港》第二部", panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "unsaved", label: "布局未保存", input: {props: {project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "customizations", kind: "unsaved", code: "unavailable"}]}}},
            {id: "unread", label: "布局未读取", input: {props: {project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "side", kind: "unread", code: "corrupt"}]}}},
            {id: "hidden", label: "面板已隐藏、按钮不可用", input: {props: {project: null, panelHidden: true, panelToggleDisabled: true, problems: []}}},
            {id: "bell-unread", label: "铃铛：有 2 条没看过的通知", input: {props: {project: "雾港", panelHidden: true, panelToggleDisabled: false, problems: [], unreadNotifications: 2}}},
        ],
        // 场景 `hidden` 一直是英文界面，id 被引用，所以点名。
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchStatusBar>((await import("nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue")).default, {events: ["toggle-panel", "retry", "discard"], class: "w-full"}), ["hidden"]),
    }),
    defineLabFixture<typeof WorkbenchTitleBar>({
        component: "WorkbenchTitleBar",
        scenes: (() => {
            const entry = (command: string, label: string, extra: {args?: Record<string, unknown>; reason?: string; shortcut?: string; checked?: boolean} = {}) => ({
                id: extra.args === undefined ? command : `${command} ${JSON.stringify(extra.args)}`, command, args: extra.args ?? {}, label,
                enabled: extra.reason === undefined, reason: extra.reason ?? null, shortcut: extra.shortcut ?? null, checked: extra.checked ?? null,
                context: null, icon: null, placement: "inline" as const,
            });
            const menus = [
                {id: "file", label: "文件", sections: [[entry("nbook.project.open", "打开项目"), entry("nbook.project.back-to-shelf", "回到书架")], [entry("nbook.editor.save", "保存", {reason: "活动文档没有需要保存的修改"}), entry("nbook.editor.save-all", "全部保存")]]},
                {id: "edit", label: "编辑", sections: [[entry("nbook.edit.undo", "撤销", {reason: "没有活动的编辑器"}), entry("nbook.edit.redo", "重做", {reason: "没有活动的编辑器"})]]},
                {id: "view", label: "视图", sections: [[entry("nbook.quick-open.open-commands", "命令面板", {shortcut: "Ctrl+Shift+P"})], [entry("nbook.view.set-part-hidden", "侧栏", {args: {part: "sidebar"}, checked: true}), entry("nbook.view.set-part-hidden", "右栏", {args: {part: "auxiliarybar"}, checked: false})], [entry("nbook.app.reload", "重新载入")]]},
                {id: "help", label: "帮助", sections: [[entry("nbook.help.documentation", "文档")]]},
            ];
            const layout = {sidebar: {pressed: true, disabled: false}, panel: {pressed: true, disabled: false}, auxiliarybar: {pressed: false, disabled: false}};
            const base = {menus, searchShortcut: "Ctrl+Shift+P", layout, items: []};
            return [
                {id: "project", label: "打开了项目", input: {props: {...base, project: "长篇小说《雾港》第二部", shelf: "回到书架"}}},
                {id: "no-project", label: "没有项目", input: {props: {...base, project: null, shelf: "回到书架"}}},
                {id: "no-shelf", label: "没有书架插件：作品下拉没有“回到书架”，标志不可点", input: {props: {...base, project: "雾港"}}},
                {id: "items", label: "带条目", input: {props: {...base, project: "雾港", items: [{id: "test.items.sync", text: "已同步", title: "同步状态", alignment: "right" as const, order: 0, priority: 0, command: null, tooltip: null, state: "normal" as const, disabledReason: null, icon: null, hover: null}]}}},
                {id: "long", label: "长英文项目名、英文界面与条目（窄宽度验收 35）", input: {props: {...base, project: "The Lighthouse Keeper's Chronicle, Volume Two", items: [{id: "test.items.sync", text: "Synced", title: "Sync status", alignment: "right" as const, order: 0, priority: 0, command: null, tooltip: null, state: "normal" as const, disabledReason: null, icon: null, hover: null}]}}},
            ];
        })(),
        // 场景 `long` 一直是英文界面，id 被 e2e 引用，所以点名。
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchTitleBar>((await import("nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue")).default, {events: ["run", "search", "toggle-part", "open-project", "run-item", "back-to-shelf"], class: "w-full"}), ["long"]),
    }),
    defineLabFixture<typeof WorkbenchItemStrip>({
        component: "WorkbenchItemStrip",
        scenes: (() => {
            type Extra = {title?: string; order?: number; priority?: number; command?: boolean; state?: "normal" | "warning" | "error"; disabledReason?: string; tooltip?: string; icon?: {name: string; spin: boolean; muted: boolean}};
            const entry = (id: string, text: string, extra: Extra = {}) => ({
                id, text, title: extra.title ?? text, alignment: "right" as const, order: extra.order ?? 0, priority: extra.priority ?? 0,
                command: extra.command === true ? {id: "nbook.editor.save-all", args: {}} : null,
                tooltip: extra.tooltip ?? null, state: extra.state ?? "normal", disabledReason: extra.disabledReason ?? null,
                // 悬停内容带加载函数，不是场景能写的数据；它由 WorkbenchItemStrip.dom.test.ts 测。
                icon: extra.icon ?? null, hover: null,
            });
            const editor = [
                entry("nbook.editor.unsaved", "未保存 3 个", {title: "未保存的文档", order: 10, priority: 30, command: true, state: "warning", tooltip: "第一章.md、第二章.md、设定.md"}),
                entry("nbook.editor.word-count", "12,480 字", {title: "字数", order: 20, priority: 20}),
                entry("nbook.editor.cursor", "第 18 行，第 4 列", {title: "光标位置", order: 30, priority: 10}),
            ];
            return [
                {id: "editor", label: "编辑器的三个条目", input: {props: {entries: editor, itemHeight: 20, align: "end"}}},
                {id: "states", label: "出错、禁用与长文字", input: {props: {itemHeight: 20, align: "end", entries: [
                    entry("test.items.failed", "保存失败 1 个", {order: 1, priority: 5, command: true, state: "error", tooltip: "第一章.md：磁盘已满"}),
                    entry("test.items.disabled", "全部保存", {order: 2, priority: 5, command: true, disabledReason: "没有需要保存的文档"}),
                    entry("test.items.long", "一段相当长的条目文字，用来看看三百二十像素的上限与省略号在状态栏里是什么样子", {order: 3, priority: 1}),
                ]}}},
                {id: "icons", label: "图标：转圈加文字、只有图标（淡色与出错）", input: {props: {itemHeight: 20, align: "end", entries: [
                    entry("test.items.running", "3 个任务", {title: "后台任务", order: 1, priority: 5, command: true, icon: {name: "i-lucide-loader-circle", spin: true, muted: false}}),
                    entry("test.items.idle", "", {title: "后台任务", order: 2, priority: 5, command: true, icon: {name: "i-lucide-list-checks", spin: false, muted: true}}),
                    entry("test.items.failed-icon", "", {title: "后台任务：1 个没有成功", order: 3, priority: 5, command: true, state: "error", icon: {name: "i-lucide-circle-x", spin: false, muted: false}}),
                ]}}},
                {id: "many", label: "放不下时收进“更多”", input: {props: {itemHeight: 20, align: "end", entries: Array.from({length: 14}, (_, index) => entry(`test.items.n${String(index)}`, `条目 ${String(index + 1)} · 一些文字`, {order: index, priority: index % 4, command: index % 3 === 0}))}}},
            ];
        })(),
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchItemStrip>((await import("nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue")).default, {events: ["run"], class: "w-full"})),
    }),
    defineSubjectFixture<typeof TitleActions>({
        component: "TitleActions",
        events: ["run"],
        scenes: (() => {
            const entry = (key: string, command: string, icon: string | null, title: string, extra: {disabledReason?: string; pressed?: boolean} = {}) => ({
                key, command, icon, title,
                disabledReason: extra.disabledReason ?? null,
                ...(extra.pressed === undefined ? {} : {pressed: extra.pressed}),
            });
            const buttons = (manifests: boolean, canCreate: boolean) => [
                entry("own:0", "nbook.files.new-file", "i-lucide-file-plus", "新建文件", canCreate ? {} : {disabledReason: "没有可以新建的位置"}),
                entry("own:1", "nbook.files.new-folder", "i-lucide-folder-plus", "新建文件夹", canCreate ? {} : {disabledReason: "没有可以新建的位置"}),
                entry("own:2", "nbook.view.refresh-files", "i-lucide-refresh-cw", "刷新"),
                entry("own:3", "nbook.files.collapse-all", "i-lucide-copy-minus", "全部收起"),
                entry("own:4", "nbook.files.toggle-manifests", "i-lucide-file-code", "显示清单文件", {pressed: manifests}),
            ];
            const base = {identity: "nbook.files|view:nbook.files|single|published|1", moreLabel: "更多操作"};
            const menu = [
                [entry("own:5", "nbook.files.toggle-hidden", null, "显示隐藏文件", {pressed: true}), entry("own:6", "nbook.files.reveal-in-system", "i-lucide-folder-open", "在系统中显示")],
                [entry("acme.export.selection", "acme.export.selection", "i-lucide-download", "导出选中的章节", {disabledReason: "没有选中的章节"})],
            ];
            return [
                {id: "default", label: "资源管理器的五个动作", input: {props: {...base, model: {buttons: buttons(false, true), menu: []}}}},
                {id: "pressed", label: "开关按下", input: {props: {...base, model: {buttons: buttons(true, true), menu: []}}}},
                {id: "disabled", label: "不可用：禁用并给出原因", input: {props: {...base, model: {buttons: buttons(false, false), menu: []}}}},
                {id: "more", label: "“⋯”：自己的菜单动作与别的插件贡献的（分节、勾选、禁用带原因）", input: {props: {...base, model: {buttons: buttons(false, true), menu}}}},
            ];
        })(),
        subject: () => import("nbook/ui/menus/TitleActions.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchDragFeedback>({
        component: "WorkbenchDragFeedback",
        events: [],
        scenes: [
            {id: "line", label: "标签条的插入线与拖影", input: {props: {ghost: {label: "资源管理器", icon: "i-lucide-files"}, ghostAt: {x: 220, y: 140}, preview: {areaRect: null, entryRect: null, indicator: {left: 180, top: 96, right: 182, bottom: 128}, orientation: "horizontal"}, label: "放在这里", kind: "strip"}}},
            {id: "area", label: "拆到一边的矩形", input: {props: {ghost: {label: "终端", icon: "i-lucide-terminal"}, ghostAt: {x: 320, y: 260}, preview: {areaRect: {left: 120, top: 200, right: 520, bottom: 320}, entryRect: null, indicator: null, orientation: "vertical"}, label: "拆到这一边", kind: "edge"}}},
            {id: "idle", label: "没有拖动", input: {props: {ghost: null, preview: null, label: "", kind: ""}}},
        ],
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue"),
    }),
    defineLabFixture<typeof WorkbenchViewFrame>({
        component: "WorkbenchViewFrame",
        scenes: (() => {
            const base = {viewId: "test.files", layout: "scroll" as const, error: null, component: null, context: null, generation: 1, busy: false};
            return [
                {id: "declared", label: "等待入口启动", input: {props: {...base, delivery: {kind: "declared" as const}, status: "waiting" as const}}},
                {id: "blocked", label: "入口受阻", input: {props: {...base, delivery: {kind: "entry-blocked" as const, reason: "missing-dependency：nbook/storage"}, status: "waiting" as const}}},
                {id: "failed", label: "入口启动失败（可重试）", input: {props: {...base, delivery: {kind: "entry-failed" as const, reason: "activation-threw"}, status: "waiting" as const}}},
                {id: "stopped", label: "入口已停止", input: {props: {...base, delivery: {kind: "entry-stopped" as const, reason: "scope-closed" as const}, status: "waiting" as const}}},
                {id: "loading", label: "加载中", input: {props: {...base, delivery: {kind: "available" as const}, status: "loading" as const}}},
                {id: "load-failed", label: "加载失败（重新加载）", input: {props: {...base, delivery: {kind: "available" as const}, status: "load-failed" as const, error: "Failed to fetch dynamically imported module"}}},
                {id: "render-failed", label: "渲染出错（重试）", input: {props: {...base, delivery: {kind: "available" as const}, status: "render-failed" as const, error: "Cannot read properties of undefined"}}},
            ];
        })(),
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchViewFrame>((await import("nbook/plugins/workbench/web/components/WorkbenchViewFrame.vue")).default, {events: ["retry-entry", "reload", "retry-render", "render-error"], class: "h-full w-full"})),
    }),
    defineLabFixture<typeof ExplorerRow>({
        component: "ExplorerRow",
        scenes: (() => {
            const scene = (id: string, label: string, index: number, extra: {selected?: boolean; active?: boolean; edit?: {name: string; error: string | null; busy: boolean}; hideMarkdownExtension?: boolean} = {}) => ({id, label, input: {props: {row: EXPLORER_ROWS[index] as (typeof EXPLORER_ROWS)[number], domId: `lab-row-${id}`, selected: extra.selected ?? false, active: extra.active ?? false, height: 26, edit: extra.edit ?? null, hideMarkdownExtension: extra.hideMarkdownExtension ?? false}}});
            return [
                scene("node", "内容节点：展示名与真实名字", 3),
                scene("selected", "选中并有焦点框", 3, {selected: true, active: true}),
                scene("no-body", "无正文的节点", 2),
                scene("leaf", "只有正文的节点：没有展开控件", 5),
                scene("missing", "缺失条目", 6),
                scene("unlisted", "未列入项", 7),
                scene("binder", "活页夹：需要剧情插件", 10),
                scene("content-folder", "内容文件夹：去掉后缀", 1),
                scene("manifest-error", "清单不合法", 8),
                scene("loading", "列出中", 11),
                scene("error", "读取失败", 12),
                scene("hide-md", "隐藏 Markdown 扩展名", 14, {hideMarkdownExtension: true}),
                scene("root", "根：分节标题", 0),
                scene("rename", "改名：名字冲突的提示", 3, {selected: true, edit: {name: "alice", error: "已存在同名项", busy: false}}),
            ];
        })(),
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerRow>((await import("nbook/plugins/explorer/web/components/ExplorerRow.vue")).default, {events: ["press", "activate", "context", "retry"], class: "w-full"})),
    }),
    defineLabFixture<typeof ExplorerTree>({
        component: "ExplorerTree",
        scenes: [
            {id: "kinds", label: "三类文件夹与行上的状态", input: {props: {rows: EXPLORER_ROWS, selected: ["project://lore.content/bob"], focus: "project://lore.content/bob", label: "文件"}}},
            {id: "guides", label: "缩进参考线一直显示、焦点那一层加深", input: {props: {rows: EXPLORER_ROWS, selected: ["project://lore.content/carol"], focus: "project://lore.content/carol", label: "文件", indentGuides: "always"}}},
            {id: "many", label: "五百行：虚拟滚动与长名字", input: {props: {rows: manyRows(500), selected: [], focus: null, label: "文件"}}},
            {id: "english", label: "英文界面", input: {props: {rows: EXPLORER_ROWS, selected: [], focus: null, label: "Files"}}},
        ],
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerTree>((await import("nbook/plugins/explorer/web/components/ExplorerTree.vue")).default, {
            events: ["row-press", "row-activate", "row-context", "retry", "focus-change"],
            class: "h-full w-full",
            runtimeProps: {handleKey: () => "none" as const},
        })),
    }),
    defineLabFixture<typeof InlineChip>({
        component: "InlineChip",
        scenes: [
            {id: "reference", label: "引用作品里的文件", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md"}}},
            {id: "reference-image", label: "引用一张图片", input: {props: {kind: "reference", label: "地图", target: "/资料/地图.png"}}},
            {id: "attachment", label: "引用会话附件", input: {props: {kind: "reference", label: "截图", target: "session://attachments/截图.png"}}},
            {id: "external", label: "外部链接", input: {props: {kind: "reference", label: "官网", target: "https://example.com"}}},
            {id: "other", label: "旧应用的领域地址", input: {props: {kind: "reference", label: "第一章", target: "chapter://c1"}}},
            {id: "long", label: "过长的名称截断", input: {props: {kind: "reference", label: "一个非常非常非常非常非常非常长的设定文件名字", target: "/设定/很长.md"}}},
            {id: "skill", label: "技能", input: {props: {kind: "skill", label: "reviewer"}}},
            {id: "selection", label: "选区", input: {props: {kind: "selection", label: "第一章.md#L3-L8"}}},
            {id: "command", label: "命令", input: {props: {kind: "command", label: "plan"}}},
            {id: "image", label: "图片 #1", input: {props: {kind: "image", number: 1}}},
            {id: "uploading", label: "文件上传中", input: {props: {kind: "file", label: "笔记.txt", number: 2, state: "uploading"}}},
            {id: "failed", label: "上传失败", input: {props: {kind: "image", number: 3, state: "failed", error: "文件太大"}}},
            {id: "paste", label: "粘贴位置", input: {props: {kind: "paste", number: 4}}},
            {id: "highlighted", label: "联动高亮", input: {props: {kind: "image", number: 1, highlighted: true}}},
            {id: "selected", label: "在选区里", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md", selected: true}}},
            {id: "interactive", label: "可聚焦（静态显示里）", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md", interactive: true}}},
            {id: "english", label: "英文界面", input: {props: {kind: "file", label: "notes.txt", number: 2, state: "uploading"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./InlineChipFixture.vue")).default),
    }),
    defineLabFixture<typeof MarkdownDisplay>({
        component: "MarkdownDisplay",
        scenes: [
            {id: "reply", label: "一条完整的回复（各方言）", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "streaming", label: "流式追加", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "conversation", label: "100 条消息的长对话", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "plain", label: "只有普通 Markdown", input: {props: {text: "## 小结\n\n- 第一章节奏**偏快**\n- 第二章的*伏笔*可以提前，~~旧的开头~~删掉\n\n#### 细节\n\n---\n\n```ts\nconst answer = 42;\n```\n\n| 章 | 字数 |\n|---|---|\n| 一 | 3200 |", locale: "zh-CN"}}},
            {id: "empty", label: "空文本", input: {props: {text: "", locale: "zh-CN"}}},
            {id: "stickers", label: "表情：夹在文字里、一段只有表情的大图、认不出的原文", input: {props: {text: LAB_STICKER_TEXT, locale: "zh-CN"}}},
            {id: "stickers-late", label: "表情：目录晚到，先显示原文占位", input: {props: {text: LAB_STICKER_TEXT, locale: "zh-CN"}}},
            {id: "stickers-display", label: "表情包按贴纸显示：夹在文字里的也是大图，点图发出 sticker", input: {props: {text: LAB_STICKER_TEXT, locale: "zh-CN"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./MarkdownDisplayFixture.vue")).default),
    }),
    defineLabFixture<typeof PromptEditor>({
        component: "PromptEditor",
        scenes: promptEditorScenes,
        load: async () => withMarkdownSceneText((await import("./prompt-scene/PromptEditorFixture.vue")).default),
    }),
    // 这三个零件经场景端口取文字（`markdown-text.ts`），所以不用 defineSubjectFixture，自己包一层（同 ExplorerTree）。
    defineLabFixture<typeof PromptTextView>({
        component: "PromptTextView",
        scenes: promptTextViewScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptTextView>(withNbookMarkdownHost((await import("@notnotype/nb-markdown/prompt")).PromptTextView).default, {
            events: ["token-activate"],
            class: "w-full p-4 text-[13px] leading-[1.6] text-[var(--text-main)]",
            runtimeProps: {resolveThumbnail: (target: string) => PROMPT_LAB_THUMBNAILS[target] ?? null},
        })),
    }),
    defineLabFixture<typeof PromptAttachmentStrip>({
        component: "PromptAttachmentStrip",
        scenes: promptAttachmentStripScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptAttachmentStrip>((await import("@notnotype/nb-markdown/prompt")).PromptAttachmentStrip, {
            events: ["activate", "remove", "retry", "hover"],
            writeBack: {hover: {layer: "props", key: "highlighted"}},
            class: "w-full",
        })),
    }),
    defineLabFixture<typeof PromptPasteFrame>({
        component: "PromptPasteFrame",
        scenes: promptPasteFrameScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptPasteFrame>((await import("@notnotype/nb-markdown/prompt")).PromptPasteFrame, {
            events: ["hover"],
            class: "w-full",
        })),
    }),
    // 属性面板：写回直接改场景的 `raw` 与 `open`，点一下就能看到改过的原文（数据 tab）。
    defineLabFixture<typeof MarkdownProperties>({
        component: "MarkdownProperties",
        scenes: [
            {id: "open", label: "展开：五种类型各一个", input: {props: {raw: PROPERTIES_SAMPLE}, model: {open: true}}},
            {id: "closed", label: "收起：一行摘要", input: {props: {raw: PROPERTIES_SAMPLE}, model: {open: false}}},
            {id: "complex", label: "表示不了的属性", input: {props: {raw: `${PROPERTIES_SAMPLE.slice(0, -4)}人物关系:\n  林雪: 姐妹\n  沈舟: 旧识\n---\n`}, model: {open: true}}},
            {id: "error", label: "YAML 写错", input: {props: {raw: "---\n视角: 林雪\n时间: 2025-12-21\n地点: [青石镇, 北山\n字数目标: 4000\n---\n"}, model: {open: false}}},
            {id: "empty", label: "没有属性", input: {props: {raw: "---\n---\n"}, model: {open: true}}},
            {id: "long", label: "很长的名字与值", input: {props: {raw: "---\n这一章里出场的所有人物与他们的别名: [林雪, 雪儿, 沈舟, 舟哥, 掌柜, 渡口的船夫, 北山的猎户]\n一句很长的提要: 雪是后半夜落下来的，林雪推开客栈的窗，镇子已经白了一层，石板路上只剩一行脚印\n---\n"}, model: {open: true}}},
            {id: "readonly", label: "只读", input: {props: {raw: PROPERTIES_SAMPLE, readonly: true}, model: {open: true}}},
            {id: "english", label: "英文界面", input: {props: {raw: "---\npov: Lin Xue\ndate: 2025-12-21\nplaces: [Qingshi, North Hill]\nword goal: 4000\nfinal: false\n---\n"}, model: {open: false}}},
            // 宿主按属性名给图标、显示名与类型（输出 60）：`describe` 是运行期的函数，下面的 `runtimeProps` 给；只有这个场景里的键（`叙事视角` 等）有声明，别的场景不受影响。
            {id: "declared", label: "插件的声明：图标、显示名、空值按声明的类型输入", input: {props: {raw: "---\n叙事视角: 林雪\n截稿日:\n预计字数:\n定稿:\n关键词:\n地点: 青石镇\n---\n"}, model: {open: true}}},
            {id: "declared-long", label: "插件的声明：很长的显示名；表示不了的行有显示名、图标不换", input: {props: {raw: "---\n人物别名: [林雪, 雪儿]\n人物关系:\n  林雪: 姐妹\n  沈舟: 旧识\n---\n"}, model: {open: true}}},
            {id: "declared-readonly", label: "插件的声明：只读（显示名照出，不能点着改名）", input: {props: {raw: "---\n叙事视角: 林雪\n截稿日: 2025-12-21\n预计字数: 4000\n定稿: true\n关键词: [雪, 客栈]\n---\n", readonly: true}, model: {open: true}}},
            {id: "declared-english", label: "插件的声明：英文的显示名", input: {props: {raw: "---\npov: Lin Xue\ndue:\nword goal: 4000\n---\n"}, model: {open: true}}},
        ],
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof MarkdownProperties>((await import("@notnotype/nb-markdown/editor")).MarkdownProperties, {
            events: ["commit", "update:open", "leave"],
            writeBack: {commit: {layer: "props", key: "raw"}},
            class: "w-full max-w-[720px]",
            runtimeProps: {describe: (name: string) => PROPERTY_DECLARATIONS[name] ?? null},
        })),
    }),
    defineLabFixture<typeof MarkdownImage>({
        component: "MarkdownImage",
        scenes: [
            {id: "shown", label: "显示", input: {props: {src: "images/封面.png", alt: "封面", title: "第一卷封面"}}},
            {id: "loading", label: "读取中", input: {props: {src: "lab://loading", alt: "封面"}}},
            {id: "outside", label: "不在作品里", input: {props: {src: "lab://outside", alt: "外面的图"}}},
            {id: "broken", label: "读不出", input: {props: {src: "lab://broken", alt: "坏图"}}},
            {id: "no-alt", label: "没有说明", input: {props: {src: "lab://outside"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./MarkdownImageFixture.vue")).default),
    }),
    defineLabFixture<typeof FileIcon>({
        component: "FileIcon",
        scenes: [
            {id: "markdown", label: "Markdown 文件", input: {props: {icon: "markdown"}}},
            {id: "content-open", label: "展开的内容文件夹", input: {props: {icon: "folder-content-open"}}},
            {id: "image", label: "图片", input: {props: {icon: "image"}}},
        ],
        load: async () => (await import("./FileIconFixture.vue")).default,
    }),
    defineLabFixture<typeof ExplorerFeedback>({
        component: "ExplorerFeedback",
        scenes: [
            {id: "editor-missing", label: "编辑器尚未接入", input: {props: {notice: {kind: "editor-missing", address: "project://lore.content/bob/index.md"}}}},
            {id: "open-failed", label: "打开失败、长路径", input: {props: {notice: {kind: "open-failed", address: "project://一个非常深的目录/再深一层/还有一层/第一百二十三章 一个相当长的章节标题.md", reason: "not-text：文件含 NUL，不是文本"}}}},
            {id: "none", label: "没有提示", input: {props: {notice: null}}},
        ],
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerFeedback>((await import("nbook/plugins/explorer/web/components/ExplorerFeedback.vue")).default, {events: ["dismiss"], class: "w-full"})),
    }),
    defineLabFixture<typeof FilesExplorerView>({
        component: "FilesExplorerView",
        scenes: (() => {
            const base = {rows: EXPLORER_ROWS, selected: [], focus: null, ready: true, notice: null, problem: null};
            return [
                // 集成场景：真实的视图宿主、控制器与命令，文件换成内存适配器；输入只是占位，场景不读它。
                {id: "live", label: "内存数据：真实控制器与命令", input: {props: base}},
                {id: "default", label: "浏览", input: {props: base}},
                {id: "unbound", label: "未打开项目、用户资产停止同步", input: {props: {...base, rows: UNBOUND_ROWS}}},
                {id: "unsaved", label: "偏好未保存、编辑器尚未接入", input: {props: {...base, problem: {kind: "unsaved" as const, code: "conflict"}, notice: {kind: "editor-missing" as const, address: "project://plain/a.md"}}}},
                {id: "loading", label: "偏好还在读取", input: {props: {...base, ready: false}}},
                {id: "delete", label: "删除确认：多项与长路径", input: {props: {...base, dialog: {kind: "delete" as const, items: Array.from({length: 12}, (_, index) => ({address: `project://一个很深的目录/第${String(index + 1)}章 一个相当长的章节标题.md`, token: `t${String(index)}`})), busy: false, unsaved: ["project://一个很深的目录/第1章 一个相当长的章节标题.md"]}}}},
                {id: "dirty-copy", label: "复制有未保存修改的文件", input: {props: {...base, dialog: {kind: "dirty-copy" as const, documents: ["project://chapters/第一章.md", "project://chapters/第二章.md"], saveable: true}}}},
                {id: "report", label: "删除部分失败、进行中", input: {props: {...base, running: {action: "delete" as const, count: 3}, report: {action: "delete" as const, items: [
                    {address: "project://plain", target: null, result: {status: "failed" as const, code: "permission-denied", detail: "没有权限", partial: {removed: {paths: ["plain/a.md", "plain/b.md"], truncated: false}}}},
                    {address: "project://a.md", target: null, result: {status: "done" as const}},
                    {address: "project://b.md", target: null, result: {status: "not-run" as const, reason: "stopped" as const}},
                ], manifests: [{path: "lore.content/content.xml", status: "failed" as const, detail: "写不进去"}], truncated: false}}}},
                {id: "collision", label: "粘贴碰撞：长路径与名字不能用", input: {props: {...base, dialog: {kind: "collision" as const, action: "copy" as const, source: "project://一个很深的目录/再深一层/第一百二十三章 一个相当长的章节标题.md", target: "project://另一个目录/第一百二十三章 一个相当长的章节标题.md", candidate: "第一百二十三章 一个相当长的章节标题 (2).md", error: {code: "conflict" as const}, busy: false as const}}}},
                {id: "unknown", label: "结果未知、剪切中、移动部分失败", input: {props: {
                    ...base,
                    rows: EXPLORER_ROWS.map((row) => (row.kind === "entry" && row.id === "project://lore.content/stray.md" ? {...row, cut: true} : row)),
                    unknown: {action: "move" as const, clipboard: 1, items: [{address: "project://plain/a.md", target: "project://lore.content/a.md"}, {address: "project://plain/z.md", target: "project://lore.content/z.md"}]},
                    report: {action: "move" as const, manifests: [], truncated: false, items: [
                        {address: "project://plain/a.md", target: "project://plain/sub/a.md", result: {status: "done" as const}},
                        {address: "project://plain/z.md", target: "project://plain/sub/z.md", result: {status: "failed" as const, code: "conflict", detail: "目标已存在"}},
                        {address: "project://plain/y.md", target: "project://plain/sub/y.md", result: {status: "declined" as const, reason: "skip" as const}},
                    ]},
                }}},
            ];
        })(),
        load: async () => (await import("./FilesExplorerViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorGroupHead>({
        component: "EditorGroup",
        // 集成场景：真实的编辑器区控制器、文档模型与控件，文件换成内存适配器；界面语言由场景 id 决定（`english` 用英文），输入只给多行标签（它是头的属性，所以类型按头）。
        scenes: [
            {id: "live", label: "内存数据：两个标签", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "split", label: "向右拆分的两组", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "english", label: "英文界面", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "empty", label: "没有标签：标志与提示", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "dialect", label: "Markdown 方言、提示块与原样内容", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "stickers", label: "表情：显示成图、一段只有表情的大图、打出结尾冒号变成表情", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments", label: "批注：批注末尾的小符号出浮层、按住 Ctrl 悬停，Ctrl+Alt+M 加批注，块菜单整块批注", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments-margin", label: "批注：页边开着（视口够宽时画在稿纸右边）", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments-slots", label: "批注页边：一段几条批注、短段与长段、下一段有无批注、表格行", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments-overlap", label: "批注：重叠的波浪线、块批注的显示", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "unrepresentable", label: "写不出：组顶部的提示", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "recycle", label: "回收：每种编辑器只留 2 个控件", input: {props: {groupId: "g0", wrapTabs: true}}},
        ],
        load: async () => (await import("./editor-scene/EditorAreaFixture.vue")).default,
    }),
    defineLabFixture<typeof MarkdownImageCard>({
        component: "MarkdownImageCard",
        // 卡片的数据来自夹具里的假文件服务；场景决定数据与宿主状态，`english` 用英文界面。需要的锚点、菜单文字与插图能力由夹具给出。
        scenes: [
            {id: "list", label: "存放目录里的图：缩略图、名字过长截中间、坏图画占位", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "loading", label: "读取中", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "empty", label: "没有图", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "error", label: "读不了：说明原因", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "truncated", label: "查到的比显示的多：末尾一行提示", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "no-library", label: "宿主没有提供插图能力：只能插入网址的图片，上传置灰", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "unbound", label: "没有绑定作品：列表为空，上传置灰", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "english", label: "英文界面", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
        ],
        load: async () => (await import("./editor-scene/MarkdownImageCardFixture.vue")).default,
    }),
    defineLabFixture<typeof ImageViewer>({
        component: "ImageViewer",
        // 字节绑定与图片由夹具生成（这里登记的 binding、host 只占位，夹具换成自己的）；可调的是文件名与界面语言。
        scenes: (() => {
            const base = {binding: null, host: {state: null, dispose: null}, readonly: true, visible: true};
            return [
                {id: "small", label: "比舞台小的图：原尺寸居中", input: {props: {...base, label: "插图.png", locale: "zh-CN" as const}}},
                {id: "large", label: "比舞台大的图：适应、点一下 100%", input: {props: {...base, label: "地图.png", locale: "zh-CN" as const}}},
                {id: "svg", label: "带透明的 SVG：棋盘格", input: {props: {...base, label: "图标.svg", locale: "zh-CN" as const}}},
                {id: "broken", label: "不是图片：说明与重试", input: {props: {...base, label: "坏图.png", locale: "en-US" as const}}},
            ];
        })(),
        load: async () => (await import("./image-viewer-scene/ImageViewerFixture.vue")).default,
    }),
    defineLabFixture<typeof HtmlPreview>({
        component: "HtmlPreview",
        // 文本绑定、令牌服务与时钟由夹具给出（这里登记的 binding、host 只占位）；界面语言由场景 id 决定（`-english` 结尾用英文）。
        scenes: (() => {
            const base = {binding: null, host: {state: null, dispose: null}, readonly: true, visible: true, label: "index.html"};
            return [
                {id: "page", label: "预览一张带脚本的页面", input: {props: base}},
                {id: "user", label: "不是作品里的文件", input: {props: base}},
                {id: "denied", label: "令牌申请失败：说明与重试", input: {props: base}},
                {id: "denied-english", label: "令牌申请失败：英文界面", input: {props: base}},
            ];
        })(),
        load: async () => (await import("./html-preview-scene/HtmlPreviewFixture.vue")).default,
    }),
    defineSubjectFixture<typeof EditorBreadcrumbs>({
        component: "EditorBreadcrumbs",
        events: ["open", "reveal", "escape"],
        class: "w-full",
        scenes: (() => {
            const segments = [
                {kind: "root" as const, label: "长夜", address: "project://"},
                {kind: "dir" as const, label: "正文", address: "project://正文"},
                {kind: "dir" as const, label: "卷一 一个相当长的卷名用来看截断", address: "project://正文/卷一 一个相当长的卷名用来看截断"},
                {kind: "file" as const, label: "第二章 旧城.md", address: "project://正文/卷一 一个相当长的卷名用来看截断/第二章 旧城.md", icon: fileIconForName("第二章 旧城.md")},
            ];
            const outline = {binding: "lab", version: 1, items: [{id: "h0", level: 1, text: "第二章 旧城"}, {id: "h1", level: 2, text: "雨夜的来客"}, {id: "h2", level: 2, text: "旧书店"}], current: "h1"};
            const base = {segments, parent: segments[2]?.address ?? null, locale: "zh-CN" as const};
            return [
                {id: "outline", label: "目录、文件与光标所在的标题", input: {props: {...base, outline}}},
                {id: "plain", label: "不是 Markdown：没有标题段", input: {props: {...base, outline: null}}},
            ];
        })(),
        // 目录下拉的列表：场景里的假数据，点哪个目录都列出同样几项。
        runtimeProps: async () => ({list: async (address: string) => ({ok: true as const, entries: [{name: "卷二", address: `${address}/卷二`, kind: "directory" as const}, {name: "第一章 雨夜.md", address: `${address}/第一章 雨夜.md`, kind: "file" as const}, {name: "第二章 旧城.md", address: `${address}/第二章 旧城.md`, kind: "file" as const}]})}),
        subject: () => import("nbook/plugins/editor/web/components/EditorBreadcrumbs.vue"),
    }),
    defineLabFixture<typeof CodeInput>({
        component: "CodeInput",
        scenes: [
            {id: "text", label: "两段文字", input: {props: {label: "主文字"}, model: {modelValue: "星瑕是个不怎么出门的数字游民，靠给各种工作室做外包维生。\n\n她的银白色长发是天生的，<V of=\"character.发色\" /> 这样的标签写一个字段的值。"}}},
            {id: "empty", label: "空的", input: {props: {label: "主文字"}, model: {modelValue: ""}}},
            {id: "readonly", label: "只读", input: {props: {label: "主文字", readonly: true}, model: {modelValue: "提交期间不能输入，能选能复制。"}}},
            {id: "json", label: "JSON", input: {props: {label: "设置", language: "json"}, model: {modelValue: "{\n    \"name\": \"星瑕\",\n    \"age\": 22\n}"}}},
            {id: "long-line", label: "很长的一行：折行，不出横向滚动", input: {props: {label: "主文字"}, model: {modelValue: "一行很长很长的文字".repeat(40)}}},
            {id: "stack", label: "二十个排在一起：进入视野才建编辑器", input: {props: {label: "第 1 块"}, model: {modelValue: "第 1 块\n\n往下滚，下面的块才建编辑器。"}}},
            {id: "english", label: "英文", input: {props: {label: "Text"}, model: {modelValue: "Xingxia rarely leaves her flat; she lives on contract work for small studios.\n\nHer silver hair is natural."}}},
        ],
        load: async () => (await import("./CodeInputFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorPageBreadcrumbs>({
        component: "EditorPageBreadcrumbs",
        scenes: [
            {id: "entry", label: "条目页：设定 › 人物 › 星瑕 › 哥哥（“人物”与最后一段不可点）", input: {props: {items: [{label: "设定"}, {label: "人物"}, {label: "星瑕"}, {label: "哥哥"}]}}},
            {id: "long", label: "中间的段很长：先缩短它", input: {props: {items: [{label: "设定"}, {label: "改动记录里一条很长很长的修订标题：按故事种子开局，建了 18 个条目、10 条前史，记下 7 个未决问题"}, {label: "这次改动"}]}}},
            {id: "plain", label: "没有可点的段", input: {props: {items: [{label: "设定"}, {label: "第 2 章"}, {label: "订了星瑾小时候最喜欢的蛋糕"}]}}},
        ],
        load: async () => (await import("./EditorPageBreadcrumbsFixture.vue")).default,
    }),
    defineLabFixture<typeof EntryTree>({
        component: "EntryTree",
        scenes: (() => {
            const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({id, name, folder: "", hasChildren: false, appeared: true, deleted: false, ...extra});
            const layer = (items: ReturnType<typeof item>[], remaining = 0, loading = false) => ({items, remaining, loading});
            const root = layer([
                item("xingxia", "星瑕", {folder: "人物", hasChildren: true}),
                item("baling", "白灵", {folder: "人物"}),
                item("hui", "彗", {folder: "人物", appeared: false}),
                item("federation", "联邦"),
                item("academy", "第三魔法学院", {folder: "地点"}),
                item("old", "被删掉的旧设定", {folder: "地点", deleted: true, hasChildren: true}),
            ], 12);
            const xingxia = layer([item("gege", "哥哥", {appeared: false}), item("girl", "魔法少女星")], 0);
            const sample = {props: {layers: {"": root, xingxia}, selected: "gege"}, model: {expanded: ["folder:人物", "folder:地点", "xingxia"]}};
            return [
                {id: "sample", label: "分组、未出场、已删除、还有 12 项", input: sample},
                {id: "loading-layer", label: "展开了还没读到的一层", input: {props: {layers: {"": root}}, model: {expanded: ["folder:人物", "xingxia"]}}},
                {id: "loading", label: "根这一层还没读到", input: {props: {layers: {} as Record<string, ReturnType<typeof layer>>}, model: {expanded: []}}},
                {id: "empty", label: "还没有条目", input: {props: {layers: {"": layer([])}}, model: {expanded: []}}},
                {id: "empty-creatable", label: "空着、可以新建：新建人物与新建条目", input: {props: {layers: {"": layer([])}, creatable: true}, model: {expanded: []}}},
                {id: "empty-blocked", label: "空着、世界只读：按钮禁用", input: {props: {layers: {"": layer([])}, creatable: true, blockedReason: "世界只读：日志损坏"}, model: {expanded: []}}},
                {id: "empty-creatable-english", label: "空状态（英文界面）", input: {props: {layers: {"": layer([])}, creatable: true}, model: {expanded: []}}},
                {id: "disconnected", label: "世界已断开", input: {props: {...sample.props, disconnected: true}, model: sample.model}},
                {id: "sample-english", label: "英文界面", input: sample},
            ];
        })(),
        load: async () => (await import("./EntryTreeFixture.vue")).default,
    }),
    ...canonEntryPageFixtures(),
    ...plotFixtures(),
    defineSubjectFixture<typeof EditorTabBar>({
        component: "EditorTabBar",
        events: ["activate", "keep", "close", "unpin", "move", "menu"],
        class: "w-full",
        scenes: (() => {
            type Extra = {preview?: boolean; dirty?: boolean; active?: boolean; pinned?: boolean; hint?: string};
            const tab = (id: string, label: string, extra: Extra = {}) => ({id, label, title: `project://chapters/${label}`, preview: extra.preview ?? false, dirty: extra.dirty ?? false, active: extra.active ?? false, pinned: extra.pinned ?? false, icon: fileIconForName(label), hint: extra.hint ?? null});
            const base = {label: "打开的编辑器", unsavedLabel: "未保存", pinnedLabel: "已固定"};
            const typical = [
                tab("p1", "大纲.md", {pinned: true}),
                tab("p2", "人物.md", {pinned: true, dirty: true}),
                tab("t1", "第一章 雨夜.md"),
                tab("t2", "第二章 旧城.md", {active: true, dirty: true}),
                tab("t3", "README.md", {hint: "notes"}),
                tab("t4", "README.md", {hint: "drafts"}),
                tab("t5", "cover.png"),
                tab("t6", "第三章 渡口.md", {preview: true}),
            ];
            const many = [tab("p1", "大纲.md", {pinned: true}), ...Array.from({length: 18}, (_, index) => tab(`t${String(index)}`, `第${String(index + 1)}章 一个相当长的章节标题.md`, {active: index === 9, dirty: index % 4 === 0}))];
            return [
                {id: "mixed", label: "固定、未保存、同名、预览与活动标签", input: {props: {...base, tabs: typical}}},
                {id: "many", label: "多行：固定标签单独一行，普通标签至多 3 行后滚动", input: {props: {...base, tabs: many}}},
                {id: "single-line", label: "关掉多行：一行横向滚动", input: {props: {...base, tabs: many, wrap: false}}},
                {id: "inactive-group", label: "不是活动组：活动标签文字为次级色", input: {props: {...base, tabs: typical, groupActive: false}}},
                {id: "single", label: "只有一个预览标签", input: {props: {...base, tabs: [tab("t1", "第一章.md", {preview: true, active: true})]}}},
            ];
        })(),
        runtimeProps: async () => ({closeLabel: (name: string) => `关闭 ${name}`, unpinLabel: (name: string) => `取消固定 ${name}`}),
        subject: () => import("nbook/plugins/editor/web/components/EditorTabBar.vue"),
    }),
    defineSubjectFixture<typeof SkillChip>({
        component: "SkillChip",
        scenes: [
            {id: "skill", label: "技能名", input: {props: {name: "novel-outline"}}},
            {id: "long-name", label: "长技能名", input: {props: {name: "novel-character-motivation-and-continuity-review"}}},
        ],
        subject: () => import("nbook/ui/SkillChip.vue"),
        class: "max-w-full",
    }),
    defineSubjectFixture<typeof NeuroBookLockup>({
        component: "NeuroBookLockup",
        noInput: "字标没有 prop：大小由使用方的 class 给，颜色跟随文字色。",
        scenes: [
            {id: "title", label: "标题栏大小（26px）"},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookLockup.vue"),
        class: "h-[26px] text-[var(--text-main)]",
    }),
    defineSubjectFixture<typeof NeuroBookMark>({
        component: "NeuroBookMark",
        scenes: [
            {id: "titlebar", label: "窄标题栏大小（18px）", input: {props: {decorative: false}}},
            {id: "decorative", label: "纯装饰（对读屏隐藏）", input: {props: {decorative: true}}},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookMark.vue"),
        class: "h-[18px] text-[var(--text-main)]",
    }),
    defineSubjectFixture<typeof NeuroBookMood>({
        component: "NeuroBookMood",
        scenes: [
            {id: "focus", label: "专注（看书）", input: {props: {state: "focus"}}},
            {id: "write", label: "写作中", input: {props: {state: "write"}}},
            {id: "idle", label: "空闲（跟着鼠标看）", input: {props: {state: "idle"}}},
            {id: "think", label: "思考", input: {props: {state: "think"}}},
            {id: "ask", label: "等你选择", input: {props: {state: "ask"}}},
            {id: "done", label: "完成", input: {props: {state: "done"}}},
            {id: "error", label: "出错", input: {props: {state: "error"}}},
            {id: "sleep", label: "睡着", input: {props: {state: "sleep"}}},
            {id: "dark", label: "深色底（透明）", input: {props: {state: "idea", variant: "dark"}}},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookMood.vue"),
        class: "w-28",
    }),
    ...shelfFixtures(),
    ...settingsFixtures(),
    ...nbUiFixtures,
    ...nbFormFixtures,
    ...nbLayoutFixtures,
    ...nbAgentUiFixtures,
];

/** 书架页（docs/specs/workbench/bookshelf.md）：静态稿给开发者看，也是页面接上真实数据之后的回归场景。 */
function shelfFixtures(): LabFixture[] {
    const [first, second, third, , long] = SHELF_ITEMS as [typeof SHELF_ITEMS[number], ...typeof SHELF_ITEMS];
    const page = {status: "ready" as const, items: SHELF_ITEMS, now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"};
    // 封面图由夹具给：Lab 没有服务端的封面路由，第一部作品用一张内联的 SVG，其余排版封面。
    const covers = async () => ({coverSrc: (item: ShelfItem) => (item.id === first.id ? SHELF_COVER_SRC : null)});
    return [
        defineLabFixture<typeof BookshelfPage>({
            component: "BookshelfPage",
            scenes: [
                {id: "cards", label: "卡片视图，选中一部", input: {props: page, model: {view: "cards", sort: "recent", activeId: first.id}}},
                {id: "list", label: "列表视图", input: {props: page, model: {view: "list", sort: "words", activeId: null}}},
                {id: "one", label: "只有一部", input: {props: {...page, items: [second]}, model: {view: "cards", sort: "recent", activeId: second.id}}},
                {id: "no-record", label: "有作品但没有写作记录", input: {props: {...page, items: [SHELF_ITEMS[3]!]}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "empty", label: "空书架", input: {props: {...page, items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "loading", label: "加载中", input: {props: {...page, status: "loading", items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "error", label: "取数失败", input: {props: {...page, status: "error", error: "书架没取到：服务端暂时不可用", items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "english", label: "英文界面", input: {props: {...page}, model: {view: "cards", sort: "recent", activeId: third.id}}},
                {id: "settings-open", label: "设置窗口开着：齿轮按下", input: {props: {...page, settingsOpen: true}, model: {view: "cards", sort: "recent", activeId: first.id}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof BookshelfPage>((await import("nbook/plugins/projects/web/components/BookshelfPage.vue")).default, {events: ["continue", "open", "open-new-window", "edit", "remove", "create", "add-existing", "retry", "open-settings"], class: "h-full w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof ShelfDesk>({
            component: "ShelfDesk",
            scenes: [
                {id: "writing", label: "今天写了字", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "no-today", label: "今天没写", input: {props: {items: [second, third], now: SHELF_NOW}}},
                {id: "revising", label: "今天净删", input: {props: {items: [SHELF_ITEM_REVISING], now: SHELF_NOW}}},
                {id: "no-record", label: "没有写作记录", input: {props: {items: [SHELF_ITEMS[3]!], now: SHELF_NOW}}},
                {id: "empty", label: "空书架的问候", input: {props: {items: [], now: SHELF_NOW}}},
                {id: "english", label: "英文界面", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfDesk>((await import("nbook/plugins/projects/web/components/ShelfDesk.vue")).default, {events: ["continue"], class: "w-full"})),
        }),
        defineLabFixture<typeof ShelfCards>({
            component: "ShelfCards",
            scenes: [
                {id: "grid", label: "几部作品", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: first.id}}},
                {id: "many", label: "很多部", input: {props: {items: [...SHELF_ITEMS, ...SHELF_ITEMS].map((item, index) => ({...item, id: `${item.id}-${String(index)}`})), now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: null}}},
                {id: "empty", label: "空书架的两张卡", input: {props: {items: [], now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: null}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfCards>((await import("nbook/plugins/projects/web/components/ShelfCards.vue")).default, {events: ["open", "open-new-window", "edit", "remove", "create", "add-existing"], class: "w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof BookCard>({
            component: "BookCard",
            scenes: [
                {id: "cover", label: "有封面、正在打开", input: {props: {item: first, now: SHELF_NOW, coverSrc: SHELF_COVER_SRC, active: true}}},
                {id: "typeset", label: "排版封面", input: {props: {item: second, now: SHELF_NOW, coverSrc: null, active: false}}},
                {id: "none", label: "尚未统计、没有简介", input: {props: {item: SHELF_ITEMS[3]!, now: SHELF_NOW, coverSrc: null, active: false}}},
                {id: "long", label: "长书名", input: {props: {item: long, now: SHELF_NOW, coverSrc: null, active: false}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof BookCard>((await import("nbook/plugins/projects/web/components/BookCard.vue")).default, {events: ["pick", "open", "open-new-window", "edit", "remove"], class: "w-full max-w-[360px]"})),
        }),
        defineLabFixture<typeof WelcomePage>({
            component: "WelcomePage",
            scenes: (() => {
                const quick = [
                    {address: "project://大纲.md", name: "大纲.md", kind: "file" as const},
                    {address: "project://设定", name: "设定", kind: "folder" as const},
                ];
                const recent = ["project://正文/第一卷/第一章 灯塔.md", "project://设定/人物.md", "project://大纲.md"];
                const page = {title: first.title ?? first.name, description: first.description, stats: first.stats, now: SHELF_NOW, quick, recent, shortcut: "Ctrl+Shift+P"};
                return [
                    {id: "book", label: "写过一阵的作品", input: {props: page}},
                    {id: "new", label: "新作品：没有简介、尚未统计、没有最近打开", input: {props: {...page, title: "新的一本", description: null, stats: SHELF_ITEMS[3]!.stats, quick: [], recent: []}}},
                    {id: "problem", label: "新建章节失败", input: {props: {...page, problem: "新建章节失败：permission-denied"}}},
                    {id: "unbound", label: "没有打开作品", input: {props: {...page, title: null}}},
                    {id: "english", label: "英文界面", input: {props: {...page}}},
                ];
            })(),
            load: async () => withProjectsText(createSubjectFixture<typeof WelcomePage>((await import("nbook/plugins/projects/web/components/WelcomePage.vue")).default, {events: ["new-chapter", "open", "reveal", "shelf"], class: "w-full"})),
        }),
        defineSubjectFixture<typeof BookCover>({
            component: "BookCover",
            class: "",
            scenes: [
                {id: "image", label: "有图", input: {props: {id: "a", title: "长夜行", color: null, src: SHELF_COVER_SRC, width: 150}}},
                {id: "typeset", label: "排版封面（生成的色档）", input: {props: {id: "8f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", title: "长夜行", color: null, width: 150, caption: "长篇"}}},
                {id: "light", label: "作者给的浅色", input: {props: {id: "b", title: "短篇集：在所有的夜里", color: "#d9c9a3", width: 150}}},
                {id: "small", label: "列表里的小封面", input: {props: {id: "c", title: "北方以北", color: "#7a4b3a", width: 30}}},
                {id: "english", label: "英文长名", input: {props: {id: "d", title: "The Long Dark and the Lighthouse Keeper", color: null, width: 84}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/BookCover.vue"),
        }),
        defineLabFixture<typeof ShelfList>({
            component: "ShelfList",
            scenes: [
                {id: "books", label: "几部作品", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "english", label: "英文界面", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfList>((await import("nbook/plugins/projects/web/components/ShelfList.vue")).default, {events: ["open", "open-new-window", "edit", "remove", "create"], class: "w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof FirstRunWizard>({
            component: "FirstRunWizard",
            scenes: firstRunScenes(),
            load: async () => withDesktopText(createSubjectFixture<typeof FirstRunWizard>((await import("nbook/plugins/desktop/web/components/FirstRunWizard.vue")).default, {events: ["change", "open-place", "next", "back", "skip", "finish"], class: ""})),
        }),
        defineLabFixture<typeof ProjectInfoDialog>({
            component: "ProjectInfoDialog",
            scenes: [
                {id: "create", label: "新建作品", input: {props: {open: true, mode: "create"}, model: {location: "/home/writer/Documents/NeuroBook"}}},
                {id: "create-filled", label: "新建作品（填了书名、自定义色）", input: {props: {open: true, mode: "create", initial: {title: "雪线以北", description: "一个守灯人等一封永远不会来的信。", color: "#d4a017", coverSrc: null}}, model: {location: "/home/writer/Documents/NeuroBook"}}},
                {id: "edit", label: "编辑信息（有封面）", input: {props: {open: true, mode: "edit", initial: {id: first.id, title: first.title ?? first.name, description: first.description ?? "", color: "#2f63a8", coverSrc: SHELF_COVER_SRC}}, model: {location: ""}}},
                {id: "rejected", label: "服务端拒绝了位置", input: {props: {open: true, mode: "create", initial: {title: "长夜行", description: "", color: "#2f63a8", coverSrc: null}, fieldErrors: {location: "作品目录不可用：目录不可读写（/mnt/usb/books）"}}, model: {location: "/mnt/usb/books"}}},
                {id: "busy", label: "提交中", input: {props: {open: true, mode: "edit", initial: {title: "北方以北", description: "", color: null, coverSrc: null}, busy: true}, model: {location: ""}}},
                {id: "english", label: "英文界面", input: {props: {open: true, mode: "create"}, model: {location: "/Users/writer/Documents/NeuroBook"}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ProjectInfoDialog>((await import("nbook/plugins/projects/web/components/ProjectInfoDialog.vue")).default, {events: ["submit", "cancel", "browse-location"], class: ""})),
        }),
        defineSubjectFixture<typeof FileBrowser>({
            component: "FileBrowser",
            events: ["navigate", "up", "activate"],
            class: "w-full max-w-[560px]",
            scenes: [
                {id: "default", label: "作品目录", input: {props: {
                    segments: [{label: "/", path: "/"}, {label: "home", path: "/home"}, {label: "writer", path: "/home/writer"}, {label: "Documents", path: "/home/writer/Documents"}, {label: "NeuroBook", path: "/home/writer/Documents/NeuroBook"}],
                    entries: [
                        {id: "/home/writer/Documents/NeuroBook/changyexing", name: "changyexing", kind: "directory", badge: "已在书架上", disabled: true, swatch: "#2f5fa0"},
                        {id: "/home/writer/Documents/NeuroBook/beifang", name: "beifang", kind: "directory", badge: "作品 · 北方以北", badgeTone: "accent", swatch: "#8f3f2e"},
                        {id: "/home/writer/Documents/NeuroBook/drafts", name: "drafts", kind: "directory"},
                        {id: "/home/writer/Documents/NeuroBook/old-notes", name: "old-notes", kind: "directory"},
                        {id: "/home/writer/Documents/NeuroBook/notes.md", name: "notes.md", kind: "file"},
                    ],
                    label: "作品目录",
                }, model: {selectedId: "/home/writer/Documents/NeuroBook/beifang"}}},
                {id: "empty", label: "空目录", input: {props: {segments: [{label: "/", path: "/"}, {label: "tmp", path: "/tmp"}], entries: [], emptyText: "这里没有子目录"}, model: {selectedId: null}}},
                {id: "loading", label: "加载中", input: {props: {segments: [{label: "/", path: "/"}], entries: [], loading: true}, model: {selectedId: null}}},
                {id: "error", label: "读不出", input: {props: {segments: [{label: "/", path: "/"}, {label: "root", path: "/root"}], entries: [], error: "目录不可读：/root"}, model: {selectedId: null}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/FileBrowser.vue"),
        }),
        defineLabFixture<typeof PathPickerDialog>({
            component: "PathPickerDialog",
            scenes: [
                {id: "project", label: "打开已有作品", input: {props: {open: true, mode: "project"}}},
                {id: "directory", label: "选择作品目录", input: {props: {open: true, mode: "directory", initialPath: "/home/writer/Documents"}}},
                {id: "rejected", label: "登记失败", input: {props: {open: true, mode: "project", error: "没有加入书架：目录里的项目身份文件无法读取"}}},
                {id: "english", label: "英文界面", input: {props: {open: true, mode: "project"}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof PathPickerDialog>((await import("nbook/plugins/projects/web/components/PathPickerDialog.vue")).default, {events: ["pick", "cancel"], class: "", runtimeProps: {source: (await import("./path-picker-source")).labPathPickerSource}})),
        }),
        defineLabFixture<typeof WorksSettingsPage>({
            component: "WorksSettingsPage",
            scenes: [
                {id: "unset", label: "还没设（显示缺省目录）", input: {props: {layer: "user"}}},
                {id: "default-unknown", label: "还没设、取不到缺省目录", input: {props: {layer: "user"}}},
                {id: "set", label: "设了（已修改）", input: {props: {layer: "user"}}},
                {id: "long", label: "很长的路径", input: {props: {layer: "user"}}},
                {id: "write-failed", label: "写不进去", input: {props: {layer: "user"}}},
                {id: "invalid", label: "设置文件有错误（停用）", input: {props: {layer: "user"}}},
                {id: "english", label: "英文界面", input: {props: {layer: "user"}}},
            ],
            load: async () => withProjectsText((await import("./WorksSettingsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof StatusLinePage>({
            component: "StatusLinePage",
            scenes: [
                {id: "default", label: "缺省：左边上下文，右边用量与费用，模型默认关", input: {props: {setting: {}}}},
                {id: "customized", label: "改过：用量排到费用后面，开了模型与插件的字数", input: {props: {setting: {order: ["cost", "usage"], visible: {model: true, "x.words": true}}, pluginItems: [{id: "x.words", side: "left", title: "本会话改的字数", description: "来自插件“字数统计”", defaultVisible: false, source: "x"}]}}},
                {id: "readonly", label: "配置写不了：勾选与按钮都停用", input: {props: {setting: {}, writable: false}}},
                {id: "crossed", label: "换过边：用量在左边第一位，上下文在右边最后", input: {props: {setting: {order: ["usage", "cost", "model", "context"], side: {usage: "left", context: "right"}}}}},
                {id: "write-fails", label: "写入失败：拖动放下后回到原样", input: {props: {setting: {}}}},
            ],
            load: async () => withAgentPageText((await import("./agent-scene/StatusLineFixture.vue")).default),
        }),
        defineLabFixture<typeof PermissionRulesPage>({
            component: "PermissionRulesPage",
            scenes: [
                {id: "rules", label: "我的规则：命令、路径、关键词、放行、自定义条件", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}]}}},
                {id: "empty", label: "还没有规则", input: {props: {rules: []}}},
                {id: "project", label: "绑定作品：这本书的规则只读，放行标不生效", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], projectTitle: "雨夜", projectRules: [{tool: "write", when: {type: "path", glob: "project://设定/**", access: "write"}, action: "ask" as const, reason: "设定要作者点头"}, {tool: "shell", action: "allow" as const}]}}},
                {id: "project-invalid", label: "作品的规则文件坏了", input: {props: {rules: [], projectTitle: "雨夜", projectRules: "invalid"}}},
                {id: "add", label: "添加规则：对话框", input: {props: {rules: [], initialEdit: "new"}}},
                {id: "edit", label: "编辑规则：命令", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], initialEdit: 0}}},
                {id: "edit-json", label: "编辑规则：自定义条件是 JSON", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], initialEdit: 4}}},
                {id: "readonly", label: "配置写不了", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], writable: false}}},
            ],
            load: async () => withAgentPageText((await import("./agent-scene/PermissionRulesFixture.vue")).default),
        }),
        defineLabFixture<typeof ProfileSettingsPage>({
            component: "ProfileSettingsPage",
            scenes: [
                {id: "builtin", label: "内置 Profile", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "nbook.agent.main"}}},
                {id: "user", label: "用户级：打开、删除，模型不满足要求", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "user.lore-check"}}},
                {id: "broken", label: "用户级：打包失败", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "user.draft-review"}}},
                {id: "unavailable", label: "插件 Profile：缺必需工具", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "plot.qa"}}},
                {id: "background", label: "后台 Profile：只有模型", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "nbook.agent.session-title"}}},
                {id: "narrow", label: "480px 宽：左栏收成下拉", input: {props: {state: "ready", profiles: SAMPLE_PROFILES}}},
                {id: "readonly", label: "这一层不能写", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, writable: false, initial: "user.lore-check"}}},
                {id: "loading", label: "读取中", input: {props: {state: "loading", profiles: []}}},
                {id: "failed", label: "读失败", input: {props: {state: {failed: "unavailable"}, profiles: []}}},
                {id: "narrow-broken", label: "480px 宽，有问题块", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "user.draft-review"}}},
                {id: "english", label: "英文界面：有必需工具", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "nbook.agent.main"}}},
            ],
            load: async () => withAgentPageText((await import("./agent-scene/ProfileSettingsFixture.vue")).default),
        }),
        defineLabFixture<typeof SubagentCard>({
            component: "SubagentCard",
            scenes: ([["running", "运行中：最近一步、次数与用时"], ["question", "在问父 Agent"], ["waiting", "等你批准"], ["done", "完成：点开看结果全文"], ["failed", "出错"], ["dispatch-failed", "没派出去"], ["background", "后台、名字很长"], ["unknown", "进程崩溃后：状态未知"], ["running-narrow", "390px 宽"], ["background-narrow", "390px 宽、名字很长"]] as const).map(([id, label]) => ({id, label, input: {props: sampleProps(CARD_SAMPLES[id.replace(/-narrow$/u, "")]!)}})),
            load: async () => withAgentPageText((await import("./agent-scene/SubagentCardFixture.vue")).default),
        }),
        defineLabFixture<typeof SubagentsEntry>({
            component: "SubagentsEntry",
            scenes: [
                {id: "list", label: "浮层开着：等你批准、在跑（带孙代理）、完成、出错", input: {props: {profiles: ENTRY_PROFILES}, model: {open: true}}},
                {id: "dot", label: "关着：有没看过的出错，入口亮红点", input: {props: {profiles: ENTRY_PROFILES}, model: {open: false}}},
                {id: "empty", label: "没有后代：入口不画", input: {props: {profiles: ENTRY_PROFILES}, model: {open: false}}},
            ],
            load: async () => withAgentPageText((await import("./agent-scene/SubagentsEntryFixture.vue")).default),
        }),
        defineLabFixture<typeof ContactCover>({
            component: "ContactCover",
            scenes: [
                {id: "no-model", label: "没有模型：去添加", input: {props: {cover: {kind: "pending", pending: {key: "nbook.bots/lyra", name: "星璃", step: "no-model"}}}}},
                {id: "opening", label: "正在打开", input: {props: {cover: {kind: "pending", pending: {key: "nbook.bots/lyra", name: "星璃", step: "opening"}}}}},
                {id: "failed", label: "打不开：原因与重试", input: {props: {cover: {kind: "pending", pending: {key: "nbook.bots/lyra", name: "星璃", step: "failed", code: "session-busy"}}}}},
                {id: "pick-bot", label: "还没选 bot", input: {props: {cover: {kind: "pick-bot"}}}},
                {id: "missing", label: "找不到 bot", input: {props: {cover: {kind: "missing"}}}},
            ],
            load: async () => withAgentPageText((await import("./agent-scene/ContactCoverFixture.vue")).default),
        }),
        defineLabFixture<typeof DeskCompanion>({
            component: "DeskCompanion",
            // 联系人、宿主与面板里的对话是运行时对象，不进场景输入：夹具按场景 id 自己造（见 DeskCompanionFixture.vue），这里只占位。
            scenes: [
                {id: "unread", label: "有未读：右上角计数，气泡写最后一句", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
                {id: "waiting", label: "等你处理：黄色感叹号，猫换提问的表情", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
                {id: "none", label: "没有联系人：不能点的猫", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
                {id: "failed", label: "读不到：悬停提示原因", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
                {id: "unread-english", label: "英文界面：长句截断", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
            ],
            load: async () => withAgentPageText((await import("./agent-scene/DeskCompanionFixture.vue")).default),
        }),
        defineLabFixture<typeof BackgroundCommandCard>({
            component: "BackgroundCommandCard",
            scenes: ([["command-running", "运行中：最后一行、停止"], ["command-done", "完成：退出码与行数"], ["command-failed", "失败"], ["command-restarted", "任务已移出：从 status.json 读"], ["command-running-narrow", "390px 宽"]] as const).map(([id, label]) => ({id, label, input: {props: sampleProps(COMMAND_SAMPLES[id.replace(/^command-/u, "").replace(/-narrow$/u, "")]!)}})),
            load: async () => withAgentPageText((await import("./agent-scene/SubagentCardFixture.vue")).default),
        }),
        defineLabFixture<typeof StickerPacksPage>({
            component: "StickerPacksPage",
            scenes: (() => {
                const packs = SAMPLES.map(summaryOf);
                const page = (selected: string, extra: {initialSticker?: string | null; uploads?: Array<{id: number; packId: string; name: string; state: "running" | "waiting"}>} = {}) => ({
                    state: "ready" as const, packs, selected, detail: detailOf(sampleById(selected)!), uploads: extra.uploads ?? [], initialSticker: extra.initialSticker ?? null,
                });
                const lyraKey = (name: string): string => stickerKey(`${name}.png`, name);
                return [
                    {id: "pack", label: "没选表情：表情包自己的属性", input: {props: page("user.lyra")}},
                    {id: "sticker", label: "选中一个表情：属性栏", input: {props: page("user.lyra", {initialSticker: lyraKey("开心")})}},
                    {id: "problem", label: "没有清单的包：认不出的图要先改名", input: {props: page("user.cat", {initialSticker: extraKey("1.png")})}},
                    {id: "unlisted", label: "有清单的包：文件夹里没加进来的图", input: {props: page("user.lyra", {initialSticker: extraKey("摸摸头.png")})}},
                    {id: "plugin", label: "插件的包：只读、复制到我的", input: {props: page("acme.cute.mochi", {initialSticker: stickerKey("好耶.png", "好耶")})}},
                    {id: "builtin-shadowed", label: "内置的包：只读，被我的同名包盖住", input: {props: page("builtin.lyra")}},
                    {id: "builtin-shadowed-narrow-english", label: "内置的包被盖住：480px 宽、英文界面", input: {props: page("builtin.lyra")}},
                    {id: "empty-pack", label: "还没有表情的包：整个网格是落点", input: {props: page("user.empty")}},
                    {id: "uploading", label: "上传中：占位格", input: {props: page("user.lyra", {uploads: [{id: 1, packId: "user.lyra", name: "新图.png", state: "running"}, {id: 2, packId: "user.lyra", name: "另一张.jpg", state: "waiting"}]})}},
                    {id: "many", label: "很多表情：网格折行", input: {props: page("user.many")}},
                    {id: "invalid", label: "无效的表情包：写原因", input: {props: {...page("user.broken"), detail: null}}},
                    {id: "no-packs", label: "还没有任何表情包", input: {props: {state: "ready" as const, packs: [], selected: null, detail: null}}},
                    {id: "loading", label: "读取中", input: {props: {state: "loading" as const, packs: [], selected: null, detail: null}}},
                    {id: "failed", label: "读失败", input: {props: {state: {failed: "unavailable"}, packs: [], selected: null, detail: null}}},
                    {id: "narrow", label: "480px 宽：左栏收成下拉，属性栏排到下面", input: {props: page("user.lyra", {initialSticker: lyraKey("开心")})}},
                    {id: "english", label: "英文界面", input: {props: page("user.lyra", {initialSticker: lyraKey("开心")})}},
                ];
            })(),
            load: async () => withStickersPageText((await import("./stickers-scene/StickerPacksFixture.vue")).default),
        }),
        defineLabFixture<typeof StickerPackRail>({
            component: "StickerPackRail",
            scenes: [
                {id: "rail", label: "我的、插件、内置各一组，有认不出的、无效的与被盖住的", input: {props: {groups: railGroups(SAMPLES.map(summaryOf)), current: "user.lyra"}}},
                {id: "disabled", label: "新建与导入停用", input: {props: {groups: railGroups(SAMPLES.map(summaryOf)), current: "user.cat", disabled: true}}},
                {id: "english", label: "英文界面", input: {props: {groups: railGroups(SAMPLES.map(summaryOf)), current: "user.lyra"}}},
            ],
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerPackRail>((await import("nbook/plugins/stickers/web/components/StickerPackRail.vue")).default)),
        }),
        defineLabFixture<typeof StickerGrid>({
            component: "StickerGrid",
            scenes: [
                {id: "grid", label: "认不出、常用、其他、没加进来；宽图、竖图、方图", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null}}},
                {id: "uploading", label: "上传中的占位格", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null, uploads: [{id: 1, packId: "user.lyra", name: "新图.png", state: "running"}]}}},
                {id: "readonly", label: "只读：没有“添加”格", input: {props: {detail: detailOf(sampleById("acme.cute.mochi")!), selected: null, readonly: true}}},
                {id: "empty", label: "还没有图：整个网格是落点", input: {props: {detail: detailOf(sampleById("user.empty")!), selected: null}}},
                {id: "dragging", label: "拖进 3 张图", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null, dragging: true, dragCount: 3}}},
                {id: "english", label: "英文界面", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null}}},
            ],
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerGrid>((await import("nbook/plugins/stickers/web/components/StickerGrid.vue")).default)),
        }),
        defineLabFixture<typeof StickerFields>({
            component: "StickerFields",
            scenes: (() => {
                const lyra = detailOf(sampleById("user.lyra")!);
                const sticker = (name: string): GridItem => {
                    const found = lyra.stickers.find((one) => one.name === name)!;
                    return {key: found.file, kind: "sticker", file: found.file, label: found.name, url: found.url, width: found.width, height: found.height, bytes: found.bytes, name: found.name, raw: found.raw ?? null, reason: null, common: found.common, ...(found.description === undefined ? {} : {description: found.description})};
                };
                const extra = (file: string, reason: "name" | "unlisted", file2 = file): GridItem => {
                    const found = lyra.extras.find((one) => one.file === file)!;
                    return {key: file2, kind: "extra", file: file2, label: file2, url: found.url, width: found.width, height: found.height, bytes: found.bytes, name: null, raw: null, reason, common: false};
                };
                return [
                    {id: "sticker", label: "表情：名字、说明、写法、常用", input: {props: {item: sticker("开心"), writing: "lyra"}}},
                    {id: "problem", label: "认不出的图：先要改名", input: {props: {item: extra("摸摸头.png", "name", "1.png"), writing: "lyra"}}},
                    {id: "unlisted", label: "没加进来的图", input: {props: {item: extra("摸摸头.png", "unlisted"), writing: "lyra"}}},
                    {id: "readonly", label: "插件的包：只读", input: {props: {item: sticker("开心"), writing: "mochi", readonly: true}}},
                    {id: "english", label: "英文界面", input: {props: {item: sticker("开心"), writing: "lyra"}}},
                ];
            })(),
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerFields>((await import("nbook/plugins/stickers/web/components/StickerFields.vue")).default, {runtimeProps: {commit: async () => null}})),
        }),
        defineLabFixture<typeof StickerSlot>({
            component: "StickerSlot",
            scenes: [
                {id: "square", label: "方图：64 × 64 的框", input: {props: {url: detailOf(sampleById("user.lyra")!).stickers[0]!.url}}},
                {id: "faded", label: "调淡：认不出的、没加进来的", input: {props: {url: detailOf(sampleById("user.lyra")!).stickers[0]!.url, faded: true}}},
            ],
            load: async () => createSubjectFixture<typeof StickerSlot>((await import("nbook/plugins/stickers/web/components/StickerSlot.vue")).default, {class: "h-24 w-24 p-2"}),
        }),
        defineLabFixture<typeof StickerPickerPanel>({
            component: "StickerPickerPanel",
            noInput: "面板要一个选择器服务，台子按场景名用样本表情包造一个真的（stickers-scene/StickerPickerFixture.vue）",
            scenes: [
                {id: "packs", label: "几个表情包：组头、标签、底部的写法"},
                {id: "recent", label: "有最近用过"},
                {id: "empty", label: "一个表情包也没有"},
                {id: "narrow", label: "300px 宽"},
                {id: "english", label: "英文界面"},
            ],
            load: async () => withStickersPageText((await import("./stickers-scene/StickerPickerFixture.vue")).default),
        }),
        defineLabFixture<typeof PackFields>({
            component: "PackFields",
            scenes: [
                {id: "user", label: "用户的包：显示名、说明、包名、按贴纸显示", input: {props: {detail: detailOf(sampleById("user.lyra")!)}, model: {stickerDisplay: false}}},
                {id: "plugin", label: "插件的包：只读，按贴纸显示照样能设", input: {props: {detail: detailOf(sampleById("acme.cute.mochi")!), readonly: true}, model: {stickerDisplay: true}}},
                {id: "english", label: "英文界面", input: {props: {detail: detailOf(sampleById("user.lyra")!)}, model: {stickerDisplay: false}}},
            ],
            // 按贴纸显示的开关（stickers.md 输出 47）是受控的：点了写回模型，场景里看得到开关跟着变。
            load: async () => withStickersPageText(createSubjectFixture<typeof PackFields>((await import("nbook/plugins/stickers/web/components/PackFields.vue")).default, {runtimeProps: {commit: async () => null}, writeBack: {"update:stickerDisplay": {layer: "model", key: "stickerDisplay"}}})),
        }),
        defineLabFixture<typeof StickerPackNameDialog>({
            component: "StickerPackNameDialog",
            scenes: [
                {id: "create", label: "新建", input: {props: {mode: "create"}, model: {open: true}}},
                {id: "rename", label: "改包名：警示与用到它的 Profile", input: {props: {mode: "rename", current: "lyra", usage: ["剧情问答", "设定核对"]}, model: {open: true}}},
                {id: "rename-loading", label: "改包名：还在查 Profile", input: {props: {mode: "rename", current: "lyra"}, model: {open: true}}},
                {id: "failed", label: "提交失败：已被用", input: {props: {mode: "create", status: "已经有同名的表情包。"}, model: {open: true}}},
                {id: "english", label: "英文界面", input: {props: {mode: "rename", current: "lyra", usage: null}, model: {open: true}}},
            ],
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerPackNameDialog>((await import("nbook/plugins/stickers/web/components/StickerPackNameDialog.vue")).default)),
        }),
        defineLabFixture<typeof ImportConflictDialog>({
            component: "ImportConflictDialog",
            scenes: (() => {
                const thumb = (id: string, count: number) => detailOf(sampleById(id)!).stickers.slice(0, count).map((sticker) => ({url: sticker.url, label: sticker.file}));
                const base = {name: "cat", existing: {title: "cat", count: 4, items: thumb("user.cat", 4)}, incoming: {title: "猫猫", count: 12, items: thumb("user.lyra", 4)}, copyAs: "cat-2"};
                return [
                    {id: "conflict", label: "同名：另存或替换", input: {props: base, model: {open: true}}},
                    {id: "busy", label: "处理中", input: {props: {...base, busy: true}, model: {open: true}}},
                    {id: "failed", label: "选择失败：原因写在下面", input: {props: {...base, status: "已有的表情包刚被别处改过，重新选择。"}, model: {open: true}}},
                    {id: "no-copy", label: "没有空的包名：另存不可用", input: {props: {...base, copyAs: null}, model: {open: true}}},
                    {id: "unknown", label: "读不出要导入的包", input: {props: {...base, incoming: {title: "cat", count: null, items: []}}, model: {open: true}}},
                    {id: "english", label: "英文界面", input: {props: base, model: {open: true}}},
                ];
            })(),
            load: async () => withStickersPageText(createSubjectFixture<typeof ImportConflictDialog>((await import("nbook/plugins/stickers/web/components/ImportConflictDialog.vue")).default)),
        }),
        defineLabFixture<typeof ProfileRail>({
            component: "ProfileRail",
            scenes: [
                {id: "rail", label: "可选的、有问题的、后台的", input: {props: {items: SAMPLE_PROFILES, current: "nbook.agent.main"}}},
                {id: "readonly", label: "不能写：“新建”停用", input: {props: {items: SAMPLE_PROFILES, current: "plot.qa", disabled: true}}},
            ],
            load: async () => withAgentPageText(createSubjectFixture<typeof ProfileRail>((await import("nbook/plugins/agent/web/components/ProfileRail.vue")).default)),
        }),
        defineLabFixture<typeof ProfileDetail>({
            component: "ProfileDetail",
            scenes: [
                {id: "builtin", label: "内置 Profile", input: {props: {profile: SAMPLE_PROFILES[0]!}}},
                {id: "user", label: "用户级：打开、删除，模型不满足要求", input: {props: {profile: SAMPLE_PROFILES[1]!}}},
                {id: "broken", label: "打包失败", input: {props: {profile: SAMPLE_PROFILES[2]!}}},
                {id: "unavailable", label: "缺必需工具", input: {props: {profile: SAMPLE_PROFILES[3]!}}},
            ],
            load: async () => withAgentPageText(createSubjectFixture<typeof ProfileDetail>((await import("nbook/plugins/agent/web/components/ProfileDetail.vue")).default)),
        }),
        defineLabFixture<typeof ProfileToolsSection>({
            component: "ProfileToolsSection",
            scenes: [
                {id: "tools", label: "按提供者分组，有已卸载的，能恢复默认", input: {props: {tools: SAMPLE_WRITER_TOOLS}}},
                {id: "readonly", label: "不能写", input: {props: {tools: SAMPLE_WRITER_TOOLS, disabled: true}}},
                {id: "adding", label: "添加工具对话框", input: {props: {tools: SAMPLE_WRITER_TOOLS, initialAdd: true}}},
            ],
            load: async () => withAgentPageText(createSubjectFixture<typeof ProfileToolsSection>((await import("nbook/plugins/agent/web/components/ProfileToolsSection.vue")).default)),
        }),
        defineLabFixture<typeof AddToolsDialog>({
            component: "AddToolsDialog",
            scenes: [
                {id: "candidates", label: "按提供者分组，同名的写明会换掉", input: {props: {candidates: SAMPLE_TOOL_CANDIDATES}, model: {open: true}}},
                {id: "empty", label: "没有可以添加的", input: {props: {candidates: []}, model: {open: true}}},
                {id: "failed", label: "写入失败留在对话框", input: {props: {candidates: SAMPLE_TOOL_CANDIDATES, status: "设置文件无法写入"}, model: {open: true}}},
            ],
            load: async () => withAgentPageText(createSubjectFixture<typeof AddToolsDialog>((await import("nbook/plugins/agent/web/components/AddToolsDialog.vue")).default)),
        }),
        defineLabFixture<typeof NewProfileDialog>({
            component: "NewProfileDialog",
            scenes: [
                {id: "new", label: "新建：只问名字", input: {props: {}, model: {open: true}}},
                {id: "exists", label: "已有同名", input: {props: {status: "已经有同名的 Profile 了。"}, model: {open: true}}},
            ],
            load: async () => withAgentPageText(createSubjectFixture<typeof NewProfileDialog>((await import("nbook/plugins/agent/web/components/NewProfileDialog.vue")).default)),
        }),
        defineLabFixture<typeof SkillsSettingsPage>({
            component: "SkillsSettingsPage",
            scenes: [
                {id: "full", label: "我的、插件与内置：可用、未初始化、上次没装好、正在初始化、无效、插件没打包", input: {props: {entries: SKILL_PAGE_ENTRIES}}},
                {id: "empty", label: "还没有 Skill", input: {props: {entries: []}}},
                {id: "loading", label: "读取中", input: {props: {entries: null}}},
                {id: "full-english", label: "英文界面", input: {props: {entries: SKILL_PAGE_ENTRIES}}},
            ],
            load: async () => withAgentPageText(createSubjectFixture<typeof SkillsSettingsPage>((await import("nbook/plugins/agent/web/components/SkillsSettingsPage.vue")).default, {class: "w-full max-w-[720px] p-6"})),
        }),
        defineLabFixture<typeof SkillInitDialog>({
            component: "SkillInitDialog",
            scenes: [
                {id: "confirm", label: "确认：有锁，列直接依赖", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
                {id: "no-lock", label: "确认：没有 bun.lock（说明行写会生成锁文件）", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: false, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
                {id: "installing", label: "正在安装（能关掉，在后台继续）", input: {props: {name: "epub-export", phase: "installing", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
                {id: "confirm-english", label: "英文界面：确认", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
                {id: "no-lock-english", label: "英文界面：没有 bun.lock", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: false, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
                {id: "installing-english", label: "英文界面：正在安装", input: {props: {name: "epub-export", phase: "installing", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
                {id: "failed", label: "失败：中间换成安装输出", input: {props: {name: "epub-export", phase: "failed", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: {code: "install-failed", output: "bun install v1.4.4\nResolving dependencies\nResolved, downloaded and extracted [12]\nerror: GET https://registry.npmjs.org/epub-gen-memory - ETIMEDOUT\nerror: epub-gen-memory@^1.1.2 failed to resolve"}}, model: {open: true}}},
            ],
            load: async () => withAgentPageText(createSubjectFixture<typeof SkillInitDialog>((await import("nbook/plugins/agent/web/components/SkillInitDialog.vue")).default)),
        }),
        defineLabFixture<typeof ProvidersPage>({
            component: "ProvidersPage",
            scenes: [
                {id: "providers", label: "四家服务商：目录、改过地址、自定义、本机", input: {props: {writable: true}}},
                {id: "providers-empty", label: "还没有服务商（引导）", input: {props: {writable: true}}},
                {id: "providers-narrow", label: "560px 宽：左栏收成下拉", input: {props: {writable: true}}},
                {id: "providers-write-failed", label: "写不进去（窗口通知记进事件）", input: {props: {writable: true}}},
                {id: "providers-readonly", label: "模型服务没有运行（只读）", input: {props: {writable: true}}},
                {id: "providers-english", label: "英文界面", input: {props: {writable: true}}},
                {id: "providers-focus-key", label: "从对话的“设置密钥”打开：选中 OpenAI、焦点在密钥框", input: {props: {writable: true}}},
                {id: "providers-focus-add", label: "从对话的“添加服务商”打开：添加窗口开着", input: {props: {writable: true}}},
            ],
            load: async () => withModelsText((await import("./ModelsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof RolesPage>({
            component: "RolesPage",
            scenes: [
                {id: "roles", label: "未绑定、没有密钥、自建角色", input: {props: {writable: true}}},
                {id: "roles-empty", label: "还没有模型，全部未绑定", input: {props: {writable: true}}},
                {id: "roles-readonly", label: "模型服务没有运行（只读）", input: {props: {writable: true}}},
                {id: "roles-english", label: "英文界面", input: {props: {writable: true}}},
                {id: "roles-focus", label: "从对话的“去绑定”打开：滚到“润色”、焦点在它的模型下拉", input: {props: {writable: true}}},
            ],
            load: async () => withModelsText((await import("./ModelsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof SearchSettingsPage>({
            component: "SearchSettingsPage",
            scenes: [
                {id: "unset", label: "还没有密钥（检测停用）", input: {props: {writable: true}}},
                {id: "set", label: "已设置", input: {props: {writable: true}}},
                {id: "loading", label: "读取中", input: {props: {writable: true}}},
                {id: "checking", label: "检测中", input: {props: {writable: true}}},
                {id: "passed", label: "检测通过", input: {props: {writable: true}}},
                {id: "failed", label: "检测没通过（密钥不对）", input: {props: {writable: true}}},
                {id: "not-run", label: "没检成（结果未知）", input: {props: {writable: true}}},
                {id: "readonly", label: "网页工具没有运行（只读）", input: {props: {writable: true}}},
                {id: "unreadable", label: "密钥文件读不了", input: {props: {writable: true}}},
                {id: "write-failed", label: "写不进去（窗口通知记进事件）", input: {props: {writable: true}}},
                {id: "use-tavily-no-key", label: "使用中的 Tavily 还没有密钥（左栏钥匙、密钥行写未填写）", input: {props: {writable: true}}},
                {id: "use-tavily", label: "用 Tavily、两家都有密钥", input: {props: {writable: true}}},
                {id: "rules", label: "搜索规则（屏蔽了两个网站）", input: {props: {writable: true}}},
                {id: "advanced", label: "Tavily 改过接口地址与深度：高级默认展开", input: {props: {writable: true}}},
                {id: "use-tavily-no-key-english", label: "英文界面：使用中的 Tavily 还没有密钥", input: {props: {writable: true}}},
                {id: "use-tavily-no-key-narrow", label: "390px 宽：左栏换成下拉", input: {props: {writable: true}}},
                {id: "rules-english", label: "英文界面：搜索规则", input: {props: {writable: true}}},
                {id: "failed-english", label: "英文界面：检测没通过", input: {props: {writable: true}}},
                {id: "failed-narrow", label: "390px 宽：检测没通过", input: {props: {writable: true}}},
            ],
            load: async () => withWebText((await import("./SearchSettingsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof NetworkPage>({
            component: "NetworkPage",
            scenes: [
                {id: "system", label: "跟随系统：写出环境变量里的代理与来源", input: {props: {writable: true}}},
                {id: "system-none", label: "跟随系统：系统没有设代理", input: {props: {writable: true}}},
                {id: "system-unsupported", label: "跟随系统：自动配置脚本，不支持", input: {props: {writable: true}}},
                {id: "system-unreadable", label: "跟随系统：读不到系统设置", input: {props: {writable: true}}},
                {id: "loading", label: "正在读取现在用的代理", input: {props: {writable: true}}},
                {id: "custom-tested", label: "自定义并测过：连接成功，出口 IP 与耗时", input: {props: {writable: true}}},
                {id: "custom-empty", label: "自定义还没填地址", input: {props: {writable: true}}},
                {id: "testing", label: "测试进行中（按钮换成“取消测试”）", input: {props: {writable: true}}},
                {id: "test-failed", label: "测试失败：无法连接", input: {props: {writable: true}}},
                {id: "test-bypassed", label: "测试目标在旁路清单里：不说“连接成功”", input: {props: {writable: true}}},
                {id: "direct", label: "直连：没有测试一行", input: {props: {writable: true}}},
                {id: "catalog-never", label: "还没有取过在线目录", input: {props: {writable: true}}},
                {id: "catalog-failed", label: "上次更新失败（代理设置有问题）", input: {props: {writable: true}}},
                {id: "catalog-disabled", label: "这台机器关掉了在线目录", input: {props: {writable: true}}},
                {id: "catalog-unavailable", label: "模型服务没有运行：读不到目录状态", input: {props: {writable: true}}},
                {id: "readonly", label: "用户层不能写（控件停用）", input: {props: {writable: true}}},
                {id: "write-failed", label: "写不进去（窗口通知记进事件）", input: {props: {writable: true}}},
                {id: "custom-tested-english", label: "英文界面：自定义并测过", input: {props: {writable: true}}},
                {id: "system-unsupported-english", label: "英文界面：不支持的系统代理", input: {props: {writable: true}}},
                {id: "test-failed-narrow", label: "390px 宽：测试失败", input: {props: {writable: true}}},
                {id: "system-english-narrow", label: "390px 宽、英文：跟随系统", input: {props: {writable: true}}},
            ],
            load: async () => (await import("./NetworkPageFixture.vue")).default,
        }),
        defineLabFixture<typeof ApiKeyField>({
            component: "ApiKeyField",
            scenes: [
                {id: "unset", label: "还没有填写", input: {props: {state: "unset", service: "DeepSeek"}}},
                {id: "set", label: "已设置（有“清除”）", input: {props: {state: "set", service: "DeepSeek"}}},
                {id: "loading", label: "读取中（停用）", input: {props: {state: "loading", service: "DeepSeek"}}},
                {id: "disabled", label: "停用", input: {props: {state: "set", service: "DeepSeek", disabled: true}}},
                {id: "english", label: "英文界面", input: {props: {state: "set", service: "DeepSeek"}}},
            ],
            load: async () => withWebText(createSubjectFixture<typeof ApiKeyField>((await import("nbook/plugins/web-tools/web/components/ApiKeyField.vue")).default)),
        }),
        defineLabFixture<typeof CapabilityIcons>({
            component: "CapabilityIcons",
            scenes: [
                {id: "all", label: "看图与推理（悬停写推理档）", input: {props: {vision: true, reasoning: true, efforts: ["low", "medium", "high"]}}},
                {id: "vision", label: "只能看图", input: {props: {vision: true, reasoning: false}}},
                {id: "none", label: "都没有（什么都不画）", input: {props: {vision: false, reasoning: false}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof CapabilityIcons>((await import("nbook/plugins/models/web/components/CapabilityIcons.vue")).default)),
        }),
        defineLabFixture<typeof HeadersEditor>({
            component: "HeadersEditor",
            scenes: [
                {id: "filled", label: "两行请求头", input: {props: {headers: {"X-Team": "writing", "X-Region": "cn"}, hint: "中转站、网关常要"}}},
                {id: "credential", label: "名称像凭据、值不是 env:（提示）", input: {props: {headers: {"X-Api-Key": "abc"}}}},
                {id: "empty", label: "没有请求头", input: {props: {headers: {}}}},
                {id: "english", label: "英文界面", input: {props: {headers: {"X-Team": "writing"}}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof HeadersEditor>((await import("nbook/plugins/models/web/components/HeadersEditor.vue")).default, {events: ["commit"], writeBack: {commit: {layer: "props", key: "headers"}}, class: "w-full max-w-[520px]"})),
        }),
        defineLabFixture<typeof ModelRow>({
            component: "ModelRow",
            scenes: [
                {id: "enabled", label: "启用、带角色小标、检测通过", input: {props: {model: SAMPLE_ROWS.deepseek![0]!, roles: ["快速", "压缩"], check: {status: "done", at: 0, result: {ok: true}}}}},
                {id: "failed", label: "检测失败（点开看原因）", input: {props: {model: SAMPLE_ROWS.anthropic![0]!, check: {status: "done", at: 0, result: {ok: false, kind: "auth", code: "401", raw: "{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}"}}}}},
                {id: "running", label: "检测中", input: {props: {model: SAMPLE_ROWS.volcengine![0]!, check: {status: "running"}}}},
                {id: "unknown", label: "结果未知（检测被取消，请求可能已经发出）", input: {props: {model: SAMPLE_ROWS.volcengine![0]!, check: {status: "unknown", at: 0}}}},
                {id: "incomplete", label: "缺上下文窗口（开关停用）", input: {props: {model: SAMPLE_ROWS.volcengine![2]!}}},
                {id: "edited", label: "来源模型改过字段（标“已改”）", input: {props: {model: SAMPLE_ROWS.deepseek![1]!}}},
                {id: "missing", label: "目录里没有了", input: {props: {model: SAMPLE_ROWS.anthropic![1]!}}},
                {id: "free", label: "免费的本机模型", input: {props: {model: SAMPLE_ROWS.ollama![0]!}}},
                {id: "unlisted", label: "服务商列表里没有、配置过：照用、标“列表里没有”", input: {props: {model: sampleRow("deepseek-v4-flash", {name: "DeepSeek V4 Flash", unlisted: true}), roles: ["快速"]}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ModelRow>((await import("nbook/plugins/models/web/components/ModelRow.vue")).default, {events: ["toggle", "check", "edit"], class: "w-full list-none"})),
        }),
        defineLabFixture<typeof ProviderRail>({
            component: "ProviderRail",
            scenes: [
                {id: "providers", label: "当前是第一家；第二行写密钥问题或模型数", input: {props: {providers: SAMPLE_PROVIDERS, current: "deepseek"}}},
                {id: "all", label: "当前是“全部模型”", input: {props: {providers: SAMPLE_PROVIDERS, current: "all"}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ProviderRail>((await import("nbook/plugins/models/web/components/ProviderRail.vue")).default, {events: ["select", "add"], writeBack: {select: {layer: "props", key: "current"}}, class: "h-[420px]"})),
        }),
        defineLabFixture<typeof ProviderHeader>({
            component: "ProviderHeader",
            scenes: [
                {id: "default", label: "模板的图标、名称与“复制一份”", input: {props: {provider: SAMPLE_PROVIDERS[0]!, builtinKeys: ["anthropic", "deepseek", "moonshot", "openai", "openrouter"]}}},
                {id: "initial", label: "空白模板：首字母块", input: {props: {provider: SAMPLE_PROVIDERS[2]!, builtinKeys: ["anthropic", "deepseek", "moonshot"]}}},
                {id: "custom-icon", label: "选过内置图标（面板里有“恢复模板的图标”）", input: {props: {provider: {...SAMPLE_PROVIDERS[3]!, icon: {kind: "builtin", key: "openai"}}, builtinKeys: ["anthropic", "deepseek", "openai"]}}},
                {id: "icon-error", label: "换图标失败（面板里写原因）", input: {props: {provider: SAMPLE_PROVIDERS[0]!, builtinKeys: ["deepseek"], iconError: "服务端没有接受这张图：the image was rejected (too-large)"}}},
                {id: "long-name", label: "名称很长（省略号截断）", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, name: "这是一个名字特别特别长的服务商名称用来看标题区在窄屏下怎么处理"}, builtinKeys: []}}},
                {id: "english", label: "英文界面", input: {props: {provider: SAMPLE_PROVIDERS[4]!, builtinKeys: ["moonshot"]}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ProviderHeader>((await import("nbook/plugins/models/web/components/ProviderHeader.vue")).default, {events: ["rename", "set-icon", "duplicate"], class: "w-full max-w-[560px]"})),
        }),
        defineLabFixture<typeof ProviderIcon>({
            component: "ProviderIcon",
            scenes: [
                {id: "template", label: "跟随模板的图标", input: {props: {icon: null, template: "deepseek", name: "DeepSeek", size: 28}}},
                {id: "initial", label: "首字母块", input: {props: {icon: {kind: "initial"}, template: "deepseek", name: "火山方舟", size: 28}}},
                {id: "unknown", label: "图标表里没有的模板", input: {props: {icon: null, template: "blank-openai", name: "本地 Ollama", size: 28}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ProviderIcon>((await import("nbook/plugins/models/web/components/ProviderIcon.vue")).default, {class: "p-4"})),
        }),
        defineLabFixture<typeof ProviderLogo>({
            component: "ProviderLogo",
            scenes: [
                {id: "image", label: "多色图（DeepSeek）", input: {props: {id: "deepseek", name: "DeepSeek", size: 28}}},
                {id: "search", label: "搜索服务（Tavily）", input: {props: {id: "tavily", name: "Tavily", size: 28}}},
                {id: "initial", label: "图标表里没有：首字母块", input: {props: {id: "nowhere", name: "博查", size: 28}}},
            ],
            load: async () => createSubjectFixture<typeof ProviderLogo>((await import("nbook/ui/provider-icons/ProviderLogo.vue")).default, {class: "p-4"}),
        }),
        defineLabFixture<typeof ProviderDetail>({
            component: "ProviderDetail",
            scenes: [
                {id: "catalog", label: "模板服务商，密钥已设置，系列默认收起", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: SAMPLE_ROWS.deepseek!}}},
                {id: "overridden", label: "改过地址与协议（有“恢复模板地址”），环境变量没有值", input: {props: {provider: SAMPLE_PROVIDERS[1]!, rows: SAMPLE_ROWS.anthropic!}}},
                {id: "custom", label: "空白模板：接口格式、请求头、缺字段的模型", input: {props: {provider: SAMPLE_PROVIDERS[2]!, rows: SAMPLE_ROWS.volcengine!}}},
                {id: "keyless", label: "不要认证的本机端点（没有密钥框）", input: {props: {provider: SAMPLE_PROVIDERS[5]!, rows: SAMPLE_ROWS.ollama!}}},
                {id: "no-key", label: "还没有密钥（“未设置”）", input: {props: {provider: SAMPLE_PROVIDERS[3]!, rows: SAMPLE_ROWS.openai!}}},
                {id: "env-found", label: "有地区的模板：选了中国大陆，密钥取环境变量、已读到", input: {props: {provider: SAMPLE_PROVIDERS[4]!, rows: SAMPLE_ROWS.moonshot!, template: SAMPLE_TEMPLATES.find((item) => item.id === "moonshot")!}}},
                {id: "check-error", label: "没检成（原因写在模型列表头上）", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: SAMPLE_ROWS.deepseek!, checkError: "没检成：模型服务没有运行"}}},
                {id: "big", label: "几百个模型：有搜索框，系列默认收起、收起的不渲染", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, modelCount: 600, enabledCount: 600}, rows: generatedRows(600)}}},
                {id: "loading", label: "模型行读取中", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: [], rowsLoading: true}}},
                {id: "rows-failed", label: "读取模型失败（可重试）", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: [], rowsFailure: "服务没有回应"}}},
                {id: "english", label: "英文界面", input: {props: {provider: SAMPLE_PROVIDERS[2]!, rows: SAMPLE_ROWS.volcengine!}}},
                {id: "source-ok", label: "服务商的列表：更新于某时、可重新拉取", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: false, checkedAt: SOURCE_AT, error: null}}, rows: SAMPLE_ROWS.deepseek!}}},
                {id: "source-refreshing", label: "正在拉取（按钮停用）", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: true, checkedAt: SOURCE_AT, error: null}}, rows: SAMPLE_ROWS.deepseek!}}},
                {id: "source-failed", label: "拉取失败，沿用上一次的列表", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: false, checkedAt: SOURCE_AT, error: {reason: "auth", message: "401"}}}, rows: SAMPLE_ROWS.deepseek!}}},
                {id: "source-changed", label: "改过地址或凭据：要重新拉取", input: {props: {provider: {...SAMPLE_PROVIDERS[1]!, source: {state: "changed", refreshing: false, checkedAt: null, error: null}}, rows: SAMPLE_ROWS.anthropic!}}},
                {id: "source-failed-english", label: "拉取失败，英文界面", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: false, checkedAt: SOURCE_AT, error: {reason: "bad-response", message: "503"}}}, rows: SAMPLE_ROWS.deepseek!}}},
                {id: "detect-done", label: "检测协议的结果在接口格式下面", input: {props: {provider: {...SAMPLE_PROVIDERS[2]!, connection: "c1"}, rows: SAMPLE_ROWS.volcengine!, detect: {status: "done", detection: SAMPLE_DETECTION}}}},
                {id: "detect-done-english", label: "检测协议的结果，英文界面", input: {props: {provider: {...SAMPLE_PROVIDERS[2]!, connection: "c1"}, rows: SAMPLE_ROWS.volcengine!, detect: {status: "done", detection: SAMPLE_DETECTION}}}},
                {id: "detect-running", label: "检测进行中（按钮换成“取消协议检测”）", input: {props: {provider: SAMPLE_PROVIDERS[2]!, rows: SAMPLE_ROWS.volcengine!, detect: {status: "running"}}}},
                {id: "check-run", label: "检测全部进行中：已检 N / 共 M", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: SAMPLE_ROWS.deepseek!, checkRun: {done: 3, total: 24}}}},
                {id: "proxy-custom", label: "高级里的代理：自定义地址（展开“高级”看）", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, proxy: {mode: "custom", url: "http://127.0.0.1:7890"}}, rows: SAMPLE_ROWS.deepseek!}}},
                {id: "proxy-direct-english", label: "高级里的代理：直连，英文界面", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, proxy: {mode: "direct"}}, rows: SAMPLE_ROWS.deepseek!}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ProviderDetail>((await import("nbook/plugins/models/web/components/ProviderDetail.vue")).default, {events: ["set-key", "clear-key", "update", "toggle-model", "check", "check-all", "cancel-checks", "edit-model", "add-model", "manage", "reload-rows", "refresh-source", "detect", "cancel-detect", "adopt"], class: "w-full"})),
        }),
        defineLabFixture<typeof ApiDetectResults>({
            component: "ApiDetectResults",
            scenes: [
                {id: "done", label: "四行结果：当前的标“正在用”，通过的“用这个”，失败的可复制原文", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "c1"}}},
                {id: "adopted", label: "改用 Responses 之后：结果仍有效，“正在用”跟着换", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "c-responses"}}},
                {id: "stale", label: "配置已改：整块置灰、请重新检测", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "changed"}}},
                {id: "mixed", label: "混合协议的模板跟随中：哪一行都不是“正在用”，结果仍有效", input: {props: {state: {status: "done", detection: {...SAMPLE_DETECTION, connection: "c-follow"}}, connection: "c-follow"}}},
                {id: "running", label: "检测进行中", input: {props: {state: {status: "running"}, connection: "c1"}}},
                {id: "no-model", label: "没有能用来检测的模型：填一个模型 id", input: {props: {state: {status: "failed", code: "no-model", reason: "没有能用来检测的模型"}, connection: "c1"}}},
                {id: "failed", label: "没检成（原因红字）", input: {props: {state: {status: "failed", code: "unknown-provider", reason: "这家服务商已经不在了"}, connection: "c1"}}},
                {id: "done-english", label: "英文界面", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "c1"}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ApiDetectResults>((await import("nbook/plugins/models/web/components/ApiDetectResults.vue")).default, {events: ["adopt", "detect"], class: "w-full max-w-[560px]"})),
        }),
        defineLabFixture<typeof AllModelsView>({
            component: "AllModelsView",
            scenes: [
                {id: "models", label: "每家一节，默认收起（已读到各家的行）", input: {props: {providers: SAMPLE_PROVIDERS, rows: SAMPLE_ROWS}}},
                {id: "empty", label: "没有启用的模型", input: {props: {providers: []}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof AllModelsView>((await import("nbook/plugins/models/web/components/AllModelsView.vue")).default, {events: ["edit", "load"], class: "w-full"})),
        }),
        defineLabFixture<typeof AddProviderDialog>({
            component: "AddProviderDialog",
            scenes: [
                {id: "templates", label: "分组多列：已添加（可再加一份）、不要密钥、要登录", input: {model: {open: true}, props: {templates: SAMPLE_TEMPLATES, added: ["deepseek", "anthropic"]}}},
                {id: "loading", label: "模板表还在读", input: {model: {open: true}, props: {templates: null}}},
                {id: "english", label: "英文界面", input: {model: {open: true}, props: {templates: SAMPLE_TEMPLATES, added: ["deepseek"]}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof AddProviderDialog>((await import("nbook/plugins/models/web/components/AddProviderDialog.vue")).default, {events: ["update:open", "add"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
        }),
        defineLabFixture<typeof ManageModelsDialog>({
            component: "ManageModelsDialog",
            scenes: [
                {id: "discovered", label: "服务商的列表：已加入、要补字段、类型不明一组", input: {model: {open: true}, props: {providerName: "火山方舟", candidates: SAMPLE_CANDIDATES, current: ["doubao-seed-2-0-pro"]}}},
                {id: "loading", label: "还在读", input: {model: {open: true}, props: {providerName: "火山方舟", candidates: null, current: []}}},
                {id: "failed", label: "读取失败", input: {model: {open: true}, props: {providerName: "火山方舟", candidates: null, current: [], error: "读取模型失败：服务没有回应"}}},
                {id: "english", label: "英文界面", input: {model: {open: true}, props: {providerName: "Volcengine", candidates: SAMPLE_CANDIDATES, current: ["doubao-seed-2-0-pro"]}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ManageModelsDialog>((await import("nbook/plugins/models/web/components/ManageModelsDialog.vue")).default, {events: ["update:open", "done"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
        }),
        defineLabFixture<typeof ModelEditDialog>({
            component: "ModelEditDialog",
            scenes: [
                {id: "manual", label: "手动添加的模型（都能改）", input: {model: {open: true}, props: {model: SAMPLE_ROWS.volcengine![0]!}}},
                {id: "source", label: "来源模型：改过的字段标“已改”、可恢复来源值", input: {model: {open: true}, props: {model: SAMPLE_ROWS.deepseek![1]!}}},
                {id: "add", label: "手动添加", input: {model: {open: true}, props: {model: null, takenIds: ["doubao-seed-2-0-pro"]}}},
                {id: "error", label: "保存失败（页脚写原因）", input: {model: {open: true}, props: {model: SAMPLE_ROWS.volcengine![1]!, error: "设置文件有错或写不进去，先修好设置文件"}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ModelEditDialog>((await import("nbook/plugins/models/web/components/ModelEditDialog.vue")).default, {events: ["update:open", "save"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
        }),
        defineLabFixture<typeof PluginsPage>({
            component: "PluginsPage",
            scenes: [
                {id: "pending", label: "有待生效的变化（升级、降级、安装、禁用、卸载）", input: {props: {locale: "zh-CN"}}},
                {id: "problems", label: "显示名、说明，服务端与本窗口的问题（入口失败、受阻、贡献被拒）", input: {props: {locale: "zh-CN"}}},
                {id: "problems-english", label: "显示名、说明与问题，英文界面", input: {props: {locale: "en-US"}}},
                {id: "empty", label: "没有第三方插件", input: {props: {locale: "zh-CN"}}},
                {id: "not-loaded", label: "没有登记：清单无效、不兼容", input: {props: {locale: "zh-CN"}}},
                {id: "safe-mode", label: "安全模式", input: {props: {locale: "zh-CN"}}},
                {id: "long", label: "很长的 id 与版本", input: {props: {locale: "zh-CN"}}},
                {id: "downgrade", label: "安装预览为降级", input: {props: {locale: "zh-CN"}}},
                {id: "blocked", label: "升级预览列出重启后受阻的插件", input: {props: {locale: "zh-CN"}}},
                {id: "blocked-english", label: "升级预览列出重启后受阻的插件，英文界面", input: {props: {locale: "en-US"}}},
                {id: "loading", label: "读取中", input: {props: {locale: "zh-CN"}}},
                {id: "failed", label: "读取失败", input: {props: {locale: "zh-CN"}}},
                {id: "english", label: "英文界面", input: {props: {locale: "en-US"}}},
                {id: "write-failed", label: "写操作失败（点开关看失败说明）", input: {props: {locale: "zh-CN"}}},
                {id: "write-failed-english", label: "写操作失败，英文界面", input: {props: {locale: "en-US"}}},
                {id: "busy", label: "写操作进行中（点开关或卸载后不结算）", input: {props: {locale: "zh-CN"}}},
            ],
            load: async () => (await import("./PluginsPageFixture.vue")).default,
        }),
    ];
}

/**
 * 设置窗口（docs/specs/settings/settings-window.md）与给页面用的两个组件。窗口与 SettingsRow 由设置场景的局部宿主驱动
 * （`settings-scene/`）：产品里同一个窗口模型与配置实例，配置层换成内存里的拥有者。
 */
function settingsFixtures(): LabFixture[] {
    const row = (setting: typeof appearanceSetting | typeof sceneThemeSetting | typeof localeSetting | typeof snippetsSettings.items | typeof rowDemoSettings.workers | typeof rowDemoSettings.library | typeof rowDemoSettings.mode, layer: "user" | "project", wide = false) => ({setting, layer, projectTitle: "雾港", wide});
    /** 状态原因：出错、警告、淡色各一条，看图标取最重的色调、提示逐条列出。 */
    const reasons = [
        {tone: "error" as const, text: "未保存：取值范围为 1–8"},
        {tone: "warning" as const, text: "这个值偏大，抽取会很慢"},
        {tone: "muted" as const, text: "无法加载选项：插件“模型服务”已停止"},
    ];
    return [
        defineLabFixture<typeof SettingsWindow>({
            component: "SettingsWindow",
            noInput: "窗口由场景的局部宿主驱动（窗口模型、配置实例与分区注册表，配置层在内存里），没有可登记的 JSON 输入",
            scenes: SETTINGS_WINDOW_SCENES.map((scene) => ({id: scene.id, label: scene.label})),
            load: async () => (await import("./SettingsWindowFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsRow>({
            component: "SettingsRow",
            scenes: [
                {id: "modified", label: "用户层已修改", input: {props: row(appearanceSetting, "user")}},
                {id: "overridden", label: "被本作品覆盖", input: {props: row(appearanceSetting, "user")}},
                {id: "inherit", label: "本作品标签：沿用（来自用户设置）", input: {props: row(sceneThemeSetting, "project")}},
                {id: "project-set", label: "本作品标签：单独设置了", input: {props: row(appearanceSetting, "project")}},
                {id: "invalid", label: "层文件有错误（停用）", input: {props: row(appearanceSetting, "user")}},
                {id: "unreachable", label: "层连不上（停用）", input: {props: row(appearanceSetting, "user")}},
                {id: "wide", label: "宽排法：控件另起一行", input: {props: row(snippetsSettings.items, "user", true)}},
                {id: "not-allowed", label: "不允许这一层", input: {props: row(localeSetting, "project")}},
                {id: "multi-reason", label: "多个状态原因（一个图标，色调取最重的）", input: {props: {...row(rowDemoSettings.workers, "user"), reasons}}},
                {id: "read-only", label: "只读：只写值，最右一格是锁", input: {props: row(rowDemoSettings.library, "user")}},
                {id: "project-wide-inherit", label: "本作品标签：宽排法沿用", input: {props: row(snippetsSettings.items, "project", true)}},
                {id: "narrow", label: "560px 宽：控件换到标题下面", input: {props: row(rowDemoSettings.mode, "user")}},
            ],
            load: async () => (await import("./SettingsRowFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsActionRow>({
            component: "SettingsActionRow",
            slots: ["default"],
            scenes: [
                {id: "idle", label: "空闲：没有状态（测试代理那一行）", input: {props: {title: "测试代理"}, slots: {default: true}}},
                {id: "success", label: "成功", input: {props: {title: "测试代理", status: "连接成功：出口 IP 203.0.113.7，286 ms", tone: "success"}, slots: {default: true}}},
                {id: "danger", label: "带说明、失败（长文字折行）", input: {props: {title: "现在更新", description: "2026/11/20 09:30 更新过，共 1,104 个模型", status: "上次更新失败：代理设置无效（the system proxy uses an automatic configuration script, which is not supported）", tone: "danger"}, slots: {default: true}}},
                {id: "muted", label: "淡色状态", input: {props: {title: "测试代理", status: "正在测试…", tone: "muted"}, slots: {default: true}}},
            ],
            load: async () => withSettingsText(createSubjectFixture<typeof SettingsActionRow>((await import("nbook/ui/settings/SettingsActionRow.vue")).default, {class: "w-full"})),
        }),
        defineLabFixture<typeof SettingsNotice>({
            component: "SettingsNotice",
            slots: ["default"],
            scenes: [
                {id: "warning", label: "警告", input: {props: {tone: "warning"}, slots: {default: true}}},
                {id: "danger", label: "错误", input: {props: {tone: "danger"}, slots: {default: true}}},
                {id: "button", label: "整块是按钮", input: {props: {as: "button"}, slots: {default: true}}},
            ],
            load: async () => createSubjectFixture<typeof SettingsNotice>((await import("nbook/ui/settings/SettingsNotice.vue")).default),
        }),
        defineLabFixture<typeof SettingsPageActions>({
            component: "SettingsPageActions",
            noInput: "操作由插槽给出，层能不能写由窗口通道给出，没有可登记的 JSON 输入",
            scenes: [
                {id: "in-place", label: "没有窗口通道：一个操作原位渲染"},
                {id: "multiple", label: "没有窗口通道：多个操作（按钮与图标按钮）"},
                {id: "in-title", label: "有窗口通道：操作画在标题区右侧"},
                {id: "disabled", label: "有窗口通道、这一层不能写：操作整体停用，可切换恢复"},
            ],
            load: async () => (await import("./SettingsPageActionsFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsSaveBar>({
            component: "SettingsSaveBar",
            scenes: [
                {id: "clean", label: "没有改动：两个按钮停用，不写字", input: {props: {dirty: false, busy: false}}},
                {id: "dirty", label: "有改动：缺省文字，按钮可用", input: {props: {dirty: true, busy: false}}},
                {id: "busy", label: "保存中：按钮停用", input: {props: {dirty: true, busy: true}}},
                {id: "message", label: "自定义文字", input: {props: {dirty: true, busy: false, message: "还没保存：“接口地址”还没有填写"}}},
                {id: "english", label: "英文界面", input: {props: {dirty: true, busy: false}}},
            ],
            load: async () => withSettingsText(createSubjectFixture<typeof SettingsSaveBar>((await import("nbook/ui/settings/SettingsSaveBar.vue")).default, {class: "w-full"})),
        }),
        defineSubjectFixture<typeof HighlightedText>({
            component: "HighlightedText",
            scenes: [
                {id: "single", label: "一个词：标题里的命中", input: {props: {text: "终端字号", words: ["字号"]}}},
                {id: "multi", label: "多个词、每个词的所有命中都标", input: {props: {text: "代码里的字号与行距；字号越大越清楚", words: ["字号", "行距"]}}},
                {id: "case", label: "不分大小写，标出的是原文的写法", input: {props: {text: "Font Size 与 FONT 与 font", words: ["font"]}}},
                {id: "escaped", label: "尖括号、&、正则元字符按文字显示与查找", input: {props: {text: "<b>粗体</b> & (a+b)* .*", words: ["<b>", "&", "(a+b)*", ".*"]}}},
                {id: "none", label: "没有命中：原样显示", input: {props: {text: "界面的主题与语言", words: ["字号"]}}},
            ],
            subject: () => import("nbook/ui/settings/HighlightedText.vue"),
        }),
        defineLabFixture<typeof SettingsPageList>({
            component: "SettingsPageList",
            scenes: (() => {
                const providers = [
                    {id: "deepseek", title: "DeepSeek", description: "https://api.deepseek.com", icon: "i-lucide-server", status: "已连接", tone: "success" as const, modified: true},
                    {id: "ollama", title: "本地 Ollama", description: "http://127.0.0.1:11434/v1", icon: "i-lucide-server", status: "未连接"},
                    {id: "openai", title: "OpenAI", description: "https://api.openai.com/v1", icon: "i-lucide-server", status: "密钥已过期", tone: "warning" as const},
                    {id: "custom", title: "自建服务", description: "http://llm.internal/v1", icon: "i-lucide-server", status: "连接失败", tone: "error" as const},
                ];
                const long = [
                    {id: "a", title: "一个名字很长很长的自建兼容服务（内网环境下的备用线路）", description: "https://llm.internal.example.com/v1/chat/completions/with/a/very/long/path", icon: "i-lucide-server", status: "已连接", tone: "success" as const, modified: true},
                    {id: "b", title: "备用"},
                ];
                return [
                    {id: "list", label: "列表：图标、说明、状态色调（成功、淡色、警告、出错）与改动圆点", input: {props: {items: providers, label: "服务商"}, model: {modelValue: null}}},
                    {id: "long", label: "长标题与长说明截断，状态文字不缩", input: {props: {items: long, label: "服务商"}, model: {modelValue: null}}},
                    {id: "open", label: "打开一项（没有窗口通道）：详情上方自己画“‹ 返回”，返回后焦点回到这一行", input: {props: {items: providers, label: "服务商"}, model: {modelValue: "deepseek"}}},
                    {id: "open-in-title", label: "打开一项（有窗口通道）：标题区换成“‹ 模型服务”与这一项的标题", input: {props: {items: providers, label: "服务商"}, model: {modelValue: "deepseek"}}},
                ];
            })(),
            load: async () => (await import("./SettingsPageListFixture.vue")).default,
        }),
    ];
}

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}

/** 条目页的几个组件（canon 插件，docs/specs/canon/author-ui.md 输出 6 到 15）：场景用星瑕样本里的样子手写。 */
function canonEntryPageFixtures() {
    const origins = [
        {key: "p3", where: "第 3 章", what: "被扒手偷了", basis: {text: "估计：大概三百", estimate: true}, delta: "−300", result: "2,400 元", change: "c3"},
        {key: "k2", where: "第 2 章", what: "核对：正文写 2,800，对不上", result: "", check: "mismatch" as const},
        {key: "p2", where: "第 2 章", what: "领了打工的工资", basis: {text: "原文：“店长塞给她三千”", estimate: false}, delta: "+3,000", result: "2,700 元", change: "c2"},
        {key: "p1", where: "第 1 章", what: "交了学费", basis: {text: "作者给的", estimate: false}, delta: "−800", result: "−300 元", change: "c1"},
        {key: "init", where: "", what: "初值", result: "500 元"},
    ];
    const row = (path: string, label: string, display: string, extra: Record<string, unknown> = {}) => ({path, label, display, unknown: false, incomplete: false, mark: null as string | null, ...extra});
    const fields = [
        row("character.外观", "外观", "黑发，左眼下有颗痣", {mark: "前史改过"}),
        row("character.状态", "状态", "未知", {unknown: true}),
        row("character.态度", "现在的态度", "对学院长提防，对白灵信任", {mark: "第 2 章改过", notes: [{where: "第 1 章", text: "起点：谁也不信"}, {where: "第 2 章", text: "白灵替她挡了一次"}], notReduced: true}),
        row("panel.物品", "随身物品", "", {items: ["魔杖", "旧课本", "半块面包"], elementIds: ["i1", "i2", "i3"]}),
    ];
    /** 一块：源文与值表；每项的起点按它的标签在源文里依次出现的位置算。 */
    const valued = (id: string, source: string, items: ReadonlyArray<readonly [string, Record<string, unknown>]>): EntryTextBlock => {
        let cursor = 0;
        return {id, source, values: items.map(([tag, item]) => {
            const start = source.indexOf(tag, cursor);
            cursor = start + 1;
            return {tag: tag.slice(1).split(/[\s/>]/u)[0]!, start, ...item} as unknown as EntryTextValue;
        })};
    };
    const value = (path: string, label: string, display: string, extra: Record<string, unknown> = {}) => ({path, entry: null, label, raw: display, display, ...extra});
    const blocks: EntryTextBlock[] = [
        valued("b1", '# 近况\n\n星瑕现在有 <V of="panel.存款" /> 元，魔力 <V of="panel.魔力" />，<If test="panel.存款 > 1000">交得起学费<Else />学费还差一截</If>。', [
            ['<V of="panel.存款"', value("panel.存款", "存款", "2,400")],
            ['<V of="panel.魔力"', value("panel.魔力", "魔力", "未知", {raw: null, unknown: true})],
            ["<If", {result: true, taken: 0}],
        ]),
        valued("b2", '她的另一个身份是 <Ref id="gege" />。**没人知道。**', [['<Ref id="gege"', {id: "gege", name: "哥哥", deleted: false}]]),
        {id: "b3", error: {message: "raw HTML or an HTML comment is not supported in entry text"}, text: "<div>坏掉的一块</div>"},
    ];
    const marks = {"panel.存款": "第 3 章改过"};
    const cards = [
        row("panel.存款", "存款", "2,400 元", {mark: "第 3 章改过"}),
        row("panel.魔力", "魔力", "3,110", {incomplete: true}),
        row("panel.物品", "随身物品", "", {items: ["魔杖", "旧课本"]}),
    ];
    const plot = [
        {id: "c4", where: "第 4 章", text: "她会离开学院", flags: ["plan" as const], patches: []},
        {id: "c3", where: "第 3 章", text: "被扒手偷了", flags: [] as ("plan" | "held" | "undone")[], patches: ["存款 −300"]},
        {id: "c2", where: "第 2 章", text: "领了打工的工资", flags: ["held" as const], patches: ["存款 +3,000"]},
        {id: "c1", where: "第 1 章", text: "交了学费", flags: ["undone" as const], patches: ["存款 −800", "状态 → 入学"]},
    ];
    const chapters = [{chapter: "1", index: 1, title: "雨夜的来客", start: "1:start", end: "1:end"}, {chapter: "2", index: 2, title: null, start: "2:start", end: "2:end"}];
    const tabs = [
        {value: "data:character", label: "人物", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true},
        {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own" as const},
        {value: "data:panel", label: "数值", iconClass: "i-lucide-gauge", segment: "own" as const, removable: true},
        {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 4},
    ];
    const page = {props: {status: "normal" as const, name: "星瑕", summary: "第三魔法学院一年级，靠打工交学费", sameAs: null, chapters, tabs}, model: {position: "2:end", planned: false, tab: "text"}};
    /** 条目选择器的场景只给占位的查找状态：夹具自己当宿主，按真实的去抖查找换掉它（`EntryPickerFixture.vue`）。 */
    const IDLE = {kind: "idle"} as const;
    return [
        defineLabFixture<typeof EntryPicker>({
            component: "EntryPicker",
            scenes: [
                {id: "empty", label: "没选：点开列出条目，打“小瑕”按别名找到星瑕", input: {props: {results: IDLE}, model: {modelValue: null}}},
                {id: "picked", label: "选了一个（当前值不在这一批结果里时显示给的名字）", input: {props: {results: IDLE, selectedName: "星瑕"}, model: {modelValue: "e1"}}},
                {id: "exclude", label: "已在列表里的灰掉", input: {props: {results: IDLE, exclude: ["e1", "e2"], excludeReason: "已在列表里"}, model: {modelValue: null}}},
                {id: "create", label: "可以就地新建知识点：打一个没有的名字", input: {props: {results: IDLE, createKind: "知识点"}, model: {modelValue: null}}},
                {id: "failed", label: "查找失败", input: {props: {results: IDLE}, model: {modelValue: null}}},
                {id: "picked-english", label: "英文界面", input: {props: {results: IDLE, selectedName: "星瑕", createKind: "知识点"}, model: {modelValue: "e1"}}},
            ],
            load: async () => (await import("./EntryPickerFixture.vue")).default,
        }),
        defineLabFixture<typeof ImageInput>({
            component: "ImageInput",
            scenes: [
                {id: "empty", label: "未知", input: {props: {}, model: {modelValue: null}}},
                {id: "filled", label: "填了路径与说明", input: {props: {}, model: {modelValue: {图片: "图片/星瑕.png", 说明: "银白长发"}}}},
                {id: "bad-path", label: "路径不合规则", input: {props: {}, model: {modelValue: {图片: "../外面/星瑕.png", 说明: ""}}}},
                {id: "problem", label: "服务退回的原因", input: {props: {problem: "这个作品里没有这个文件"}, model: {modelValue: {图片: "图片/没有.png", 说明: ""}}}},
                {id: "bad-path-english", label: "英文界面", input: {props: {}, model: {modelValue: {图片: "/abs/star.png", 说明: "silver hair"}}}},
                {id: "picking", label: "作品里的图片：选了一张", input: {props: {}, model: {modelValue: {图片: "插图/星瑕-立绘.png", 说明: "银白长发"}}}},
                {id: "picking-uploading", label: "正在上传", input: {props: {}, model: {modelValue: null}}},
                {id: "picking-no-images", label: "图片文件夹还是空的", input: {props: {}, model: {modelValue: null}}},
                {id: "picking-english", label: "英文界面：作品里的图片", input: {props: {}, model: {modelValue: null}}},
            ],
            load: async () => (await import("./ImageInputFixture.vue")).default,
        }),
        defineLabFixture<typeof CharacterCard>({
            component: "CharacterCard",
            scenes: (() => {
                const facts = [
                    {id: "性别", label: "性别", text: "女"},
                    {id: "年龄", label: "年龄", text: "17 岁"},
                    {id: "身份", label: "身份", text: "隐退的魔法少女"},
                    {id: "所属", label: "所属", text: "对策委员会魔法少女部", link: true},
                    {id: "现在在哪", label: "现在在哪", text: "星家老宅", link: true, mark: "第 2 章改过"},
                    {id: "生死", label: "生死", text: "活着"},
                    {id: "种族", label: "种族", text: "人类", own: true},
                    {id: "喜好", label: "喜好", text: "甜食，尤其是妹妹做的布丁", own: true},
                ];
                const blank = facts.slice(0, 6).map(({mark: _mark, ...fact}) => ({...fact, text: null}));
                const condition = {id: "现在的状态", label: "现在的状态", text: "以哥哥的样子和妹妹同住，魔力还没恢复到能变身的程度", hint: "受伤、被通缉、刚搬家……此刻的处境", mark: "第 2 章改过"};
                const passages = [
                    {id: "性格", label: "性格", text: "迟钝，情商不高，做事认真。想对妹妹好，常常用错方法，过后才知道搞砸了。", hint: "遇事怎么反应，最在意什么"},
                    {id: "说话方式", label: "说话方式", text: null, hint: "口头禅、语气、对不同的人怎么称呼"},
                    {id: "背景", label: "背景", text: "六岁那年的城市大灾难里失去了父母。之后觉醒了时间系的天赋，被对策委员会带进魔法少女部，几年里成了蓝星最强；灾难平息后，官方给她安了罪名，她顺势隐退。", hint: "从哪里来，经历过什么"},
                ];
                const filled = {facts, condition, passages, portrait: {status: "image" as const, path: "插图/星瑕-立绘.png", alt: "星瑕的立绘"}, canAdd: true, presets: [{id: "生日", label: "生日"}, {id: "弱点", label: "弱点"}, {id: "动机", label: "动机"}, {id: "初次登场", label: "初次登场"}], removed: [{id: "身高", label: "身高"}]};
                const empty = {...filled, facts: blank, condition: {...condition, text: null}, passages: passages.map((passage) => ({...passage, text: null})), portrait: {status: "no-image" as const}, removed: []};
                return [
                    {id: "filled", label: "填好的人物", input: {props: filled, model: {addOpen: false}}},
                    {id: "empty", label: "刚新建的人物", input: {props: empty, model: {addOpen: false}}},
                    {id: "no-look", label: "条目上没有形象这一组", input: {props: {...filled, portrait: {status: "absent" as const}}, model: {addOpen: false}}},
                    {id: "removed-look", label: "形象去掉过", input: {props: {...filled, portrait: {status: "removed" as const}}, model: {addOpen: false}}},
                    {id: "later-look", label: "所选位置上形象还没启用", input: {props: {...filled, portrait: {status: "later" as const, from: "第 3 章"}}, model: {addOpen: false}}},
                    {id: "add-field", label: "添加一项资料", input: {props: filled, model: {addOpen: true}}},
                    {id: "add-refused", label: "自己写的名字被拒", input: {props: {...filled, addError: "这一组里已经有叫“喜好”的一项"}, model: {addOpen: true}}},
                    {id: "condition-open", label: "现在的状态展开着", input: {props: {...filled, conditionOpen: true}, model: {addOpen: false}}},
                    {id: "blocked", label: "写不了：值按钮不可用", input: {props: {...filled, editReason: "先不算计划"}, model: {addOpen: false}}},
                    {id: "filled-english", label: "英文界面", input: {props: filled, model: {addOpen: false}}},
                ];
            })(),
            load: async () => (await import("./CharacterCardFixture.vue")).default,
        }),
        defineLabFixture<typeof LookCard>({
            component: "LookCard",
            scenes: (() => {
                const filled = {
                    portrait: {path: "插图/星瑕-立绘.png", alt: "淡金长发的少女侧身回头"},
                    appearance: {id: "外貌", label: "外貌", text: "淡金色长发及腰，浅灰蓝的眼睛，个子娇小。左手腕内侧有一道回溯留下的细痕。", hint: "发色、眼睛、体型，一眼认得出来的地方"},
                    wearing: {id: "现在穿的", label: "现在穿的", text: "哥哥的便装", mark: "第 2 章改过"},
                    outfits: [
                        {id: "i1", name: "哥哥的便装", look: "深灰连帽衫、牛仔裤，认知滤镜下看上去是个高个子男生", image: "插图/星瑕-便服.png", wearing: true},
                        {id: "i2", name: "学院制服", look: "第三魔法学院的冬季制服，藏青外套配格子裙", image: "插图/星瑕-学院制服.png", wearing: false},
                        {id: "i3", name: "睡衣", look: "妹妹挑的兔子睡衣，袖子长了一截", image: null, wearing: false},
                    ],
                };
                const empty = {portrait: null, appearance: {...filled.appearance, text: null}, wearing: {id: "现在穿的", label: "现在穿的", text: null}, outfits: []};
                return [
                    {id: "filled", label: "填好的形象", input: {props: filled}},
                    {id: "empty", label: "刚加上、还空着", input: {props: empty}},
                    {id: "blocked", label: "写不了", input: {props: {...filled, editReason: "先不算计划"}}},
                    {id: "filled-english", label: "英文界面", input: {props: filled}},
                ];
            })(),
            load: async () => (await import("./LookCardFixture.vue")).default,
        }),
        defineLabFixture<typeof CanonImage>({
            component: "CanonImage",
            scenes: [
                {id: "found", label: "读到了", input: {props: {path: "插图/星瑕-立绘.png", alt: "星瑕的立绘"}}},
                {id: "missing", label: "图片找不到", input: {props: {path: "插图/没有这张.png"}}},
                {id: "missing-english", label: "英文界面", input: {props: {path: "插图/没有这张.png"}}},
            ],
            load: async () => (await import("./CanonImageFixture.vue")).default,
        }),
        defineLabFixture<typeof MoveDialog>({
            component: "MoveDialog",
            scenes: [
                {id: "sample", label: "挂在学院下面、第 2 章出场", input: {props: {entry: {id: "e1", name: "星瑕"}, parentResults: IDLE, sameAsResults: IDLE, chapters: [{id: "1", index: 1}, {id: "2", index: 2}]}, model: {open: true, draft: {parent: "e2", parentName: "学院", folder: "人物", kind: "人物", order: "keep" as const, appears: "2", sameAs: null, sameAsName: ""}}}},
                {id: "failed", label: "内核拒收：成环", input: {props: {entry: {id: "e1", name: "星瑕"}, parentResults: IDLE, sameAsResults: IDLE, error: "不能挂到自己的下层条目下面"}, model: {open: true, draft: {parent: null, parentName: "", folder: "人物", kind: "人物", order: "first" as const, appears: null, sameAs: null, sameAsName: ""}}}},
                {id: "sample-english", label: "英文界面", input: {props: {entry: {id: "e1", name: "Xia"}, parentResults: IDLE, sameAsResults: IDLE}, model: {open: true, draft: {parent: null, parentName: "", folder: "People", kind: "Person", order: "keep" as const, appears: null, sameAs: null, sameAsName: ""}}}},
            ],
            load: async () => (await import("./MoveDialogFixture.vue")).default,
        }),
        defineLabFixture<typeof FieldInput>({
            component: "FieldInput",
            scenes: [
                {id: "number", label: "数，带单位", input: {props: {kind: "number" as const, label: "存款", unit: "元"}, model: {value: "1200"}}},
                {id: "enum", label: "选项", input: {props: {kind: "enum" as const, label: "态度", options: ["友好", "敌对", "中立"]}, model: {value: "敌对"}}},
                {id: "boolean", label: "是否", input: {props: {kind: "boolean" as const, label: "在场"}, model: {value: true}}},
                {id: "ref", label: "引用（条目选择器）", input: {props: {kind: "ref" as const, label: "对头", refName: "雾崎"}, model: {value: "e2"}}},
                {id: "image", label: "图片", input: {props: {kind: "image" as const, label: "画像"}, model: {value: {图片: "图片/星瑕.png", 说明: "入学那天"}}}},
                {id: "text", label: "文字", input: {props: {kind: "text" as const, label: "外观", rows: 3}, model: {value: "黑发，左眼下有一颗痣"}}},
                {id: "text-english", label: "英文界面", input: {props: {kind: "text" as const, label: "Looks"}, model: {value: "Black hair"}}},
            ],
            load: async () => (await import("./FieldInputFixture.vue")).default,
        }),
        defineLabFixture<typeof ElementDialog>({
            component: "ElementDialog",
            scenes: [
                {id: "add", label: "加一项：名字与数量", input: {props: {title: "给“物品”加一项", keyed: false, editing: false, keyResults: IDLE, fields: [{id: "数量", label: "数量", kind: "number" as const, unit: "把"}, {id: "来历", label: "来历", kind: "text" as const}], values: {数量: "", 来历: ""}, refResults: IDLE, intents: ["creative" as const, "story" as const]}, model: {open: true, label: "", keyValue: null, intent: "creative" as const}}},
                {id: "keyed", label: "以条目为键：选指向的知识点", input: {props: {title: "给“知情”加一项", keyed: true, editing: false, keyResults: IDLE, fields: [{id: "程度", label: "程度", kind: "enum" as const, options: ["知道", "怀疑", "不知道"]}], values: {程度: "怀疑"}, refResults: IDLE, intents: ["creative" as const]}, model: {open: true, label: "", keyValue: null, intent: "creative" as const}}},
                {id: "edit-semantic", label: "改一项：语义档只读，键不能换", input: {props: {title: "改“知情”的一项", keyed: true, editing: true, keyName: "学院的秘密", keyResults: IDLE, fields: [{id: "程度", label: "程度", kind: "enum" as const, options: ["知道", "怀疑", "不知道"]}, {id: "想法", label: "想法", kind: "text" as const, semantic: true}], values: {程度: "知道", 想法: "觉得校长在隐瞒什么"}, refResults: IDLE, intents: ["creative" as const, "story" as const]}, model: {open: true, label: "", keyValue: "k1", intent: "story" as const}}},
                {id: "failed", label: "内核拒收", input: {props: {title: "给“物品”加一项", keyed: false, editing: false, keyResults: IDLE, fields: [{id: "数量", label: "数量", kind: "number" as const}], values: {数量: "abc"}, refResults: IDLE, intents: ["creative" as const], error: "“数量”填得不对"}, model: {open: true, label: "盾", keyValue: null, intent: "creative" as const}}},
                {id: "add-english", label: "英文界面", input: {props: {title: "Add an item to “Items”", keyed: false, editing: false, keyResults: IDLE, fields: [{id: "count", label: "Count", kind: "number" as const}], values: {count: "2"}, refResults: IDLE, intents: ["creative" as const, "story" as const]}, model: {open: true, label: "Shield", keyValue: null, intent: "creative" as const}}},
            ],
            load: async () => (await import("./ElementDialogFixture.vue")).default,
        }),
        defineLabFixture<typeof OriginList>({
            component: "OriginList",
            scenes: [
                {id: "sample", label: "估计、核对对不上、初值", input: {props: {rows: origins, caption: "存款是怎么来的"}}},
                {id: "more", label: "还有没读的步", input: {props: {rows: [...origins.slice(0, 2), origins[4]!], remaining: 29}}},
                {id: "loading", label: "读取中", input: {props: {rows: [], loading: true}}},
                {id: "failed", label: "读取失败", input: {props: {rows: [], failed: true}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows: origins, remaining: 3}}},
            ],
            load: async () => (await import("./OriginListFixture.vue")).default,
        }),
        defineLabFixture<typeof FieldTable>({
            component: "FieldTable",
            scenes: [
                {id: "sample", label: "人物：改过、未知、语义档的各句、列表", input: {props: {rows: fields}}},
                {id: "open", label: "展开着一个字段", input: {props: {rows: fields, open: "character.外观"}}},
                {id: "editing", label: "能改：可改的行有“改”，列表的各项有改、去掉与添加", input: {props: {rows: fields, editing: true}}},
                {id: "empty", label: "没有字段", input: {props: {rows: []}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows: fields}}},
            ],
            load: async () => (await import("./FieldTableFixture.vue")).default,
        }),
        defineLabFixture<typeof EntryText>({
            component: "EntryText",
            scenes: [
                {id: "sample", label: "值、改过、未知、引用、出错的块", input: {props: {blocks, self: "xingxia", marks}}},
                {id: "open", label: "展开着存款", input: {props: {blocks, self: "xingxia", marks, open: "xingxia|panel.存款"}}},
                {id: "editable", label: "能改：右上“编辑”", input: {props: {blocks, self: "xingxia", marks, editable: true}}},
                {id: "empty", label: "还没有主文字：开始写", input: {props: {blocks: [], self: "xingxia", editable: true}}},
                {id: "blocked", label: "写不了：入口不可用、悬停写原因", input: {props: {blocks, self: "xingxia", editable: true, editReason: "先不算计划"}}},
                {id: "sample-english", label: "英文界面", input: {props: {blocks, self: "xingxia", marks, editable: true}}},
            ],
            load: async () => (await import("./EntryTextFixture.vue")).default,
        }),
        defineLabFixture<typeof EntryTextEditor>({
            component: "EntryTextEditor",
            scenes: (() => {
                const base = {problem: "", dirty: false, saved: "none" as const, phase: "idle" as const, submitBlocked: "", message: ""};
                const plain = "星瑕是个不怎么出门的数字游民，靠给各种工作室做外包维生。\n\n她的银白色长发是天生的。\n\n存款 <V of=\"panel.存款\" /> 联邦币。";
                const inserts = [{label: "面板 · 存款", snippet: "<V of=\"panel.存款\" />"}, {label: "面板 · 魔力", snippet: "<V of=\"panel.魔力\" />"}, {label: "人物 · 外观", snippet: "<V of=\"character.外观\" />"}];
                return [
                    {id: "clean", label: "刚进编辑：没有改动，右边是“取消”", input: {props: {...base, text: plain, inserts}, model: {preview: false}}},
                    {id: "empty", label: "没有主文字：一个空的输入框", input: {props: {...base, text: "", inserts}, model: {preview: false}}},
                    {id: "no-fields", label: "条目没有字段：不出“插入”", input: {props: {...base, text: plain}, model: {preview: false}}},
                    {id: "dirty", label: "改过：已暂存", input: {props: {...base, dirty: true, saved: "saved", text: `${plain}\n\n新加的一段。`, inserts}, model: {preview: false}}},
                    {id: "problem", label: "写得不对：原因在输入框下面", input: {props: {...base, dirty: true, saved: "saved", text: "存款 <V of=\"panel.存款\" 联邦币。", problem: "写得不对：<V is not a complete tag; finish it, or write \\< to keep it as text (1:4)", inserts}, model: {preview: false}}},
                    {id: "not-saved", label: "暂存写不进去", input: {props: {...base, dirty: true, saved: "failed", text: plain, inserts}, model: {preview: false}}},
                    {id: "unsaved", label: "正在打字：还没暂存，那一行不写状态", input: {props: {...base, dirty: true, saved: "unsaved", text: plain, inserts}, model: {preview: false}}},
                    {id: "too-large", label: "内容太大，没有暂存", input: {props: {...base, dirty: true, saved: "too-large", text: plain, inserts}, model: {preview: false}}},
                    {id: "diverged", label: "另一个窗口也在改：用这里的、换成那边的", input: {props: {...base, dirty: true, saved: "diverged", text: plain, inserts}, model: {preview: false}}},
                    {id: "submitting", label: "正在提交：输入框只读", input: {props: {...base, dirty: true, saved: "saved", phase: "submitting", text: plain, inserts}, model: {preview: false}}},
                    {id: "confirming", label: "上一次提交结果不明：正在确认，可以再试或放弃", input: {props: {...base, dirty: true, saved: "saved", phase: "confirming", text: plain, inserts}, model: {preview: false}}},
                    {id: "blocked", label: "世界只读：提交不可用，原因写在那一行", input: {props: {...base, dirty: true, saved: "saved", submitBlocked: "世界是只读的：日志里有一行认不出的格式", text: plain, inserts}, model: {preview: false}}},
                    {id: "message", label: "提交没发出去：整批的说明", input: {props: {...base, dirty: true, saved: "saved", message: "别处一直在改，稍后再提交", text: plain, inserts}, model: {preview: false}}},
                    {id: "frozen", label: "开始编辑时的那一章没了：只能看与放弃", input: {props: {...base, dirty: true, saved: "saved", frozen: true, message: "开始编辑时的那一章已经不在了：复制要留的文字，然后放弃", text: "改过的文字，还能选中复制。", inserts}, model: {preview: false}}},
                    {id: "long", label: "四十段", input: {props: {...base, text: Array.from({length: 40}, (_, index) => `第 ${String(index + 1)} 段的文字。`).join("\n\n"), inserts}, model: {preview: false}}},
                    {id: "preview", label: "预览开着：够宽时左右各半，窄处预览排在下面", input: {props: {...base, dirty: true, saved: "saved", text: `## 近况\n\n${plain}`, inserts}, model: {preview: true}}},
                    {id: "preview-problem", label: "预览开着、写得不对：栏顶上写行与原因，栏里是上一次的样子", input: {props: {...base, dirty: true, saved: "saved", text: `${plain}\n\n魔力 <V of="panel.魔力"`, previewNote: "第 7 行第 4 列写得不对：<V is not a complete tag; finish it, or write \\< to keep it as text", inserts}, model: {preview: true}}},
                    {id: "preview-long", label: "预览开着、四十段：预览栏自己滚", input: {props: {...base, text: Array.from({length: 40}, (_, index) => `第 ${String(index + 1)} 段的文字，写得长一点好看出两栏各自折行以后的高度差多少。`).join("\n\n"), inserts}, model: {preview: true}}},
                    {id: "preview-english", label: "英文界面：预览开着", input: {props: {...base, dirty: true, saved: "saved", text: "## Lately\n\nXingxia rarely leaves her flat; she lives on contract work for small studios.\n\nSavings: <V of=\"panel.存款\" credits.", previewNote: "Line 5, column 10 is not valid: <V is not a complete tag; finish it, or write \\< to keep it as text", inserts: [{label: "Panel · Savings", snippet: "<V of=\"panel.存款\" />"}]}, model: {preview: true}}},
                    {id: "dirty-english", label: "英文界面", input: {props: {...base, dirty: true, saved: "saved", text: "Xingxia rarely leaves her flat; she lives on contract work for small studios.\n\nHer silver hair is natural.", inserts: [{label: "Panel · Savings", snippet: "<V of=\"panel.存款\" />"}]}, model: {preview: false}}},
                    {id: "diverged-english", label: "英文界面：另一个窗口也在改，提交被拦", input: {props: {...base, dirty: true, saved: "diverged", submitBlocked: "The world is read-only: a line in the log has an unknown format", message: "The saved draft could not be deleted; discard again once connected", text: "Xingxia rarely leaves her flat; she lives on contract work for small studios.", inserts: [{label: "Panel · Savings", snippet: "<V of=\"panel.存款\" />"}]}, model: {preview: false}}},
                ];
            })(),
            load: async () => (await import("./EntryTextEditorFixture.vue")).default,
        }),
        defineLabFixture<typeof TextConflictDialog>({
            component: "TextConflictDialog",
            scenes: [
                {id: "changed", label: "同一块两边都改了：只标出不一样的那一截", input: {props: {items: [{id: "b1", kind: "changed", mine: "星瑕是个不怎么出门的数字游民，靠给各种工作室做外包维生。", theirs: "星瑕是个不怎么出门的数字游民，靠接私活维生。", choice: null}]}, model: {open: true}}},
                {id: "mixed", label: "几条一起：两边都改了、我删了它别处改了、被别处删了、现在不能删", input: {props: {items: [
                    {id: "b1", kind: "changed", mine: "她的银白色长发是染的。", theirs: "她的银白色长发是天生的，很少打理。", choice: "mine"},
                    {id: "b2", kind: "changed", mine: null, theirs: "别处改过的一块。", choice: null},
                    {id: "b3", kind: "gone", mine: "我改过、别处删掉的一块。", theirs: null, choice: null},
                    {id: "b4", kind: "locked", mine: null, theirs: "现在被剧情改过的一块。", reason: "现在不能删这一块了", choice: "theirs"},
                ]}, model: {open: true}}},
                {id: "rerouted", label: "这一块现在是剧情里的文字：选我的就改那条剧情；拆过并过的只说明、回去整理", input: {props: {items: [
                    {id: "b1", kind: "rerouted", mine: "我改的设定。", theirs: "第 2 章里变成的样子。", reason: "这一块现在是剧情里的文字", choice: null},
                    {id: "b2", kind: "manual", mine: "拆出去一半以后剩下的前半。", theirs: "第 2 章里整块换掉的样子。", reason: "这一块拆过或并过，现在是剧情里的文字：回去整理以后再提交", choice: null},
                ]}, model: {open: true}}},
                {id: "busy", label: "正在提交", input: {props: {busy: true, items: [{id: "b1", kind: "changed", mine: "我的。", theirs: "现在的。", choice: "mine"}]}, model: {open: true}}},
                {id: "changed-english", label: "英文界面", input: {props: {items: [{id: "b1", kind: "changed", mine: "Her silver hair is dyed.", theirs: "Her silver hair is natural and rarely styled.", choice: null}, {id: "b2", kind: "gone", mine: "A block I edited.", theirs: null, choice: null}]}, model: {open: true}}},
            ],
            load: async () => (await import("./TextConflictDialogFixture.vue")).default,
        }),
        defineLabFixture<typeof EntryRichInput>({
            component: "EntryRichInput",
            scenes: [
                {id: "text", label: "标题、取值、条件、列表与引用", input: {props: {label: "主文字"}, model: {modelValue: "## 现在\n\n魔力 <V of=\"panel.魔力\" />/<V of=\"panel.魔力上限\" />，<If test=\"panel.魔力 >= 1000\">还能变身。<Else />魔力不够变身。</If>\n\n- 存款 <V of=\"panel.存款\" /> 联邦币\n- 哥哥是 <Ref id=\"e2\" />\n\n> 引用里的 **强调** 与 `代码`。"}}},
                {id: "empty", label: "空的", input: {props: {label: "主文字"}, model: {modelValue: ""}}},
                {id: "readonly", label: "只读", input: {props: {label: "主文字", readonly: true}, model: {modelValue: "提交期间不能输入，<V of=\"panel.魔力\" /> 照样显示。"}}},
                {id: "text-english", label: "英文", input: {props: {label: "Main text"}, model: {modelValue: "A long English line that keeps going so that it has to wrap inside a narrow container, with <V of=\"panel.mana\" /> in the middle."}}},
            ],
            load: async () => (await import("./EntryRichInputFixture.vue")).default,
        }),
        defineLabFixture<typeof PlainSourceInput>({
            component: "PlainSourceInput",
            scenes: [
                {id: "text", label: "两段文字", input: {props: {label: "第 1 块的源文字"}, model: {modelValue: "第一段。\n\n第二段，<V of=\"panel.存款\" /> 这样的表达式照写。"}}},
                {id: "empty", label: "空的", input: {props: {label: "第 1 块的源文字"}, model: {modelValue: ""}}},
                {id: "readonly", label: "只读", input: {props: {label: "第 1 块的源文字", readonly: true}, model: {modelValue: "提交期间不能输入。"}}},
                {id: "text-english", label: "英文", input: {props: {label: "Source of block 1"}, model: {modelValue: "A long English line that keeps going so that it has to wrap inside a narrow container without overflowing."}}},
            ],
            load: async () => (await import("./PlainSourceInputFixture.vue")).default,
        }),
        defineLabFixture<typeof PanelView>({
            component: "PanelView",
            scenes: [
                {id: "sample", label: "选中存款，旁边是流水", input: {props: {cards, selected: "panel.存款", ledger: origins, ledgerRemaining: 12}}},
                {id: "loading", label: "流水读取中", input: {props: {cards, selected: "panel.魔力", ledger: [], ledgerLoading: true}}},
                {id: "empty", label: "面板还没有内容", input: {props: {cards: []}}},
                {id: "sample-english", label: "英文界面", input: {props: {cards, selected: "panel.存款", ledger: origins}}},
                // 能改：可改的卡右边有“改”，随身物品不能改、那一格空着；英文的 Edit 比“改”宽，看那一格是否放得下、各卡是否仍等宽。
                {id: "editing", label: "能改：可改的卡右边有“改”", input: {props: {cards: cards.map((card, index) => ({...card, editable: index !== 2})), selected: "panel.存款", ledger: origins, editing: true}}},
                {id: "editing-english", label: "能改（英文界面）", input: {props: {cards: cards.map((card, index) => ({...card, editable: index !== 2})), selected: "panel.存款", ledger: origins, editing: true}}},
            ],
            load: async () => (await import("./PanelViewFixture.vue")).default,
        }),
        defineLabFixture<typeof PlotList>({
            component: "PlotList",
            scenes: [
                {id: "sample", label: "计划、待定、已撤销与改动", input: {props: {rows: plot, remaining: 8}}},
                {id: "loading", label: "读取中", input: {props: {rows: [], loading: true}}},
                {id: "empty", label: "还没有情节", input: {props: {rows: []}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows: plot}}},
            ],
            load: async () => (await import("./PlotListFixture.vue")).default,
        }),
        defineLabFixture<typeof EntryPage>({
            component: "EntryPage",
            scenes: [
                {id: "sample", label: "页头与分页", input: page},
                {id: "same-as", label: "马甲、还没出场、选过的章不在了", input: {props: {...page.props, name: "哥哥", summary: "星瑕扮成的男生", sameAs: {id: "xingxia", name: "星瑕"}, notAppeared: true, positionGone: true}, model: {...page.model, position: "1:end"}}},
                {id: "disconnected", label: "世界已断开", input: {props: {...page.props, disconnected: true}, model: page.model}},
                {id: "read-only", label: "世界只读", input: {props: {...page.props, readOnly: "不确定世界里写进去了什么，先不能写"}, model: page.model}},
                {id: "loading", label: "读取中", input: {props: {status: "loading" as const}, model: {position: "", planned: false, tab: ""}}},
                {id: "failed", label: "读取失败", input: {props: {status: "failed" as const}, model: {position: "", planned: false, tab: ""}}},
                {id: "missing", label: "找不到", input: {props: {status: "missing" as const}, model: {position: "", planned: false, tab: ""}}},
                {id: "deleted", label: "已删除", input: {props: {status: "deleted" as const, name: "旧设定"}, model: {position: "", planned: false, tab: ""}}},
                {id: "editable", label: "页头可编辑：改名字、简介、别名，更多里有移动与加去设定组", input: {props: {...page.props, editable: true, aliases: ["小瑕", "夜王"], removableGroup: "人物"}, model: {...page.model, tab: "data:character"}}},
                {id: "editable-blocked", label: "页头可编辑但算着计划：入口禁用", input: {props: {...page.props, editable: true, editReason: "先不算计划", aliases: ["小瑕"]}, model: {...page.model, planned: true}}},
                {id: "deleted-restorable", label: "已删除、可以恢复", input: {props: {status: "deleted" as const, name: "旧设定", editable: true}, model: {position: "", planned: false, tab: ""}}},
                {id: "editable-english", label: "页头可编辑（英文界面）", input: {props: {...page.props, editable: true, aliases: ["Xia"], removableGroup: "Person"}, model: page.model}},
                {id: "sample-english", label: "英文界面", input: page},
                // 看法菜单（输出 9、54）：设定组分页留箭头格，选中的显出；选中的再点开菜单。不在缺省看法时分页上写看法名。
                ...(() => {
                    const lookTabs = tabs.map((tab) => (tab.removable === true ? {...tab, looks: true} : tab));
                    const looks = [{value: "card", label: "用户视图"}, {value: "agent", label: "AI视图"}, {value: "raw", label: "原始视图"}];
                    const looksEnglish = [{value: "card", label: "User view"}, {value: "agent", label: "AI view"}, {value: "raw", label: "Raw view"}];
                    return [
                        {id: "looks", label: "看法菜单：选中的设定组分页上有箭头，再点开菜单", input: {props: {...page.props, editable: true, tabs: lookTabs, looks}, model: {...page.model, tab: "data:character", look: "card"}}},
                        {id: "looks-agent", label: "看法菜单：在 AI视图，分页上写着", input: {props: {...page.props, editable: true, tabs: lookTabs, looks}, model: {...page.model, tab: "data:panel", look: "agent"}}},
                        {id: "looks-english", label: "看法菜单（英文界面）", input: {props: {...page.props, editable: true, tabs: lookTabs, looks: looksEnglish}, model: {...page.model, tab: "data:character", look: "raw"}}},
                    ];
                })(),
            ],
            load: async () => (await import("./EntryPageFixture.vue")).default,
        }),
        defineLabFixture<typeof ConfirmBar>({
            component: "ConfirmBar",
            scenes: [
                {id: "number", label: "改一个数：预览写回哪里与带来的变化", input: {props: {label: "存款", kind: "number" as const, unit: "元", intents: ["creative" as const, "story" as const], preview: {route: "改第 2 章“领了打工的工资”那一笔", impact: ["少了 1 条待处理", "魔力跟着变成 3,000"]}}, model: {value: "2,800", intent: "creative" as const}}},
                {id: "accumulated", label: "累出来的数：保存不可用", input: {props: {label: "存款", kind: "number" as const, unit: "元", intents: ["creative" as const, "story" as const], error: "这个数是几笔累出来的：改其中一笔，或者记一笔", locked: true}, model: {value: "500", intent: "creative" as const}}},
                {id: "text", label: "改文字，只有“改设定”", input: {props: {label: "外观", kind: "text" as const, intents: ["creative" as const], preview: {route: "改初值", impact: []}}, model: {value: "银发，左眼下有颗痣", intent: "creative" as const}}},
                {id: "conflict", label: "这个值刚刚变了", input: {props: {label: "状态", kind: "enum" as const, options: ["入学", "休学", "毕业"], intents: ["creative" as const, "story" as const], preview: {route: "在第 3 章记一条变更", impact: []}, error: "这个值刚刚变了"}, model: {value: "休学", intent: "story" as const}}},
                {id: "unknown", label: "不确定有没有写进去", input: {props: {label: "存款", kind: "number" as const, intents: ["creative" as const], preview: {route: "改初值", impact: []}, error: "不确定这次改动有没有写进去", recheck: true}, model: {value: "800", intent: "creative" as const}}},
                {id: "number-english", label: "英文界面", input: {props: {label: "Savings", kind: "number" as const, unit: "", intents: ["creative" as const, "story" as const], preview: {route: "Changes the initial value", impact: ["Nothing else changes"]}}, model: {value: "800", intent: "creative" as const}}},
                {id: "inline-since", label: "就地改：二选一写落点，没有别的变化时不写预览", input: {props: {variant: "inline" as const, rows: 1, label: "年龄", kind: "text" as const, intents: ["creative" as const, "story" as const], intentLabels: {creative: "从最初起", story: "从第 3 章起"}, noteFallback: "年龄变成 十八", preview: {route: "改最初的值", impact: []}}, model: {value: "十八", intent: "creative" as const, note: ""}}},
                {id: "inline-note", label: "就地改：选剧情里变了，多一行“发生了什么”", input: {props: {variant: "inline" as const, rows: 1, label: "年龄", kind: "text" as const, intents: ["creative" as const, "story" as const], intentLabels: {creative: "从最初起", story: "从第 3 章起"}, noteFallback: "年龄变成 十八", preview: {route: "在第 3 章末尾记一条变更", impact: []}}, model: {value: "十八", intent: "story" as const, note: ""}}},
                {id: "inline-same-chapter", label: "就地改：值就来自所选的那一章", input: {props: {variant: "inline" as const, rows: 1, label: "现在在哪", kind: "text" as const, intents: ["creative" as const, "story" as const], intentLabels: {creative: "改第 3 章那一笔", story: "第 3 章里又变了"}, noteFallback: "现在在哪变成 学院宿舍", preview: {route: "改第 3 章“搬家”那一笔", impact: []}}, model: {value: "学院宿舍", intent: "creative" as const, note: ""}}},
                {id: "inline-passage", label: "就地改：成段的文字（Ctrl+回车保存）", input: {props: {variant: "inline" as const, rows: 3, label: "性格", kind: "text" as const, intents: ["creative" as const, "story" as const], intentLabels: {creative: "从最初起", story: "从第 3 章起"}, noteFallback: "性格变了", preview: {route: "改最初的值", impact: []}}, model: {value: "迟钝，情商不高，做事认真。嘴硬心软，其实很在意妹妹。", intent: "creative" as const, note: ""}}},
                {id: "inline-impact", label: "就地改：变化多于一条时收成“还有 N 项”", input: {props: {label: "存款", kind: "number" as const, unit: "元", intents: ["creative" as const, "story" as const], preview: {route: "改第 2 章“领了打工的工资”那一笔", impact: ["少了 1 条待处理", "魔力跟着变成 3,000", "等级跟着变成 4"]}, variant: "inline" as const}, model: {value: "2,800", intent: "creative" as const}}},
                {id: "inline-conflict", label: "就地改：这个值刚刚变了，有原因时只写原因", input: {props: {label: "现在穿的", kind: "suggest" as const, options: ["学院制服", "便服"], intents: ["creative" as const, "story" as const], preview: {route: "在第 3 章记一条变更", impact: []}, error: "这个值刚刚变了", variant: "inline" as const}, model: {value: "便服", intent: "story" as const}}},
                {id: "inline-unknown", label: "就地改：不确定有没有写进去，“再查一次”在按钮那一行", input: {props: {label: "性别", kind: "suggest" as const, options: ["男", "女", "不明"], intents: ["creative" as const], error: "不确定这次改动有没有写进去", recheck: true, variant: "inline" as const}, model: {value: "女", intent: "creative" as const}}},
                {id: "inline-english", label: "就地改（英文界面）", input: {props: {label: "Savings", kind: "number" as const, unit: "", intents: ["creative" as const, "story" as const], preview: {route: "Changes the step “Got paid for the part-time job” in Chapter 2", impact: ["1 fewer pending", "Mana becomes 3,000", "Level becomes 4"]}, error: "This value just changed", variant: "inline" as const}, model: {value: "2,800", intent: "creative" as const}}},
            ],
            load: async () => (await import("./ConfirmBarFixture.vue")).default,
        }),
        defineLabFixture<typeof SuggestInput>({
            component: "SuggestInput",
            scenes: [
                {id: "empty", label: "空着：获得焦点时列出建议值", input: {props: {label: "性别", suggestions: ["男", "女", "不明"]}, model: {modelValue: ""}}},
                {id: "typed", label: "写了建议值之外的字", input: {props: {label: "性别", suggestions: ["男", "女", "不明"]}, model: {modelValue: "双性"}}},
                {id: "empty-english", label: "英文界面", input: {props: {label: "Gender", suggestions: ["Male", "Female", "Unknown"]}, model: {modelValue: ""}}},
                {id: "inline", label: "嵌在编辑卡里：列着全部，当前值打勾", input: {props: {label: "性别", suggestions: ["男", "女", "不明", "无"], inline: true}, model: {modelValue: "女"}}},
                {id: "inline-many", label: "嵌在编辑卡里、建议值多：列表在里面滚，方向键走到看不见的一项时滚到露出它", input: {props: {label: "身份", suggestions: ["学生", "教师", "医生", "护士", "警察", "律师", "厨师", "司机", "作家", "画家", "商人", "军人"], inline: true}, model: {modelValue: ""}}},
            ],
            load: async () => (await import("./SuggestInputFixture.vue")).default,
        }),
        defineLabFixture<typeof RecordForm>({
            component: "RecordForm",
            scenes: [
                {id: "exact", label: "精确档：一句话与变化量", input: {props: {}, model: {text: "领了工资", delta: "+3000"}}},
                {id: "semantic", label: "语义档：只有一句话", input: {props: {semantic: true}, model: {text: "白灵替她挡了一次", delta: ""}}},
                {id: "blocked", label: "初值上不能记", input: {props: {blockedReason: "先选一章"}, model: {text: "", delta: ""}}},
                {id: "failed", label: "上一次没记进去", input: {props: {error: "这个值刚刚变了"}, model: {text: "领了工资", delta: "+3000"}}},
                {id: "exact-english", label: "英文界面", input: {props: {}, model: {text: "", delta: ""}}},
            ],
            load: async () => (await import("./RecordFormFixture.vue")).default,
        }),
        defineLabFixture<typeof EntryPageNav>({
            component: "EntryPageNav",
            scenes: (() => {
                const items = [
                    {value: "data:character", label: "人物", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true},
                    {value: "data:look", label: "形象", iconClass: "i-lucide-shirt", segment: "own" as const, removable: true},
                    {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own" as const},
                    {value: "data:panel", label: "数值", iconClass: "i-lucide-gauge", segment: "own" as const, removable: true},
                    {value: "data:knowing", label: "知道什么", iconClass: "i-lucide-key-round", segment: "own" as const, removable: true},
                    {value: "data:attitude", label: "目标与态度", iconClass: "i-lucide-target", segment: "own" as const, removable: true},
                    {value: "extra:experience", label: "经历", iconClass: "i-lucide-footprints", segment: "view" as const},
                    {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 12},
                ];
                return [
                    {id: "sample", label: "人物：设定组、文字与看法两段，末尾“添加一组设定”", input: {props: {items, canAdd: true, panelId: "lab-panel"}, model: {modelValue: "data:character"}}},
                    {id: "new", label: "空作品里刚新建：没有看法一段", input: {props: {items: items.slice(0, 3), canAdd: true, panelId: "lab-panel"}, model: {modelValue: "data:character"}}},
                    {id: "blocked", label: "写不了：添加不可用", input: {props: {items, canAdd: true, addReason: "先不算计划", panelId: "lab-panel"}, model: {modelValue: "plot"}}},
                    {id: "sample-english", label: "英文界面", input: {props: {items: [{value: "data:character", label: "Person", iconClass: "i-lucide-user-round", segment: "own" as const}, {value: "text", label: "Text", iconClass: "i-lucide-file-text", segment: "own" as const}, {value: "plot", label: "Story events", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 3}], canAdd: true, panelId: "lab-panel"}, model: {modelValue: "text"}}},
                    // 看法：设定组的行留箭头格、选中的显出；看法名单独一格，名字长时标题先截（168 像素一栏）。
                    {id: "looks", label: "看法：选中的行写着 AI视图，标题长时先截标题", input: {props: {items: items.map((item) => (item.removable === true ? {...item, looks: true} : item)), canAdd: true, panelId: "lab-panel", menus: true, note: "AI视图"}, model: {modelValue: "data:attitude"}}},
                    {id: "looks-english", label: "看法（英文界面）", input: {props: {items: [{value: "data:character", label: "Person", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true, looks: true}, {value: "data:attitude", label: "Goals and attitudes", iconClass: "i-lucide-target", segment: "own" as const, removable: true, looks: true}, {value: "text", label: "Text", iconClass: "i-lucide-file-text", segment: "own" as const}], canAdd: true, panelId: "lab-panel", menus: true, note: "Raw view"}, model: {modelValue: "data:attitude"}}},
                ];
            })(),
            load: async () => (await import("./EntryPageNavFixture.vue")).default,
        }),
        ...(() => {
            type Group = "canon" | "plot" | "other";
            const item = (value: string, label: string, iconClass: string, group: Group, extra: {kinds?: string[]; present?: boolean; restore?: boolean} = {}) => ({value, label, iconClass, group, kinds: extra.kinds ?? [], present: extra.present ?? false, restore: extra.restore ?? false});
            const PERSON = ["人物"];
            // 人物条目：人物、形象已经有了，数值去掉过；适用于人物的排在最前。
            const person = [
                item("nbook.canon.person", "人物", "i-lucide-user-round", "canon", {kinds: PERSON, present: true}),
                item("nbook.canon.look", "形象", "i-lucide-shirt", "canon", {kinds: PERSON, present: true}),
                item("nbook.canon.skills", "技能", "i-lucide-sparkles", "canon", {kinds: PERSON}),
                item("nbook.canon.panel", "数值", "i-lucide-gauge", "canon", {restore: true}),
                item("nbook.canon.inventory", "物品栏", "i-lucide-backpack", "canon"),
                item("nbook.canon.place", "地点", "i-lucide-map-pin", "canon"),
                item("nbook.plot.knowing", "知道什么", "i-lucide-key-round", "plot", {kinds: PERSON}),
                item("nbook.plot.attitude", "目标与态度", "i-lucide-target", "plot", {kinds: PERSON}),
                item("a.test.badge", "徽章", "i-lucide-award", "other"),
            ];
            const presets = [
                {id: "basic", label: "基本", components: ["nbook.canon.person", "nbook.canon.look"]},
                {id: "main", label: "主要角色", components: ["nbook.canon.person", "nbook.canon.look", "nbook.canon.panel", "nbook.plot.knowing", "nbook.plot.attitude"]},
            ];
            // 三十多个类型：列表封顶，在里面滚，搜索框与预设留在上面。
            const many = [
                ...person,
                ...[["关系", "i-lucide-users"], ["组织架构", "i-lucide-network"], ["势力范围", "i-lucide-flag"], ["地理", "i-lucide-mountain"], ["气候", "i-lucide-cloud-sun"], ["历史", "i-lucide-scroll"], ["货币", "i-lucide-coins"], ["魔法体系", "i-lucide-wand-sparkles"], ["咒语", "i-lucide-book-open"], ["契约", "i-lucide-file-signature"], ["职业", "i-lucide-briefcase"], ["称号", "i-lucide-crown"], ["病症", "i-lucide-heart-pulse"], ["饮食", "i-lucide-utensils"], ["服饰规范", "i-lucide-shirt"], ["节日", "i-lucide-party-popper"], ["语言", "i-lucide-languages"]].map(([label, icon], index) => item(`nbook.canon.extra${String(index)}`, label!, icon!, "canon")),
                ...[["伏笔", "i-lucide-bookmark"], ["秘密", "i-lucide-lock"], ["誓言", "i-lucide-hand"]].map(([label, icon], index) => item(`nbook.plot.extra${String(index)}`, label!, icon!, "plot")),
                ...[["好感度", "i-lucide-heart"], ["战斗力", "i-lucide-swords"], ["日程", "i-lucide-calendar"], ["相册", "i-lucide-images"]].map(([label, icon], index) => item(`a.test.extra${String(index)}`, label!, icon!, "other")),
            ];
            const english = [
                item("nbook.canon.person", "Person", "i-lucide-user-round", "canon", {kinds: ["Person"], present: true}),
                item("nbook.canon.skills", "Skills", "i-lucide-sparkles", "canon", {kinds: ["Person"]}),
                item("nbook.canon.panel", "Stats", "i-lucide-gauge", "canon", {restore: true}),
                item("nbook.canon.inventory", "Inventory", "i-lucide-backpack", "canon"),
                item("nbook.plot.knowing", "What they know", "i-lucide-key-round", "plot", {kinds: ["Person"]}),
                item("a.test.badge", "Badges", "i-lucide-award", "other"),
            ];
            const englishPresets = [{id: "main", label: "Main character", components: ["nbook.canon.person", "nbook.canon.panel", "nbook.plot.knowing"]}];
            return [
                defineLabFixture<typeof ComponentChecklist>({
                    component: "ComponentChecklist",
                    scenes: [
                        {id: "person", label: "人物条目：预设一排，适用的在最前，已添加的勾着，去掉过的写“恢复”", input: {props: {items: person, kind: "人物", presets}, model: {modelValue: []}}},
                        {id: "checked", label: "勾了两组", input: {props: {items: person, kind: "人物", presets}, model: {modelValue: ["nbook.canon.skills", "nbook.plot.knowing"]}}},
                        {id: "no-kind", label: "没有种类：没有“适用于”与预设", input: {props: {items: person, kind: ""}, model: {modelValue: []}}},
                        {id: "many", label: "三十多个设定组：列表封顶、在里面滚", input: {props: {items: many, kind: "人物", presets, maxHeight: "22rem"}, model: {modelValue: []}}},
                        {id: "person-english", label: "英文界面", input: {props: {items: english, kind: "Person", presets: englishPresets}, model: {modelValue: []}}},
                    ],
                    load: async () => (await import("./ComponentChecklistFixture.vue")).default,
                }),
                defineLabFixture<typeof AddComponentDialog>({
                    component: "AddComponentDialog",
                    scenes: [
                        {id: "person", label: "人物条目：预设、按组列出", input: {props: {items: person, kind: "人物", presets}, model: {open: true}}},
                        {id: "many", label: "三十多个设定组：列表在对话框里滚", input: {props: {items: many, kind: "人物", presets}, model: {open: true}}},
                        {id: "failed", label: "加的时候别处已经加上了其中一组", input: {props: {items: person, kind: "人物", presets, error: "“技能”这组设定已经加上了"}, model: {open: true}}},
                        {id: "person-english", label: "英文界面", input: {props: {items: english, kind: "Person", presets: englishPresets}, model: {open: true}}},
                    ],
                    load: async () => (await import("./AddComponentDialogFixture.vue")).default,
                }),
            ];
        })(),
        defineLabFixture<typeof ComponentAgentView>({
            component: "ComponentAgentView",
            scenes: [
                {id: "panel", label: "数值：给模型的那一节", input: {props: {position: "第 2 章末尾", text: "【数值】（设定组 panel，可以加字段）\n- 存款 = 900｜数｜单位 元\n- 魔力上限 = 3000｜数\n- 魔力 = 未知｜数（语义档：改起点或记一句）\n- 物品｜列表｜2 项\n  - [wand] 魔杖｜数量=1\n  - [cape] 斗篷｜数量=1"}}},
                {id: "long-line", label: "很长的一行折行", input: {props: {position: "最初", text: "【人物】（设定组 character）\n- 性格 = 黑发，左眼下有颗痣，平时话少，遇到和妹妹有关的事会突然变得很固执，打工的地方没人知道她是魔法少女，也没人知道她其实是男生变的｜文字"}}},
                {id: "loading", label: "设定组类型还在读", input: {props: {position: "第 2 章末尾", text: "", loading: true}}},
                {id: "failed", label: "设定组类型读失败", input: {props: {position: "第 2 章末尾", text: "", failed: "世界已断开"}}},
                {id: "panel-english", label: "英文界面", input: {props: {position: "End of chapter 2", text: "【数值】（设定组 panel）\n- 存款 = 900｜数｜单位 元"}}},
            ],
            load: async () => (await import("./ComponentAgentViewFixture.vue")).default,
        }),
        defineLabFixture<typeof ComponentRawView>({
            component: "ComponentRawView",
            scenes: (() => {
                const initial = {type: "nbook.canon.panel", version: 1, enabled: true, fields: {存款: 1000}, declared: [{id: "存款", label: "存款", kind: "number", unit: "元"}]};
                const step = (id: string, chapter: string, text: string, value: number) => ({id, kind: "written", text, at: {kind: "chapter", chapter, key: 10}, status: "active", patches: [{op: "add", at: {entry: "xingxia", path: "panel.存款"}, value}]});
                const changes = [step("c1", "1", "领了工资", 200), step("c2", "2", "买了书", -300)];
                return [
                    {id: "panel", label: "数值：初值与两条变更", input: {props: {initial, changes, total: 2, remaining: 0, initialLoading: false, changesLoading: false, failed: null}}},
                    {id: "more", label: "变更多于一页：再显示", input: {props: {initial, changes, total: 45, remaining: 43, initialLoading: false, changesLoading: false, failed: null}}},
                    {id: "added-by-change", label: "初值里没有、也没有变更", input: {props: {changes: [], total: 0, remaining: 0, initialLoading: false, changesLoading: false, failed: null}}},
                    {id: "loading", label: "读取中", input: {props: {changes: [], total: 0, remaining: 0, initialLoading: true, changesLoading: true, failed: null}}},
                    {id: "changes-first", label: "变更先读回来、初值还在读", input: {props: {changes, total: 2, remaining: 0, initialLoading: true, changesLoading: false, failed: null}}},
                    {id: "failed", label: "读失败", input: {props: {initial, changes, total: 2, remaining: 0, initialLoading: false, changesLoading: false, failed: "世界已断开"}}},
                    {id: "panel-english", label: "英文界面", input: {props: {initial, changes, total: 45, remaining: 43, initialLoading: false, changesLoading: false, failed: null}}},
                ];
            })(),
            load: async () => (await import("./ComponentRawViewFixture.vue")).default,
        }),
        defineLabFixture<typeof ViewPointPicker>({
            component: "ViewPointPicker",
            scenes: (() => {
                const titles = ["雨夜的来客", "妹妹的布丁", "学院开学", "旧校舍的钟", "第一次变身", "对策委员会", "哥哥的秘密", "失物招领", "夏日祭", "回不去的那天", "星瑕的信", "雨停以后"];
                const chapterOf = (n: number, title: string | null) => ({chapter: `c${String(n)}`, index: n, title, start: `c${String(n)}:start`, end: `c${String(n)}:end`});
                const three = [chapterOf(1, "好哥哥真难当"), chapterOf(2, "用钱说话"), chapterOf(3, null)];
                const many = Array.from({length: 60}, (_, index) => chapterOf(index + 1, titles[index % titles.length]!));
                const lines = [{id: "main", name: null, depth: 0}, {id: "l1", name: "重来的那个晚上", depth: 1}, {id: "l2", name: "梦里的那一天", depth: 2}];
                const english = [chapterOf(1, "The Visitor on a Rainy Night"), chapterOf(12, "The Long Road Home Begins")];
                return [
                    {id: "sample", label: "第 3 章末尾，有分支线与计划", input: {props: {chapters: three, canPlan: true, lineOptions: lines, resolvedLine: "main"}, model: {position: "c3:end", planned: false, line: ""}}},
                    {id: "main-only", label: "只有主线：不提线", input: {props: {chapters: three, canPlan: true}, model: {position: "c3:end", planned: false, line: ""}}},
                    {id: "pinned", label: "固定看一条分支线", input: {props: {chapters: three, lineOptions: lines, resolvedLine: "l1"}, model: {position: "c2:end", planned: false, line: "l1"}}},
                    {id: "planned", label: "算上计划", input: {props: {chapters: three, canPlan: true, lineOptions: lines, resolvedLine: "main"}, model: {position: "c3:end", planned: true, line: ""}}},
                    {id: "many", label: "60 章：菜单里能搜、滚到当前章", input: {props: {chapters: many, canPlan: true, lineOptions: lines, resolvedLine: "main"}, model: {position: "c37:end", planned: false, line: ""}}},
                    {id: "initial", label: "在“最初”：往前一步不可用", input: {props: {chapters: three}, model: {position: "initial", planned: false, line: ""}}},
                    {id: "not-appeared", label: "到这里还没出场", input: {props: {chapters: three, notAppeared: true}, model: {position: "c1:end", planned: false, line: ""}}},
                    {id: "gone", label: "原来选的那一章不在了", input: {props: {chapters: three, positionGone: true}, model: {position: "c3:end", planned: false, line: ""}}},
                    {id: "locked", label: "有没提交的主文字：锁着", input: {props: {chapters: three, canPlan: true, lineOptions: lines, resolvedLine: "main", locked: "先提交或放弃正在写的主文字"}, model: {position: "c3:end", planned: true, line: ""}}},
                    {id: "only-plans", label: "空作品里只有计划", input: {props: {chapters: [], canPlan: true}, model: {position: "initial", planned: false, line: ""}}},
                    {id: "sample-english", label: "英文界面", input: {props: {chapters: english, canPlan: true, lineOptions: lines, resolvedLine: "l2"}, model: {position: "c12:end", planned: true, line: ""}}},
                    // 英文、长线名、还没出场：标记与结论截断，390 宽不撑出横向滚动。
                    {id: "long-title-english", label: "英文、长线名、还没出场", input: {props: {chapters: english, notAppeared: true, lineOptions: [{id: "main", name: null, depth: 0}, {id: "l9", name: "The Night Everything Was Undone Again", depth: 1}], resolvedLine: "l9"}, model: {position: "c12:end", planned: false, line: "l9"}}},
                ];
            })(),
            load: async () => (await import("./ViewPointPickerFixture.vue")).default,
        }),
        defineLabFixture<typeof PageNotices>({
            component: "PageNotices",
            scenes: [
                {id: "sample", label: "刚保存了一次就地改：记在第 3 章", input: {props: {notice: {revision: "r1", title: "改外观", where: "第 3 章"}}}},
                {id: "initial", label: "改的是最初的值", input: {props: {notice: {revision: "r1", title: "改年龄", where: "最初"}}}},
                {id: "no-where", label: "改条目本身：没有位置", input: {props: {notice: {revision: "r1", title: "加上“形象”这组设定"}}}},
                {id: "with-agent", label: "Agent 也改了（之前还改过两次）", input: {props: {notice: {revision: "r1", title: "改外观", where: "第 3 章"}, agent: {revision: "r2", title: "给星瑕加别名小瑕", earlier: 2}}}},
                {id: "agent-undone", label: "Agent 那一次已还原", input: {props: {agent: {revision: "r2", title: "给星瑕加别名小瑕", earlier: 0, undone: true}}}},
                {id: "error", label: "页面自己的写入失败", input: {props: {error: "这个条目在你打开以后被别处改过，重读以后再试一次"}}},
                {id: "long", label: "很长的标题截断", input: {props: {notice: {revision: "r1", title: "记了一笔：在第三魔法学院门口被一个自称是星瑕远房表哥的人借走了三百块", where: "第 12 章"}}}},
                {id: "sample-english", label: "英文界面", input: {props: {notice: {revision: "r1", title: "Edit appearance", where: "Chapter 3"}, agent: {revision: "r2", title: "Add alias", earlier: 1}}}},
            ],
            load: async () => (await import("./PageNoticesFixture.vue")).default,
        }),
        defineLabFixture<typeof NewEntryDialog>({
            component: "NewEntryDialog",
            scenes: (() => {
                const draft = {name: "", kind: "", kindChosen: "", folder: "", folderTouched: false, parent: null as string | null, types: [] as string[], typesTouched: false, sameAs: null as string | null, appears: null as string | null};
                // 种类的候选：登记的人物、组织、地点、物品在前，用过的“魔法”接在后面；点“人物”勾上人物与形象。
                const options = {kinds: ["人物", "组织", "地点", "物品", "魔法"], kindDefaults: {人物: ["nbook.canon.person", "nbook.canon.look"], 组织: [], 地点: [], 物品: []}, entries: [{id: "xingxia", name: "星瑕"}, {id: "academy", name: "第三魔法学院"}], items: [
                    {value: "nbook.canon.person", label: "人物", iconClass: "i-lucide-user-round", group: "canon" as const, kinds: ["人物"], present: false, restore: false},
                    {value: "nbook.canon.look", label: "形象", iconClass: "i-lucide-shirt", group: "canon" as const, kinds: ["人物"], present: false, restore: false},
                    {value: "nbook.canon.panel", label: "数值", iconClass: "i-lucide-gauge", group: "canon" as const, kinds: [], present: false, restore: false},
                    {value: "nbook.plot.knowing", label: "知道什么", iconClass: "i-lucide-key-round", group: "plot" as const, kinds: ["人物"], present: false, restore: false},
                    {value: "nbook.plot.attitude", label: "目标与态度", iconClass: "i-lucide-target", group: "plot" as const, kinds: ["人物"], present: false, restore: false},
                ], kindPresets: {人物: [{id: "basic", label: "基本", components: ["nbook.canon.person", "nbook.canon.look"]}, {id: "main", label: "主要角色", components: ["nbook.canon.person", "nbook.canon.look", "nbook.canon.panel", "nbook.plot.knowing", "nbook.plot.attitude"]}]}, chapters: [{id: "1", index: 1}, {id: "2", index: 2}]};
                return [
                    {id: "empty", label: "空的：名字为空时不能新建", input: {props: options, model: {open: true, draft}}},
                    {id: "filled", label: "在星瑕下面建一个物品，启用面板", input: {props: options, model: {open: true, draft: {...draft, name: "魔杖", kind: "物品", kindChosen: "物品", folder: "物品", parent: "xingxia", types: ["nbook.canon.panel"]}}}},
                    {id: "person", label: "新建人物：勾上人物与形象，有人物的预设", input: {props: options, model: {open: true, draft: {...draft, name: "星瑾", kind: "人物", kindChosen: "人物", folder: "人物", types: ["nbook.canon.person", "nbook.canon.look"]}}}},
                    {id: "failed", label: "没建成", input: {props: {...options, error: "这次改动没有成功"}, model: {open: true, draft: {...draft, name: "魔杖", kind: "物品", kindChosen: "物品", folder: "物品"}}}},
                    {id: "empty-english", label: "英文界面", input: {props: options, model: {open: true, draft}}},
                ];
            })(),
            load: async () => (await import("./NewEntryDialogFixture.vue")).default,
        }),
        defineLabFixture<typeof WorldBanners>({
            component: "WorldBanners",
            scenes: [
                {id: "disconnected", label: "世界已断开", input: {props: {disconnected: true}}},
                {id: "read-only", label: "世界只读", input: {props: {readOnly: "世界只读：日志的版本号重复了"}}},
                {id: "both", label: "断开又只读", input: {props: {disconnected: true, readOnly: "不确定世界里写进去了什么，先不能写"}}},
                {id: "disconnected-english", label: "英文界面", input: {props: {disconnected: true}}},
            ],
            load: async () => (await import("./WorldBannersFixture.vue")).default,
        }),
        defineLabFixture<typeof RevertDialog>({
            component: "RevertDialog",
            scenes: [
                {id: "ready", label: "没有依赖：写带来的变化", input: {props: {title: "改外观", phase: "ready" as const, impact: ["星瑕的外观：银发 → 黑发", "少了 1 条待处理"]}, model: {open: true}}},
                {id: "dependents", label: "有依赖：列出后面依赖它的改动", input: {props: {title: "领了打工的工资", phase: "dependents" as const, dependents: ["改第 2 章“领了打工的工资”那一笔", "记了一笔：买了书", null], moreDependents: 4}, model: {open: true}}},
                {id: "previewing", label: "正在预览", input: {props: {title: "改外观", phase: "previewing" as const}, model: {open: true}}},
                {id: "not-revertable", label: "章序调整不能还原", input: {props: {title: "调整章序", phase: "blocked" as const, reason: "调整章序的改动不能还原"}, model: {open: true}}},
                {id: "busy", label: "别人正在写", input: {props: {title: "改外观", phase: "ready" as const, impact: ["别的都不变"], reason: "第 3 章记账正在写，写完以后才能改"}, model: {open: true}}},
                {id: "unknown", label: "不确定有没有还原", input: {props: {title: "改外观", phase: "ready" as const, impact: ["星瑕的外观：银发 → 黑发"], error: "不确定这次改动有没有写进去", recheck: true}, model: {open: true}}},
                {id: "saving", label: "还原中", input: {props: {title: "改外观", phase: "ready" as const, impact: ["星瑕的外观：银发 → 黑发"], saving: true}, model: {open: true}}},
                {id: "ready-english", label: "英文界面", input: {props: {title: "Edit Appearance", phase: "ready" as const, impact: ["Xingxia's Appearance: silver → black"]}, model: {open: true}}},
            ],
            load: async () => (await import("./RevertDialogFixture.vue")).default,
        }),
        defineLabFixture<typeof ReceiptPage>({
            component: "ReceiptPage",
            scenes: (() => {
                const model = {
                    title: "改存款",
                    by: "作者",
                    time: "2026-11-11 14:03",
                    what: "改设定",
                    sections: [
                        {kind: "modify" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "xingxia"}, name: "星瑕", fields: [{label: "存款", before: "500 元", after: "800 元"}, {label: "外观", before: "黑发，左眼下有颗痣", after: "银发，左眼下有颗痣"}]}]},
                    ],
                    impact: ["少了 1 条待处理", "星瑕的魔力：2,700 → 3,000"],
                    reverts: [],
                };
                const created = {
                    ...model,
                    title: "新建“魔杖”",
                    sections: [{kind: "create" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "wand"}, name: "魔杖", fields: []}]}],
                    impact: ["别的都不变"],
                };
                const reverted = {
                    ...model,
                    title: "还原“改存款”",
                    what: "还原",
                    sections: [{kind: "modify" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "xingxia"}, name: "星瑕", fields: [{label: "存款", before: "800 元", after: "500 元"}]}]}, {kind: "delete" as const, items: [{key: "2", ref: null, name: "被扒手偷了", fields: []}]}],
                    reverts: ["r1"],
                };
                const reorder = {...model, title: "调整章序", what: "调整章序", sections: [{kind: "chapters" as const, items: [{key: "1", ref: null, name: "", fields: [{label: "章序", before: "第 1 章：入学、第 2 章：打工", after: "第 2 章：打工、第 1 章：入学"}]}]}], impact: ["别的都不变"]};
                return [
                    {id: "edit", label: "改了两个字段", input: {props: {status: "normal" as const, model}}},
                    {id: "dependents", label: "后面有改动依赖它", input: {props: {status: "normal" as const, model, dependents: 2}}},
                    {id: "created", label: "新建一个条目", input: {props: {status: "normal" as const, model: created}}},
                    {id: "reverted", label: "一次还原：还原的是哪一次", input: {props: {status: "normal" as const, model: reverted, reverted: [{id: "r1", title: "改存款"}]}}},
                    {id: "reorder", label: "章序调整不能还原", input: {props: {status: "normal" as const, model: reorder, revertBlocked: "调整章序的改动不能还原"}}},
                    {id: "read-only", label: "世界只读", input: {props: {status: "normal" as const, model, readOnly: "世界只读：日志的版本号重复了", revertBlocked: "世界只读：日志的版本号重复了"}}},
                    {id: "loading", label: "读取中", input: {props: {status: "loading" as const}}},
                    {id: "missing", label: "找不到", input: {props: {status: "missing" as const}}},
                    {id: "edit-english", label: "英文界面", input: {props: {status: "normal" as const, model: {...model, title: "Edit Savings", by: "Author", what: "Setting change", sections: [{kind: "modify" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "xingxia"}, name: "Xingxia", fields: [{label: "Savings", before: "500", after: "800"}]}]}], impact: ["Nothing else changes"]}}}},
                ];
            })(),
            load: async () => (await import("./ReceiptPageFixture.vue")).default,
        }),
        defineLabFixture<typeof RevisionsView>({
            component: "RevisionsView",
            scenes: (() => {
                const row = (id: string, title: string, meta: string, summary: string, extra: {notRevertable?: boolean; note?: string} = {}) => ({id, title, meta, summary, notRevertable: extra.notRevertable ?? false, note: extra.note ?? ""});
                const rows = [
                    row("r7", "改存款", "作者 · 2026-11-13 14:12", "2 处值变了，少了 1 条待处理"),
                    row("r6", "第 3 章记账", "任务：第 3 章记账 · 2026-11-13 14:08", "4 处值变了，多了 1 条待处理"),
                    row("r5", "还原“改外观”", "作者 · 2026-11-13 14:05", "1 处值变了"),
                    row("r4", "改外观", "作者 · 2026-11-13 14:03", "1 处值变了", {note: "后面有 1 次改动依赖它"}),
                    row("r3", "补上星瑕领工资的那一笔", "Agent · 2026-11-13 13:58", "1 处值变了，1 条情节套不上了"),
                    row("r2", "新建“星瑕”", "作者 · 2026-11-13 13:50", "没有带来别的变化", {note: "后面有 4 次改动依赖它"}),
                    row("r1", "章序调整", "系统 · 2026-11-13 13:49", "没有带来别的变化", {notRevertable: true, note: "调整章序的改动不能还原"}),
                ];
                const chapters = [{value: "all", label: "全部章"}, {value: "1", label: "第 1 章：入学"}, {value: "2", label: "第 2 章：打工"}, {value: "3", label: "第 3 章"}];
                const writers = [{value: "all", label: "全部写入者"}, {value: "author", label: "作者"}, {value: "agent", label: "Agent"}, {value: "task", label: "任务"}, {value: "system", label: "系统"}];
                const model = {chapter: "all", writer: "all"};
                const sample = {props: {status: "normal" as const, rows, more: true, chapters, writers}, model};
                const busy = "第 3 章记账正在写，写完以后才能改";
                const readOnly = "世界只读：日志的版本号重复了";
                return [
                    {id: "sample", label: "七次修订：有依赖的、章序调整、还有更多", input: sample},
                    {id: "current", label: "键盘停在第四行", input: {props: {...sample.props, more: false}, model: {...model, current: "r4"}}},
                    {id: "long-title", label: "很长的标题", input: {props: {...sample.props, more: false, rows: [row("r9", "把第 3 章到第 9 章里所有提到星瑕存款的地方按新的工资标准重新记一遍账", "Agent · 2026-11-13 15:01", "12 处值变了，少了 3 条待处理，2 条情节套不上了"), ...rows.slice(0, 2)]}, model}},
                    {id: "busy", label: "别人正在独占写", input: {props: {...sample.props, revertBlocked: busy}, model}},
                    {id: "read-only", label: "世界只读", input: {props: {...sample.props, revertBlocked: readOnly, readOnly}, model}},
                    {id: "disconnected", label: "世界已断开", input: {props: {...sample.props, revertBlocked: "世界已断开", disconnected: true}, model}},
                    {id: "loading", label: "读取中", input: {props: {status: "loading" as const, rows: [], chapters, writers}, model}},
                    {id: "failed", label: "没有读出来", input: {props: {status: "failed" as const, rows: [], chapters, writers}, model}},
                    {id: "empty", label: "还没有改动", input: {props: {status: "normal" as const, rows: [], chapters, writers}, model}},
                    {id: "empty-filtered", label: "没有符合筛选的", input: {props: {status: "normal" as const, rows: [], chapters, writers}, model: {chapter: "3", writer: "agent"}}},
                    {id: "sample-english", label: "英文界面", input: {props: {...sample.props, more: false, chapters: [{value: "all", label: "All chapters"}], writers: [{value: "all", label: "All writers"}], rows: [row("e2", "Edit Savings", "Author · 2026-11-13 14:12", "2 values changed, 1 fewer pending"), row("e1", "Chapter reorder", "System · 2026-11-13 13:49", "Nothing else changed", {notRevertable: true, note: "Chapter reorders cannot be reverted"})]}, model}},
                ];
            })(),
            load: async () => (await import("./RevisionsViewFixture.vue")).default,
        }),
        ...(() => {
            const rows = (items: readonly [string, string, string][]) => items.map(([key, text, place]) => ({key, text, place}));
            const group = (items: readonly [string, string, string][], extra: {count?: number | null; loading?: boolean; more?: boolean} = {}) => ({rows: rows(items), count: extra.count === undefined ? items.length : extra.count, loading: extra.loading ?? false, more: extra.more ?? false});
            const groups = {
                pending: group([
                    ["check", "星瑕的存款对不上：正文写 2,700，算出来是 24,500", "第 2 章"],
                    ["held", "“订了星瑾小时候最喜欢的那家店”待定", "第 2 章"],
                    ["chain", "传话链断了", "第 3 章第 4 段"],
                ]),
                hints: group([["dup", "“领了工资”的原句在这一章出现了 2 次", "第 1 章"]]),
                handled: group([], {count: 2}),
            };
            const detail = {
                title: "星瑕的存款对不上：正文写 2,700，算出来是 24,500",
                place: "第 2 章",
                quote: {text: "她看了一眼余额：2700。", chapter: "2"},
                facts: [{label: "正文写的数", value: "2,700"}, {label: "算出来的数", value: "24,500"}],
                suspects: [
                    {key: "c3", text: "工资到账，三千左右", place: "第 2 章", estimate: true, target: {kind: "change" as const, id: "c3"}, initial: false},
                    {key: "c2", text: "订了星瑾小时候最喜欢的那家店", place: "第 2 章", estimate: false, target: {kind: "change" as const, id: "c2"}, initial: false},
                    {key: "init", text: "初值", place: "", estimate: false, target: {kind: "entry" as const, id: "xingxia"}, initial: true},
                ],
                links: [{label: "打开条目", target: {kind: "entry" as const, id: "xingxia"}}],
            };
            const held = {title: "“订了星瑾小时候最喜欢的那家店”待定", place: "第 2 章", quote: {text: "她订了那家店。", chapter: "2"}, facts: [{label: "原因", value: "与设定冲突：存款不够"}], suspects: [], links: [{label: "打开这条情节", target: {kind: "change" as const, id: "c2"}}]};
            const handled = {title: "传话链断了", place: "第 3 章第 4 段", quote: null, facts: [{label: "作者当时的决定", value: "有意为之：她是故意不传话的"}], suspects: [], links: [{label: "星瑕", target: {kind: "entry" as const, id: "xingxia"}}, {label: "“她没把话带到”", target: {kind: "change" as const, id: "c5"}}]};
            const sample = {props: {groups, selected: {group: "pending" as const, key: "check"}, detail}, model: {expanded: ["pending" as const]}};
            return [
                defineLabFixture<typeof PendingView>({
                    component: "PendingView",
                    scenes: [
                        {id: "sample", label: "核对点不符：详情有原句、两个数与嫌疑", input: sample},
                        {id: "all-groups", label: "三组都展开", input: {props: {...sample.props, groups: {...groups, handled: group([["chain-old", "传话链断了", "第 1 章"], ["chain-2", "传话链断了", "第 2 章"]])}}, model: {expanded: ["pending" as const, "hints" as const, "handled" as const]}}},
                        {id: "busy", label: "别人正在独占写入、结果不完整", input: {props: {...sample.props, holder: "第 3 章记账", notes: ["这些检查没有算出来：传话链断了", "这些检查所在的插件停用了，没有算：插件的一项检查"]}, model: sample.model}},
                        {id: "no-selection", label: "没有选中", input: {props: {groups}, model: sample.model}},
                        {id: "more-and-hints", label: "一组没列完、“只是提示”展开有项", input: {props: {...sample.props, groups: {...groups, pending: {...groups.pending, more: true}}}, model: {expanded: ["pending" as const, "hints" as const]}}},
                        {id: "disconnected", label: "世界已断开", input: {props: {...sample.props, disconnected: true}, model: sample.model}},
                        {id: "loading", label: "读取中", input: {props: {groups: {pending: group([], {count: null, loading: true}), hints: group([], {count: null}), handled: group([], {count: null})}}, model: sample.model}},
                        {id: "empty", label: "没有待处理的问题", input: {props: {groups: {pending: group([]), hints: group([]), handled: group([])}}, model: sample.model}},
                        {id: "read-only", label: "世界只读", input: {props: {...sample.props, readOnly: "世界只读：日志的版本号重复了"}, model: sample.model}},
                        {id: "sample-english", label: "英文界面", input: {props: {groups: {pending: group([["check", "Xingxia's Savings does not match: the text says 2,700, computed 24,500", "Chapter 2"]]), hints: group([]), handled: group([])}, selected: {group: "pending" as const, key: "check"}, detail: {...detail, title: "Xingxia's Savings does not match: the text says 2,700, computed 24,500", place: "Chapter 2", facts: [{label: "In the text", value: "2,700"}, {label: "Computed", value: "24,500"}], suspects: [{...detail.suspects[0]!, text: "Salary arrived, about three thousand", place: "Chapter 2"}], links: [{label: "Open entry", target: {kind: "entry" as const, id: "xingxia"}}]}}, model: sample.model}},
                    ],
                    load: async () => (await import("./PendingViewFixture.vue")).default,
                }),
                defineLabFixture<typeof PendingDetail>({
                    component: "PendingDetail",
                    scenes: [
                        {id: "check-mismatch", label: "核对点不符", input: {props: {detail}}},
                        {id: "held", label: "待定的情节", input: {props: {detail: held}}},
                        {id: "handled", label: "已处理的插件发现", input: {props: {detail: handled}}},
                        {id: "long-text", label: "很长的原句与链接", input: {props: {detail: {
                            title: "“她在第三章末尾把这些年攒下的钱全部取出来交给了哥哥让他去还清赌债”套不上了",
                            place: "第 3 章",
                            quote: {text: "她把卡里的钱一笔一笔转给哥哥，转到最后余额只剩下一个零头，她盯着那个零头看了很久很久，才想起来今天还没吃饭。", chapter: "3"},
                            facts: [{label: "原因", value: "改完的数超出了范围"}, {label: "让它套不上的那次改动", value: "“把第 3 章到第 9 章里所有提到星瑕存款的地方按新的工资标准重新记一遍账”"}],
                            suspects: [],
                            links: [{label: "打开这条情节", target: {kind: "change" as const, id: "c9"}}, {label: "“她在第三章末尾把这些年攒下的钱全部取出来交给了哥哥让他去还清赌债”", target: {kind: "change" as const, id: "c8"}}, {label: "看那次改动的回执", target: {kind: "receipt" as const, id: "r7"}}],
                        }}}},
                    ],
                    load: async () => (await import("./PendingDetailFixture.vue")).default,
                }),
                defineLabFixture<typeof BreakExclusiveDialog>({
                    component: "BreakExclusiveDialog",
                    scenes: [
                        {id: "confirm", label: "二次确认", input: {props: {holder: "第 3 章记账"}, model: {open: true}}},
                        {id: "saving", label: "解除中", input: {props: {holder: "第 3 章记账", saving: true}, model: {open: true}}},
                        {id: "failed", label: "没有解除", input: {props: {holder: "第 3 章记账", error: "世界已断开"}, model: {open: true}}},
                    ],
                    load: async () => (await import("./BreakExclusiveDialogFixture.vue")).default,
                }),
            ];
        })(),
        defineLabFixture<typeof ChangePage>({
            component: "ChangePage",
            scenes: (() => {
                const model = {
                    text: "被扒手偷了",
                    place: "第 3 章",
                    kind: "已写",
                    status: "active" as const,
                    statusText: "生效",
                    heldReason: "",
                    undoneReason: "",
                    quotes: [{key: "t1", quote: "她摸了摸口袋，钱包不见了", source: "第 3 章正文", chapter: "3"}, {key: "t2", quote: "被偷了大概三百", source: "细纲", chapter: null}],
                    involved: [{id: "xingxia", name: "星瑕"}, {id: "pickpocket", name: "扒手"}],
                    patches: [
                        {index: 0, line: "星瑕的存款 −300", basis: {text: "估计：大概三百", estimate: true}, editable: true, label: "星瑕的存款"},
                        {index: 1, line: "星瑕的样子 → 狼狈", editable: false, label: "星瑕的样子"},
                    ],
                };
                const held = {...model, status: "held" as const, statusText: "待定", heldReason: "待定：与设定冲突。第 2 章末尾的存款是 2,700，扣 300 以后和第 3 章正文写的 2,800 对不上"};
                return [
                    {id: "active", label: "生效的一条：原句、涉及的条目、改动", input: {props: {status: "normal" as const, model}}},
                    {id: "active-editing", label: "改那一笔：确认条在顶上", input: {props: {status: "normal" as const, model}}},
                    {id: "held", label: "待定：写原因与“改成生效”", input: {props: {status: "normal" as const, model: held}}},
                    {id: "activating", label: "改成生效：预览", input: {props: {status: "normal" as const, model: held, activation: {preview: ["少了 1 条待处理", "星瑕的存款：2,700 → 2,400"], previewing: false, error: "", recheck: false, saving: false, locked: false}}}},
                    {id: "activation-invalid", label: "改成生效：校验不过", input: {props: {status: "normal" as const, model: held, activation: {preview: null, previewing: false, error: "没有通过检查：quote does not contain 300", recheck: false, saving: false, locked: true}}}},
                    {id: "blocked", label: "写不了：“改”不可用，章节文件没找到", input: {props: {status: "normal" as const, model, blocked: "第 3 章记账正在写，写完以后才能改", chapterMissing: "3"}}},
                    {id: "missing", label: "找不到", input: {props: {status: "missing" as const}}},
                    {id: "active-english", label: "英文界面", input: {props: {status: "normal" as const, model: {...model, text: "Pickpocketed", place: "Chapter 3", kind: "written", statusText: "in effect", quotes: [{key: "t1", quote: "Her wallet was gone", source: "Chapter 3 text", chapter: "3"}], involved: [{id: "xingxia", name: "Xingxia"}], patches: [{index: 0, line: "Xingxia's Savings −300", basis: {text: "estimate: about 300", estimate: true}, editable: true, label: "Xingxia's Savings"}]}}}},
                ];
            })(),
            load: async () => (await import("./ChangePageFixture.vue")).default,
        }),
    ];
}

/** 首次启动向导（desktop-shell 输出 34）的场景：四步、便携版、写入失败、作品目录还没建、插件主题、英文。 */
function firstRunScenes() {
    const themes = [
        {id: "nbook", name: "NeuroBook", thumbnails: FIRST_RUN_THUMBNAILS.nbook ?? null},
        {id: "macos", name: "macOS", thumbnails: FIRST_RUN_THUMBNAILS.macos ?? null},
        {id: "eye-green", name: "护眼绿", thumbnails: FIRST_RUN_THUMBNAILS["eye-green"] ?? null},
        {id: "eye-sepia", name: "护眼米黄", thumbnails: FIRST_RUN_THUMBNAILS["eye-sepia"] ?? null},
    ];
    const base = {
        open: true,
        step: 1 as const,
        themes,
        theme: "nbook",
        appearance: "system" as const,
        dark: false,
        locales: [{value: "zh-CN", label: "简体中文"}, {value: "en-US", label: "English"}],
        locale: "zh-CN",
        options: {desktopShortcut: true, openAtLogin: false, tray: false},
        shownOptions: ["desktopShortcut", "openAtLogin", "tray"] as Array<"desktopShortcut" | "openAtLogin" | "tray">,
        places: {stateRoot: "C:\\Users\\lin\\AppData\\Local\\NeuroBook", library: "C:\\Users\\lin\\Documents\\NeuroBook"},
        libraryMissing: false,
        error: null,
    };
    return [
        {id: "welcome", label: "第 1 步：欢迎", input: {props: base}},
        {id: "appearance", label: "第 2 步：外观", input: {props: {...base, step: 2 as const}}},
        {id: "appearance-dark", label: "第 2 步：选了暗色", input: {props: {...base, step: 2 as const, appearance: "dark" as const, dark: true, theme: "eye-green"}}},
        {id: "plugin-theme", label: "第 2 步：插件主题没有缩略图，当前是自建主题", input: {props: {...base, step: 2 as const, theme: "user.my-theme", themes: [...themes, {id: "acme.paper", name: "Paper", thumbnails: null}]}}},
        {id: "desktop", label: "第 3 步：桌面", input: {props: {...base, step: 3 as const}}},
        {id: "desktop-portable", label: "第 3 步：便携版只有关窗去向", input: {props: {...base, step: 3 as const, shownOptions: ["tray"] as Array<"desktopShortcut" | "openAtLogin" | "tray">}}},
        {id: "desktop-error", label: "第 3 步：写入失败", input: {props: {...base, step: 3 as const, error: "登录时打开没有改成，回到了原来的值。"}}},
        {id: "ready", label: "第 4 步：准备好了", input: {props: {...base, step: 4 as const}}},
        {id: "ready-missing", label: "第 4 步：作品目录还没建、路径很长", input: {props: {...base, step: 4 as const, libraryMissing: true, places: {stateRoot: "C:\\Users\\a-very-long-user-name-for-testing\\AppData\\Local\\NeuroBook\\with\\a\\deep\\nested\\path\\to\\wrap", library: "D:\\Writing\\NeuroBook"}}}},
        {id: "english", label: "英文界面（第 3 步）", input: {props: {...base, step: 3 as const, locale: "en-US"}}},
        {id: "appearance-english", label: "英文界面（第 2 步）", input: {props: {...base, step: 2 as const, locale: "en-US"}}},
    ];
}

/** 剧情侧的几个零件（plot 插件，docs/specs/plot/author-ui.md 输出 1、8、12、14）：场景用带剧情数据的星瑕样本里的样子手写。 */
function plotFixtures() {
    const name = (text: string, type = "人物") => ({name: text, type});
    const names = {
        xia: name("星瑕"), jin: name("星瑾"), hui: name("彗"), parents: name("父母"), sprite: name("魔法精灵（名字未定）"),
        k1: name("哥哥就是星瑕", "知识点"), k2: name("星瑕做过魔法少女", "知识点"), k3: name("那几年哥哥是被软禁", "知识点"), k4: name("父母没有死", "知识点"),
        g1: name("不让星瑾知道那几年的事", "目标"), g2: name("做个好哥哥", "目标"), g3: name("把星瑾接回家", "目标"), g4: name("弄清哥哥那几年去了哪", "目标"),
        line1: name("做个好哥哥", "剧情线"), line2: name("兄妹的心结", "剧情线"), line3: name("双王", "剧情线"),
    };
    const cell = (degree: AuthorDegree, belief: string | null = null) => ({degree, belief});
    const rows: SecretRow[] = [
        {point: "k1", secrecy: "secret", subject: "xia", people: {hui: cell("knows"), xia: cell("knows"), jin: cell("none")}, others: [], othersTotal: 0, reader: {degree: "knows", suspects: {chapter: "1", paragraph: 8}, knows: {chapter: "1", paragraph: 8}}, reveals: [{plan: "p0", chapter: "1", mode: "explicit", done: true}], decisions: [], guards: []},
        {point: "k2", secrecy: "secret", subject: "xia", people: {hui: cell("knows"), xia: cell("knows"), jin: cell("forgot")}, others: [{person: "sprite", degree: "knows"}], othersTotal: 1, reader: {degree: "knows", suspects: {chapter: "1", paragraph: 13}, knows: {chapter: "1", paragraph: 13}}, reveals: [], decisions: [], guards: []},
        {point: "k3", secrecy: "secret", subject: "xia", people: {hui: cell("knows"), xia: cell("knows"), jin: cell("misbelieves", "哥哥那几年不想回家，也不想管她")}, others: [], othersTotal: 0, reader: {degree: "suspects", suspects: {chapter: "2", paragraph: 10}, knows: null}, reveals: [], decisions: [{id: "d1", text: "什么时候让星瑾知道那几年的事", status: "pending", conclusion: null, due: "3"}], guards: []},
        {point: "k4", secrecy: "topSecret", subject: "parents", people: {hui: cell("none"), xia: cell("none"), jin: cell("none")}, others: [{person: "parents", degree: "knows"}, {person: "sprite", degree: "suspects"}], othersTotal: 2, reader: {degree: "unaware", suspects: null, knows: null}, reveals: [{plan: "p1", chapter: "3", mode: "explicit", done: false}], decisions: [{id: "d2", text: "父母以什么身份回来", status: "decided", conclusion: "双王", due: null}], guards: []},
    ];
    const people = ["hui", "xia", "jin"];
    const goal = (id: string, holder: string, extra: Partial<AuthorGoal>): AuthorGoal => ({id, holder, name: names[id as keyof typeof names].name, 状态: "active", 轻重: "major", 层次: "want", 为什么: null, 基于: [], 冲突: [], 后继: null, 隐秘: null, conflicts: [], last: null, quiet: 2, stalled: false, ...extra});
    const goals: AuthorGoal[] = [
        goal("g1", "xia", {隐秘: "k3", 基于: ["k3"], conflicts: [{id: "g4", writtenOn: "other", holder: "jin"}]}),
        goal("g2", "xia", {隐秘: "k1", quiet: 31, stalled: true}),
        goal("g3", "xia", {状态: "achieved", last: {chapter: "2"}, quiet: 1}),
    ];
    const attitudes: AuthorAttitude[] = [
        {object: "jin", 态度: "想补偿她，又不知道怎么开口", notReduced: false, 起因: null, 称呼: "星瑾"},
        {object: "hui", 态度: null, notReduced: true, 起因: null, 称呼: "彗"},
    ];
    const node = (role: Role, chapter: string, written: boolean) => ({role, chapter, written});
    const candidates = [{id: "hui", name: "彗"}, {id: "xia", name: "星瑕"}, {id: "jin", name: "星瑾"}, {id: "parents", name: "父母"}, {id: "sprite", name: "魔法精灵（名字未定）"}];
    return [
        defineLabFixture<typeof SecretsMatrix>({
            component: "SecretsMatrix",
            scenes: [
                {id: "sample", label: "按主体分组：知道、信错了、忘了、读者从哪一段起、计划与决策", input: {props: {rows, people, names, now: 3}}},
                {id: "compact", label: "窄的版式：一行一条的列表", input: {props: {rows, people, names, now: 3, compact: true}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows, people, names, now: 3}}},
            ],
            load: async () => (await import("./SecretsMatrixFixture.vue")).default,
        }),
        defineLabFixture<typeof PeoplePicker>({
            component: "PeoplePicker",
            scenes: [
                {id: "sample", label: "缺省点名三个主要角色", input: {props: {candidates}, model: {modelValue: ["hui", "xia", "jin"]}}},
                {id: "max", label: "选满了（上限 2）", input: {props: {candidates, max: 2}, model: {modelValue: ["xia", "jin"]}}},
                {id: "sample-english", label: "英文界面", input: {props: {candidates}, model: {modelValue: ["xia"]}}},
            ],
            load: async () => (await import("./PeoplePickerFixture.vue")).default,
        }),
        defineLabFixture<typeof NodeBand>({
            component: "NodeBand",
            scenes: [
                {id: "sample", label: "写了的实心、打算写的虚线框，跳过的章收成省略格", input: {props: {nodes: [node("plant", "1", true), node("echo", "2", true), node("mislead", "7", true), node("partial", "12", false), node("payoff", "30", false)], now: 12}}},
                {id: "one", label: "只埋了一次", input: {props: {nodes: [node("plant", "2", true)], now: 3}}},
                {id: "sample-english", label: "英文界面", input: {props: {nodes: [node("plant", "1", true), node("payoff", "3", false)], now: 2}}},
            ],
            load: async () => (await import("./NodeBandFixture.vue")).default,
        }),
        defineLabFixture<typeof GoalGroup>({
            component: "GoalGroup",
            scenes: [
                {id: "sample", label: "瞒着别人、打架、因为、停滞、达成，态度里一条还没归纳", input: {props: {goals, attitudes, names}}},
                {id: "goals-only", label: "只有目标", input: {props: {goals: goals.slice(0, 1), attitudes: [], names}}},
                {id: "sample-english", label: "英文界面", input: {props: {goals, attitudes, names}}},
            ],
            load: async () => (await import("./GoalGroupFixture.vue")).default,
        }),
        defineLabFixture<typeof ReadFailure>({
            component: "ReadFailure",
            scenes: [
                {id: "thrown", label: "取数出错：写服务给的说明", input: {props: {failure: {code: "external-failed", detail: "剧情插件还没启动"}}}},
                {id: "line", label: "这条线读不到", input: {props: {failure: {code: "line-not-found"}}}},
                {id: "not-found", label: "找不到这个条目", input: {props: {failure: {code: "not-found", detail: {code: "not-found"}}}}},
                {id: "thrown-english", label: "英文界面", input: {props: {failure: {code: "external-failed", detail: "The plot plugin has not started"}}}},
            ],
            load: async () => (await import("./ReadFailureFixture.vue")).default,
        }),
        defineLabFixture<typeof PlotSidebar>({
            component: "PlotSidebar",
            scenes: [
                {id: "sample", label: "三张表（选中谁知道什么）与剧情线", input: {props: {lines: ["line1", "line2", "line3"], names, active: "secrets"}}},
                {id: "no-lines", label: "还没有剧情线", input: {props: {lines: [], names}}},
                {id: "unbound", label: "没有打开作品", input: {props: {unbound: true}}},
                {id: "sample-english", label: "英文界面", input: {props: {lines: ["line1", "line2"], names, active: "ledger"}}},
            ],
            load: async () => (await import("./PlotSidebarFixture.vue")).default,
        }),
    ];
}
