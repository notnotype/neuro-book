# agent-kit 四模式编辑与资源组件：实现验证

日期：2026-09-18。批准依据：开发者批准的 `agent-kit-editing-api` 计划（`local://agent-kit-editing-api-plan.md`）。

## 交付内容

新增/变更文件（均在 `packages/agent-kit`、`docs/specs/agent-kit/`、`.agents/works/w00002-neuro-agent-harness-redesign/tasks/t05-agent-kit-editing-api/` 范围内）：

| 路径 | 说明 |
| --- | --- |
| `docs/specs/agent-kit/{editing,resources}.md` | 两份 `planned` 黑盒合同（capability `agent-kit.editing`、`agent-kit.resources`），已登记到 `docs/specs/README.md` 待实现规范表 |
| `packages/agent-kit/src/resources/{types,internal,locator,registry,text-provider,node-provider,index}.ts` | 资源 DTO、locator 解析、registry、静态文本 provider、受控 Node 文件 provider |
| `packages/agent-kit/src/editing/{types,text,virtual-tree,hunks,replace,patch,apply-patch,hashline,observations,blocks,commit,engine,index}.ts` | 四模式规划、行表、观测存储、块定位、提交组件 |
| `packages/agent-kit/src/editing/contract-cases.ts` | 不进入 barrel 的共享合同套件（供其它实现复用） |
| `packages/agent-kit/src/{text,sse}/…`、`src/index.ts`、`package.json` | `./file-tools` → `./text` 迁移；subpath 改为 `./editing`、`./resources`、`./text`、`./sse` |
| 测试 | `resources/{registry,node-provider}.test.ts`、`editing/{engine,hashline,commit,observations,blocks,smoke}.test.ts`、包 `src/smoke.test.ts` |

依赖：`typescript@5.9.3`（dev → runtime）、`mdast-util-from-markdown@2.0.3`、`diff@9.0.0`、`xxhashjs@0.2.2`、`@types/xxhashjs@0.2.4`（dev）。`bun.lock` 差异仅 agent-kit 条目与 4 个新包条目（30 insertions / 2 deletions；两个版本号行是本任务开始前既有的 canary 刷新）。

## 已运行门禁（真实输出）

```
bun run --cwd packages/agent-kit test
  Test Files  11 passed (11)
  Tests  143 passed | 1 skipped (144)

bun run --cwd packages/agent-kit typecheck
  （无输出，exit 0）

bun run docs:check
  {"failures":[],"checkedFiles":5510}

bun run governance:check
  failures: w00003 t14 缺 README.md、AGENTS.md 缺 Leader 顺序开发标记（两项均与本任务无关，来自并行改动）
```

跳过项：`node-provider.test.ts > 更新保留现有 POSIX mode`，`it.runIf(process.platform !== "win32")`；本机 win32，**该平台未验证**。

## 独立核验（不依赖被测实现）

1. **xxhash32 跨实现一致**：用独立实现的标准 xxHash32（参考算法手写，seed 0）与 `xxhashjs` 的 `h32` 对 11 个样本（长度 0/1/3/9/12/14/17/22/31/64/137 字节，含非 BMP）逐位比较，`allMatch: true`。
2. **tag 向量**：以同一独立实现复算内容 tag（去 BOM → CRLF/孤立 CR 归一 → 逐行去尾空白 → 低 16 位大写四位 hex），得到 `alpha\nbeta\ngamma\n = B6C1`、`alpha\nbeta\ngamma = 9FB5`、`alpha\nbeta = B07E`、空文本 `5D05`、`a\nb\n = 9A46`；与 ObservationBlocksAgent 用独立 Python xxHash32 实现算出的向量一致。CRLF 与尾空白两个等价输入得到同一 tag `0063`。
3. **四模式真实文件 smoke**：`editing/smoke.test.ts` 通过 `@notnotype/agent-kit/editing`、`@notnotype/agent-kit/resources` 的公开工厂组装，在真实临时根（`createTestTmpRoot`，测试内 `rm -rf` 清理）完成 replace / patch / apply_patch / hashline 四条写入路径，最终磁盘文本均为 `alpha\nBETA\ngamma\n`；另覆盖 apply_patch 多文件 create/move/delete、严格失败（歧义替换 / 陈旧 tag / 无绑定 / 缺失文件）、规划后外部改动的 `version_conflict`、CRLF/无尾随换行/BOM 保真。

