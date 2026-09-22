# t43 返工证据（第二稿）

2026-09-16 作者按 [leader-rework-requirements](./leader-rework-requirements.md) 的 R1–R9 逐项返工，并真实运行。

**结论：通过。** 最终运行退出码 `0`、`status: "passed"`、`findings: []`、清理项（含隔离根删除）全部 `ok: true`。
覆盖范围是**最小 HTTP 宿主上的真实浏览器 → 产品适配器 → Project Storage 磁盘链路**，
**不是**完整 Nuxt/Project Picker/主页面 UI 验收（见 §6）。

原始输出：`evidences/run-final-direct.json`、`evidences/run-final-registered-entry.json`、`evidences/run-negative-control.md`、
`evidences/root-ownership-guard.txt`、`evidences/typecheck-scripts.txt`。

## 1. 命令、cwd 与退出码

cwd 一律为 worktree 内绝对路径 `C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration/packages/neuro-book`。

| # | 命令 | 退出码 | 结果 |
|---|------|--------|------|
| A 负面对照 | `node --import tsx scripts/smoke/storage-project-adapter.ts --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"` | `1` | `status: "failed"`，1 条 finding（真实缺口，见 §5 偏差 2） |
| B | 同上（修复后） | `0` | `status: "passed"`，`findings: []` |
| C 登记入口 | `bun run smoke:storage-project-adapter --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"` | `0` | `status: "passed"`，`findings: []`（`package.json` 的 `smoke:storage-project-adapter` 等价于 `node --import tsx scripts/smoke/storage-project-adapter.ts`） |
| D 最终 | 同 B（含 `records` 证据字段） | `0` | `status: "passed"`，`findings: []` |

`bunx tsc --noEmit --pretty false -p scripts/tsconfig.json` 退出码 `2`：唯一报错是基线已登记的
`scripts/deploy/product-agent-state-root-smoke.ts:318`（theme fixture 缺 `colorwayId`/`userColorways`）；
本 Task 的 `scripts/smoke/storage-project-adapter.ts` **零报错**。该命令不记为通过。

原始输出对应关系：D → `run-final-direct.json`（隔离根 `…\nb-t43\c4cd5038`，端口 2091，§4 采用它）；
C → `run-final-registered-entry.json`（同为最终代码，隔离根 `…\nb-t43\0a0bd68f`，端口 18358）；A → `run-negative-control.md`。
B 是修复 `open` 覆盖语义后的中间版本验证，其原始输出未保留（D/C 已在最终版本上重跑并留档）。
记录路径里的身份域/主体/客户端摘要每次运行都不同（它们是本次随机 data 身份域与浏览器凭证的 sha256 派生），表内为 D 的实际值。

stdout 前面会混入生产模块的 `workspace-history` info 日志，最终 JSON 是 stdout 的最后一段（从 `{\n  "schema"` 起解析）。

## 2. R1–R9 逐项落地

### R1 全阶段失败清理

- 落地：`runStorageProjectAdapterSmoke` 的 `try` 从**第一**个资源开始——`installIsolatedEnvironment`（首个动作）、
  三个 `mkdir`、`config.yaml`、`loadStorageModules`、`importProjectSession`、`openProjectsUnderTest`（Project manifest + `openProject`）、
  `setHostContextForTest`、esbuild 产物、`startIsolatedHost`（HTTP listener）、两次 `launchProfileRuntime`——全部在同一个 `try` 内。
- 释放顺序固定并逐项串行（页面 → profile/浏览器 → HTTP → Project session → Storage host → 进程环境），
  每项用 `dispose(resource, …)` 包裹：单项失败只记录 `{ok:false, message}`，**不跳过**后续资源（等价 allSettled 且保留顺序）。
- 证据：最终 JSON `cleanup` 10 项按该顺序排列且全部 `ok: true`；
  `page:main#1`、`page:main#2`、`page:other#1`、`profile:…\profiles\main`、`profile:…\profiles\other`、
  `http:http://storage.test:2091/`、`project-session`、`storage-host`、`environment`、`isolation-root:…\nb-t43\c4cd5038`。
