---
schema: nbook.task/v2
taskId: t29-project-ready-review
---

# Project 精确 ready 与 presence 独立审查

## 当前追加审查指令

首轮 Reviewer 退出 0 但未留下任何报告，期间多次 sleep 等待；不作为独立审查完成。
现在源码已经冻结、证据完整：t28 最终 **30 文件 / 215 用例通过、主应用 typecheck exit 0**。
本轮禁止 sleep 或等待主 Agent，不再重复 typecheck/完整测试；只读审查，必要时小探针。
**第一步先写 `walkthroughs/review.md` 标“审查进行中”及范围，然后再读实现。**
预算内给明确结论；若发现阻断，立即追加具体触发与路径，不能空返回。
主 Agent 已核验 GC 追加修复，2 文件 8 用例直接回归与随后全部 215 用例均通过。

Work：[w00003](../../README.md)，实现 [t28](../t28-project-ready-publication/README.md)。
审查当前 worktree 相对于 `42d65b7c` 的 t28 源码、测试与新真实 HTTP 合同测试。
两个 workbench descriptors 是用户既有 dirty，完全排除。仅写本 Task `walkthroughs/review.md`，不改源码、Spec 或 Task。
不联网、再派代理、提交、push、远端写入，不操作真实用户 data。

主 Agent 的前端追加修复与测试登记见 [frontend-followup](../t28-project-ready-publication/walkthroughs/frontend-followup.md)。
追加 omp 的 server 实现未完成验证，由主 Agent 接管，最新统一证据会写入 t28 的 `walkthroughs/leader-verification.md`。
首次报告不是当前最终证据；以 diff 和实际输出核验。3 分钟内先写已查范围/发现，不把报告留到最后。

## 重点

09:10 追加：HMR 全文件暴露 SQLite GC helper 的存量重载问题，已最小修复并增加同名回归测试。
`sqlite-handle-release.ts` 的进程 exposed 标记不能当作模块 collector 已缓存；重载需要重新取得函数。
将这两个文件一并核对。主 Agent 已移除临时 DEBUG 日志，正在跑 HMR 全文件与该直接回归。

1. publicId 由 Runtime 签发，绑定精确 ready 对象；open/presence 不按路径重求当前代次，未知/跨项目/跨运行期/终止代次拒绝。
2. 控制器运行期验证 DTO、同根不同标识、同步抛错、latest-wins、release 等待 SSE 退出、manifest 提示与重连。
3. presence signal 属于 Runtime；acquire 到首帧、活跃连接到 Project close 的窗口均不继续旧心跳；真实 H3 测试可观察 EOF。
4. V2 HMR 不复用不懂 publicId 的旧实例；旧 owner 排空失败必须阻断新 owner，交接期间 shutdown 不可提前完成或令待交接 open 在之后复活。
   同版 V3 reload 仍保留同一 Service/ready，避免每次编辑断开用户。
5. publicId 是定位条件，不是授权凭据。Project Storage 的身份签发、lazy module、文件/备份、UI 仍是后续 Task，不把非目标当缺陷。

核对现有调用方已完整切换，公共接口没有静默路径 fallback；检查是否引入生命周期回归与测试假阳性。
必要时可跑小探针；不要重复全部主应用业务测试。按 Reviewer 合同给 `建议合并`、`需要修复`、`未完成验证` 或 `无法判断`，
每个缺陷写具体触发条件、影响与代码位置；未运行项如实写出。
