# nb-history 集成（操作日志 / 文件历史接入 NeuroBook）

> **状态：已实施并验收（2026-07-09；2026-07-10 经 Task 102 完成 Composer / 安全 diff / profile-controlled notice 演进与浏览器终验）**——自动化门禁与 `$playwright-cli` 真实浏览器验收全绿，临时数据已清理并恢复原 Inbox 基线。实施计划见 `~/.claude/plans/1-writer-tidy-hamster.md`（批准版），本 README 记录执行结果与偏差。

## Relative documents refs

- [Task 91 操作日志 / 文件历史](../91-operation-log-file-history/README.md)：**主档案**——模块契约（GOAL.md）、spike 验收结果、集成可行性分析（挂点核实 + 前置发现 + 决策点）都在那里，本目录不重复，只做集成执行记录。
- [Task 94 生命周期模型重构](../94-project-lifecycle-model/README.md)：前置——WorkspaceHistory 注册为 ProjectSession 资源，项目 open 时开库（D13）。
- `../nb-history/`：模块本体（sibling 仓，31 tests 验收全绿；README = API 文档，NOTES = 契约发现 14 条）。

## User Request / Topic

Task 91 spike 验收通过、集成可行性定案后，用户确认集成任务与生命周期重构一并推进：「本次任务涉及到了 "NeuroBook 底层的项目生命周期模型重构" + "集成 nb-history"」。

## Goal

NeuroBook 全部写入路径接入 nb-history 记账，四视图（单文件时间线 / 删除找回 / 用户收件箱 / 会话 unseen 提醒）在宿主可用；隐私红线落实（history.sqlite 严禁进入 task 72 可分享日志包）。

## Decisions / Discussion

**D7–D15 已批复（2026-07-09，用户）**，其中 D8 附语义澄清、D15 按用户新需求反转为「做」并拆两半：

| # | 决策点 | 批复结果 |
|---|---|---|
| D7 | 驱动 | **批**：留 `@libsql/client`（宿主全线 libsql；Docker 形态可能跑 node，bun:sqlite 不存在） |
| D8 | auto-accept | **批**：默认开、N=14 天未审自动接受，`global-workspace` scope 可配。**语义澄清（批复时确认）**：接受 ≠ 删除——只推进「已过目」位点，时间线/diff/找回不受影响；不自动接受的代价 = inbox 退化全扫（spike 实测 1 万条 32–67ms 超线）+「未接受段永不 prune」使磁盘无上限增长。用户如不适可调大 N。 |
| D9 | 编辑器自动保存节流 | **批**：先实测前端保存频率再定窗口；收口层「hash 相同不记账」直接做 |
| D10 | userId | **批**：固定 `"local"`（模块天然 n 用户，以后零迁移） |
| D11 | workspace CLI 归因盲区 | **批**：v1 接受 external 归因 + 自回声；红线：CLI 永不自开 history.sqlite |
| D12 | `fileChangeAwareness` | **原批复**：默认 minimal；leader.default = full（+先写后补 instruction）；inline editor = off。**Task 102 演进**：取消 Harness 默认 fallback，改为 Profile DSL 显式声明；Leader=full、Writer=minimal、Inline Editor 不声明。 |
| D13 | history 库打开时机 | **批**：项目 open 时预热（显式生命周期给了 eager 的自然位置） |
| D14 | prune 调度 | **批**：项目 open 时距上次 ≥24h 则后台跑一次（fire-and-forget，不阻塞 open 返回） |
| D15 | closed 期间的外部变更可见性 | **批·反转为「做」**（用户需求：应用关闭期间的外部改动，打开后必须能看到改了什么）。拆两半：**D15a 记账层**——open 时后台增量对账扫描（搭 tree index 初扫的目录遍历便车取 mtime，mtime/存在性过滤后逐文件 `reconcile`，账本 vs 磁盘缺失文件记外部删除进删除找回）；**D15b 呈现层**——external 条目**不触发收件箱**（模块语义：收件箱只由 agent/system 条目触发，`nb-history/README.md` 语义要点），所以宿主必须补外部变更的用户可见入口：open 扫描发现变更时 notification 提示 + 一个「外部变更」列表视图（timeline 按 actor 过滤；可能需要 nb-history 增加跨文件按 actor 查询的小 API）。能力边界如实声明：只能看到净变化（关闭期间多次编辑合并为一版首尾 diff）；mtime 被工具保留时可能漏检，写路径对账兜底正确性，可加手动「全量对账」入口。 |

