---
schema: nbook.task/v2
taskId: t35-storage-project-browser
role: tasker
---

# 浏览器 Project Storage 适配器

Work：[w00003](../../README.md)；[实施计划](../../storage-implementation-plan.md)切片 2。
合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md)、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)。
切片 1 user 适配器已提交 `42d65b7c`，精确 Project ready/publicId 已提交 `0d66064b`。
t30 的 project context/action HTTP 已实现并有独立 347 用例复核；当前只在补服务端物理根复核和 HMR，不改变 HTTP DTO。

## 结果

浏览器沿用同一 owner 句柄、条件写和订阅实现访问 Project Storage；每个 session 固定用户工作面或精确 Project ready。
Project open/presence 不依赖 Storage/IndexedDB 成功，Storage 初始化失败明确返回不可用，不落到 user/shared。

## 独占范围

`app/utils/storage/**` 与直接受影响的前端测试/fixture；必要时新增独立宿主 helper，但不要提前接 UI 或迁移旧 writer。
可读 `useProjectSession.ts` 和 server Storage，不编辑 t30/t31 文件、shared HTTP DTO、Work/Spec。
两个 `app/utils/workbench/descriptors{,.test}.ts` 是用户既有 dirty，完全排除。
不联网、不再派代理、不提交/push/PR，不操作真实用户数据；隔离测试根用仓库支持包。
新增测试必须核对 vitest include；若需登记 vitest.config.ts 先在报告说明，主 Agent收口。

## 实现

1. 读取当前 `host-context-client.ts`、`owner-handle.ts`、`value-transport.ts`、client identity 与相关测试。
   提供显式 user/project session 类型（判别字段固定 scope；project 包含捕获的 projectRoot/publicId），不能给调用者任意 URL。
   现有 user API 可保留清楚的薄包装；消除 user 类型被误当通用 session 的约定。
2. `openStorageProjectContext` 接受 t28 ready 的明确字段或结构化目标。第一次 await 前复制/校验标量，避免身份初始化等待期间页面切换改变请求地址。
   POST `/api/storage/project/context` body 精确 `{projectRoot, publicId}`，身份凭证沿用同一 IndexedDB owner。
   session/target 返回时不可改写；旧 session 不自动重新签发或用路径取得新 ready。
3. 共用 transport 按 session 的固定 scope 选 user/project action 路径。owner handle、订阅、CAS、终止、释放继续复用；
   frontend 也核验 definition.scope 与 session.scope，避免确定无效的请求下发。
   session release 使用相应 context endpoint；只能释放本 session，不关 Project/presence，不清客户端身份。
4. Context 初始化/释放保留显式失败；自动重试关闭，背景失败不得反复全局 toast。和值传输一样请求期限覆盖完整响应体；取消/超时不伪装成功。
   不复制第二套截止计时器；若提取已有 helper 保持原语义和测试。
5. README 写 user/project 的消费顺序、ready 先于 Storage、目标捕获、句柄先 release 再 session release；切换的未提交意图 UI 留切片4。

## 验证与报告

聚焦 tests 覆盖：A/B 两目标与 user 路径隔离；ready 对象在身份 await 期间被外部改变仍请求原 A；
缺/非法 publicId 直接不可用且无请求；身份失效不 fallback；project 发布失效后动作错误使句柄终止而非重签；
scope 不匹配确定拒绝；release 指向正确 scope；前后端超时/取消不产生隐式重放；user 既有回归。
至少用真实 adapter + 注入 request 串起 context→owner bind→read/save/read→release，检查真实 body/headers/path；服务端真实 HTTP t30 已覆盖。
跑 `bun run test app/utils/storage --maxWorkers 1`，记录文件/用例数与退出码。主 Agent统一 typecheck。
先写 `walkthroughs/implementation.md` 进行中，15 分钟内留下可核查产物，完成更新真实结果与未运行项。不要 sleep、空返回或宣称整个切片完成。
