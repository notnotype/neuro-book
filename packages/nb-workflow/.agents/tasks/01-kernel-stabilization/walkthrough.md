# Task 01 Walkthrough：Workflow Kernel 稳定化

> 状态：Merged via PR #1（2026-08-12）
>
> Task：[`README.md`](README.md)

## Round 0：仓库保护、GitHub 基线与任务启动

日期：2026-08-11

### 目标

在不修改用户 dirty `master` 和外部 worktree 的前提下，为 `nb-workflow` 建立公开
远端、可复现基线和独立稳定化 Task。

### 仓库基线

```text
repository:
C:\Users\<user>\Documents\CodeRepository\GithubProjects\nb-workflow

master:
cf34d1567181f77b49f12721648f8f73c3385120

dirty files:
src/index.ts
src/ports.ts
src/runner.ts
src/types.ts
test/kernel.test.ts
test/scenario-rp.test.ts

external worktree:
C:\Users\<user>\Documents\CodeRepository\GithubProjects\
  neuro-book\.agent\workspace\wt\nb-workflow-contract

external branch:
fix/i46-nb-workflow-contract

external HEAD:
c071ad55b2cd1c8efeb044a956483574835fd3b2
```

主工作区 staged 0、untracked 0。dirty 内容与外部提交只在 `AskSpec.description`
及对应测试上不同；Task 尚未决定保留哪一种产品形态。

### GitHub

创建公开仓库：

```text
https://github.com/notnotype/nb-workflow
```

已推送：

- `master@cf34d1567181f77b49f12721648f8f73c3385120`
- `fix/i46-nb-workflow-contract@c071ad55b2cd1c8efeb044a956483574835fd3b2`

未提交的 6 个文件没有进入远端，也没有被修改。

### 验证

干净 `origin/master`：

```text
bun install --frozen-lockfile
bun test
bunx tsc --noEmit
```

结果：

- 13 tests；
- 78 assertions；
- TypeScript 通过。

dirty `master`：

- 18 tests；
- 96 assertions；
- TypeScript 通过。

外部修复分支：

- 18 tests；
- 97 assertions；
- TypeScript 通过。

### 决定

- 从干净 `origin/master` 创建
  `codex/feat-t01-kernel-stabilization`。
- worktree 位于仓库目录之外，避免给 dirty 主工作区增加新的未跟踪目录。
- 候选修复逐项迁移并补 conformance，不直接 merge/cherry-pick。
- Cosmos Task 04 只作为 Host/recovery/parity 证据，不复制其 Runtime。

### 下一步

先为候选修复和通用 Kernel 合同建立 characterization/conformance 测试，再调整
Runtime 与 Port。当前没有修改 `nb-workflow` 主工作区或 Cosmos 代码。

## Round 1：候选生命周期修复与 Backend Port

日期：2026-08-11

### 修改

- 逐项移入 UUID Run ID、`cancelled` 终态、Agent `AbortSignal`、迟到成功拒绝、
  完整 usage 和 `AskSpec.description`。
- 新增 `WorkflowBackend`、显式 `BackendCapabilities`、CAS revision、
  `DefinitionRegistry`、`Clock` 和 `IdGenerator`。
- Memory Backend 明确声明仅当前进程有效，不声称进程重启、多 Worker、durable
  signal/timer 或 Child Workflow。
- 建立不依赖 Bun/Vitest 的 Backend conformance cases。

### 验证

- Backend conformance：8 tests 通过。
- 候选生命周期 focused：11 tests / 57 assertions 通过。
- strict TypeScript 通过。

## Round 2：Runner 持久恢复与定义身份

日期：2026-08-11

### 修改

- Runner 的 Run、journal、pending ask、日志、进度、终态和 revision 进入 Backend。
- 第二个 Runner 可从共享 Backend 和 Registry hydrate 后 `rerun()`，已完成
  Activity 不重复执行。
- 重跑先清除旧 result/error/log/progress/pending，再持久化 `running` 投影。
- `cancel()` 改为可等待的 durable 操作；运行中请求保存
  `cancelRequestedAt`，waiting Run 取消后不能 resume/rerun。
- `resume()` 先验证全部答案，再原子写 ask journal，避免部分答案污染内存状态。
- `RunView` 改为深隔离快照。
- Definition reference 固定 key、version 和 manifest hash；只读 Run view 不要求
  加载 executable，但 replay 必须命中精确 manifest。

### 发现与修复

- 原实现只标记 dirty suffix，没有删除未再次执行的旧 journal。
- `map/all` 原先没有结构 marker，输入缩短后已消失分支仍残留。
- 修复后 mismatch 会删除同路径后缀和对应子分支；`kernel.map/all` marker 固定
  分支根 identity。

