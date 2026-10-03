# Round 411: Default Template Subject System Schema

## 背景

继续按真实作者流检查“新建 Project，以命定之诗2为例设置 subject schema”。此前已经解决了 schema/calendar 文件入口可达性，但新 Project 默认模板仍有一个拼接断点：

- Project 模板会创建 `simulation/subjects/player` 六文件。
- Workbench 的“同步主体系统”已经能把六文件路径、RAG source 和计数写进 World Engine init slice。
- 但默认 `world-engine/schema.yaml` 的 `character` type 没声明这些主体系统映射字段。

结果是：作者新建 Project 后即使同步 `player`，World Engine state 也只能得到 `hp/events` 等通用字段，看不到 `sourcePath / subjectFiles / ragIndexSources` 这组主体系统元数据。要达到 `ming-ding-zhi-shi-2` 的效果，作者必须手动把一长串 schema 字段补进 YAML。

这不是低频畸形输入，而是“新 Project + 六文件主体系统 + World Engine state”拼接处的第一步摩擦。

## 改动

更新默认 Project Workspace 模板：

```text
assets/workspace/.nbook/templates/project-directory-templates/world-engine/schema.yaml
```

`character` type 保留通用奇幻字段，同时增加主体系统映射 attrs：

- `sourcePath`
- `legacyKind`
- `controlledBy`
- `profile`
- `canonicalSource`
- `subjectFiles`
- `actorImportPath`
- `leaderOnlyPath`
- `directStatePath`
- `ragIndexSources`
- `eventCount`
- `memoryCount`
- `subjectSystemVersion`

这样新 Project 模板自带的 `simulation/subjects/player` 被同步为 World Engine subject 时，Workbench 会自动把这些已声明字段写进 init slice；仍不复制或改写六文件正文。

## 验证

同步系统资产到 user-assets：

```bash
bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets
```

结果：

```text
synced user assets: copied 0, updated profiles 0, updated assets 1, skipped 157
```

目标测试通过：

```bash
bunx vitest run server/workspace-files/workspace-files.test.ts -t "创建 Project Workspace 时会写入 manifest、初始化 Project SQLite 并加载模板"
```

结果：

```text
1 file passed
1 test passed | 75 skipped
```

源码确认：

- 默认模板中已包含 `sourcePath / subjectFiles / ragIndexSources / subjectSystemVersion`。
- `copyNovelDirectoryTemplate()` 创建的新 Project Workspace 会加载更新后的 `world-engine/schema.yaml`。

## 实际偏差

- 曾用较宽的 `-t "小说目录模板|创建 Project Workspace"` 跑同文件测试；其中一条既有模板断言失败，原因是 `agents/writer/generated.md` 不存在，与本轮 World Engine schema 改动无关。随后改用精确测试名，目标路径通过。
- 本轮未启动浏览器验收。改动是 Project template 内容与模板复制加载路径，目标测试已经覆盖“新 Project 会带更新 schema 并能被 World Engine facade 读取”。完整 UI 流后续继续按真实作者验收推进。

## 后续

- 新建 Project 现在更接近 `ming-ding-zhi-shi-2` 的六文件主体系统 schema，不再要求作者手写主体系统映射字段才能获得完整 World Engine state。
- 后续仍需继续观察作者是否卡在“如何创建/改写 player 六文件本身”，这属于 subject 模板 / 角色创建体验，不应继续用 schema 边界补丁代替。