- 清理失败使退出码非零：`const failed = findings.length > 0 || cleanup.some((outcome) => !outcome.ok)`。
- run 函数自身完成全部运行时资源释放，CLI 端只保留「核验归属后删除隔离根」。

### R2 根内独立 profile 与 cache

- 落地：`launchProfileRuntime` 使用 `chromium.launchPersistentContext(<root>/profiles/<name>, …)`，
  两个 profile 为 `<root>/profiles/main`、`<root>/profiles/other`；`--host-resolver-rules=MAP storage.test 127.0.0.1`
  与 `--no-proxy-server` 保留。
- 证据（`isolated.profileArtifacts`，浏览器仍运行时采样）：两个目录各自包含 `Local State` 与
  `Default/IndexedDB/http_storage.test_2091.indexeddb.leveldb`——浏览器数据目录与定位凭证库确实位于本次隔离根内。
- 两者都在清理范围内（`cleanup` 的 `profile:<绝对路径>` 两项）。
- 表述纪律：profile 隔离由持久化 profile 目录证明；同 profile 内两个标签属于**同一客户端**，
  两者不混为一谈（§3 场景 2 与 4 分别取证）。

### R3 隔离维度分别取证

- 同客户端跨 Project：场景 3。同一 profile 内标签 2 从 Project A 切到 Project B（相同 owner/key）后读到 `missing`，
  保存 B=`{width:900}`，标签 1 在 A 重读仍是 `480`。
- 独立 profile 的 local 隔离：场景 4。`other` profile 读 Project A 的 local 记录为 `missing`，
  同一 owner/Project 的 shared 记录却能读到（证明差异来自 clientId 而非 Project）。
- 释放第二个标签后第一标签的真实往返：场景 5。`release` 后由标签 1 执行 `save 720` + `read 720`（真实写入与读回，
  不只是「没有轮询请求」）。

### R4 shared Project 定义与场景

- 落地：新增 `smoke.project-layout/board`（`scope: project`、`locality: shared`），与 local 定义**同 owner 不同 key/locality**。
- 证据：场景 4——主客户端写入 `{title:"shared-board"}` 后独立 profile 读到同值；
  同一 owner 的 local 记录在该独立客户端仍是 `missing`。
- 边界：只证明「同 data、同主体（auth-off 本地主体）、跨客户端」的 shared 语义，不宣称跨 data 在线同步。

### R5 精确磁盘断言

- 落地：`assertProjectRecordsOnDisk` + `assertRecordValue`。
  地址链全部来自生产入口：`userStorageRootFromWorkspaceRoot`（data 根，身份域位置）→ `readStorageIdentityDomain`（身份域）→
  `localStorageSubject` / `deriveStorageClientId`（主体与客户端）→ `projectStorageRootFromProjectRoot` →
  `storagePartitionPaths` → `storageRecordFileName`。
  没有任何手写目录、没有 `includes("700")`、没有从 Project Storage 读取 `identity.json`（只用 `readdir` 断言其不存在）。
- 字段：`wrapper === STORAGE_WRAPPER_VERSION(=1)`、`state === "value"`、生产解析器 `parseStorageRecord` 的
  `kind === "value"`、`schemaVersion === 1`、`revision` 与封装一致、最终值字段逐一比较。
- 证据（`records`，来自最终运行）：

| 记录 | 绝对路径（生产推导，身份域/摘要为本次运行值） | wrapper/state/schemaVersion | value |
|------|----------------------|-----------------------------|-------|
| Project A local | `…\nb-t43\c4cd5038\state\workspace\alpha\.nbook\storage\0907a036-…\173397bd…\local\c26f9586…\smoke.project-layout\records\layout.json` | 1 / value / 1 | `{"width":730}` |
| Project B local | `…\state\workspace\beta\.nbook\storage\0907a036-…\173397bd…\local\c26f9586…\smoke.project-layout\records\layout.json` | 1 / value / 1 | `{"width":900}` |
| Project A shared | `…\state\workspace\alpha\.nbook\storage\0907a036-…\173397bd…\shared\smoke.project-layout\records\board.json` | 1 / value / 1 | `{"title":"shared-board"}` |