## Round 3：通用 Activity 与可恢复控制流

日期：2026-08-11

### 修改

- Agent/Session Port 改为可选；普通 Workflow 可以只注入空 Core ports。
- 新增 `ActivityExecutor`，`wf.callAction()` 和 journaled `wf.query()` 共享
  `path + seq + kind + fingerprint` identity。
- Activity idempotency key 包含 Run、path/seq、kind 和 fingerprint digest；
  参数变化不会错误复用旧外部执行。
- 新增受控 `wf.now()`、`wf.random()`、持久 budget 和取消读取。
- 新增内容寻址 `ValueStore`、inline 上限和 `WorkflowValue`；大 Activity output
  只以 SHA-256 `ValueRef` 进入 journal。
- 新增 `wf.checkpoint()` 和幂等 `EventSink`。
- 新增三类可恢复等待：
  - Signal Store：publish/consume 幂等，消费绑定 Activity identity；
  - Timer Store：首次 `dueAt` 固定，replay 不滑动；
  - Child Workflow Store：父 Activity 稳定绑定一个 child Run，Host 持有 child
    终态和取消传播。
- `map/all` 使用默认并发与硬上限；并发失败按最低输入 index 决定，不依赖完成
  时序。

### 当前验证

```text
bun test \
  test/backend-conformance.test.ts \
  test/runner-backend.test.ts \
  test/activity-runtime.test.ts \
  test/wait-runtime.test.ts \
  test/kernel.test.ts \
  test/scenario-rp.test.ts
```

结果：

- 39 tests；
- 131 assertions；
- 0 failures；
- `node node_modules/typescript/bin/tsc --noEmit` 通过。

这些是 focused 证据。全量场景、Node build/dist、公共 export、Markdown、质量审查
和发布分支门禁尚未运行。

### 保护边界

- 用户 dirty `master` 的 6 个文件未修改。
- 外部 `fix/i46-nb-workflow-contract` worktree 未修改。
- Cosmos Runtime/Worker 未开始 convergence。

## Round 4：Core/Extension 拆分、Node 交付与完整门禁

日期：2026-08-11

### 结构收敛

原 `runner.ts` 一度达到约 1,400 行，同时拥有 Run codec、Activity engine、
Context、Agent extension 和控制面。重构后：

- `runner.ts`：Runner façade 与生命周期控制；
- `runtime.ts`：Activity identity、journal replay、wait 和 invalidation；
- `workflow-context.ts`：Core Workflow API 与并发；
- `agent-extension.ts`：Session/Agent/Workspace/Caller；
- `run-record.ts`：Backend state 与 public view codec；
- `runner-support.ts`：启动选项和小型生命周期 helper；
- `runtime-events.ts`：观测事件。

`runner.ts` 降至 500 行以下，没有建立第二套 Kernel。

类型层固定：

- `WorkflowContext`：Core；
- `AgentWorkflowExtension` / `AgentWorkflowContext`：可选扩展；
- `WorkflowDefinition` 默认使用 Core；
- Agent 场景显式使用 `AgentWorkflowDefinition`；
- 旧 `Wf` 仅保留兼容别名。

### Value 与输入边界

- Activity fingerprint 从原始 canonical JSON 改为 SHA-256。
- 非 JSON 值、非有限数、Date/class、getter、稀疏数组、循环引用和过深对象在
  边界拒绝。
- Run input、Activity output、checkpoint 和 terminal result 都使用
  `WorkflowValue`；大值只保存内容寻址 `ValueRef`。
- Run 创建时深拷贝输入；每次 replay 给脚本新的执行副本，调用方或脚本修改不会
  改写持久 input snapshot。
- Backend/CAS 写失败不再伪装成业务 `failed` Run，而是拒绝执行 Promise。

### 构建发现

第一次 Bun build 虽返回 0，但 1.6 KB bundle 只保留导出名，没有类定义；纯 Node
报：

```text
SyntaxError: Export 'ActivityDefinitionNotFoundError' is not defined in module
```

原因是 Bun 1.3.14 在当前 re-export 结构与 `sideEffects:false` 组合下错误裁剪。
移除该声明后 bundle 恢复为约 80 KB。

第二个门禁发现 declaration emit 使用 extensionless relative specifier，NodeNext
报 TS2834。构建现在通过确定性脚本为 `.d.ts` 相对导入补 `.js`，并以真实
NodeNext consumer 验证。

### 完整验证

```text
bun test
```

