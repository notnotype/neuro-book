# 主 Agent 审查意见（第 1 轮）

基线结构、Manager 驱动、L1、L5、L6、L10 的实现方式都接受。以下问题处理后再验收，约束与任务说明相同（只改 smoke 脚本与 package.json 的一行 scripts，不改产品代码，不提交、不 stash，不动 `packages/neuro-book/docs/research/README.md`）。

## 必须修改

1. **你把 `smoke:runtime-foundation` 脚本替换掉了。** `packages/neuro-book/package.json` 里原有的 `"smoke:runtime-foundation": "node --import tsx scripts/smoke/runtime-foundation.ts"` 被删，它是多份已实现 Spec 的验证入口。恢复它，`smoke:product-lifecycle` 作为新增的一行。

2. **L3、L4 的排空部分现在就能检查，不要整体标 pending。** 用自然的长请求：在临时 Project 里写一个足够大的文件（例如 128MB 以上），经产品现有的工作区文件下载接口读取，客户端读到一部分后暂停读取，使响应保持在途；然后发停止（L3 发 SIGTERM，L4 用 Manager 的停止函数），在排空期间发一个新请求，最后恢复读取并核对字节数完整。
   - 每个检查项拆成子断言，各自有 pass、fail、pending：L3、L4 至少包含“排空期间新请求得到 503”“在途请求完整结束”“进程以 0 退出且租约锁释放”“关闭按依赖逆序”四条。前三条按实际行为判 pass 或 fail；只有最后一条因为缺关闭诊断标 pending。
   - 检查项的总结果：有任一子断言 fail 即 fail；否则有 pending 即 pending；全部 pass 才 pass。报告与汇总表都显示子断言。L1、L5–L10 也按同样结构输出（子断言可以只有一条）。

3. **L9 测错了对象。** 同源部署下，服务端停掉后刷新页面只会得到浏览器原生的连接错误页，这不是规范要的场景。规范的意思是“外壳已经加载，但浏览器宿主的启动请求失败”。改为：服务端正常运行，用 Playwright 的路由拦截让页面启动阶段的 API 请求失败（当前代码里是主页启动时调用的接口；阶段 1 之后是宿主的引导请求，拦截规则写成容易替换的形式，并在代码注释里说明）。断言三条：不渲染半个工作台；显示带重试的失败页；解除拦截后重试成功。按当前代码的实际表现判定，很可能是 fail，这是正确的基线。

4. **L8 必须独立于 L7。** L8 用全新的临时 State Root、全新的 dev 进程与端口，不经过热重载，直接就绪后发 SIGTERM。查清现在“dev 进程没有稳定 200”的原因：是 #244 本身（开发模式停止或启动问题），还是 L7 残留的进程、租约锁或端口导致。如果是残留，修 smoke 的清理；如果全新 dev 进程本来就无法就绪，在汇报中写明现象与日志依据。

## 交付

- 重跑完整 smoke（含构建），覆盖 `evidences/baseline-report.json` 与 `baseline-output.txt` 以及各项日志。
- 汇报每条的处理；给出新的基线表（含子断言）。
