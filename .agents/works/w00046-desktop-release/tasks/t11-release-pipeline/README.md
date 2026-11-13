---
schema: nbook.task/v2
taskId: t11-release-pipeline
status: planned
updated: 2026-11-13
---

# 打标签自动发布流水线

## 目标与范围

release.yml：标签与产品版本一致性、标签提交上调用可复用的 ci.yml、ubuntu 冒烟 11 个包、windows 组装与冒烟安装包与便携包、npm CLI trusted publishing 发同一批 tarball（publish.ts 增加 CI 入口）、草稿 Release 核对后公开、重跑与不回拨 latest；11 个包在 npm 上配置信任（开发者操作）。依据提案 4.8、ADR 0051 决定 7。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-13 经 nbdev 新建，尚未开工。

## 下一步

待补充。
