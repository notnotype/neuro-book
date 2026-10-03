# 2026-06-21 Subject System Information Boundary

## Summary

- 继续修正 `workspace/ming-ding-zhi-shi-2` 的主体系统适配。
- 上一轮已经把六文件主体系统写入 World Engine state，随后又补了 `subjectFiles / actorImportPath / leaderOnlyPath / directStatePath / ragIndexSources` 拓扑字段。
- 本轮根据 `reference/content/simulation.md`、`reference/content/subjects.md` 和 `reference/content/subject-rag-memory.md` 收口信息边界：World Engine 只记录主体系统拓扑、RAG 来源和计数，不再把 `subject.md / soul.md / mind.md / state.md / memory.jsonl / events.jsonl` 全文镜像到当前 reduce state。

## Changes

- `workspace/ming-ding-zhi-shi-2/world-engine/schema.yaml`
  - `character` 保留：
    - 默认身份 / 世界状态字段：`hp / maxHp / location / faction / inventory`。
    - 旧主体链接字段：`sourcePath / legacyKind / controlledBy / profile / canonicalSource`。
    - 主体系统拓扑字段：`subjectFiles / actorImportPath / leaderOnlyPath / directStatePath / ragIndexSources`。
    - 摘要计数字段：`eventCount / memoryCount / subjectSystemVersion`。
  - `character` 移除不再作为 World Engine 当前状态字段使用的全文 / 镜像字段：
    - `subjectFile`
    - `soulFile`
    - `visibleState`
    - `mind`
    - `memory`
    - `events`
- Project SQLite 数据
  - 新增 `复兴纪元488年 1月15日 14:00:05` / `kind=init` 切片：`主体系统信息边界收口`。
  - 该切片对 6 个真实角色执行 `unset`：
    - `subjectFile / soulFile / visibleState / mind / memory / events`
  - 该切片通过 `WorldEngineFacade.writeSlice()` 写入，未直接修改 SQLite。

## Verification

- Facade 验证：
  - `writeSlice()` 返回 `issues: []`。
  - `queryState({ subjectIds: ["player", "armand-brauer"], attrs: [...] })` 不再返回 `subjectFile / soulFile / visibleState / mind / memory / events`。
  - 同一查询仍返回 `subjectFiles / actorImportPath / leaderOnlyPath / directStatePath / ragIndexSources / eventCount / memoryCount`。
- 设计验证：
  - `subject.md` 继续只由 `simulator.leader` 读取，不经 World Engine State Snapshot 暴露。
  - `soul.md` 继续作为 actor 主路 Import 源，不经 World Engine State Snapshot 暴露。
  - `events.jsonl / memory.jsonl` 继续作为 Subject RAG 源头，不把完整条目复制成世界当前状态。

## Notes

- 历史 slice 中仍保留上一轮写入的全文 mutations；这是 timeline 历史事实。当前可 reduce state 已由本轮 unset slice 收口。
- 本轮不改后端 DTO / API，也不新增通用迁移工具。
- 若后续要让 World Engine 与 Subject RAG 深度联动，应单独设计 source trace / projection API，而不是把主体源文件全文写进 World Engine state。
