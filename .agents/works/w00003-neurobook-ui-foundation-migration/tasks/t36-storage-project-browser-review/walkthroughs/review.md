# t36 浏览器 Project Storage 适配独立审查

结论：**建议合并**。

审查对象：相对 `0d66064b` 的未提交工作树改动（分支 `refactor/w00003-nb-ui-adoption`，HEAD 仍 `0d66064b`）。
只读审查，未修改被审源码、Spec 或 Task 合同。

## 基线

| 项 | 值 |
|---|---|
| revision | `0d66064b7336ecde2783d83ac78411623a562853` + 工作树改动（无提交） |
| 范围 | `packages/neuro-book/app/utils/storage/**` 7 个改动文件 + 1 个新增文件 |
| 源文件指纹 | `host-context-client.ts` `8a0ccf6dedf3dc78040ce360164bd5e8`；`value-transport.ts` `1b1212ab3f61e58cabf0c72b4dcf8777`；`owner-handle.ts` `f516b01c45f7985c6c0b8ababdae24c2`；`request-deadline.ts` `a62e1589853868c2e7a07f6bcdceb01c` |

我方实跑（本 Task 唯一执行的命令）：

```
cd packages/neuro-book && bun run test app/utils/storage --maxWorkers 1
→ Test Files  4 passed (4)
  Tests       76 passed (76)
  Duration    2.84s
```

与 Task 中「4 文件 76 通过」的声明一致。`client-identity.ts/.test.ts` 相对基线未改动，仍在同一 include 内。

## 核对重点逐项

| # | 合同要求 | 结果 | 证据 |
|---|---|---|---|
| 1 | project 目标在第一次 await 前捕获 | 通过 | `host-context-client.ts:121-127` 先 `StorageProjectContextRequestSchema.safeParse` 再 `loadOrCreateStorageClientIdentity`；`const {projectRoot, publicId} = parsed.data` 落成局部标量，请求体与 session 都取局部值 |
| 2 | session/target 返回后不可改写 | 通过 | 两个 `Object.freeze({...})`；用例断言 `Object.isFrozen(session) === true` |
| 3 | 目标捕获是有效断言而非摆设 | 通过 | 用例「身份初始化等待期间目标被改写仍请求原来捕获的 A」在 `await` 前改写 `target`，期望请求体仍为 A；一旦把捕获点移到身份 await 之后该用例必失败（Task 声明的负向变异结果与此一致，我未复跑变异） |
| 4 | HTTP 地址按固定 scope 派生，无 user fallback | 通过 | `STORAGE_CONTEXT_PATHS[session.scope]`（context）与 `STORAGE_ACTION_PATHS[options.session.scope]`（action）为唯一地址来源，无 `?? user` 兜底；调用方不能传 URL |
| 5 | 非法 target 可诊断且不发请求 | 通过 | `reason: "target-invalid"`；用例覆盖 publicId 缺失/空/超长、projectRoot 空，且身份同时不可恢复时断言 `calls.length === 0`（目标错误优先于身份错误） |
| 6 | 身份失效不 fallback 到 user/其它身份 | 通过 | `unavailableIdentity()` 统一返回 `identity-unrecoverable`；用例断言无请求 |
| 7 | scope 定义不匹配前端拒绝 | 通过 | `owner-handle.ts` `assertDefinition` 同时核 owner 与 scope，抛 `STORAGE_CONTEXT_INVALID`，且是直接抛出而非经 `send`，不会被登记为终态 |
| 8 | 服务端错误终止该句柄、不重签/不按路径重取 | 通过 | `TERMINAL_STORAGE_CODES` 含 `STORAGE_CONTEXT_INVALID`；用例「project 发布失效后句柄终止」断言第二次 read 失败后第三次 read 不发请求、`bind` 仅 1 次 |
| 9 | 初始化/释放禁自动重试与背景 toast | 通过 | POST 与 DELETE 均带 `retry: false`、`notify: false`；用例逐项断言 |
| 10 | 超时 helper 抽取不丢 AbortSignal 与完整 body 期限 | 通过 | `createRequestCancellation` 原样迁移到 `request-deadline.ts`，`value-transport.ts` 仍传 `sendOptions?.signal`；context 签发/释放使用同一 helper，`finally` 中 `dispose()` |
| 11 | 超时不伪装成功 | 通过 | context：`backend-unreachable` + `diagnosis === "Storage 请求超时"`，计时器数归零；release：直接抛出，不吞错 |
| 12 | release 使用对应 scope 入口 | 通过 | `closeStorageContext` 按 `session.scope` 选路径，`it.each` 覆盖 user/project 两个入口 |
| 13 | release 不关 Project/presence、不清身份 | 通过（客户端侧） | 客户端只发一次 `DELETE .../context`，不触达任何 Project API；服务端是否只撤销本次访问属 t30，见「范围外」 |
| 14 | 测试走真实 adapter 而非绕过 | 通过 | 「真实 adapter 的 project 链路」用 `openStorageProjectContext` + 真实 `createStorageHttpTransport` + `openStorageOwnerHandle` + 注入 request，断言 6 次调用序列、headers、`bind/read/save/read` body，并断言 `calls.some(path.includes("/user/")) === false` |
| 15 | 改名引用无遗漏（含脚本/fixture，不只搜 app） | 通过 | 全仓搜索 `closeStorageUserContext`、`StorageUserContextOpenOptions`、`StorageUserContextFailureReason` 均 0 命中；`StorageUserContextSession` 仅剩定义处；`packages/neuro-book/scripts/smoke/storage-host-identity.ts` 与 `storage-value-adapter.ts` 只读 `contextId/clientCredential`，新增 `scope` 为附加字段，不破坏 |
| 16 | smoke 定义不被 scope 核验打破 | 通过 | 两个 smoke 脚本内所有 `defineStorageState` 均为 `scope: "user"`，与 user session 一致 |
| 17 | 不把 Storage 变成 Project open 门禁 | 通过 | `app/composables/useProjectSession.ts` 无 storage 适配器导入；README 明确「Project open/presence 不依赖 Storage 成功」 |
| 18 | README 与实现一致 | 通过 | 消费顺序 1–6、target-invalid、scope 核验、15s 期限、状态机描述均能在源码定位；验证章节描述的覆盖点与实跑结果相符 |

