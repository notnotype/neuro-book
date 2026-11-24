---
schema: nbook.task/v2
taskId: t45-openrouter-app-attribution
status: planned
updated: 2026-11-24
---

# 给 OpenRouter 的请求带应用归属请求头

## 目标与范围

发往 OpenRouter 的模型请求带上应用归属请求头，让 NeuroBook 出现在 OpenRouter 的应用排行与分析里。由模型服务一侧负责，不属于遥测插件（开发者 2026-11-24）。

合同：待定。会改模型服务对外发出的请求头，开工时在模型服务的 Spec 里加一条。

## 当前状态

2026-11-24 记下，未开工。来源：开发者在讨论遥测（[w00053 t02](../../../w00053-telemetry-feedback-stats/tasks/t02-collection-scope-and-terms/README.md)）时提出。

已知事实（2026-11-24 读 OpenRouter 文档 `https://openrouter.ai/docs/app-attribution`）：

- `HTTP-Referer` 必填，值是应用的网址，它是应用在排行里的唯一标识；没有它不会建应用页。
- `X-OpenRouter-Title` 是显示名（旧名 `X-Title` 仍可用），要与 `HTTP-Referer` 一起发才有效。
- `X-OpenRouter-Categories` 至多两个分类，认得的分类里有 `creative-writing`；不认识的被丢弃、不报错。
- `X-OpenRouter-App-Visibility: hidden` 只在第一次建应用时起作用，之后改可见性要联系对方客服。
- 仓库里现在没有发这些请求头的代码（在 `packages/nb-models`、`packages/nb-harness`、模型与网络插件范围内搜 `HTTP-Referer`、`X-Title`、`X-OpenRouter` 没有命中）；模型请求头在 `packages/nb-harness/src/kernel/model/omp.ts` 合并（服务商目标的 `headers` 加请求自带的 `headers`）。

开工时要定的：

- `HTTP-Referer` 用哪个网址。它一旦用上就是唯一标识，换网址会在排行里变成另一个应用；官方站的域名定下来之前不要发。
- 是否给用户一个关闭的开关。请求是用户用自己的密钥发的，这些请求头只告诉 OpenRouter “这次请求来自 NeuroBook”，不含用户信息；仍应写进隐私说明里“发给第三方的信息”一节。
- 只对 OpenRouter 的地址发，其它服务商与中转站不发。

## 下一步

等官方站的域名与隐私说明定稿后开工。