## 代码评审与修复（2026-09-18）

五轴评审记录见 `walkthroughs/001-code-review-2026-09-18.md`。用户在会话中追加了两项需求：README 重写（去掉成员表格，改为签名/参数/行为/用法散文）与 `./text` 的 token 截断（可注入 `TokenCounter`，缺省用内置近似计数，保证 `outputTokens <= maxTokens`）。

评审共 5 项确认缺陷（作者自查 3 项 + 两个独立 reviewer 5 项，去重后 5 项全部修复且各有 RED→GREEN 证据）：

1. hunk 锚语义（匹配起点必须 >= 锚行）与相邻 hunk 共享 context 被误拒；
2. hashline 同 uri 多段改为按段序执行、旧 tag 失效报 `stale_snapshot`；
3. `patch` rename 源操作集改为 `read`+`delete`；
4. 行表把**文件末尾孤立 CR** 当 CRLF 终止符导致静默丢字节（数据损坏，Required）；
5. `commit.ts` 三处：CAS 成功值未校验（假 committed / TypeError 逃出 API 且不补偿）、最后一次 mutation 后缺中止检查、计划拷贝不在接受时刻（`acceptPlan()` 修复）。

另修 1 项新功能缺陷：token 截断的二分切点在 code point 边界空间搜索（此前会挂起或切出孤立低代理）。

## 计划偏差（已记录）

1. **未使用隔离 worktree**：本任务改动全部在允许路径内（`packages/agent-kit/**`、`docs/specs/agent-kit/**`、`docs/specs/README.md`、本 Task 目录、`bun.lock`/根 `package.json` 的依赖条目）。agent-kit 包与根接线均未提交且与其它 Agent 的改动交织，新建 worktree 需要复制这些未提交状态并重装依赖，且不能提升隔离收益（无其它 Agent 写这些路径）。主工作区未切换分支、未 stash/reset/commit/push。
2. **`./file-tools` 无兼容 alias**：搜索确认包外无消费者，旧 subpath 直接移除。
3. **零行 `Add File` 是显式语法扩展**：上游 grammar 要求 `add_line+`；本合同允许紧跟 header 的空 body 创建空文件，已在 Spec 与测试中写明。
4. **同 uri 同 tag 的不同精确版本**：capture 返回 `ambiguous_match` 并保留原记录（不合并 seen、不自动换代）。
5. **`EditState.scope`**：committer lifetime 内生成；恢复相同 revision/registers 也不承认旧计划（`state_conflict`），已由测试锁定。
6. **子代理发现的缺陷**：locator 初版按拼接 key 校验，导致 `local://a%2Fb` 被接受；改为逐段校验后 `%2F`/`%5C` 在解析期被拒（有测试）。
7. **主代理发现的缺陷**：`splitLineTable("")` 曾返回 1 个空行（空文本应为 0 行），导致空文件 hashline 头插被误判 `unseen_range`；已修复并覆盖。
8. **补写修复**：hunk 匹配曾把整个匹配区间按「仅新增行」替换，导致上下文行丢失；改为「上下文 + 新增行」重建并保留原终止符（`engine.test.ts` 锁定）。
9. **块后命名粘贴**：`PUT >N* @name` 与数字开头寄存器名（`@1`）由 `hashline.test.ts` 覆盖。

## 未验证 / 未做

- POSIX 分支：更新保留 mode、POSIX symlink 逃逸、POSIX 非法文件名判定（本机 win32 无法执行）。
- Node provider 在 mutation 中途失败的补偿路径（临时文件清理失败上报 `unknown`、create 部分写入后补偿）只有代码路径，无注入故障测试。
- mutation 开始后的 abort 行为无法在单线程测试中稳定构造，未覆盖。
- 观测默认 64 MiB 预算未用真实 64 MiB 载荷验证（用自定义小预算覆盖 `limit_exceeded`）。
- Rust 实现不存在；共享合同套件 `contract-cases.ts` 已就位，新实现只需提供同形工厂。
- 未接入 NeuroBook 产品（#117 管理）；未实现 sandbox 后端；未提交、未 push、未发布。
- 两份 `planned` Spec 尚未晋升 `implemented`（需 Reviewer 复核与证据确认）。