**批复过程中确认的既有语义（防误解，非新决策）**：external 事件天然进各 agent 会话的 unseen（人机互知的机器侧不受 D15b 影响）；扫描用的 `reconcile` 幂等、回声由 hash 比对吸收。

### 2026-07-18 Project Runtime Artifact 路径收口

- World Engine 运行后生成的 `.runtime-artifact-import-cache/**/*.mjs` 曾被 watcher 和 history 纳入 Project 内容，真实项目已有 2 条 `external file.create` 污染记录。
- 路径策略收口为共享的 runtime-generated path Module，watcher、history、Project Workspace File Index 与 Project 下载统一排除；World Engine artifact 同时迁入 Project Workspace `.nbook`。
- 只扩充过滤会让 D15 把旧账补成一次 `external file.delete`，因此 `nb-history` 增加模块内原子 `purgePaths`，历史实例必须先清理不再受管的路径，再对外提供 unseen/inbox 并运行 D15。
- 清理只删除错误路径的 operation/acceptance 与孤儿快照；正常文件历史和 session cursor 保留，不重建 history.sqlite。
- D15 回归测试允许继续补记 `project.yaml` 等合法外部变化，只断言 runtime artifact 不出现在 unseen/timeline；不能为了隔离生成物而屏蔽其它真实 Project 内容变化。
- Project 下载继续包含已有 `history.sqlite`，但改为独立在线 snapshot，不复制 live WAL/SHM。该文件是完整备份数据，可能包含全文快照、已删除正文、acceptance 与 session cursor；它只禁止进入 Task 72 可分享日志包，不禁止进入用户主动下载的完整 Project 备份，前端必须提示隐私风险。

### 2026-07-18 File Index / History 并发预热竞态

- Project open 仍可并发预热 Tree 与 History；不引入全局锁或人为延时。
- `.nbook/history.sqlite-shm` 的 `ENOENT` 来自 `readdir → sidecar 消失 → stat` 的实时文件系统竞态，不表示 History 打开、purge 或 SQLite 数据损坏。
- 修复归属 Project Workspace File Index：单节点扫描期间只有 `ENOENT` 被视为“本轮 snapshot 忽略该路径”，`EACCES`、containment 越界与其他 I/O 错误继续失败。History 生命周期和 purge 顺序不为此改变。

## Verification / Test

- 2026-07-18 File Index / Archive 收口回归：显式与递归 runtime artifact target、Tree/History 并发预热下消失的 `history.sqlite-shm`、非 `ENOENT` 错误传播、live Project/History SQLite 在线 snapshot 与 WAL/SHM 排除均由自动测试覆盖；`history.sqlite` 的完整备份隐私提示已进入 Project 下载确认框，user-assets 不显示该提示。
- 2026-07-09 初始 vendor 同步二跑幂等（copied=0 / manifest unchanged，sourceCommit `5df28cf`）。
- 2026-07-18 `nb-history` 源仓 `bun test` 38/38、`bun run typecheck` 通过；最终单一源码提交 `ce65f57`。`bun run sync:nb-history` 二跑 `copied=0, unchanged=10, manifest=unchanged`，`VENDOR.json.sourceCommit` 为完整 SHA `ce65f57d6fdbf6816d497a02374cf9716aef27fe`。
- 2026-07-18 NeuroBook 聚焦验证：Workspace History / Index / Archive 20 tests、World Engine / runtime artifact import 33 tests、FileChangeNotice / Harness 18 tests 全绿；`bun run typecheck` 退出 0。完整 `server/workspace-history` 与 `server/world-engine` 目录回归另暴露 6 个旧 `target` fixture 和 7 个既有 World Engine/Zod 断言失效，均不在本轮改动文件内，未混入本任务修复。
- 真实项目 operation `1102` / `1103` 的数据验收待安全窗口执行：2026-07-18 验收时检测到 NeuroBook dev server 仍在运行，无法证明目标 Project 未被占用，因此未触发真实 ProjectSession/History open，也未直接修改 SQL。应用停止后再按“只读前置记录 → 正常 open 触发 purge → 关闭后只读复核”的 runbook 验收。
- `bun run profile:metadata`：3 个 stale profile（writer / leader.default / inline.editor）重编译无残留。
- `bun run typecheck` 全绿。
- 靶向 vitest 全绿：`server/workspace-history`（15+3+2）、`server/config`、`server/api/workspace-files`、`server/workspace-files`（含 4 个 watcher 修复回归）、`server/agent/tools`（47）、`server/agent/harness`（243，含 file-change notice 黑盒端到端）、profile contract（18）。
- 初始 Task 95 浏览器冒烟清单已由 Task 102 的 `$playwright-cli` 终验覆盖：收件箱折叠与 diff、准确打开文件、敏感正文阻断、版本冲突 412 与刷新链均通过；Agent notice 的顺序、预算和游标语义由 FauxProvider 黑盒测试覆盖。Task 95 未在 Task 102 范围内扩展时间线、删除找回与 D15b 外部变更列表。

