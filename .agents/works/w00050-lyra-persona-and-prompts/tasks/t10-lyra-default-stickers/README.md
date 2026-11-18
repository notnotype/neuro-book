---
schema: nbook.task/v2
taskId: t10-lyra-default-stickers
status: in-progress
updated: 2026-11-18
---

# 星璃默认表情包：生成一组表情并随应用带上

## 目标与范围

用 image-gen 以 [`brand/mascot/master/canonical-lyra-nai45.png`](../../../../../brand/mascot/master/canonical-lyra-nai45.png) 为参考生成一组星璃表情，定画风与表情清单，并定下怎么默认带给用户。来源：开发者 2026-11-18 在会话里提出（“表情包可以用 /image-gen + brand/mascot/master/canonical-lyra-nai45.png 生成一组默认的”）。

合同：带给用户的方式定下后再定。若选内置来源，[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 的“不承诺”里“内置表情包”一条要改，来源加 `builtin`。

## 做法

- 服务：image-gen 的 `jiji` profile（OpenAI Images 协议，`gpt-image-2.6-sunburst`），`edit` 接口上传母版作参考。
- 提示词：Q 版贴纸、白色模切边、整张纯绿幕底（`#00FF00`），每张只换表情与动作一句。
- 抠图：本地脚本去掉绿幕（与四边连通的、或面积至少 30 像素的绿块；人物的青色宝石绿度低不受影响），边缘按绿度渐变透明并去绿溢色，裁到内容加 4% 边距，缩到 512×512 存 WebP。
- 原图、抠图脚本、批量脚本与对照图在本地 `.local/brand/mascot/stickers/`，不入库。

## 当前状态

2026-11-18 第一批 12 张出完（开心、害羞、捂脸、思考、灵感、疑问、好的、困、委屈、生气、惊讶、喝茶），共发 14 次生成请求（另 2 张定画风的样图）。人物一致、抠图干净；问题是 28 像素的行内小图里 12 张几乎分不出。第 1 轮评审板（[`artifacts/review`](artifacts/review/index.html)）问构图、白边、清单与带给用户的方式。

## 下一步

按评审板的答复重出或定稿，再按带给用户的方式改 Spec、写计划。
