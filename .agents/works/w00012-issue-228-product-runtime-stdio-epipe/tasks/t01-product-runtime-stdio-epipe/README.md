---
schema: nbook.task/v2
taskId: t01-product-runtime-stdio-epipe
---

# 修复 Product Runtime stdio 断管

## 目标

修复 Issue #228：当 Product 父进程的 stdout/stderr 被关闭、替换或断开时，Product 继续监听并提供 API；日志写入失败不得递归写管道或让业务进程退出。

## 修改范围

1. 沿用现有 `AppFileLogger` 和 State Root JSONL 所有权，补齐 async/sync 写失败与 EPIPE 处理，并保证 `consola` reporter、`console.warn/error` 和异常监听不把日志错误重新抛回业务路径。
2. 调整 Product start command、product command wrapper 和 acceptance runner 的 child stdio 与信号生命周期；统一从显式环境解析绝对 Application/State/Cache 根，不改变已有启动命令和退出合同。
3. 在现有 Product/Bun/Windows 测试入口增加真实子进程回归：断开父输出后 `/api/app/version`、World Engine `schema`/`slices`、shutdown、lease release/reacquire 和第二实例 `ELOCKED`。
4. 不旁路 Runtime Image verifier，不修改 World Engine 领域逻辑、esbuild、proper-lockfile 算法或真实 Provider/Model。

## 验证

由 Leader 先运行新增复现使其在旧实现失败，再运行日志/launcher 聚焦测试、Product rebuild、Windows Portable smoke 和受影响完整测试；所有临时根使用测试支持包或系统 Temp，并记录未能在当前环境执行的门禁。

## 边界

不执行远端 Issue/Project/PR 写入、push、合并、发布、部署、浏览器人工验收、真实 Provider/Model 或数据删除。实现阶段跳过格式化、lint、全量测试和构建，由 Leader 统一验证。