## Implementation Walkthrough

按批准计划 S0–S8 切片执行（2026-07-09）：

### 落地内容

- **S0 watcher 前置**：`isIgnoredWorkspaceWatchPath` 扩到 `.git/.nbook/.agent` 任意段；新增 `onProjectWorkspaceFileChange` seam（防抖合并批后通知，只对 `workspace/<slug>` 的 project-workspace root）。
- **S1 vendor**：`scripts/cli/sync-nb-history.ts`（SHA-256 比对镜像 + `VENDOR.json`）→ `server/vendor/nb-history/`；`package.json` 加 `sync:nb-history`；vendor 冒烟测试。初始源仓两笔改动（`Bun.gc` 改 globalThis 访问以兼容无 @types/bun 宿主；新增 `liveFiles()` 支撑 D15 删除检测），commit `b7e6de4` + `5df28cf`；2026-07-18 原子 path purge、去重路径扫描、`from_path` 索引及事务失败/rename 两端回归统一收口在 commit `ce65f57`。
- **S2 config**：`history` section 五字段（enabled / retentionFullDays / keepDailyLastAfterWindow / autoAcceptEnabled / autoAcceptDays），scope `global-workspace`，project 覆盖结构性剥离 `enabled`（DTO omit + patch normalizer + config-service 400 拒绝）。
- **S3 门面**：`server/workspace-history/project-history.ts`——ProjectSession 资源属主（open 预热 + 懒开 in-flight 去重 + close 级联）、watcher 批对账（unlink→reconcile(null)、8MB 读盘上限）、记账入口（fail-open）、`readUnseenForAgent`（懒 initCursor N8）/`advanceAgentCursor`、D15 open 全量对账扫描（磁盘遍历 reconcile + `liveFiles()` 反查补删除账）、24h 维护（auto-accept D8「组末条也超龄才整组接受」→ prune）。`history-paths.ts` 谓词（`.git/.nbook/.agent` 任意段 + 根层 `agents/`）。`server/api/projects/open.post.ts` 加 fire-and-forget 预热。
- **S3b 路径策略维护**：2026-07-18 起，每个 `WorkspaceHistory` 实例首次打开时，在返回给 inbox、unseen、watcher、写入或 D15 消费方之前调用 `purgePaths(path => !isHistoryTrackedRelativePath(path))`；未使用 History 的 ProjectSession 不会仅为维护而强制开库。D15 磁盘扫描与账面反查继续使用同一谓词。runtime artifact 路径知识留在宿主共享 Module，通用 nb-history 只拥有事务清理 Interface。
- **S4 写面收口**：`tracked-workspace-files.ts` 包装层（非项目 root 零成本透传；convert = 一条 rename `foo.md→foo/index.md`；目录 rename/delete 展开为逐文件记账，delete 先读 before 保找回；upload 只记 `action==="written"`，二进制由模块 NUL 判定降级 hash-only）。接线 8 条路由（write/create-file/create-directory/delete/rename/convert/upload-file/upload-project）+ `chapter-bootstrap.service.ts` frontmatter 反指写入记 system(`chapter-bootstrap`) 账。write 路由冲突检测已读内容复用为记账 before（`knownBefore`）。
- **S5 agent 归因**：`agent-file-recorder.ts`（绝对路径反推项目归属，支持跨项目别名；`String(sessionId)` 集中转换 N5）；file-tools write（写前补读 before）/ edit（before=original）/ apply_patch（`applyCodexPatch` 暴露 `changes: PlannedFileChange[]`，逐条记账）。
- **S6 harness 感知（历史实现，已由 Task 102 演进）**：三 builtin profile 加 `fileChangeAwareness` radio（leader=full / writer=minimal / inline.editor=off 新增最小 settingsForm）；`RunFrame.fileChangeAwareness`（sidecar 等缺省 off）+ `pendingHistoryCursorAdvance`；settings 经 `PreparedRunProfile → PreparedRun → runLoop` 流出（未声明 profile 回退 minimal，D12）；`file-change-reminder.ts` 纯函数生成 `<file-change-notice>`；`runTurnTransaction` steer 后单挂点注入（N7）+ savePoint 持久化 + leaf 回填，ingest 成功分支（含 waiting）才 `advanceCursor`（N9）。当前实现见下方 2026-07-10 演进说明。
- **S7 收件箱 UI（历史实现，已由 Task 102 演进）**：`server/api/workspace-history/`（inbox / snapshot / accept / revert，userId 服务端固定 local，revert 后失效 workspace 索引）+ `shared/dto/workspace-history.dto.ts` + `history-dto.ts` 映射；`WorkspaceHistoryInboxDialog.vue`（左组列表含归因/删除徽标 + 右 SharedDiffEditor 按 hash 按需拉全文 + accept/revert 行操作，revert 走 danger confirm）；Header「变更」入口（仅 novel 模式）+ index.vue 三点接线 + i18n en/zh。当前正文读取已硬切安全 diff API，不再保留 snapshot 公开路由。
- **S8 红线**：`server/app-logs/archive.ts` 顶注 + task 72 README 登记（history.sqlite 含全文快照严禁进日志包）。

