# 2026-06-21 Subject System Topology And Card Density

## Summary

- 继续修正 `ming-ding-zhi-shi-2` 的主体系统适配。
- 上一轮已经把六文件内容写入 World Engine state，但浏览器验收暴露了新问题：Slice Card 会把长 Markdown / events value 铺进主画布，世界切片列表失去扫读能力。
- 本轮把主体系统从“全文字段”进一步补成“文件拓扑 + 可见性边界 + RAG 来源”，并压缩 Slice Card 的 value 展示密度。

## Changes

- `workspace/ming-ding-zhi-shi-2/world-engine/schema.yaml`
  - `character` 新增：
    - `subjectFiles`：六文件路径拓扑，包含 `subject / soul / events / memory / mind / state`。
    - `actorImportPath`：actor 主路 Import 文件，当前为 `soul.md`。
    - `leaderOnlyPath`：仅 simulator.leader 可见文件，当前为 `subject.md`。
    - `directStatePath`：上级直接读取状态文件，当前为 `state.md`。
    - `ragIndexSources`：Subject RAG 索引源，当前为 `events.jsonl / memory.jsonl`。
- Project SQLite 数据
  - 新增 `复兴纪元488年 1月15日 14:00:04` / `kind=init` 切片：`主体系统拓扑初始化`。
  - 该切片为 6 个真实角色写入六文件拓扑、可见性边界和 RAG 索引源，共 30 条 mutations，`issues=0`。
- `WorldEngineWorkbenchPreviewSliceCard.vue`
  - 长字符串 value 改为首段摘要 + 字符数，例如 `... · 1526 chars`。
  - array value 显示 `list · N items · <first item summary>`。
  - object value 显示 `object · N keys · key1, key2, key3`。
  - 每个 subject group 在主画布最多显示 6 条 mutation，剩余显示 `+N mutations`；完整编辑和检查继续交给底部审查工作台 / Inspector。
- `world-engine-workbench-preview.test.ts`
  - 增加 Slice Card 长文本 / object / list 摘要和 per-subject mutation 折叠的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`
- Facade 验证：
  - `queryState({subjectIds:["player"]})` 返回 `subjectFiles / actorImportPath / leaderOnlyPath / directStatePath / ragIndexSources`。
  - `issues: []`。
- 浏览器验证：
  - 打开 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`，进入 Header `WORLD`。
  - Workbench 不显示 schema 缺失警告。
  - 左侧显示 `7 / 7 个主体`。
  - Slice List 显示 `主体系统拓扑初始化`。
  - 主画布显示 object / long text 摘要与 `+N mutations` 折叠。
  - 截图保存在 `.agent/workspace/world-engine-compact-subject-system-dialog.png`。

## Notes

- 后续 [Subject System Information Boundary](2026-06-21-subject-system-information-boundary.md) 已把 `subjectFile / soulFile / visibleState / mind / memory / events` 从当前 reduce state 收口移除。
- 当前方向是：World Engine 记录主体系统拓扑、索引源、旧主体链接和摘要计数；Project Workspace 文件继续是长文本源头，不把主体源文件全文当作世界当前状态。
