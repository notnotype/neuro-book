# t28 前端追加修复

主 Agent 在首轮 omp 退出后切换 Tasker，仅修改前端 controller/测试及相关测试登记。

## 修复

- transport 返回值与事件按 `unknown` 接收，在 controller 边界用既有 DTO schema 验证；open 的 Project root 还必须匹配请求。
  缺失、空或非字符串 publicId 均不能发布 ready，也不能把无效 open 结果发往 presence。
- Opening 先建立 owner，再用 Promise 微任务启动网络；open/stream 同步抛错仍进入 failed，后续重试可成功。
- ready 首帧与 release 同轮到达时，失败/取消分支等待已建立的 presence 流退出；旧 owner 不提前释放。
- 同一轮 open 后立即 release 不再启动已取消的传输。

## 实际验证

`bun run test app/composables/useProjectSession.test.ts app/utils/project-route-progress.test.ts app/utils/project-route-transition.contract.test.ts`
（主应用包根）：**3 文件 / 33 用例通过，exit 0**。

首轮报告曾将后两份文件写入运行命令，但 Vitest include 未登记，实际上被静默跳过；本轮已逐项补登记。
因此首轮“命令包含文件”的自述不作为这两份测试的运行证据。

服务端旧 V2 HMR 与 presence terminal 由追加 omp 修复；本报告不替代统一 typecheck 与独立审查。
