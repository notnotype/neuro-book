---
schema: nbook.task/v2
taskId: t06-skin-extensions
status: done
updated: 2026-11-06
---

# 皮肤的新能力：图标集、画框、按状态换场景、代码提供的场景

## 目标与范围

theme.skins 不承诺的四项扩展，各自先定声明形状与外观，再实现

合同：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md)；本 Task 要给它加新的声明字段，先出外观再改 Spec。

## 开发者的决定

1. （2026-11-06）四项新能力先做画框，其余三项（图标集、按状态换场景、由代码提供的场景）看过画框再排。

2. （2026-11-06，`r1-frame`）画框用双线框：里面一圈面色细缝，外面一道强调色细线，只用皮肤自己的配色，不需要素材。
3. （2026-11-06，`r1-scope`）加在菜单、气泡、对话框与设置窗口上，小提示不加。

## 当前状态

画框已合入 master（决定 1 到 3）。其余三项在 2026-11-06 由开发者要求“用 autonomous-delivery 做完”，计划见 [plan.md](plan.md)，设计审查（omp，一轮，去重后 9 个问题）的处理见 [evidences/design-review-disposition.txt](evidences/design-review-disposition.txt)，待开发者追认的决定见 Work 的 [pending-confirmations.md](../../pending-confirmations.md)。

代码在 `.worktree/w00041-t06-skin-extensions`（分支 `feat/w00041-t06-skin-extensions`），四个提交：图标集、按状态换场景、由代码提供的场景与用户层降级、scene-clock 示例与 SDK 助手。Spec：`theme.skins` 输出 16 到 18、验收 16 到 18；`theme.editor` 边界与兼容、验收 12。

- **图标集**（输出 16）：`Look.icons`，图标名到插件内 `.svg`；写成一张不进 `@layer` 的样式表压过 nb-ui 预生成的 `--svg`，整张包在 `@media not ((prefers-contrast: more) or (forced-colors: active))` 里。书房带 10 个手写的原创图标（files、search、settings、message-square、messages-square、palette、feather、book-open-text、pencil-line、file-text），真实截图看过亮色。
- **按状态换场景**（输出 17）：`Look.workingScene`；工作中 = 公开状态 `nbook.agent/active`；换图不触发整页渐变。书房没有工作态场景（要第二张图，等 t05）；用 `theme-dusk` 示例验证（工作态图是现有图调暗调灰的派生图，约 2 KB）。
- **由代码提供的场景**（输出 18）：新贡献点 `workbench.theme-scenes`（浏览器入口、有实现）与主题的 `sceneProvider`；`ThemeCatalog` 里的 `SceneProviders` 管请求、检查（`image/*`、4 MB、`Image.decode()`）、响应式结果表、`expiresAt` 重画、主题代次、撤回与 `dispose`；SDK `/workbench` 导出 `sceneProvider` 助手；示例插件 `scene-clock`（画布画随钟点变的天空）与场景 8。
- **书房作为示例**：留在内置，不搬到 SDK；`plugin-sdk/examples/README.md` 加“主题的三份参考”（`theme-dusk`、书房、`scene-clock`），`theme-study/plugin.ts` 开头注明；见待确认清单。
- **用户层**：“我的主题”不持有 `icons`、`workingScene`（用户素材管线只有场景图）；复制插件主题与导入主题包时丢弃这两项，读到带它们的记录时那一条不进列表；`sceneProvider` 保留。这是设计审查第 1 条改出来的。

验证（受影响的）：
- `bun test` workbench、sdk、plugin-sdk、ui 共 531 个，`test:vitest` workbench 74 个，`typecheck`、`governance:check`、`docs:check` 无失败。
- e2e：`themes.e2e`（含新增的图标集与 SVG 外部资源探针，探针带对照）、`theme-editor.e2e`、`plugin-code.e2e`（外置场景提供者：blob 地址、1600×900、换明暗换图）、`agent-conversation.e2e`（会话运行时换成工作态场景、结束后换回）共 55 个，一次整批里“书房 light 可读性”超时，单独重跑通过（已知的整批负载问题，与本 Task 无关）。
- **未验证**：真实浏览器里损坏图片的解码失败回退（目录单测用注入的解码函数覆盖，`Image.decode()` 对坏图 reject 是浏览器的标准行为）；真实 Agent 模型运行（e2e 用本机脚本端点的会话进入运行态，没有调真模型）。

实现审查（Claude Sonnet，前端，一轮）：14 条（阻断 0、重要 4、建议 10），处理见 [evidences/impl-review-disposition.txt](evidences/impl-review-disposition.txt)：10 条已改（含 expiresAt 死循环、没发布的诊断、用户层缓存失效、导入丢弃的测试、刷新失败重试、e2e 补失败与刷新），4 条接受取舍或不成立。修正后受影响的单测、`typecheck`、`governance:check`、`docs:check` 无失败，`plugin-code.e2e` 的两个场景提供者用例通过。已合入 master（`b7500beab`）。

## 下一步

书房第二张场景与素材定稿见 [t05](../t05-study-art-final/README.md)（要开发者定画面内容与张数上限）。编辑器里给图标集、工作态场景、提供者补编辑项另开 Task。