### 与计划的偏差（须知）

1. **D15 按反转后版本实现**：批准计划正文写「不做 open 全量扫描」，但用户在并行批复中已把 D15 反转为「做」（见上方决策表）；实现按反转版：`openProjectHistoryAndMaintain` 做全量对账扫描（未搭 tree index mtime 水位便车，直接磁盘遍历 + reconcile 幂等吸收，更简单且正确；性能不够再优化）。**D15b 呈现层（外部变更 notification + 列表视图）本轮未做**，留 TODO。
2. **`createWorkspaceContentState` 未包装**：全仓无调用方（死入口），跳过。
3. **vendor 冒烟的「库文件可删」断言降级**：vitest worker 无 `Bun.gc` 时自然 GC 不可控，该断言只在有 Bun.gc 时严格执行；严格覆盖保留在源仓 bun test（T12）。
4. **apply_patch `moveTo` 不聚合 rename**：moveTo+chunks = 改名+改内容，不满足模块 rename「内容不变」语义，按 planned changes 拆 delete+add 各记一条（罕见操作，时间线在此断链，接受）。
5. **顺带修复两个既有 bug（S4 回归暴露，非本任务引入）**：
   - `managedProjectPath` 把 user-assets root（`workspace/.nbook`）误判为受管项目 → user-assets 全部数据面路由会 409（Task 94 遗留，upload-file mock 测试一直红）。修复：谓词排除 `WORKSPACE_NBOOK_ROOT`，`historyProjectPathFromRoot` 冗余特判收敛到该单一权威。
   - S0 忽略段扩展暴露 chokidar `ignored` 用**绝对路径**判定的既有缺陷：root 自身路径含 `.nbook`（user-assets）或 `.agent`（测试目录）时整个 watch root 被忽略。修复：先 `path.relative(root, ...)` 再判段。
6. **执行过程违规自报**：S2 期间曾用 heredoc（`cat >> ... << 'EOF'`）追加 normalizer.test.ts，违反「永远不要用 shell 工具代替文件编辑工具」规则；当场自查停止，内容经测试验证正确，其后全部改用编辑工具。
7. **测试覆盖取舍**：S6 黑盒覆盖「notice 注入→游标推进→不重复→懒基线→无 projectPath 跳过」端到端；「失败轮不推进」未做黑盒（settle 只在成功路径调用，由代码结构保证 + N9 注释锚定）。清单第 3 条的「write 工具 hash-since-read 新鲜度检查」未做（独立增强，非记账链路，留 TODO）。

### 2026-07-09 验收（主会话）

**代码走查（重点面全部核实）**：门面 `ensureProjectHistory` 以 `isProjectOpen` 为闸——懒开不绕过生命周期，控制面写入（项目创建/zip 导入，未 open）自然不记账、由首次 open 的 D15 扫描收编为基线，与 Task 94 严格守卫恰好咬合；fail-open + 模块内建对账兜底的分层正确；S4 包装层 before 先读后写、目录删除先存快照；S5 绝对路径反推归属 + `managedProjectPath` 单一权威；收件箱 API userId 服务端固定；初始基线（账本空 + external 不触发收件箱 + 懒 initCursor 置头部）符合批复审查的预期设计。两个顺带 bug 修复（`managedProjectPath` 误纳 `workspace/.nbook`、chokidar ignored 绝对路径判定）核实为真既有 bug 且修法正确。

