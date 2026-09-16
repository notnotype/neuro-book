# t35 浏览器 Project Storage 适配器：实现与验证

状态：完成（Task 范围内实现、测试、README 已闭合；未提交、未 push，等待 Leader 收口）。

## 基线

- 工作区：`.worktree/w00003-neurobook-ui-foundation-migration`；分支 `refactor/w00003-nb-ui-adoption`。
- 切片 1 user 适配器已提交 `42d65b7c`；精确 Project ready `0d66064b`。
- 服务端 project 入口在本工作树已存在（t30 未提交增量）：
  `server/api/storage/project/{context.post,context.delete,action.post}.ts`，
  DTO 为 `shared/storage/host.ts` 的 `StorageProjectContextRequestSchema`（`.strict()` 的 `{projectRoot, publicId}`）
  与 `shared/storage/action.ts` 的值动作 DTO。本轮不改 DTO。
- 前端改动前：`host-context-client.ts` 只有 user 入口；`value-transport.ts` 硬编码 `/api/storage/user/action`；
  `owner-handle.ts` 的 `session` 是 `StorageUserContextSession`，不区分 scope。

## 决策与实现

| 决策 | 理由 |
| --- | --- |
| session 改成判别联合 `StorageUserContextSession \| StorageProjectContextSession`，两者都带 `scope`、`contextId`、`clientCredential`，project 另带捕获的 `projectRoot`/`publicId`；返回值 `Object.freeze` | 一次访问的归属是固定事实；调用方拿不到任意 URL，路径只在适配器内按 scope 选择 |
| `openStorageProjectContext(target, options)` 的 `target` 是结构化 `{projectRoot, publicId}`，`ProjectSessionReady` 天然满足（`revision` 不进请求） | 不把 composable 类型引入 util；ready 语义仍由 Project owner 拥有 |
| 目标在第一次 await（身份初始化）前用共享 schema 复制校验，标量落成局部值 | 等待期间页面切换不改写请求地址；注入的 request 改写对象也不影响返回的 session |
| 非法/缺失目标返回 `target-invalid` 且不发请求、不做身份初始化 | 缺/非法 `publicId` 是调用方错误，不能落成身份问题或 user 分区 |
| 释放统一为 `closeStorageContext(session)`：按 session 的 scope 选 context 入口；旧的 `closeStorageUserContext` 删除 | 单一释放入口，避免用错 scope 被服务端拒绝；旧名唯一消费者是测试 |
| 抽出 `request-deadline.ts`（`STORAGE_REQUEST_TIMEOUT_MS`、`createRequestCancellation`），值动作与上下文签发/释放复用 | 不复制第二套截止计时器；`ofetch` 自带计时器只覆盖响应头 |
| 上下文签发/释放显式 `retry: false, notify: false` | 签发不是幂等动作，超时自动重放会多签一份；后台失败不能反复全局通知 |
| `openStorageOwnerHandle` 用 `assertDefinition` 同时核验 owner 与 `definition.scope === session.scope` | 归属不匹配的请求服务端必然拒绝，适配器在本地提前拒绝 |

文件：

- 新增 `app/utils/storage/request-deadline.ts`。
- 改 `app/utils/storage/host-context-client.ts`（session 联合、project 入口、统一释放、期限）。
- 改 `app/utils/storage/value-transport.ts`（按 session scope 选 action 入口，复用期限 helper）。
- 改 `app/utils/storage/owner-handle.ts`（session 类型、捕获 session、scope 核验）。
- 改 `app/utils/storage/README.md`（消费顺序：ready 先于 Storage、目标捕获、先 release 句柄再 release session；切换的未提交意图 UI 留给切片 4）。

## 验证

| 命令 | cwd | 结果 |
| --- | --- | --- |
| `bun run test app/utils/storage --maxWorkers 1` | `packages/neuro-book` | exit 0；4 文件 / 76 用例通过（本 Task 新增 18 个用例：host-context-client 14、owner-handle 3、value-transport 1） |
| `bun run typecheck` | `packages/neuro-book` | exit 0 |
| `git diff --check` | 仓库根 | 无空白错误 |

新增用例（`vitest.config.ts` 的 `app/utils/storage/**/*.test.ts` 已覆盖，无需登记）：

- `host-context-client.test.ts`：user/project 入口路径与请求体；ready 形状直传与 A/B 目标隔离；
  身份初始化等待期间改写目标仍请求原 A；`publicId` 缺失/为空/超长与 `projectRoot` 为空时不发请求且优先于身份错误；
  身份失效不 fallback；服务端拒绝/响应不合分别可识别；15 秒超时按未确认失败返回且只发一次请求；
  `closeStorageContext` 按 scope 指向对应入口、失败显式抛出；
  真实 adapter 链路 project context → bind → read/save/read → handle release → context release，
  核对每步的真实路径、请求头、请求体与 `retry`/`notify`，并断言整链不出现 `/user/` 入口。
- `owner-handle.test.ts`：user session 对 project 归属定义、project session 对 user 归属定义均在本地拒绝且不发动作；
  project 发布失效后句柄终止，`bind` 只发生一次（不重新绑定、不按路径重取 ready）。
- `value-transport.test.ts`：project session 提交到 `/api/storage/project/action`，值动作不重复提交定位字段。

测试敏感性抽查：临时把 `openStorageProjectContext` 的请求体改成 await 后读 `target.projectRoot`，
「身份初始化等待期间被改写」用例随即失败（实际请求 B、期望 A），确认该用例真的覆盖目标捕获；已还原实现。

## 未运行项与残余

- 未运行浏览器真实 Chrome smoke（`smoke:storage-value-adapter` 仍是 user 链路）；project 入口的真实 HTTP 由
  t30 的服务端用例覆盖，浏览器侧只到「真实 adapter + 注入 request」的边界。
- 未提交、未 push、未创建 PR；两个 `app/utils/workbench/descriptors{,.test}.ts` 用户既有 dirty 未触碰。
- 未接 UI、未迁移旧 writer、未改 Spec/Work/Task 文档正文与 `shared` HTTP DTO。
- 依赖 t30 未提交的 project 入口与 DTO；若 t30 改动 `{projectRoot, publicId}` 字段，本适配器需同步。