- 12 files；
- 63 tests；
- 196 assertions；
- 0 failures。

```text
bun run typecheck
bun run verify:package
bun build demo/generate.ts --outfile .agent/tmp/demo-compile/generate.js \
  --target bun --format esm
```

结果：

- strict TypeScript：通过；
- Bun bundle：通过；
- NodeNext declaration consumer：通过；
- pure Node package smoke：`NODE_PACKAGE_SMOKE_OK`；
- demo compile：通过；
- `npm pack --dry-run --json`：54 个 package entries，约 84 KB 压缩包。

### 未验证

- 真实进程重启和多 Worker；
- Cosmos Prisma Backend；
- Redis/PostgreSQL/S3；
- Harness/真实模型；
- Cosmos Worker/Host convergence。

这些不属于 Memory Kernel 完成证据，继续由后续 Task 单独验收。

## Round 5：合并前质量审查与稳定性补强

日期：2026-08-11

### 审查范围

按 merge、code、architecture 和 structure 四个维度重新审查
`origin/master@cf34d1567181f77b49f12721648f8f73c3385120` 到 Task
worktree 的完整变更。审查先只读复现，再以公共 seam 逐项执行
red → green；没有修改用户 dirty `master`、外部修复 worktree 或 Cosmos。

### 合并前修复

- 危险 JSON key `__proto__` 原先与空对象得到相同 fingerprint；canonical object
  改为 null-prototype，并增加公共回归测试。
- Activity options 原先会把未知字段传给 Executor，却不写入 fingerprint；现在
  采用 strict runtime contract。
- Definition Registry 的 `key@version` 字符串索引可碰撞；现在使用无歧义 tuple
  identity。
- `begin()` 后、首次 `createRun` 完成前立即取消会出现 NotFound/CAS 竞态；现在
  后续 save 等待初始化完成，取消前不会执行 Workflow 脚本。
- 外部 `AbortSignal` 的后台取消失败原先会形成未处理 rejection；现在通过
  `control_error` 观测事件报告。
- 取消发生在 Activity output、checkpoint 或 terminal result 的 ValueStore 写入
  期间时，迟到成功原先仍可能写 journal、推进 checkpoint 或覆盖终态；三个窗口
  已分别建立行为测试并关闭。
- Activity journal save 的短暂 Backend 故障原先会被持久成业务 `failed`；现在以
  `WorkflowPersistenceError` reject，并保留 Backend 旧 revision 供恢复。
- durable Signal 等 capability 原先只看 Backend 声明；现在同时要求对应 Port
  实际注入。
- Agent caller/default model 原先在跨 Runner resume 时丢失；现在保存在版本化、
  不可变的通用 `extensionContext` 中，Core Run 默认仍是空对象。
- `RunEnv.onEvent` 原先可以因观察者抛错而中断 Workflow；现在观察错误隔离，并可
  通过 `onEventError` 旁路接收。

### 结构收敛

质量审查期间将 Runner 的持久化和单次执行职责继续拆开：

- `runner.ts`：公共 façade、控制命令与进程内互斥；
- `runner-run-store.ts`：本地 Run 投影、hydrate、Backend CAS 与持久化错误；
- `runner-execution.ts`：单次执行、终态归约与资源释放；
- `workflow-activities.ts`：Core Activity API 和 options contract；
- `workflow-context.ts`：并发与观察 API 组合；
- `agent-extension.ts`：可选 Agent/Session 兼容层。

当前 `src` 共 29 个模块，静态相对 import 图没有循环。没有生产函数超过 100
物理行；大文件均已按 façade、Activity engine 或兼容 Extension 明确职责。

### 构建脚本修复

declaration specifier 修正器的宽泛正则会误改普通字符串字面量。改用 TypeScript
import 预处理结果后，第一次实现暴露了 source range 语义错误，NodeNext 门禁以
TS2834 失败。修正 range 后脚本带自检：

- 只改真实相对 import/export specifier；
- 普通相对路径字符串保持不变；
- 重复执行幂等。

### 最终本地验证

```text
bun test
  -> 13 files / 76 tests / 220 assertions / 0 failures

bun run typecheck
  -> passed

bun run verify:package
  -> 29-module Bun bundle passed
  -> NodeNext declaration consumer passed
  -> NODE_PACKAGE_SMOKE_OK

bun build demo/generate.ts --outfile .agent/tmp/demo-compile/generate.js \
  --target bun --format esm
  -> passed

npm pack --dry-run --json
  -> 62 entries
  -> 93,735 bytes compressed
  -> no runtime dependencies bundled

git diff --check
  -> passed
```

