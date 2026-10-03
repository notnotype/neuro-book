# 2026-06-21 Ming Ding Subject System Adapter

## Summary

- 继续修正 `workspace/ming-ding-zhi-shi-2` 的 World Engine 项目迁移。
- 上一轮只把旧 `simulation/subjects` 注册成 World Engine subjects，并写入少量来源链接；这还没有适配项目真实主体系统。
- 本轮把 `simulation/subjects/{id}/` 的六文件契约映射进 World Engine 当前状态，让 Workbench 的 State Snapshot 和 Slice List 能直接看到主体系统内容。

## Changes

- `workspace/ming-ding-zhi-shi-2/world-engine/schema.yaml`
  - `character` 继续保留默认世界引擎字段与旧主体链接字段。
  - 新增六文件主体系统字段：
    - `subjectFile`：`subject.md`，simulator.leader 可见的全知秘密档。
    - `soulFile`：`soul.md`，actor 主路 Import 的第一人称扮演手册。
    - `visibleState`：`state.md`，上级可读的可见状态与短期目标。
    - `eventCount` / `memoryCount`：旧主体记忆数量摘要。
    - `subjectSystemVersion`：当前映射版本，值为 `simulation-subjects-v1`。
- Project SQLite 数据
  - 新增 `复兴纪元488年 1月15日 14:00:02` / `kind=init` 切片：`主体系统六文件初始化`。
  - 该切片写入 6 个真实角色的 `subjectFile / soulFile / mind / visibleState / memory / eventCount / memoryCount / subjectSystemVersion`，共 48 条 mutations。
  - 新增 `复兴纪元488年 1月15日 14:00:03` / `kind=init` 切片：`主体经历记忆初始化`。
  - 该切片把 `events.jsonl` 作为角色 episodic memory 追加到 World Engine `events` list，共 58 条 mutations。

## Verification

- Facade 验证：
  - `character` schema attr 包含 `subjectFile / soulFile / visibleState / eventCount / memoryCount / subjectSystemVersion`。
  - `listWorldSubjects` 返回 7 个主体。
  - `listSlices(withMutations)` 返回 4 条 init slice，新增两条分别为 48 / 58 mutations。
  - `queryState({subjectIds:["player","mage"]})` 返回：
    - `eventCount` 与 `events.length` 分别为 `7 / 7`、`11 / 11`。
    - `memoryCount` 分别为 `7`、`5`。
    - `subjectFile / soulFile / mind / visibleState` 均存在。
    - `subjectSystemVersion = simulation-subjects-v1`。
    - `issues: []`。
- 浏览器验证：
  - 使用本机 Chrome 打开 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`，点击 Header `WORLD`。
  - Workbench 不再显示 `当前 schema 缺少示例所需类型`。
  - 左侧显示 `5 个类型`、`7 / 7 个主体`。
  - Slice List 显示 `主体系统六文件初始化` 与 `主体经历记忆初始化`。
  - 页面文本包含 `subjectFile / soulFile / visibleState / subjectSystemVersion / events.jsonl`。
  - 截图保存在 `.agent/workspace/world-engine-subject-system-dialog.png`。

## Notes

- 后续 [Subject System Information Boundary](2026-06-21-subject-system-information-boundary.md) 已按主体系统信息边界收口当前 reduce state；本 walkthrough 记录的是中间迁移事实，不代表最终字段设计。
- `events.jsonl` 本轮不拆成真实世界时间线历史切片；它被视为角色主体的 episodic memory，写入该 subject 的 `events` list。这样能适配现有 Subject RAG / actor 记忆语义，也避开旧时间字符串里 `风信之月` 暂未被 Calendar 支持的问题。
- `memory.jsonl` 被折叠为 World Engine `memory` object：topic 作为 key，view 作为 value。
- 本轮仍不做通用迁移工具；这是当前 Project Workspace 的项目级适配。
