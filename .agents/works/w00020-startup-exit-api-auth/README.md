---
schema: nbook.work/v1
workId: w00020-startup-exit-api-auth
issueId: null
---

# 启动失败不退出与 API 路径认证放行修复

修复两个现有产品问题。它们是在 w00017 的风险门验证（t27 G0）与设计审查中发现的，与 w00017 的平台重构无关，所以独立修复、可单独合入 master：

1. **启动失败时进程不退出。** Nitro 的 node-server 入口通过 `trapUnhandledNodeErrors()` 注册了只记录、不退出的 `uncaughtException` 处理器；`server/middleware/00-product-startup.ts` 靠 `setImmediate` 抛出未捕获异常来终止进程，因此在产品构建中失效。进程存活并对所有请求返回 500，Manager 的就绪探测要等 120 秒超时才放弃。
2. **认证中间件按扩展名放行 API 路径。** `server/middleware/auth.ts` 的 `isPublicPath` 对任何以 `.js`、`.png` 等结尾的路径跳过登录检查，`/api/` 下也不例外；捕获全部子路径的路由（`world-engine`、`plot`）把最后一段当作 id，理论上可以绕过认证。

## 范围与非目标

- 只改这两处行为及其测试；启动失败退出码沿用通用失败码 1，租约失效专用退出码 75 保持优先。
- 不处理开发模式的热重载与停止问题，已登记 [#244](https://github.com/notnotype/neuro-book/issues/244)，随 w00017 阶段 1 解决。

## 执行位置

- worktree：`.worktree/w00020-startup-exit-api-auth`
- branch：`fix/w00020-startup-exit-api-auth`（基于本地 `master`）
- 主工作区的本目录只是占号记录，进度与证据在 worktree 中维护。

## Task

| Task | 内容 |
|---|---|
| [t01](tasks/t01-startup-exit-api-auth/README.md) | 两个修复与回归测试 |
