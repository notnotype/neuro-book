# 阶段 3：前端 IDE 重构

## 目标

删除 chapter 面板心智，把左侧工具区改为通用文件树。中间编辑器打开真实文本文件。底部 detail 面板保留，但从 lorebook/chapter 结构化表单改成当前文件详情。

## 左侧文件树

调整方向：

- 移除 `Chapters` 独立入口。
- 扩展现有 lorebook 树能力，或重命名为中性的文件树组件。
- 文件树使用 `workspace/` 根目录，整体按普通资源管理器处理。
- 第一版仅在 `manuscript/`、`lorebook/` 下启用内容目录节点语义。
- 点开头文件和目录正常显示；`.gitignore` 命中的路径才隐藏。
- `.nbook/` 作为普通可见目录展示，`.nbook/icons.json` 可配置文件树默认图标。
- 节点支持目录和文件。
- 内容目录节点内有 `index.md` 时，点击目录自动打开 `index.md`。
- 普通目录即使有 `index.md`，点击目录也只选中目录，`index.md` 作为普通文件展示。
- 内容目录节点可通过通用 detail 中的图标选择器写入 `frontmatter.icon`；Lorebook 专用 detail 不提供条目级图标按钮。
- 新建 Lorebook 条目创建 `lorebook/{type}/{name}/index.md`，不再创建 `new-entry.md` 这类普通文件。
- 拖拽移动是真实文件系统移动；松手后先做前端乐观移动，再后台调用通用 rename API 校准。

第一版节点展示：

- 图标：优先 `frontmatter.icon`，其次 `.nbook/icons.json` 的 `entryTypes`、`directories`、`extensions`、`defaults`。
- 类型：只对内容节点生效，来自内容节点 frontmatter 或路径推断。
- 状态：来自 frontmatter。
- 摘要：来自 frontmatter `summary` 第一行。
- 内容目录节点弱化或隐藏其内部 `index.md`，由目录行代表该节点。

## 中央编辑器

支持范围：

- `.md` 使用现有 Markdown 编辑器。
- `.txt` 和无扩展纯文本使用普通文本编辑器。
- 其他文件显示只读/不支持提示。

行为变化：

- 标题从“章节标题”改为当前文件路径或 frontmatter title。
- 字数统计基于当前文件内容。
- 保存写回真实文件。
- lorebook entry 正文仍按 Markdown 文件编辑；底部 detail 可以显示 lorebook 字段表单并写回同一个 `index.md` 的 frontmatter 和正文。

## 底部 detail 面板

保留底部 detail 面板，但内容改为文件详情。

第一版展示：

- 当前路径。
- 文件类型。
- frontmatter title / status / type / summary。
- 字数。
- 引用数量。
- `workspace.ts validate` 对当前文件相关的问题。
- 可复制 Markdown 相对引用路径。

第一版动作：

- 新建同级文件。
- 新建普通目录。
- 新建 Lorebook 条目。
- 将内容根目录内的普通文本文件转换为目录节点，即 `foo.md` 到 `foo/index.md`。
- 运行校验。
- 复制引用。

不做：

- 普通 Markdown 不做完整 frontmatter 表单编辑；内容目录节点的 `index.md` 可由 detail 编辑 frontmatter。
- 普通目录和普通 Markdown 不显示“转化为目录节点”动作。
- 不做 lorebook 专用 metadata/content 双保存。
- 不做排序语义；拖拽只表示移动到目标目录或根目录。

## Store 与状态

从 chapter 状态迁移为 active file 状态：

- `selectedChapterId` 替换为 `selectedFilePath`。
- `content` 继续表示当前文件内容。
- `lastSyncedChapterContent` 替换为 `lastSyncedFileContent`。
- `showEditorWorkspace` 改为是否选中了可编辑文件。
- agent drawer 仍可接收当前文件上下文，但不再强依赖 chapter id。

## 第一版验收

- 打开页面后左侧可以展示配置根目录文件树。
- 点击 `.md` 文件能编辑并保存。
- 点击内容根目录内存在 `index.md` 的目录时自动打开；普通目录不自动打开普通 `index.md`。
- 点击不可编辑文件不崩溃。
- 右键菜单可以创建普通文件、普通目录、Lorebook 条目。
- 拖拽文件或目录时 UI 立即乐观移动，后台失败时回滚。
- `.nbook/icons.json` 修改默认图标后，文件树节点图标按配置展示。
- 删除 chapter 面板入口后页面 typecheck 通过。