- A/B 两条记录分别断言且互不污染：分区目录不同、值分别为各自最后确认值；
  shared 分区相对路径不含 client 段（`…/shared/<owner>/records/board.json`）而 local 含（`…/local/<client digest>/…`）。

### R6 PageApi 生命周期

- 落地（浏览器入口）：`open` 先签发新上下文，成功后才释放旧槽（订阅 → 句柄 → `closeStorageContext`），
  并返回 `replaced`；失败时不动已有槽，句柄建立失败时立即释放刚签发的上下文。
  `release` 调 `closeSlotResources`：关闭订阅 → `handle.release()` → `closeStorageContext(session)`，逐项 try，最后统一抛出。
- 证据：
  - 覆盖：场景 3、5、7 中三次成功的 `open` 返回 `replaced: true`（切 Project、切回、关闭重开）。
  - 失败不留半初始化：场景 1 中两次失败的 `open` 之后 `state('a1')` 三项 `false`；`read`/`subscribe` 在没有句柄时失败后
    仍为 `false`。
  - 释放断言：`state('a2')` 的 `hasSubscription/hasHandle/hasSession` 全为 `false`；
    `DELETE /api/storage/project/context` 计数 ≥ 1；释放后再 `open` 得到**新的** `contextId`
    （脚本比较释放前 `state('a2').contextId` 与重新 `open` 的 `contextId`，必须不同）；
    释放后 1.2s 内订阅 `updates` 计数不增长（且第一标签在此期间完成了 `save/read` 往返）。
  - 关闭重开同理：重建后的 `contextId` 必须不同于关闭前的 `contextId`。

### R7 CLI 清理与根归属

- 落地：`assertOwnedIsolationRoot` 在 `rm` 之前校验：绝对路径 == `resolve()` 结果、父目录 == `nb-t43`、
  叶子 == 本次 `randomBytes(4)` 十六进制名、真实路径经 `assertContained(resolveAgentTempRoot(), …)` 位于 scratch 根之下；
  另有历史根拒删名单（scratch 与 `acceptance/product-runtime` 两种拼写）。
- 证据（`evidences/root-ownership-guard.txt`）：历史根两种拼写、旧命名服务目录、系统 Temp 根、仓库根、相对路径**全部 REFUSE**，
  只有本次形状 ACCEPT。删除项本身作为独立 `cleanup` 结果上报（`isolation-root:<绝对路径>`），失败会使退出码非零。
