# 浏览器值适配器、分区绑定与状态订阅

状态：实现、主 Agent 验证与独立审查后修复完成。基线 `8b1229ea`；两个 descriptors 的既有 dirty 未触碰。
omp 两轮完成中间源码，第二轮 exit 1 且未留下完整报告，不能作为交付证据。
主 Agent 按 Task 分工修复前端、直接核对服务端差异并运行以下验证。

## 采用的最小方案

“分区代次绑定 + 每请求临时句柄”，保留 t24 的句柄池排空模式；没有引入长期句柄 Map。

- 服务端：新的 `bind` 动作打开一次受信 owner 句柄，读回该 owner 的 local/shared 分区代次，
  只返回有界代次（不含主体、根或路径）。值动作必须携带这份绑定；句柄在 `initialize()`
  先把绑定写进代次盒，再由核心 `bindGeneration` 校验，因此绑定与当前代次不符时在接纳边界直接
  失败关闭，不存在“先读新代次再让浏览器事后比较”的窗口。回收会持久化新代次，未读过的键同样失效。
- 前端：`app/utils/storage/` 下的纯适配器只消费共享合同，通过一次 HTTP 动作边界读写，
  不导入 H3/磁盘/IndexedDB。订阅用有界串行轮询复用同一个读取协议，先给初始快照再按修订发布更新。

## 已完成的改动

- `bind` 独立打开受管短句柄，值动作按 context/owner/binding 复用；所有打开与释放计入池容量与关闭排空。
- 核心第一次 await 前捕获并校验绑定；旧代次在打开时失败，包括尚未读过的键。
- 非 bind 请求必带消费定义的 schemaVersion；服务端在取得句柄前与注册定义比较，不同则返回 409/STORAGE_SCHEMA_MISMATCH。
- 浏览器值传输校验请求/响应，显式关闭自动重试，15 秒超时，保留嵌套公开错误的 committed；502/503 无证据时保持未确认。
- owner 句柄捕获 owner、观察配置、绑定、值与凭据；当前值必须通过客户端定义版本和验证函数，网络值复制并冻结。
- 每记录写队列保持调用顺序；订阅按修订去重、串行轮询、故障退避，401/403 与失效停止访问，schema 不匹配停止订阅。
- release 拒绝新调用、停止调度、取消只读请求、等待所有已接纳读写；重复释放共享同一个 Promise。
- 修复一次本地保存后 dirty 从未清零导致的持续 0ms 轮询；确定性计时器用例核对实际请求次数。
- Chrome smoke 使用产品适配器与真实 ofetch，实现双标签、独立上下文、shared、近硬上限、回收、损坏原件和运行期重建恢复。

## 验证

主 Agent 于 2026-09-16 实跑：

- `bun run --cwd packages/neuro-book test shared/storage server/storage server/api/storage app/utils/storage server/utils/auth.test.ts server/api/auth/login.post.test.ts server/runtime/shutdown/product-shutdown.test.ts`：26 文件、244 用例，通过。
- `bun run --cwd packages/neuro-book typecheck`：exit 0。
- `bun run --cwd packages/neuro-book smoke:storage-value-adapter --browser-executable 'C:/Program Files/Google/Chrome/Application/chrome.exe'`：passed，findings=[]。
  初次运行 smoke 因隔离站点找不到 ofetch 失败；esbuild 解析指向工作树根 node_modules 后重跑通过，使用真实库而非手写替身。
- `bun run --cwd packages/neuro-book scripts:typecheck`：只报告已登记的 `scripts/deploy/product-agent-state-root-smoke.ts:318` 缺 `colorwayId/userColorways`；本轮脚本无新增类型错误，不声称 scripts 全绿。

浏览器重启场景是同一 HTTP 宿主内销毁再创建生产 Storage runtime，证明旧访问失效与磁盘恢复；不是整台机器断电或 Nuxt 进程崩溃验收。
Project、备份接线、迁移原件专用预算、UI 和旧键迁移仍在后续切片，不提前声明完成。

## 独立审查后的修复

t27 首轮发现真实 ofetch 在传入 signal 时不启用 timeout；原来只检查传参的测试没覆盖实际行为。
主 Agent 已改成每请求独占 AbortController 与 15 秒计时器，链接外部取消，并在整个 request（含响应体）结束后清理。
HTTP 选项固定 notify=false，让调用方或订阅 onError 拥有展示；删除无消费的 ReadEntry.started。
新增真实 createFetch 行为测试：服务器无响应头、已返回响应头但响应体未结束，均在 15 秒失败且 committed=null，不重放请求。

- `test app/utils/storage`：4 文件、59 用例通过（比全量 244 用例时新增 2 个超时场景）。
- Chrome 值 smoke 修复后再次 passed / findings=[]。
- `docs:check`：5646 文件，failures=[]；`governance:check`：failures=[] / warnings=[]。
- 主应用 typecheck 最终 exit 0。中间新增测试曾因 Bun fetch 的 preconnect 与 HTTP 接缝类型不匹配报错，补齐实际替身能力与适配函数后转绿；未放宽产品类型。
- t27 追加独立复核正式结论为建议合并；报告单独记录，不以首轮结论替代。后续 UI 消费者必须兑现保存失败通知与恢复入口。
