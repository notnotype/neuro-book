# t23 宿主接线与验收准备

2026-09-16，基线 `dfc5df82`；本文件是 Leader 的只读取证，不是 t23 实现/验收通过结论。
t23 omp Tasker 正在执行，主 Agent 不并行改它拥有的源码。

## 已核对的仓库入口

- `server/utils/auth.ts` 的 `getCurrentUser` 读取 session，并复验 User.status=active 与 sessionVersion。
  auth-on 不应仅信任 session 的静态 user DTO；auth-off 主体应单独命名，不能与真实 user ID 合并。
- 同文件 `authSessionConfig` 根据请求 HTTP/HTTPS 决定 Secure cookie。新客户端宿主不能仅靠
  HTTPS-only Web Crypto subtle 或 navigator.locks 才正常工作；随机字节 API 和 IndexedDB 需分别验证。
- `server/middleware/auth.ts` 默认保护新 API；不要把 Storage 路由加入 publicApiPaths。
- `server/runtime/shutdown/product-shutdown.ts` 拥有产品关闭步骤；
  `middleware/product-shutdown-drain.ts` 与 `plugins/project-session-close.ts` 已经共用该 controller。
  新 user 上下文 owner 接入同一关闭路径，不新增 process.on 或无人管理的 singleton 定时器。
- `ProductShutdownController` 在关 owner 前等待已进入的 HTTP 请求；并发关闭和已有请求排空有真实测试。
  长连接将需要后续专门处理，不能假设 response 永远结束。
- `workspace-files/workspace-runtime-root.ts` 提供显式运行期路径与隔离测试上下文。
  `runtime/paths/runtime-paths.ts` 的 workspaceRoot 同样属于运行期路径 owner；禁止 API body 自由传路径。

## 真实浏览器设施

- 根与主包已有 `playwright-core ^1.61.1`，不需要新增依赖。
- `scripts/deploy/product-browser-smoke.ts`、主包 `scripts/smoke/component-lab.ts` 的合同明确：
  Windows 上使用 Node 启动 Playwright，Bun 的 Chromium pipe 连接不可靠。
- 本机已只读核验存在：
  `C:/Program Files/Google/Chrome/Application/chrome.exe`、
  `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。
  这只证明 binary 存在，尚未启动本轮浏览器验收。
- 可为新纯身份模块提供最小 loopback HTTP 测试宿主，在新浏览器 profile/context 里验
  同源两个页面并发初始化、另一个 context 隔离、关闭重开页面、清标识与存储失败。
  代码应消费真实身份模块，不能只复制一段类似 IndexedDB 算法证明原语可用。
- 浏览器 profile、fixture、输出和临时 bundle 使用测试支持包分配的系统 Temp，finally 收口；
  不接管现有桌面浏览器，不连接真实产品默认 data。

## 后续复核重点

客户端凭证与一次访问上下文分别有生命周期：凭证定位可恢复分区，上下文证明本次仍有访问权。
后端重启后旧上下文失效，但重新初始化应复用浏览器凭证定位原分区。
HTTP 请求必须核验当前主体、凭证与运行期，不能只根据一个已知 context ID 继续使用签发时的权限。
本 Task 的容量/过期机制不能用静默逐出仍有操作的上下文来掩盖泄漏。
