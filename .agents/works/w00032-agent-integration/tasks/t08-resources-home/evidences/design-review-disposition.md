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

# 第二轮

审查者：omp 默认模型，报告 [design-review-omp-r2.txt](design-review-omp-r2.txt)，13 条（阻断 1、重要 11、建议 1），审查对象为提交 `fa95086c0` 的第二稿。审查者确认第一轮第 3、5、6、7、11、13（相对引用）、14、15、16 条已解决或随 t17 退出，没有要求改变第二稿的形状。

| # | 级别 | 归类 | 处理 |
|---|---|---|---|
| 1 | 阻断 | 成立，要改 | 授权回调改为 `authorize(caller, mount, operation, relativePath)`，挂载点名显式传入；同一个回调对词法与真实路径各调一次时用同一个挂载点名 |
| 2 | 重要 | 成立，要改 | 服务的每个方法与 `SessionResources` 的方法收 `{signal?, as?}`；t12 从工具执行的 `signal` 传入。“不提供取消方法”与“支持 `AbortSignal`”分开写。门面释放与 Files 入口停止也会中止在途调用 |
| 3 | 重要 | 成立，要改 | Agent 来源的事件会进 `user://` 与 `project://` 的订阅：两份合同的版本都加 1 |
| 4 | 重要 | 成立，要改 | 物化流程写成步骤：只建挂载点根（受管容器下的单段名，非递归 `mkdir`）与 `ensure` 列出的单段子目录（在打开的根里用排他新建）；容器由注册方在激活时建好并核对是真实目录；已存在的同名文件或链接为 `not-a-directory`/`protected-path`，不覆盖；被拒的请求不建任何目录；建好后照常按真实路径授权实际目标 |
| 5 | 重要 | 成立，要改 | 列出的结果逐项过 `authorize(…, "read", 子项路径)`，不通过的不返回 |
| 6 | 重要 | 成立，要改 | `docs://builtin` 挂 `dist/docs/builtin/`，SDK 作者文档生成到其下的 `sdk/`；验收用 `docs://builtin/sdk/README.md` |
| 7 | 重要 | 成立，要改 | Files 给注册方一个按挂载点撤下的接口 `retire(mount)`：先拒新借用、等在途结算、关闭 Backend；之后同名挂载点重新打开时按新根处理。`temps` 的归档清理改在“已归档的会话从句柄表卸下时”（t10 的卸下只在没有运行时发生），先 `retire` 再删。理由：内核的归档不停止运行，归档当下删会删掉正在运行的命令的工作文件。这是对开发者决定 3 的细化，汇报时说明 |
| 8 | 重要 | 成立，要改 | 挂载方案的 Backend 不做文件夹类型投影（`.content`、`.binder` 当普通目录，不维护清单），新建不会顺带改 `content.xml`。授权在服务入口按词法与真实路径各做一次，操作内部等锁后的重新解析不再调授权回调：期间能换链接的只有 Agent 自己的 shell，而 shell 绕过文件工具是已接受的限制（t12 决定），写进 Spec 的已知限制 |
| 9 | 重要 | 成立，要改 | `temps` 的受管容器 `nbook[-uid]`、状态根分区、`sessions` 逐层 `lstat` 核对是本用户的真实目录（建时权限 0700），任何一层是链接、文件或别的用户的就拒绝并诊断；系统临时目录本身不查 |
| 10 | 重要 | 成立，要改 | 定义成功值：虚拟根的 `list` 返回 `{kind: "virtual", description, entries: [{name, address, title?, meta}]}`，实体目录沿用现有列出结果；虚拟根的 `read` 为 `not-a-file`，`realPath` 为 `unsupported-capability`；`SessionResources` 交回的条目带全局地址 |
| 11 | 重要 | 成立，要改 | `projectsKey` 的 `registry-invalid`（`list`、`resolve`、`acquire`）映射为 `project-unavailable`，详情带原因；修好登记表后下一次调用照常 |
| 12 | 建议 | 成立，要改 | 把“在一个根上执行一次已接纳的请求、记来源、转成公共结果”从 `implementation()` 抽成 Files 内部的执行模块，旧远程合同、`user://` 服务分派与挂载方案共用；`parseAddress` 与 `parseResource` 共用语法与 `pathProblem` |
| 13 | 重要 | 成立，要改 | 验收映射补上：同一挂载点并发首次打开、`closing` 中的新请求、打开中撤回、切 Profile 前后的权限、首次 `home`/`profile`/`temp` 的真实路径、不带 `as` 的浏览器写入照常、伪造 `as` 被拒、旧版本订阅得 `version-changed`、运行中归档不删目录。应用包：把打包产物解到仓库外，用同一个定位函数找到文档目录并读 `docs://builtin/sdk/README.md` |

