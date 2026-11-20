---
schema: nbook.task/v2
taskId: t43-models-ux
status: planned
updated: 2026-11-20
---

# 服务商、模型角色与模型选择器的体验改进

## 目标与范围

按开发者 2026-11-20 的反馈改进三处：服务商与模型页（在线目录、多列分组带图标的添加、模板化服务商、添加即全部模型、协议检测、代理）、模型角色的推理档、Composer 模型选择器的重新设计。

合同：会改 [`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md)、[`models/service.md`](../../../../../docs/specs/models/service.md)，以及 Composer 选择器所在的对话视图 Spec；改哪些输出在计划里写明。

前情：服务商与模型页、角色页的设计与实现在 [t09](../t09-models/README.md)；选择器分“角色”“模型库”两页的稿在 [t28](../t28-conversation-ui-followups/README.md) 静态稿第 1 轮。

## 开发者的反馈（2026-11-20）

服务商和模型：

1. omp 好像提供不更新依赖就能拿到最新模型目录的办法，我们现在没有。
2. 不够直观：点“添加服务商”后弹出的选择列表可以改成多列、分组，并加上服务商图标。先看已装的依赖里有没有专门提供这些图标的库，没有就看 Magpie 的图标从哪来。
3. 选 OpenRouter 作模板后只有“管理模型”“添加全部”，“管理模型”不能自动发现、也没有重新拉取。所有服务商都应一样：能从 Gemini 模板创建、再手动改成 GPT 的模板也没关系；服务商列表提供的是模板（Magpie 支持给服务商自己改图标）。
4. 添加服务商后自动添加这个服务商提供的全部模型。
5. Magpie 有检测协议的功能，我们也加一个。
6. Magpie 可以克隆到本地研究（已克隆到 `.local/github/magpie`，提交 `9494a38`）。
7. 支持代理，同 Magpie：应用级代理，服务商有自己的代理设置；代理分全局（走主机代理设置）、自定义、直连三种。

模型角色：

8. 模型角色也能设推理档。

模型选择器（Composer 里用的）：

9. UI 有点丑，要重新设计；模型库这里加服务商图标，角色也有自己的专属图标。
10. 角色页里有些模型没提供思考档，界面直接把思考档调节隐藏了，这样不好。
11. 思考档调节不好用，要重新设计。
12. 选择器的阴影太重。
13. 角色选择这里 UI 有点丑，角色卡片太大、浪费空间；以前出过静态稿。

## 调研

- [Magpie 的做法](research/magpie.md)
- [OMP 的在线目录与发现](research/omp-catalog.md)

调研要点（2026-11-20）：

- OpenRouter 不能发现是我们自己挡的：服务端 `discover` 只放行 OpenAI 兼容的自定义服务商，前端“重新拉取”也只给自定义服务商；OMP 有 OpenRouter 的端点发现，不要密钥也能拉。只放开发现还不够：目录服务商的模型解析只认打包目录里的 id，新发现的模型照样调不了。
- OMP 不升级依赖拿新目录：`createModelManager` 合并打包目录、本机缓存 `models.db`、stencil.so 的目录（`catalog.stencil.so/models.json.zstd`，40 家，不含 OpenRouter）与各家 `/models`；不传缓存路径时会写进 `~/.omp/agent/models.db`，接入时要放进状态根。
- 规模：OpenRouter 打包的对话模型 587 个；现在的“管理模型”不按类别过滤，还会列出图片、embedding 等非对话模型（从代码推断）。
- 推理档：角色没有推理档字段；自定义模型的 `efforts` 只进快照、不进解析。选择器在档位少于两个时隐藏调节（`AgentRoleModelPicker.vue` 的 `thinkingLevels.length > 1`）。
- 图标：已装的 `simple-icons` 是 vitepress 的传递依赖，缺智谱、豆包、硅基流动、xAI、Groq 等；Magpie 用 lobehub/icons（npm `@lobehub/icons-static-svg`，MIT，约 2.5 MB），用户可上传、填 URL、抓站点图标、首字母色块。
- Magpie 的模板建出来后协议与地址只读、模板之间不能互改；开发者要的是全部可改，与它不同。
- 代理：OMP 每次请求可传 `fetch`，按服务商带 `proxy` 能接上；Magpie 的“自动”依次读设置、环境变量、操作系统设置。
- t28 第 1 轮的稿里角色卡片有图标、“跟随默认”旁写出默认是哪个角色，实现都没有做。

## 当前状态

2026-11-20 建 Task，调研完成（见上），草稿 worktree `.worktree/w00032-t43-drafts`（分支 `t43/drafts`）已建。

## 下一步

开发者定下面向产品的几个问题后，按 design-review 出静态稿。
