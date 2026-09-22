---
schema: nbook.task/v2
taskId: t01-manager-installation-entry-load-fix
---

# 修复 Manager installation entry clean build 加载失败

## 目标

修复 Issue #229：clean Manager build 后导入 `@notnotype/neuro-book-manager/installation` 不得再触发 `TypeError: Q9 is not a function`，并恢复 Windows Portable provenance 验证。

## 修改范围

1. 复现并定位 `installation-entry.mjs` minified bundle 的加载根因，检查共享依赖、Bun.build 配置和其它 Manager entry 的影响。
2. 采用现有 Manager 包与构建模式修复公开入口，保持 installation API、minification、发布 identity、archive provenance 和 containment 合同。
3. 增加或调整行为验证，覆盖 clean build 后公开入口实际 import；不以源码字符串或绕过 bundle 的方式证明。
4. 运行 `scripts/release/windows-portable-manager.test.ts` 及受影响 Manager build/typecheck/test/pack 验证，并在等价 clean archive 上确认影响范围。

## 验证

实现后由 Leader 运行 clean Manager build、公开 installation import、Windows Portable provenance 测试、Manager typecheck/test/pack 与必要的发布归档等价验证；记录实际命令、退出码、关键结果和未运行项。

## 边界

不修改 Product Runtime stdio、World Engine、proper-lockfile 或真实 Provider/Model；不执行远端 Issue/Project/PR 写入、push、合并、发布、部署、浏览器人工验收或数据删除。实现阶段跳过格式化、lint、全量测试和构建，由 Leader 统一验证。