## 发现（均不阻断）

1. **未知 scope 只有类型层保证，运行期不可诊断（低）。**
   `STORAGE_CONTEXT_PATHS[session.scope]` 与 `STORAGE_ACTION_PATHS[options.session.scope]` 对未登记 scope 返回 `undefined`，会把 `undefined` 当 URL 交给宿主请求，最终只表现为一次 `backend-unreachable`。好处是不会静默回落到 user，符合合同；但若将来 session 可能来自反序列化数据，建议在 `closeStorageContext`/`createStorageHttpTransport` 入口对 scope 做一次运行期白名单判定。当前所有 session 都由 `openStorageUserContext`/`openStorageProjectContext` 构造，实际不可达。

2. **t35 walkthrough 未按自身合同收口（低，属交付材料而非代码）。**
   `tasks/t35-storage-project-browser/walkthroughs/implementation.md` 仍写「状态：进行中」，未补真实命令、文件/用例数、退出码与「未运行项」，与 t35 README「完成更新真实结果与未运行项」不符。本报告已独立复跑该命令并给出结果，因此不构成证据缺口；建议 Leader 收口前让 Tasker 补齐，或由 Leader 记录实跑结果。

3. **本地 scope 不匹配复用 `STORAGE_CONTEXT_INVALID`（提示）。**
   该 code 位于 `TERMINAL_STORAGE_CODES`。当前 `assertDefinition` 直接抛出、不经 `send`，不会把句柄置为终态，语义正确；但消费者若只按 code 判断「句柄已死」会误判。README 已说明句柄在本地拒绝，信息足够，无需改动。

## 范围外（未审）

- 服务端 t30（`server/storage/**`、`server/api/storage/project/**`）：仅作交叉核对（POST body schema、DELETE 无 body、`releaseStorageProjectContext` 不关 Project），未审其实现与在补修的 HMR/物理根复核。
- UI 接线、旧键迁移、插件消费、浏览器真实 Project 恢复验收，按 Task 声明留待后续消费验收。
- 全库 typecheck 与 Product build：主 Agent 统一执行，本报告不含该项证据。

## 残余风险

- 未执行变异测试：「移除捕获后负向用例必失败」来自 Task 中主 Agent 的原始 tool output 记录，我未复跑（复跑需修改被审源码）。
- 未在真实 Chrome 中验证 project 链路；`host-context-client.test.ts` 的端到端链路止于注入 request 边界，真实 HTTP 由 t30 服务端用例覆盖。
