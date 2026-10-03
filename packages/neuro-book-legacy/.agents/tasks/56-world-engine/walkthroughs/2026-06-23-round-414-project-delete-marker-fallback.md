# Round 414: Project 删除 marker 兜底

## 背景

Round 413 跑通默认模板完整作者流后，继续追查临时 Project 删除在 Windows dev server 下偶发 20s 超时的问题。这个问题已经不属于 World Engine 切面语义，而是作者完成临时验收或删除 Project 时会直接卡住的基础设施问题。

## 诊断结论

- `GET /api/projects/world-engine/schema` 曾会无谓创建 Project DB client；已改为只读 schema/calendar loader，单独访问 schema 后删除可恢复到约 400ms。
- 真实写入链路仍可复现删除超时：创建 subject、写 slice、读 state 后，`DELETE /api/projects/item` 偶发停在 Project 根目录物理删除。
- raw libsql repository 能让部分轮次成功，但不能根治：HTTP 验证中出现成功 927ms、失败 20s 的混合结果。
- 边界日志确认 close 阶段都在 1-2ms 内完成，卡点在 `fs.rm(projectRoot)`；成功轮也会出现 7-12s 长尾。
- 子进程 `fs.rm` 仍会偶发超时；PowerShell `Move-Item` 也会在 `project.sqlite` 被占用时失败。

## 实现

- `deleteProjectWorkspace()` 保持先释放 Plot、World Engine、Agent SQLite 和 workspace tree index。
- Windows 下删除 Project Root 改为两层兜底：
  - 优先把 Project 目录移动到 `workspace/.nbook/deleted-projects/`，然后后台清理。
  - 若移动也被 SQLite 句柄挡住，写入 `.nbook/deleted-project.json`，并尝试把 `project.yaml` 移到 `.nbook/deleted-project.yaml`，让 Project 立即从列表与正常入口消失；物理目录留给后台清理。
- `listProjectWorkspaces()` 会跳过 deleted marker 目录。
- 新建 Project 分配 slug 时会把已标记删除但未物理清理的目录也视为占用，避免同名新 Project 复用旧目录。
- `WorldEngineRepository` raw libsql 参数类型从 `InArgs` 收窄为位置参数数组，修掉本轮 typecheck 暴露的 World Engine repository 类型错误。

## 验证

- `bunx vitest run server/workspace-files/project-workspace-delete.test.ts`：1 file / 3 tests passed。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts`：1 file / 69 tests passed。
- 真实 HTTP 回归 5 轮通过：
  - 每轮创建 Project、读 schema、创建 `world` subject、写入 `world.events` slice、查询 state、删除 Project。
  - 5 轮 `DELETE /api/projects/item` 均返回 `{"success": true}`，耗时约 0.9-1.6s。
  - 5 轮删除后 Project 均不再出现在 `/api/projects` 列表。
  - 2 轮物理目录已消失；3 轮保留 deleted marker，符合后台清理兜底语义。
- `bun run typecheck`：仍失败于既有无关 `server/agent/tools/control-tools.test.ts` 类型漂移；本轮修掉了 `server/world-engine/world-engine.repository.ts` 的类型错误，typecheck 输出不再包含 World Engine / Project delete 新错误。

## 与计划出入

- 原本以为继续释放 SQLite client 或扩大 retry 能解决；真实 HTTP 证明 retry 和 raw repository 都只能降低失败概率。
- 最终改为产品语义兜底：删除 API 返回时保证 Project 从用户可见列表消失，并阻止同 slug 复用；物理删除不再阻塞作者操作。
- 本轮没有继续增加 World Engine 畸形输入校验，也没有触碰前端交互。
