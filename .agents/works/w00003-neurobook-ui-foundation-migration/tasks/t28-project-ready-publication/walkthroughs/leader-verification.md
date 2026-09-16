# t28 统一复核与验证

状态：实现与最终统一验证通过；[t29 独立审查](../../t29-project-ready-review/walkthroughs/review.md)建议合并，无阻断项。

## 追加实现

- 前端修复见 [frontend-followup](frontend-followup.md)：运行期 DTO 校验、同步抛错、同轮 ready/release 排空；路由两份测试已真实登记。
- Runtime presence 返回精确代次 signal 与幂等 release；HTTP 在首帧前检查 signal，代次结束时停止心跳并关闭 SSE。
- V2→V3 升级先排空旧 Service，不复用缺少 publicId 的旧实例；同版 V3 重载保留 owner。
- 主 Agent 修正追加 omp 中的交接缺陷：旧 close 的同步/异步失败均保留并阻断新 owner；
  Facade shutdown 先建立 gate、失效等交接请求、排空旧 owner。核验和新操作接纳之间没有额外 await。
- 追加 omp exit 1，未交付验证报告；其产物由主 Agent 接管核对，退出状态不作为完成证据。

## 当前真实结果

- 前端与路由：3 文件 33 用例通过。
- 主应用 `bun run typecheck`：exit 0（当前产品源码，尚在修改测试清理）。
- 首次完整 Project 聚焦：29 文件 214 用例，212 通过 / 2 个 HMR afterEach 超时；保留这个失败事实。
  Facade 清理并非全部根因：有界日志证明所有 close 已结束，卡在 Windows rm。
  `sqlite-handle-release.ts` 在模块重载后丢了 collector 缓存，却因进程的 exposed 标记而拒绝重新取得函数。
  修复 owning helper 后，**HMR 全文件 + GC 直接回归：2 文件 8 用例通过，exit 0，11.19 秒**。
  三个真实 Session 用例从 8～30 秒降低到 0.7～1 秒；未延长删除重试或跳过清理。临时 DEBUG 日志已移除。
  **最终重跑：30 文件、215 用例全部通过，exit 0，97.47 秒**（`--maxWorkers 1`）。
  最终主应用 `bun run typecheck` 同样 exit 0。
- `bun run docs:check`：最终 5656 文件、failures=[]。
- `bun run governance:check`：failures=[]、warnings=[]。
- `git diff --check`：通过（仅 CRLF 提示）。

真实 H3 合同在完整聚焦中通过：open/presence 标识、close/reopen、同路径重建、缺失标识/陈旧标识拒绝、活跃 SSE 在 Project 关闭后 EOF。
尚未运行浏览器 UI 验收；本增量没有更改 UI 表面、Project Storage 尚未接入。

## 审查收口

Reviewer 独立复核 publicId、运行期 DTO、presence EOF、HMR 排空与 GC 重载，并运行聚焦探针；详见上述 t29 报告。
保留两项明确边界：旧 Service 关闭失败时需重启进程才能恢复；publicId 是代次定位符，不是授权凭据。
下一增量在既有 Storage 身份核验上绑定精确 Project ready，不以 publicId 替代主体或客户端鉴权。
