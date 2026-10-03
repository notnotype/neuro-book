# 阶段 1：文件树正式规范

## 目标

建立 chapter / lorebook 共同遵守的文件系统规范。实现者只需要按这个规范读写文件，不再依赖数据库表表达树结构。

本文件是后续脚本、前端、迁移实现的唯一文件树规范来源。旧 DB chapter / lorebook / VFS 规范只能作为历史背景，不能覆盖本文件规则。

## 阶段 1 范围

阶段 1 只固化规范，不实现脚本、不改前端、不删除旧代码、不修改 `reference/` 目录。

第一版文件树能力明确不做：

- 不做二进制文件编辑。
- 不做全项目通用的复杂 frontmatter 可视化表单；内容节点可以提供必要字段编辑。
- 不做 DB id 引用。
- 不做 VFS 路径兼容。
- 不要求 UI 固定展示 `manuscript/`、`lorebook/` 两个根。

## 工作区根目录

文件树由项目内的 `workspace/` 目录承载。基础设施负责把所有文件操作限制在这个根目录内，UI 与业务组件只消费文件树结果。

规则：

- UI 不把 `manuscript/`、`lorebook/` 做成两个固定根面板；它们只是 `workspace/` 文件树下的普通顶层目录。
- 第一版内容节点作用域固定为 `manuscript/`、`lorebook/` 及其子目录。
- 脚本和前端必须先按普通文件系统扫描目录，再在内容节点作用域内叠加 `index.md` 节点语义。
- 路径解析必须限制在 `workspace/` 内，不能逃逸到根目录外。
- 工作区根目录内的 `.nbook/` 预留给 nbook 存放配置和私有数据，第一版支持 `.nbook/icons.json`。
- 点开头文件和目录默认可见，例如 `.agent/`、`.nbook/`；是否隐藏交给工作区 `.gitignore`。
- 文件树扫描应适配工作区根目录内的 `.gitignore`，而不是用硬编码名单隐藏普通目录。

## `.nbook/icons.json`

工作区可以通过 `.nbook/icons.json` 配置文件树默认图标。图标值使用 lucide 裸图标名，不写 `i-lucide-` 前缀；不存在或非法时使用内置默认值。

完整推荐配置：

```json
{
    "defaults": {
        "contentNode": "notebook-tabs",
        "directory": "folder",
        "markdown": "file-text",
        "text": "file",
        "file": "file-question-mark"
    },
    "directories": {
        ".agent": "bot",
        ".claude": "sparkles",
        ".nbook": "settings",
        ".vscode": "settings",
        "archive": "archive",
        "archives": "archive",
        "assets": "image",
        "chapter": "book-open-text",
        "chapters": "book-open-text",
        "character": "user-round",
        "characters": "users-round",
        "config": "settings",
        "configs": "settings",
        "data": "database",
        "docs": "scroll-text",
        "draft": "file-pen-line",
        "drafts": "file-pen-line",
        "image": "image",
        "images": "image",
        "item": "package",
        "items": "package",
        "location": "map-pinned",
        "locations": "map-pinned",
        "lorebook": "library",
        "manuscript": "book-open-text",
        "media": "image",
        "note": "notebook",
        "notes": "notebook",
        "outline": "list-tree",
        "outlines": "list-tree",
        "plan": "list-todo",
        "plans": "list-todo",
        "plot": "git-branch",
        "plots": "git-branch",
        "reference": "link",
        "references": "link",
        "research": "search",
        "rule": "book-key",
        "rules": "book-key",
        "scene": "clapperboard",
        "scenes": "clapperboard",
        "setting": "settings",
        "settings": "settings",
        "template": "copy",
        "templates": "copy",
        "todo": "list-todo",
        "todos": "list-todo",
        "world": "landmark",
        "worldbuilding": "landmark"
    },
    "extensions": {
        ".css": "palette",
        ".csv": "table",
        ".gif": "image",
        ".jpeg": "image",
        ".jpg": "image",
        ".js": "file-code",
        ".json": "braces",
        ".jsonc": "braces",
        ".lock": "lock",
        ".log": "terminal",
        ".md": "file-text",
        ".mjs": "file-code",
        ".png": "image",
        ".svg": "image",
        ".ts": "file-code",
        ".tsx": "file-code",
        ".txt": "file",
        ".vue": "file-code",
        ".yaml": "settings",
        ".yml": "settings",
        ".zip": "archive"
    },
    "entryTypes": {
        "active": "shield-check",
        "artifact": "gem",
        "background": "users-round",
        "building": "building-2",
        "chapter": "book-open-text",
        "character": "user-round",
        "city": "building-2",
        "continent": "map",
        "district": "route",
        "document": "scroll",
        "dungeon": "swords",
        "equipment": "shield",
        "facility": "building-2",
        "group": "users-round",
        "idea": "lightbulb",
        "important": "crown",
        "item": "package",
        "landmark": "landmark",
        "location": "map-pinned",
        "magic": "wand-sparkles",
        "nation": "castle",
        "note": "notebook",
        "person": "user-round",
        "region": "map",
        "resource": "package-open",
        "room": "door-open",
        "rule": "book-key",
        "settlement": "house",
        "system": "settings",
        "timeline": "calendar-clock",
        "todo": "list-todo",
        "transport": "route",
        "world": "earth"
    }
}
```

