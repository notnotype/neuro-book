---
标签: []
---

# EditorWelcome

编辑器工作区欢迎页面受控组件：从原 `MarkdownStudioWelcome` 迁移而来，承载工作区空状态引导（新建章节、世界书条目、项目文档、打开文件树、打开 Agent 面板）以及不可编辑只读节点的元信息展示。

组件纯消费 nb-ui 主题角色变量：`--panel-surface`、`--bg-panel`、`--bg-hover`、`--bg-input`、`--border-color`、`--border-strong`、`--divider`、`--text-main`、`--text-secondary`、`--text-muted`、`--text-inverse`、`--accent-main`、`--accent-text`、`--status-warning`、`--radius-control`、`--radius-panel`。

## 与外壳拓扑的关系

- **嵌入 empty 插槽**：作为 `EditorWorkbench` 的 `#empty` 槽位内容渲染，当工作区没有打开任何标签或没有活动文档时呈现；
- **展示投影适配**：接收 `tabs: readonly EditorTabPresentation[]`，图标解析直接读取 `tab.iconClass`；
- **全响应式支持**：移除了旧有的 640px 最小宽度下限，结合 `@container` 容器查询，在 1440px 桌面大屏与 390×844 窄屏移动视口下均可自然适配。

## 数据与 API

```ts
export type WorkspaceMode = "novel" | "user-assets";

type Props = {
    /** 当前选中的不可编辑节点（若非空且不可编辑，呈现只读说明卡片） */
    node: WorkspaceFileNode | null;
    /** 标签只读展示投影列表，用于展示最近文件快捷入口 */
    tabs?: readonly EditorTabPresentation[];
    /** 是否以紧凑模式渲染 */
    compact?: boolean;
    /** 工作区模式：novel（故事创作）或 user-assets（用户资产） */
    workspaceMode?: WorkspaceMode;
};

type Emits = {
    (event: "select-tab", path: string): void;
    (event: "open-path", path: string): void;
    (event: "open-files"): void;
    (event: "create-chapter"): void;
    (event: "create-markdown-file"): void;
    (event: "create-lorebook-entry"): void;
    (event: "open-agent-panel"): void;
    (event: "open-profile-workbench"): void;
};
```

## 无障碍与交互契约

1. **结构语义**：采用单根 `<section class="editor-welcome-root ...">`，只读节点说明具有清晰的 `h1` 标题与状态标签；
2. **键盘访问**：所有操作卡片均使用原生语义化 `<button type="button">`，保证 Tab 键顺畅聚焦与 Enter/Space 激活；
3. **文案国际化统一**：完整采用 `editorWorkbench.welcome.*` 键名体系，区分作品工作区与资产工作区的专属动作引导。
