---
schema: nbook.work/v1
workId: w00054-typecheck-speed
issueId: null
status: active
updated: 2026-11-24
---

# 类型检查提速：先量清楚慢在哪，再评估 TypeScript 7

## 目标

开发者嫌现在的类型检查太慢（本地 test:affected --typecheck 与 CI 的 check 作业）。先量出各包 typecheck 的耗时与构成（tsc、vue-tsc、依赖 TS 接口的脚本各占多少），再评估 TypeScript 7.0（Go 原生移植，官方称整库构建快 8 到 12 倍，但没有编程接口，vue-tsc 与直接 import typescript 的脚本要留在 6.0）能给纯 TS 包带来多少，以及 tsconfig 要改什么（baseUrl 被去掉、types 默认为空、strict 默认开）。结果是一份有数字的结论和能落地的改法，不预设一定上 7.0。
