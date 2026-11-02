# t08 设计审查第一轮的处理

审查者：omp 默认模型，报告 [design-review-omp.txt](design-review-omp.txt)，16 条（阻断 5、重要 11），审查对象为提交 `aa190052f` 的 plan.md。

核实方式：第 3 条对照 `files/shared/contracts.ts` 的 `rawUrlOf`；第 11 条对照 `nb-runtime/src/remote/node.ts` 对未声明失败码的处理（改报 `provider-error`）；第 6、16 条对照编辑器 `documents/store.ts`；服务端的按调用方门面查 `nb-runtime/src/services/per-consumer.ts`；监视只在有订阅时开，查 `files/backend/changes.ts`。都属实。

## 总的处理：浏览器访问新方案推迟到 t17，服务端改用进程内服务

第 3、5、6、7、13（Markdown 部分）、16 条都出在“新方案经远程合同开放给浏览器，编辑器、Markdown、字节地址、持久化记录跟着放宽”这一步；第 11 条出在 `projects://` 由远程合同提供方转发一跳。t08 的使用方只有服务端的 Agent（t12 的工具），浏览器要看附件与大结果是 t17 的事。所以：

- 方案注册表仍在 `nbook.files`（开发者决定 1 不变），服务端插件经**进程内服务** `serverFilesKey`（按调用方门面）访问；`projects://` 由这个服务直接对 `{project}` 目标发远程调用，路由失败（`unknown-outcome` 等）原样交回，不经第二层远程提供方。
- 不新增 `nbook.files/server` 远程合同，不删 `nbook.files/user`，`parseResource` 与浏览器一侧（文件客户端、编辑器、文件树、字节地址、Markdown 的方案判断）不动。浏览器访问已注册方案随 t17 设计，届时第 3、5、6、7、13、16 条作为它的输入。
- 服务只给 Agent 工具要用的方法：列出、读、写、新建、真实路径；不给批量搬运、删除与取消（t12 的工具没有这些）。

这条改变了开发者已认可的计划形状（原计划删 `nbook.files/user`、浏览器走新合同），提交前请开发者确认。

## 逐条

| # | 级别 | 归类 | 处理 |
|---|---|---|---|
| 1 | 阻断 | 成立，要改 | 挂载点改为按 `(调用方, 操作, 路径)` 授权的回调，由注册方（`nbook.agent`）实现；路径按词法与解析链接后的真实路径各判一次。服务不提供目录级的删除、改名、移动，递归操作碰不到只读子树。补测试：日志可读不可写、自己的 home 可写、附件与大结果对 Agent 只读、经链接指向日志被拒 |
| 2 | 阻断 | 成立，要改 | `temps` 按状态根分区：`<系统临时目录>/nbook[-uid]/<状态根标记>/sessions/<id>/`，标记取状态根真实路径的哈希前 16 位；扫描只进本状态根的分区，删除前 `lstat` 核对是本用户的真实目录。补两个状态根并存的测试 |
| 3 | 阻断 | 随总处理消失 | 浏览器不接新方案，`parseResource` 不放宽，`rawUrlOf` 不受影响；t17 开放时按这条显式分支 |
| 4 | 阻断 | 成立，要改 | 挂载点各有自己的子作用域与 `opening`/`open`/`closing` 状态、唯一的打开 Promise 与借用计数；请求从开始到结算一直借用；回收只选借用为 0 且空闲满 5 分钟的；64 是软上限：超出时只回收空闲的，都在用就照开，并写诊断。`closing` 中到来的请求等它收口再开。这次没有订阅（不声明 `watch`），订阅占住挂载点的规则随 t17 |
| 5 | 重要 | 随总处理消失 | 编辑器不打开新方案 |
| 6 | 重要 | 随总处理消失 | 浏览器不订阅新方案；Agent 方案这次不声明 `watch` |
| 7 | 重要 | 随总处理消失 | 服务不提供批量与取消；单项方法各自按地址分派到一个挂载点 |
| 8 | 重要 | 成立，要改 | 挂载点的根不存在时：读为 `not-found`，列出为空列表，不报提供方异常；第一次写、新建或取真实路径时由 Files 建根目录（授权通过之后）。会话的 `home/` 也按这条按需建，fork 与老会话不必另补 |
| 9 | 重要 | 成立，要改 | Files 只把 `agent: {session, profile}` 原样带进调用方信息，只接受服务端的 `nbook.agent`；会话存在与否、当前 Profile 由 `nbook.agent` 签发 `SessionResources` 时按内核给的 `ToolSessionContext` 决定（内核换 Profile 时重建，审查已核实），授权回调也是 `nbook.agent` 自己的代码 |
| 10 | 重要 | 成立，要改（范围缩小） | 这次没有跨项目订阅；每次调用：`acquire` 回来后复核外层 `signal`，已取消就立即释放；调用用外层 `signal`；`finally` 释放。租约 `revoked` 时调用以路由失败结束。订阅的收口器随 t17 |
| 11 | 阻断 | 成立，要改 | 改为进程内服务直接发 `{project}` 远程调用，路由失败原样交回调用方；补项目子进程断链后 `unknown-outcome` 原样到达 Agent 的测试 |
| 12 | 重要 | 成立，要改 | `docs://builtin/sdk` 用 SDK 打包已有的作者文档生成（`plugin-sdk/pack.ts` 的说明改写与附表），抽出一个只生成文档的入口，开发时生成到 `dist/docs/sdk/`，`pack-app.ts` 复制进应用包并加进 `files` 白名单；验收读 README 并跟进一条附表与一条 Spec 链接 |
| 13 | 重要 | 部分成立 | 相对引用部分随总处理消失。附件地址改名有真实使用方：`markdown/shared/targets.ts` 按 `local` 判附件、`nb-agent-ui/src/prompt-token-action.ts` 按 `local://` 取名字、`workspace/markdown-dialect.md`，一并改成 `session://attachments/`，前端这一小片派 Sonnet 审查 |
| 14 | 重要 | 成立，要改 | 挂载方案改为声明式：`nbook.agent` 交给 Files 的贡献实现只有根目录、挂载点的解析与授权回调，Backend 由 Files 构造与管理；类型放 `files/shared/schemes.ts`（不引 Node）。第三方插件注册方案与 SDK 公开面不在本次，随第一个插件方案（`plot://`），Spec 写明 |
| 15 | 重要 | 成立，要改 | `expand` 先按单数方案校验路径（沿用 `pathProblem`，拒绝 `.`、`..`，不做去点段），再拼成全局地址；分类只看全局地址，`sessions://<自己>/home/…` 与 `session://…` 结果相同。内核 `resolve` 返回全局地址，校验不过的原样返回（之后读写给 `invalid-address`）；`read` 只在 `not-found` 时为 `undefined`，其它失败抛出 |
| 16 | 重要 | 随总处理消失 | 编辑器不打开新方案；t17 开放时把调用方可写性交给文档模型 |

另外更正计划里的一处事实：`changes.ts` 用的是 `node:fs` 的 `watch`，不是 chokidar（第 170 行附近的“未发现问题的方面”指出）。