- 打印内容：实际隔离根、HTTP 端口、两个 profile 绝对路径、逐项关闭结果。
- 历史根 `storage-browser-MxfyHy` 实际位于 `…\Temp\neuro-book\acceptance\product-runtime\`，本次运行前后均存在且未被触碰
  （本会话多次运行后 `nb-t43` 目录为空，无残留）。

### R8 可读性

- `call`、`observePage`、`parseOptions`、CLI 块全部展开为常规块结构；`ENTRY` 仍是打包用字符串，
  但按「导入 → 定义 → attempt → 槽工具 → closeSlotResources → API」分段并保留命名 helper 与注释；
  场景按 7 个 `assert*` 函数拆分，各带一句职责说明。未引入新框架或额外抽象层。

### R9 验证与报告

- 真实运行（§1 表 B/C/D）cwd 与 `--browser-executable` 同要求；只有 `findings` 为空才写 `passed`。
- scripts 类型检查同 §1。
- 本文件即返工证据；Task README 状态行同步更新。

## 3. 场景清单（浏览器侧，均为真实 HTTP + 真实产品适配器）

| # | 场景 | 关键断言 |
|---|------|----------|
| 1 | 无 ready / 错误 publicId 不签发 | 缺 `publicId` 在本地拒绝（`reason: target-invalid`，无 HTTP 状态码）；用 Project B 的 ready 打开 A 得到 409；两者之后槽无 session/handle/subscription；全程无 `/api/storage/user/**` 请求（路由只挂 Project，未挂 user） |
| 2 | 同客户端两标签共享分区 | 标签 2 与标签 1 的 `clientCredential` 相同、`binding.local` 相同、读到标签 1 刚提交的 `480` |
| 3 | 同客户端跨 Project 隔离 | 标签 2 切到 B：`replaced: true`；B 读 `missing`；B 保存 `900`；标签 1 在 A 仍读 `480` |
| 4 | shared 定义 + 独立 profile local 隔离 | 独立 profile 读 A 的 local 为 `missing`；标签 1 写 shared `{title:"shared-board"}` 后独立 profile 读到同值 |
| 5 | 订阅 + 陈旧 CAS + 释放独立性 | 订阅初始快照 `480`、`onUpdate` 不因初始快照触发；标签 1 写 `640` 后订阅观察到 `640`；标签 2 用陈旧凭据写 `800` 得 `STORAGE_REVISION_CONFLICT` 且 `committed: false`；`release` 后标签 1 真实 `save 720` + `read 720`，被释放标签订阅不再投递，重新 `open` 得到新 `contextId` 并读回 `720` |
| 6 | （含于 5）失败调用不留半初始化 | 释放后再 `read`/`subscribe` 失败，状态仍无句柄/订阅 |
| 7 | Project 关闭与同路径重开 | `closeProject(alpha,'shutdown')` 后旧 session 的 `read`/`save` 均 `STORAGE_CONTEXT_INVALID`，旧 `publicId` 打开得 409；`openProject` 发布新 `publicId`；重建上下文后读回 `720`，再写 `730` 成功 |

浏览器控制台 `error`/`warning`（除刻意非 2xx 的 `Failed to load resource:`）与 `pageerror` 都会成为 finding；最终 `findings` 为空。

## 4. 隔离根、端口与关闭结果（最终运行）

- 隔离根：`C:\Users\NOTNOT~1\AppData\Local\Temp\neuro-book\nb-t43\c4cd5038`（scratch 根 `…\Temp\neuro-book` 之下）
- HTTP：`http://storage.test:2091/`，`listen(0, "127.0.0.1")`；未访问、复用或停止 `localhost:3001`
- data 存储根：`…\c4cd5038\state\workspace\.nbook\storage`
- Project 存储根：`…\state\workspace\alpha\.nbook\storage`、`…\state\workspace\beta\.nbook\storage`
- profile：`…\c4cd5038\profiles\main`、`…\c4cd5038\profiles\other`（均含 `Local State` 与 `…indexeddb.leveldb`）
- 关闭结果：页面 3、profile/浏览器 2、HTTP 1、Project Session、Storage Host、进程环境恢复、隔离根删除 —— 全部 `ok: true`；
  运行后 `…\Temp\neuro-book\nb-t43\` 为空，`storage-browser-MxfyHy` 未被触碰（仍存在）。

## 5. 未运行项与偏差

- 未运行：全包 `typecheck`/`build`/测试套件（Leader 统一执行）；完整 Nuxt 页面与 Project Picker UI 验收（本 Task 不覆盖）；
  未联网、未开代理、未提交/推送、未使用真实 Provider/Model、未访问真实用户数据。
- 偏差 1：历史根 `storage-browser-MxfyHy` 的实际位置是 `acceptance/product-runtime` 而不是 scratch 根；
  脚本的形态校验对它两种拼写都拒绝，并把实际位置补进拒删名单。
- 偏差 2：负面对照（§1 表 A）暴露的是**脚本自身**的覆盖语义问题（失败的 `open` 会先销毁可用槽，导致后续重建的 `replaced` 期望不成立），
  已改为「先签发成功再释放旧槽」；不是产品适配器缺陷，也未被改写成通过。
- 偏差 3：`isolated.root`/`cleanup`/stderr 打印使用系统 Temp 的 8.3 短名（`NOTNOT~1`），
  而 `ready.workspace.root` 经 Project Lifecycle realpath 后是长名；两者是同一目录的两种拼写。
