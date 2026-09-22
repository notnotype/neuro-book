---
schema: nbook.task/v2
taskId: t01-product-runtime-builder-import
---

# 修复 Product Runtime stage 的 Builder 导入

## 目标

修复 Issue #226：`scripts/deploy/product-runtime.mjs` 的 `openVerifiedImage()` 使用 `ProductRuntimeImageBuilder` 时补齐对现有实现的正确导入，使 `bun run product:stage` 能进入既有 Runtime Image 验证路径。

## 修改范围

1. 在 `scripts/deploy/product-runtime.mjs` 沿用现有 `#scripts` 导入约定，补齐 `ProductRuntimeImageBuilder` 的静态导入；不复制或旁路 Builder 的校验逻辑。
2. 在现有脚本合同测试中增加缺失导入的可观察回归覆盖，确保源文件包含正确导入且继续使用 Builder 验证入口。
3. 不改变 acceptance lease、owner、pointer、containment、清理、`product:start` 或 Runtime Image identity 合同。

## 验证

由 Leader 在实现完成后运行受影响脚本测试、受控系统 Temp 下的 `product:stage`，并验证既有 `product:start` acceptance lease 生命周期；另运行 `bun run docs:check` 与 `git diff --check`。

## 边界

不修改 `proper-lockfile@4.1.2` 补丁算法，不处理 Issue #123、Issue #225、Manager 缺包或远端 Issue/Project/PR；不 push、合并、发布、部署、数据库迁移、真实 Provider/Model 或浏览器人工验收。实现阶段跳过格式化、lint、构建和测试命令，由 Leader 统一验证。
