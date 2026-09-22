import type {EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";

export const SCENE_TABS: Record<string, EditorTabPresentation[]> = {
    empty: [],
    mixed: [
        {path: "docs/architecture.md", title: "architecture.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
        {path: ".env", title: ".env", pinned: false, preview: false, dirty: false, description: "...\\tim-completion-spike", iconClass: "i-lucide-key-round"},
        {path: "AGENTS.md", title: "AGENTS.md", pinned: false, preview: false, dirty: false, statusText: "M", iconClass: "i-lucide-file-text"},
        {path: "docs/002-product-decision-brief.md", title: "002-product-decision-brief.md", pinned: false, preview: false, dirty: false, statusText: "U", iconClass: "i-lucide-file-text"},
        {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: false, preview: false, dirty: false, statusText: "U", iconClass: "i-lucide-file-text"},
        {path: "src/story/chapter-02.md", title: "chapter-02.md", pinned: false, preview: false, dirty: true, statusText: "M", iconClass: "i-lucide-file-text"},
        {path: "package.json", title: "package.json", pinned: false, preview: false, dirty: false, statusText: "M", iconClass: "i-lucide-braces"},
        {path: ".agents/skills/doc-review/SKILL.md", title: "SKILL.md", pinned: false, preview: false, dirty: false, description: "...\\doc-review", iconClass: "i-lucide-file-text"},
        {path: "src/notes/quick-draft.txt", title: "quick-draft.txt", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file"},
    ],
    "long-titles": [
        {path: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue", title: "ProviderSettingsViewFixtureLongPathComponentName.vue", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
        {path: "docs/specifications/drafts/2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", title: "2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
        {path: "assets/workspace/deeply/nested/directory/structure/with-multiple-submodules/long-configuration-matrix-sample.json", title: "long-configuration-matrix-sample.json", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file-code-2"},
    ],
    loading: [{path: "src/heavy-dataset.json", title: "heavy-dataset.json", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"}],
    diagnosis: [{path: "assets/diagram.drawio", title: "diagram.drawio", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-question"}],
    "closing-cancel": [
        {path: "src/draft-chapter.md", title: "draft-chapter.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
        {path: "src/saved-notes.md", title: "saved-notes.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    ],
    "keyboard-menu": [{path: "src/main.ts", title: "main.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"}],
    "multi-view": [{path: "chapter-01.md", title: "chapter-01.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"}],
};

export const DEFAULT_CONTENTS: Record<string, string> = {
    ".env": "# Application Environment\nPORT=3001\nNODE_ENV=development\nWORKSPACE_ROOT=/workspace/novel-drafts\n",
    "AGENTS.md": "# NeuroBook Agent 入口\n\nNeuroBook 是本地优先的长篇写作工作区。\n\n## 核心规则\n- 结论先行，以可观察行为解释判断。\n",
    "docs/002-product-decision-brief.md": "# 决策简报：VS Code 标签栏与面板对齐\n\n- 移除孤岛浮动药丸，还原无边框紧凑矩形。\n- Git 状态颜色同步文件名。\n",
    "package.json": '{\n  "name": "neuro-book",\n  "version": "0.1.0",\n  "private": true\n}',
    ".agents/skills/doc-review/SKILL.md": "---\nname: doc-review\ndescription: 文档审查规范\n---\n\n# 文档审查 Skill\n",
    "src/story/chapter-01.md": "# 第一章：雨夜的信件\n\n雨水拍打着窗棂。文本由三重视图共享。",
    "src/story/chapter-02.md": "# 第二章：钟表匠的密室\n\n这段正文有未保存的修改，用于演示脏标记与关闭保护。",
    "docs/architecture.md": "# 系统架构概览\n\nEditorWorkbench 受控组合件与 EditorTabBar、EditorToolbar。",
    "src/config/app.json": '{\n  "appName": "NeuroBook",\n  "version": "1.0.0"\n}',
    "src/notes/quick-draft.txt": "随手草稿：\n1. 增加更多无障碍测试\n2. 检查移动端 390x844 表现",
    "src/heavy-dataset.json": '{\n  "dataset": "massive-corpus",\n  "status": "loading"\n}',
    "assets/diagram.drawio": "<mxfile host='app.diagrams.net'><diagram>...</diagram></mxfile>",
    "src/draft-chapter.md": "# 草稿章节\n\n这段文字修改后未保存。关闭会弹出确认横幅，点取消能完整保留输入内容。",
    "src/saved-notes.md": "# 已保存的笔记\n\n这是一份干净的文档，关闭无需确认。",
    "src/main.ts": "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');",
    "chapter-01.md": "# 第三注册视图演示正文\n\n本正文供源码视图、Markdown 视图和测试预览视图 (test.preview) 共享。\n请点击顶部菜单「打开方式」切换，文本内容实时保持同步。",
};