审查者的两条规范回写建议是 Spec 内容，写进第 0 片的 `resources.md` 与 `agent/resources.md`，不另作规范回写。

# 第三轮

审查者：omp 默认模型，报告 [design-review-omp-r3.txt](design-review-omp-r3.txt)，8 条（重要 8），审查对象为提交 `2d970f706` 的第三稿。审查者确认第二轮第 1–5、8、9、11、12 条已落实。第 5、6 条附了在真实插件宿主上跑的探针（远程订阅让归档会话一直不卸下；工具中止后底层仍在执行时会话已卸下），核实为属实。第三轮仍有实质问题，按 reviewing 的轮数上限交开发者决定。

| # | 归类 | 处理 |
|---|---|---|
| 1 | 成立 | `retire` 完成就重新接纳，删除目录的那段时间不受保护。随下面的“`temps` 归档清理”决定 |
| 2 | 成立，要改 | `docs` 两个根不在同一容器下：开发生成与打包都产出 `dist/docs/{builtin/sdk,agent}/`，Agent 文档构建时复制进去，容器为 `dist/docs/` |
| 3 | 成立 | 声明式贡献拿不到 `retire` 句柄。随下面的决定 |
| 4 | 成立，要改 | 虚拟根的 `read` 改为返回文字呈现（说明加条目与全局地址），`list` 仍返回结构化值；写入照旧拒绝 |
| 5 | 成立 | 远程订阅让归档会话一直不卸下，清理不触发。随下面的决定 |
| 6 | 成立 | 工具中止后底层仍在用目录时会话已能卸下，卸下不是安全的删除时机。随下面的决定 |
| 7 | 成立，要改 | 工具实现拿不到资源服务：`agent.tools` 的 `create(context, services)` 多一个 `services.resources: SessionResources`，由 `nbook.agent` 按内核给的真实上下文构造后交给工具工厂；t12 的工具用它做全部地址读写，并把 `context.signal` 传给每个方法 |
| 8 | 成立，要改 | `AgentService.resources(context)` 让任何依赖 `agentKey` 的插件都能伪造会话：删掉这个方法，`SessionResources` 只经第 7 条的工具工厂与内核的 `SessionEnv.resources` 交出，都在 `nbook.agent` 的激活闭包里按内核上下文构造 |

## 交开发者决定：`temps` 的归档清理

第 1、3、5、6 条都出在“归档时清理临时目录”：要安全地删，必须等“已归档、没有运行、没有工具还在用目录”，而工具被中止后可能仍在底层执行，订阅又会让会话一直不卸下，于是需要 `retire` 的控制通道、删除期间的接纳门闩、工具实际使用期的借用。

推荐：`temps` 只在服务端启动时清理（已不存在或已归档的会话），不在归档时清。启动时新进程里没有任何工具在用这些目录，四条都不再成立，`retire` 也不需要。代价是已归档会话的临时文件留到下次启动服务端；系统临时目录本身也会被操作系统定期清理。

开发者 2026-11-02 选“只在启动时清理”。第 1、3、5、6 条随之不再成立，`retire` 从计划中删掉；第 2、4、7、8 条按上表改进计划第四稿。设计审查到此结束（三轮上限），第四稿直接实施，实现审查时一并核对。
