# 阶段 2：脚本基础设施

## 目标

新增可被 `execute_shell` 调用的脚本，而不是新增专用 agent tools。脚本负责浏览、创建、校验，编辑仍由通用文件工具完成。

## `scripts/workspace-ls.ts`

扩展 `ls -al` 风格输出，展示文件树的写作语义。

示例输出：

```text
mode        type       status   words  refs  path
drwxr-xr-x  location   active   0      3     lorebook/location/神恩大陆/
drwxr-xr-x  location   active   812    2     lorebook/location/神恩大陆/王国B/B-a城/孤儿院/
drwxr-xr-x  chapter    draft    3200   5     manuscript/001-开篇/001-雪夜/
```

参数：

```bash
bun scripts/workspace-ls.ts
bun scripts/workspace-ls.ts lorebook
bun scripts/workspace-ls.ts manuscript
bun scripts/workspace-ls.ts --type location
bun scripts/workspace-ls.ts --depth 3
bun scripts/workspace-ls.ts --refs
bun scripts/workspace-ls.ts --json
```

要求：

- 只读文件。
- 普通输出给人和 LLM 快速扫。
- `--json` 给前端或其他脚本消费。
- 默认工作区根目录为 `workspace/`。
- 文件树扫描遵守 `workspace/.gitignore`，但不默认隐藏点开头目录；`.git` 可以作为硬排除。
- 只有 `manuscript/`、`lorebook/` 内容根目录内的目录节点存在 `index.md` 时，才从 `index.md` 读取 frontmatter 和统计。
- 普通目录里的 `index.md` 作为普通 Markdown 文件输出。
- 输出应包含图标信息，图标解析遵守 `.nbook/icons.json` 与 `frontmatter.icon` 优先级。

## `scripts/workspace.ts`

统一工作区 CLI，负责内容节点脚手架、校验和 schema 查看。`workspace-new.ts` 与 `workspace-validate.ts` 可以暂时保留，但不再作为推荐入口。

### `new`

创建符合规范的 Markdown 文件或内容目录节点 `index.md`。

示例：

```bash
bun scripts/workspace.ts new "lorebook/location/神恩大陆/王国B/B-a城/孤儿院" --dir --title "孤儿院" --type location
bun scripts/workspace.ts new "lorebook/character/苏雪" --dir --status active --type character
bun scripts/workspace.ts new "manuscript/001-开篇/001-雪夜" --dir --title "雪夜来客" --type chapter
bun scripts/workspace.ts new "docs/备忘.md" --title "备忘"
bun scripts/workspace.ts new "manuscript/001-开篇" --dir --title "开篇"
```

要求：

- 创建前检查目标是否已存在。
- 支持创建 `.md` 文件。
- 支持在内容根目录内创建目录并写入 `index.md`。
- 普通目录默认只创建目录，不隐式写入 `index.md`。
- 自动生成 frontmatter 模板。
- `type=character` 使用顶层 `character` 字段，不再生成 `ext.character`。
- lorebook entry 应优先创建为 `lorebook/{type}/{name}/index.md`。
- 不覆盖已有文件。

### `validate`

校验文件树结构、frontmatter 和相对引用。

校验项：

- frontmatter YAML 可解析。
- 内容节点的 `type`、`status` 在允许集合内，status 只允许 `draft / pending / active / archived`。
- `status=deprecated` 报 `legacy-status`。
- `ext.character` 报 `legacy-ext-character`，角色字段应迁移到顶层 `character`。
- 内容根目录内同级文件 stem 与目录名不相同；当前等价于禁止 `foo.md` 与 `foo/index.md` 同时存在。
- 普通目录允许同时存在 `foo.md` 与 `foo/index.md`，不按内容节点冲突处理。
- 同级数字前缀不重复。
- `refs[].target` 和 inline Markdown 链接统一使用相对路径。
- `lorebook://`、`chapter://`、`pending://`、`db://`、`vfs://` 等旧协议报 `legacy-ref`。
- 文本文件路径不逃逸项目根。
- `.nbook/icons.json` 可解析，图标名存在于 lucide 图标集中。

示例输出：

```text
[P1] missing-ref  manuscript/001-开篇/001-雪夜.md:23
     ../location/神恩大陆/王国B/ 不存在

[P2] duplicate-order  manuscript/001-开篇
     001-雪夜.md 与 001-孤儿院.md 使用了相同排序号
```

参数：

```bash
bun scripts/workspace.ts validate
bun scripts/workspace.ts validate --json
bun scripts/workspace.ts validate lorebook/character/苏雪
```

### `schema`

查看内容节点 schema、状态说明和受约束字段。

```bash
bun scripts/workspace.ts schema
bun scripts/workspace.ts schema character --json
```

## 可选 `scripts/workspace-rename.ts`

用于移动或重命名路径，并批量替换 Markdown 相对引用。

第一版可以先不实现，但规范保留该脚本位置，避免后续把重命名逻辑塞回前端或后端专用 tool。

## 第一版验收

- `workspace-ls.ts` 与 `workspace.ts` 都可通过 `bun scripts/*.ts` 运行。
- 脚本不依赖数据库。
- 脚本失败时返回非 0 exit code。
- `workspace.ts validate` 能作为迁移和 CI 的安全网。