新增 Ubuntu CI 将在 PR 上重复 frozen install、全量测试、类型、Node package、
demo compile 和 package contents 检查。远端 CI 在 push 前尚未运行，不能用本地
结果冒充。

### 仍未验证或未决定

- 真实进程重启、多 Worker、lease 和 Cosmos Prisma Backend；
- Harness/真实模型与 Agent invocation durable receipt；
- Cosmos Worker/Host convergence；
- npm 发布；
- 仓库与 package 的许可证。当前代码源自同为 AGPL-3.0 的 NeuroBook 历史，但
  本 Task 不替用户作新的许可授予；正式发布前必须单独决定并补齐。

Run 级 `workspace` 对象仍是进程内覆盖项；跨 Runner 恢复必须由新 Runner 的
`RunEnv.workspace` 注入。这个限制已明确记录，没有伪装成 durable capability。

## Round 6：push、PR、远端 CI 与合并

日期：2026-08-12

### 提交

```text
1037c11 feat(kernel): stabilize workflow execution contracts
362291e chore(task): add delivery gates and walkthrough
```

每次只暂存明确范围；没有使用 `git add -A`。用户 dirty `master` 的 6 个文件在
提交前后 SHA-256 完全一致，外部修复 worktree 保持 clean。

### 远端门禁

- 分支 `codex/feat-t01-kernel-stabilization` 已 push 到
  `notnotype/nb-workflow`。
- PR #1（base `master`）状态 CLEAN / MERGEABLE；
- Ubuntu CI workflow `verify`：SUCCESS；
- 使用 merge commit 合并，保留两个语义提交：

```text
c3bdae63 Merge pull request #1 from notnotype/codex/feat-t01-kernel-stabilization
```

- 合并后 `origin/master` 从 `cf34d156` 推进到 `c3bdae63`；merge 内容与 Task
  分支完全一致（49 个文件，+7,765 / -522）。

### 保护边界复核

- 用户本地 `master` 仍停在 `cf34d156`，6 个未提交文件未被触碰；fetch 后显示
  落后远端 3 个提交（本 Task 的两个提交加 merge commit）。本地 `master` 的
  `fetch` + `merge --ff-only` 同步留给用户确认后再执行，本 Task 不覆盖其
  dirty 工作区。
- 外部 `fix/i46-nb-workflow-contract` worktree 仍 clean。
- Cosmos 仓库未修改，仍停在 `61ed21e`。

### 最终状态

Task 01 的 Kernel、conformance、兼容验证、Node 产物、CI 和合并均已完成。npm
发布、许可证、真实进程重启、多 Worker 和 Cosmos Prisma Backend 仍由后续
Task 单独验收。

## Round 7：许可证决定

日期：2026-08-12

### 决定

用户决定 `nb-workflow` 使用 MIT 许可证。

### 修改

- 新增根 `LICENSE`：MIT 全文，版权行 `Copyright (c) 2026 notnotype`（可后续
  修改为真实署名）。
- `package.json`：`license: "MIT"`，`files` 增加 `LICENSE`，确保 npm 包内容
  包含许可证。
- `README.md`：增加安装方式、Public API 地图和 License 引用。

### 状态

变更已提交并合并（PR #3，merge commit `818b749`），`master` 已包含 MIT
许可证。

## Round 8：npm 发布 0.1.1

日期：2026-08-12

### 发布过程

- 第一次手动发布从旧主工作区执行，把未构建的旧源码打成了
  `@notnotype/nb-workflow@0.1.0`（无 `dist`、无 `LICENSE`、无入口字段）。
- 该 0.1.0 已由用户 `npm unpublish` 撤回；npm 不允许复用已撤回的版本号，
  最终发布为 `0.1.1`。
- 从合并后的 `master`（`818b749`）在干净 worktree 中执行
  `npm publish --access public`；npm 打开浏览器完成 2FA 网页授权后上传成功。

### 发布验证

```text
npm view @notnotype/nb-workflow
  -> version 0.1.1
  -> dist-tags.latest = 0.1.1
  -> license MIT
  -> main ./dist/index.js / types ./dist/index.d.ts
  -> engines node >= 20

npm pack @notnotype/nb-workflow@0.1.1
  -> 63 files（LICENSE、README.md、dist/*）

全新目录安装 smoke
  -> added 1 package
  -> INSTALL_SMOKE_OK status=completed result={value:42}
```

### 记录

- 版本号与安装文档随本分支提交；registry 内容以实际发布的 0.1.1 为准。
- 后续发布继续使用浏览器网页授权，不再手工输入 OTP。
