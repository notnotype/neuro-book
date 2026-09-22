# nb-ui 项目状态

> 本轮 T149 resync：来源 checkout 的 HEAD 为 `2a2ed2df79fe9b2a9336ec779b7792780d280e83`，来源分支为 `feat/component-lab`。本页记录当前收编包可确认的快照状态，不替代项目规范或 Task。

## 当前状态

- `@notnotype/nb-ui` 已作为自治包收编到 `packages/nb-ui`。
- 包保留源 package name、版本、scripts、exports、依赖语义，并设置 `private: true`。
- 许可证为 `AGPL-3.0-only`，与仓库根和 `packages/neuro-book` 一致。收编时保留的 `PolyForm-Noncommercial-1.0.0` 与 AGPL 产品的分发条件冲突，已在主应用开始消费本包时切换。
- 组件、主题、配色、token、playground、README 和项目文档均按 S0 import manifest 迁入。
- `dist/nb-ui.css` 是项目约定的提交型构建产物；本轮由 `packages/nb-ui` 源码执行 `bun run build:css` 重建，产物 SHA-256 为 `176968c47a8b9c19c2e884348af52c0b7b221d02b5c0c488af258ac16a99f8c6`。

## 治理入口

- 项目规则：[`AGENTS.md`](AGENTS.md)
- 项目文档：[`docs/README.md`](docs/README.md)
- 项目 Task：[`.agents/tasks/README.md`](.agents/tasks/README.md)
- 仓库共享规则：[`../../AGENTS.md`](../../AGENTS.md)

## 验证边界

本轮 T149 resync 已运行 `bun run build:css` 并成功；未运行本包测试、typecheck、playground 浏览器验收或完整 build。原 checkout 保持只读；导入范围与来源 hash 由 T149 resync manifest 复核。

## 来源与范围

本轮 resync manifest 位于系统临时目录 `00149-sibling-resync-20260818T123029Z`，记录 156 个 included 条目和 2 个排除条目；`.gitignore` 与根 `bun.lock` 不复制为目标包控制文件。