解析优先级：

1. 当前内容节点 `frontmatter.icon`。
2. `entryTypes[entryType]`，其中 `entryType` 只来自内容节点 frontmatter 或内容节点路径推断。
3. `directories[目录名]`。
4. `extensions[扩展名]`。
5. `defaults.contentNode`、`defaults.directory`、`defaults.markdown`、`defaults.text`、`defaults.file`。

规则：

- 图标名必须能在 lucide 图标集中找到。
- `frontmatter.icon` 只建议用于内容节点；普通文件默认走 `.nbook/icons.json`。
- Lorebook 专用 detail 不提供图标选择按钮，避免业务表单和视觉配置混在一起。
- 通用内容节点 detail 可以写入 `frontmatter.icon`，用于覆盖 `.nbook/icons.json` 默认图标。

## 推荐目录约定

目录名不由系统强制，但建议项目采用：

```text
manuscript/
  001-开篇/
    index.md
    001-雪夜.md

lorebook/
  location/
    神恩大陆/
      index.md
      王国B/
        index.md
  character/
    苏雪/
      index.md
  rule/
    魔法体系/
      index.md
  note/
    写作风格/
      index.md
```

系统只提供通用文件树能力，不在 UI 中硬编码这些根目录。AI 与用户通过规范遵守目录语义。

## 文件与目录节点

`workspace/` 整体是普通文件系统资源管理器。只有 `manuscript/`、`lorebook/` 这类内容根目录内启用“目录 + index.md + frontmatter”的内容节点语义。

规则：

- 内容根目录第一版固定为 `manuscript/`、`lorebook/`。
- 内容根目录内，`foo/index.md` 表示目录 `foo/` 自身的内容节点。
- 内容根目录内，`foo/` 可以同时包含其他子文件或子目录。
- 内容根目录内，`foo.md` 是不规范内容节点的兼容形态，但系统先按普通文件处理；即使 frontmatter 存在业务 `type`，也不触发 lorebook/chapter 节点语义。
- 内容根目录内，第一版粗略禁止同级文件 stem 与目录同名，例如 `foo.md` 与 `foo/` 不能同时存在；当前等价于禁止 `foo.md` 与 `foo/index.md` 并存，后续如有资料目录需求再放开。
- 内容根目录内，目录没有 `index.md` 时，该目录只是容器节点，不承载正文。
- 内容根目录外，普通文件夹、普通文件、`index.md` 都按 VS Code 风格资源处理，不触发内容节点语义。

点击目录时：

- 如果目录位于内容根目录内且存在 `index.md`，自动打开该 `index.md`。
- 如果目录不在内容根目录内，或内容根目录内没有 `index.md`，只选中目录并展示目录详情。
- 展开或折叠目录是文件树交互，不改变上述打开规则。

示例：

```text
lorebook/location/孤儿院.md
lorebook/location/孤儿院/index.md
```

