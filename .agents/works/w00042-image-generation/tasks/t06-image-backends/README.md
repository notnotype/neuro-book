---
schema: nbook.task/v2
taskId: t06-image-backends
status: planned
updated: 2026-11-06
---

# 生成后端与任务

## 目标与范围

首发后端的适配器、异步生成任务、取消与失败处理、抽卡结果的存放，以及采用后进入作品目录。

NovelAI 与 ComfyUI 要自己写；gpt-image、nano banana 以后可以用 OMP 的 `generateImage`。抽卡废片放缓存，采用后才进作品目录（canon 要求图片路径不在 `.nbook/` 下）。合同：待补充。

## 当前状态

2026-11-06 经 nbdev 新建，尚未开工。

## 下一步

等 t02 定首发后端、t03 定合同。
