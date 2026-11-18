---
schema: nbook.task/v2
taskId: t02-backend-probe
status: planned
updated: 2026-11-18
---

# 后端接入探测

## 目标与范围

用真实令牌从 Bun 发普通请求，测通 NovelAI 的生成与 suggest-tags，定首发后端；实测 V5 的氛围迁移、质量词与负面预设由谁添加。

本 Task 只测，不写产品代码，行为合同未变；结论写进 Work 决定表与本记录。令牌由开发者放进仓库根的 `.env`（`NAI_API_BASE_URL`、`NAI_API_KEY`），不进 Git。不模仿浏览器指纹。

要测的事实以提案的[待定项 1](../../../../../docs/proposals/image-generation-v1.md#待定项)为准。开发者 2026-11-13 的笔记另提了几样，开工时一并测：
- 标签顺序的影响有多大：固定种子，只挪一个词；
- 多角色的位置参数；
- 氛围迁移与精确参考的请求形状和参数；
- 余额与这一次生成要花多少；
- 同一个词以两种权重出现（如 `0.5::甲::, {甲}`）与合成一项，固定种子比一比是否等价。

## 当前状态

2026-11-06 经 nbdev 新建。

2026-11-18 开发者给了令牌，先做了不花钱的几次探测（curl，英国出口）：

| 请求 | 结果 |
|---|---|
| `GET image.novelai.net/ai/generate-image/suggest-tags`，带令牌与不带令牌 | 都是 200，返回 `{tags: [{tag, count, confidence}]}` |
| `POST image.novelai.net/ai/generate-image`，空请求体，带令牌 | 401 `Unauthorized`，和不带令牌一样 |
| `GET image.novelai.net/user/subscription`，带令牌 | 401 `Unauthorized` |
| `GET api.novelai.net/user/subscription`、`/user/data`，带令牌 | 401 `User not found.` |

结论：
- suggest-tags 不要令牌，普通请求就能访问。调研里 11-06 的 Cloudflare 403 原因没查清。这只说明 suggest-tags 不用模仿指纹；带令牌的生成请求要不要，等有效令牌出了图才知道。
- 令牌很可能没被接受：三个要鉴权的接口都是 401，带不带令牌结果一样。启动器的源码说，空请求体在鉴权通过后才走参数校验，通过了是 400 一类；它这样说的是第三方站点，官方是否一样，未验证。还没有做任何生成，也没有花费。令牌的格式没看出问题：`pst-` 开头，68 个字符，没有空白与回车。

从 [Aaalice_NAI_Launcher](https://github.com/Aaalice233/Aaalice_NAI_Launcher)（MIT，开发者在用；只读了源码，没运行）读到的几点，都是从源码推断，未验证：
- 官方的 `/user/*` 走 `image.novelai.net`，与生成同一个域名，`Authorization: Bearer <令牌>`。
- V5 的 Opus 免费额度是随时间回充的配额池：订阅响应里有 `usage` 字段，透支以后按正常价扣 Anlas。离线文档写的是“只有 V4.5 及以前免费”，两者不一致，以实测为准。
- 计 token：
  - V4、V4.5 用 T5 分词，源码注释说 `{}`、`::` 被当成未知字符忽略；权重的数字占不占 token，注释没说；
  - V5 用 Qwen 分词，权重写法照算：启动器的测试用例记着，官网计数条上 `4::blending::` 计 5，`blending` 计 2。

## 下一步

等开发者换一个有效的令牌，并告诉我订阅档位。能查到余额以后，先列出每一组实测要发几次请求、预计花多少 Anlas，再开始生成。会花钱的只有这几样：
- 超出 Opus 免费范围的尺寸或步数；
- 氛围迁移每编码一张图 2 Anlas；
- 精确参考每张图加 5 Anlas。
