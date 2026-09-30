import type EditorTabBar from "../../components/editor-workbench/EditorTabBar.vue";
import type {EditorTabPresentation} from "../../components/editor-workbench/editor-view.types";
import type {LabFixtureDefinition} from "./index";

/** 假项目沿用 EditorWorkbenchFixture 的同一套路径，两个夹具在 Lab 里看起来是同一个工作区。 */
const MIXED_TABS: EditorTabPresentation[] = [
    {path: "docs/architecture.md", title: "architecture.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/config/app.json", title: "app.json", pinned: true, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
    {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/story/chapter-02.md", title: "chapter-02.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
    {path: "src/notes/quick-draft.txt", title: "quick-draft.txt", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file"},
];

// 标题用相对路径而不是文件名：标签最大宽度 200px，长路径必然截断，横向滚动才有东西可滚。
const OVERFLOW_TABS: EditorTabPresentation[] = [
    {path: "docs/specifications/2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", title: "docs/specifications/2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorTabBar.vue", title: "packages/neuro-book/app/components/editor-workbench/EditorTabBar.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorToolbar.vue", title: "packages/neuro-book/app/components/editor-workbench/EditorToolbar.vue", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorWorkbench.vue", title: "packages/neuro-book/app/components/editor-workbench/EditorWorkbench.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/editor-workbench/editor-view.types.ts", title: "packages/neuro-book/app/components/editor-workbench/editor-view.types.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/shared/theme/theme-axes.ts", title: "packages/neuro-book/shared/theme/theme-axes.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/utils/theme/theme-session.ts", title: "packages/neuro-book/app/utils/theme/theme-session.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/component-lab/fixtures/EditorWorkbenchFixture.vue", title: "packages/neuro-book/app/component-lab/fixtures/EditorWorkbenchFixture.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue", title: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "assets/workspace/deeply/nested/directory/structure/with-multiple-submodules/long-configuration-matrix-sample.json", title: "assets/workspace/deeply/nested/directory/structure/with-multiple-submodules/long-configuration-matrix-sample.json", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "src/story/volumes/volume-03/chapters/chapter-017-the-clockmakers-secret-room-draft.md", title: "src/story/volumes/volume-03/chapters/chapter-017-the-clockmakers-secret-room-draft.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/notes/2026-09-17-editor-tab-bar-scroll-and-truncation-manual-verification-checklist.txt", title: "src/notes/2026-09-17-editor-tab-bar-scroll-and-truncation-manual-verification-checklist.txt", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file"},
];

const PINNED_ONLY_TABS: EditorTabPresentation[] = [
    {path: "docs/architecture.md", title: "architecture.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/config/app.json", title: "app.json", pinned: true, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
    {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorTabBar.vue", title: "EditorTabBar.vue", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
];

const SINGLE_PREVIEW_TABS: EditorTabPresentation[] = [
    {path: "docs/outline.md", title: "outline.md", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/story/chapter-03.md", title: "chapter-03.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
];

/** 场景初值只登记在这里一处：`fixtures/index.ts` 不给这些场景登记 data，Lab 数据面板对它们不可编辑。 */
const SCENE_SEEDS: Record<"mixed" | "overflow" | "pinned-only" | "single-preview", {tabs: EditorTabPresentation[]; activePath: string}> = {
    "mixed": {tabs: MIXED_TABS, activePath: "src/story/chapter-02.md"},
    "overflow": {tabs: OVERFLOW_TABS, activePath: "src/notes/2026-09-17-editor-tab-bar-scroll-and-truncation-manual-verification-checklist.txt"},
    "pinned-only": {tabs: PINNED_ONLY_TABS, activePath: "src/config/app.json"},
    "single-preview": {tabs: SINGLE_PREVIEW_TABS, activePath: "docs/outline.md"},
};

export const editorTabBarScenes = [
    {id: "mixed", label: "固定 / 普通 / 预览 / 脏标记混排", input: {props: {...SCENE_SEEDS.mixed, groupId: "primary", wrap: true}, slots: {trailing: true}}},
    {id: "overflow", label: "12 个长标题：默认折行，切单行验证横向滚动", input: {props: {...SCENE_SEEDS.overflow, groupId: "primary", wrap: true}, slots: {trailing: true}}},
    {id: "pinned-only", label: "只有固定标签（固定行独立成行）", input: {props: {...SCENE_SEEDS["pinned-only"], groupId: "primary", wrap: true}, slots: {trailing: true}}},
    {id: "single-preview", label: "预览标签与脏标记", input: {props: {...SCENE_SEEDS["single-preview"], groupId: "primary", wrap: true}, slots: {trailing: true}}},
] satisfies LabFixtureDefinition<typeof EditorTabBar>["scenes"];
