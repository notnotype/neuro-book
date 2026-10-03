# 架构决策记录

`docs/adr/` 保存已接受且需要长期解释的架构、协议、所有权和安全决策。ADR 解释“为什么”，完整可观察行为仍由 [`../specs/README.md`](../specs/README.md) 登记的当前规范定义。

文件名使用 `NNNN-kebab-case.md`；编号唯一，一级标题中的编号必须与文件名一致。新决策使用下一个空闲编号，不复用已归档或已撤销编号。被替代的 ADR 保留原文件并标明 superseded 与替代者。

ADR 0001–0021 是旧应用的决策，随旧包留在 [`../../packages/neuro-book-legacy/docs/adr/`](../../packages/neuro-book-legacy/docs/adr/README.md)，只作参照；编号从 0022 起在本目录延续。

| 编号 | 决策 |
|---|---|
| [0022](0022-extensible-platform-and-plugin-trust.md) | 可扩展应用平台与第一版插件信任模型 |
| [0023](0023-v2-frontend-backend-stack.md) | NeuroBook v2 去掉 Nuxt，前端 Vue + Vite，后端 Bun + Hono，校验统一 TypeBox |
