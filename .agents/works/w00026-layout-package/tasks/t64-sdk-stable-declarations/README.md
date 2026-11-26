---
schema: nbook.task/v2
taskId: t64-sdk-stable-declarations
status: planned
updated: 2026-11-26
---

# 插件 SDK 的声明两次构建字节相同

## 目标与范围

build:sdk 的 components.d.ts 不再随构建变（组件属性的先后）：改成先 vue-tsc 一次出全部声明、再只打包声明，同 nb-layout 的 build:package；整轮重跑发布时发布计划不再误报

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-26 经 nbdev 新建，尚未开工。

## 下一步

待补充。
