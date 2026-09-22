---
schema: nbook.work/v1
workId: w00009-issue-123-proper-lockfile
issueId: i123
---

# Issue 123 proper-lockfile Windows exFAT 租约修复

修复 `proper-lockfile@4.1.2` 在 Windows exFAT 时间精度与心跳时序下误报运行租约失效的问题；保留锁竞争、stale 接管和失去所有权后的 fail-closed 关闭合同。实现与验证只在本 Work 的隔离 worktree 中进行。

## 当前状态

- 本机可执行的 patch、回归、Product/Portable、NTFS 120 秒租约与 Product 生命周期验收已完成。
- Issue #123 保持 OPEN，当前等待报告者在真实 exFAT 机器上验证至少 120 秒租约、锁竞争和 release/reacquire；本机没有可用 exFAT 卷，不能以 NTFS 结果替代。
- Product acceptance stage 已通过项目 cleanup 命令清理，服务已停止；Product Runtime stdout/stderr 断管 EPIPE 单独跟踪于 Issue #228。
- 当前工作区只保留本 Work 的验收记录未提交改动；未清理含未提交实验资料的历史 Temp worktree。