上述两个路径位于 `lorebook/` 内容根内，因此冲突，校验脚本必须报错。`docs/孤儿院.md` 与 `docs/孤儿院/index.md` 位于普通目录内，不按内容节点冲突处理。

## 排序规则

文件树排序只依赖文件名，不再维护数据库 `volume.sortOrder`、`chapter.sortOrder`。

规则：

- 同级文件和目录按名称升序排序。
- 推荐用数字前缀表达人工顺序，例如 `001-开篇`、`002-逃亡`。
- 数字前缀格式推荐为 `001-标题`，但规范不强制所有文件都必须有数字前缀。
- 同一目录下如果多个节点使用相同数字前缀，校验脚本必须报错。
- 排序时目录与文件不需要分组置顶，第一版按统一名称排序即可。

## frontmatter

Markdown 文件可使用 YAML frontmatter。

chapter / manuscript 建议字段：

```yaml
---
icon: notebook-tabs
status: draft
summary: 主角第一次意识到孤儿院异常。
characters:
  - 苏雪
todos:
  - 补院长伏笔
---
```

lorebook 建议字段：

```yaml
---
icon: map-pinned
type: location
status: active
aliases:
  - 孤儿院
tags:
  - 王国B
summary: 苏雪幼年生活过的地点。
refs:
  - relation: belongs_to
    target: ../王国B/B-a城/
---
```

规则：

- frontmatter 是内容目录节点的约定与校验对象。
- 内容目录节点第一版允许结构化 detail 编辑 frontmatter。
- 内容目录节点允许用 `icon` 配置 lucide 图标，值保存为裸图标名，例如 `map-pinned`，由图标选择器写入。
- 普通 Markdown 文件可以包含 frontmatter，但系统不把它当作 lorebook/chapter 内容节点。
- 内容根内的非 `index.md` Markdown 文件仍按普通 Markdown 处理；frontmatter `type` 只作为文本内容保留，不参与业务类型推断。
- 没有 frontmatter 的 `.md` 文件仍然是合法文本节点。
- 未识别字段应保留，不应在读写时被无故删除。

## 类型推断

内容节点类型只对内容根内的目录 `index.md` 生效，普通文件不推断业务类型。内容节点类型由以下顺序推断：

1. frontmatter `type`。
2. 内容目录节点路径中的约定目录名，例如 `lorebook/location/孤儿院/index.md` 推断为 `location`。
3. 内容目录节点位于 `manuscript/` 下时可推断为 `chapter`。
4. 无法推断时为 `null`，前端按普通节点展示。

合法 lorebook 类型第一版包含：

- `location`
- `character`
- `item`
- `rule`
- `note`

## 相对引用

引用使用 Markdown 风格相对路径。

示例：

```md
[孤儿院](../location/神恩大陆/王国B/B-a城/孤儿院/)
[雪夜](../../manuscript/001-开篇/001-雪夜/)
```

解析规则：

- 相对路径以当前 Markdown 文件所在目录为基准。
- 内容节点 target 指向目录并保留结尾 `/`。
- 普通文件 target 指向具体文件名。
- `lorebook://`、`chapter://`、`pending://`、`db://`、`vfs://` 等旧协议只作为迁移问题报错。
- 新建 lorebook entry 应创建目录节点 `name/index.md`，不再创建 `name.md`。
- 移动或重命名文件会破坏引用，应通过校验脚本发现，并由重命名脚本或 `rg` 批量修复。

禁止新规范使用下列旧主路径作为推荐方案：

- `db://chapter/<id>`
- `db://lorebook/<id>`
- `vfs://novel/...`
- `chapter://...`
- `lorebook://...`

## 第一版验收

- 文档明确文件、目录、`index.md`、frontmatter、排序、类型推断、相对引用的行为。
- 文档明确只有内容根内的目录 `index.md` 表达内容节点，非 `index.md` 文件只按普通文件处理。
- 文档明确同级文件 stem 与目录同名冲突只在内容根内校验。
- 文档明确 UI 不硬编码 `manuscript/`、`lorebook/` 两个根。
- 文档明确不使用 DB id、DB URI、VFS URI 作为新规范推荐路径。
- 后续脚本和前端都以本规范为准。