**验收发现并修复 1 个真 bug（游标 off-by-one）**：harness 注入后 `pendingHistoryCursorAdvance = maxEntryId + 1`，而模块游标语义是 `last_seen_entry_id`（unseen = `id > 游标`，`UnseenGroup.maxEntryId` 注释明确要求原样传）——多传 1 会把 agent 回合进行中恰好落在 `max+1` 的下一条他人写入**永久吞出 unseen**（正是本功能要覆盖的「agent 跑着时用户改文件」场景）。原有测试因自己会话的下一条恰好占住关键 id 而钉不住该 bug。修复：harness 去掉 `+1`（`neuro-agent-harness.ts` + `run-kernel-types.ts` 注释）；`project-history.test.ts` 改按契约传 `maxEntryId` 并补回归钉子（推进后紧接着的下一条他人写入必须重新可见）。

**验证复跑**：全量 `bun run test` = 1562 passed / 3 failed / 3 skipped（3 个失败全部集中在 `profile-build-coordinator.test.ts` 的 3s waitFor 超时，**单跑 8/8 全绿**——既有 debounce 时序 flaky，仅全量负载下出现，非本任务引入；随套件增长恶化，建议后续放宽其 waitFor 预算）；修复后 `server/workspace-history` + harness black-box 全绿（35 + 17 例）。`bun run typecheck` 剩 2 个错误，均在 `PlotDecisionLedgerTab.vue`（Task 93 规划层前端，非本任务改动面，归属并行任务处理）。

**结论：验收通过**（含验收轮 off-by-one 修复）。偏差 1–7 全部核定接受；D15b 呈现层等 TODO 维持。

### 2026-07-10 Task 102 演进

- Composer 输入卡上方新增默认收起的文件变更摘要，与完整 Dialog 共用 inbox 状态；小型安全文本 diff 可按需内联展开。
- 公开 hash-only snapshot API 已删除。新 `/api/workspace-history/diff` 必须用当前 inbox path + group revision 授权；accept/revert 同样要求 group revision，accept-all 要求 Inbox revision，过期统一 412，绝不对旧版本读 diff 或执行动作。
- 敏感策略扩展为明确黑名单：`.ssh/.aws/.azure/.kube/.docker/.gnupg`、所有 `.env` 变体与 `.envrc`、常见凭据文件、私钥名及 `.pem/.key/.p12/.pfx/.jks/.keystore` 在 `textDiff` 前阻断；不使用 `secret` 等宽泛子串，不扫描正文。
- `<file-change-notice>` 所有权移交 Profile DSL：`<FileChangeNotice />` 生成 turn context plan，Harness 只做通用物化与成功 ingest 后 settlement；未声明节点时 0 notice。
- Leader 显式 full、Writer 显式 minimal、Inline Editor 不声明；原 inline editor 的 `fileChangeAwareness` settingsForm 已删除。
- Agent notice 在单文件预算外增加整轮硬保护：最多 4 个文件详情、50 个逐项文件、inline 总额 `min(8192, diffMaxChars × 4)`、最终 notice ≤12,288 字符；reference 不再保留 diff 正文，删除路径不生成当前文件链接。
- Composer / Dialog diff 缓存键固定为 `projectPath + path + revision + mode`，项目切换、Inbox 刷新和卸载会 abort 旧请求；浏览器验收确认延迟旧响应不回填。Inbox 加载绑定宿主 active/open 生命周期，消除 ProjectSession open 前早发 409。
- 验证：Workspace History / API 37 tests、Task 102/Profile 聚焦 70 tests、Agent tools 147/147、全仓 typecheck 退出 0；`$playwright-cli` 真实验收通过并恢复原 Inbox 基线。

详见 [Task 102](../102-agent-change-inbox-and-prompt-order/README.md)。

## TODO / Follow-ups

- [ ] D15b 呈现层：open 扫描发现外部变更时 notification + 「外部变更」列表视图（需要 nb-history 跨文件按 actor 查询小 API 时先在模块仓做）。
- [ ] 时间线 / 删除找回面板（`WorkspaceHistory.timeline/deletedFiles/restore` 服务端能力已就绪，UI 未建）。
- [ ] write 工具 hash-since-read 新鲜度检查（Task 91 D11 顺带项）。
- [ ] 设置页 history section 表单 UI（当前 JSON/API 可配）。
- [ ] 下游（不在本任务内）：先写后补 leader instruction + 回补设定 skill → 整书导入。
