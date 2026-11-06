---
schema: nbook.task/v2
taskId: t13-scene-provider-title
status: done
updated: 2026-11-06
---

# 场景提供者的显示名与编辑器分区导航滚动

## 目标与范围

`workbench.theme-scenes` 的声明加可选 `title`，主题编辑器的下拉显示名称；窄屏分区导航切换时带当前项进可视范围。合同：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 18、[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 20、验收 19。计划：[plan.md](plan.md)。

## 决定

- 2026-11-06 开发者：做。设计审查两段的修订都写进了计划：`title` 只收字符串与语言映射（贡献点没有 `complete`，文本引用补不了命名空间）；`Select` 的次要文字是同一行右侧，不是第二行；导航滚动只改导航条自己的 `scrollLeft`，三个入口（分区变了、导航条出现、宽度变了）。

## 完成情况

- 声明与助手：`SceneProviderDeclarationSchema` 的 `title`（字符串或语言映射）、SDK `sceneProvider(plugin, {name, title?})`；示例 `scene-clock` 带双语标题。
- 目录与下拉：`SceneProviders.published` 返回 `{id, title?}`；`providerOptions` 标题作选项名、贡献 id 在右侧，显示名解出来为空时退回 id。
- 导航：`ThemeEditor.vue` 的 `revealCurrentSection`，用 `watch(nav, …, {flush: "post"})` 跟着导航条出现与更换，`ResizeObserver` 随它建与释放。
- 测试：`scene-providers.test.ts`、`provider-options.test.ts`（用真实的 `resolveLocaleMap`）、`themes.test.ts`（声明校验拒绝文本引用）、`08-scene-provider.test.ts`（声明里的标题）；`plugin-code.e2e` 下拉按标题断言；`theme-editor.e2e` 窄屏三个入口各一条“导航项在可视范围里”的判据（不用 Playwright 的 click），去掉对分区变化的监听后会失败。
- 验证：上述单测通过，`plugin-code.e2e`“场景提供者”3 条与 `theme-editor.e2e` 全文件通过，类型检查通过（`permission-page.dom.test.ts` 两条错误是别的会话在 master 上的既有问题）。
- 设计审查：omp（第一段，额度用完中断，4 条，处理见 [证据](evidences/design-review-omp.txt)）加 Opus（第二段，15 条，[报告](evidences/design-review-opus.txt)）；计划按它们修订，t14 补了对比度测量，t15、t16 重写了几处设计。
- 实现审查：Sonnet（前端），1 条重要 5 条建议，5 条已改、1 条接受取舍，[报告](evidences/impl-review-frontend.txt)、[处理](evidences/impl-review-disposition.txt)。
- 提交：`5f362a8ef`、`55af3d05a`、修正 `8d2c82df4`，合入 `85cca5676`、`2d1bd281f`；Spec `77ea2d9f7`。

## 下一步

无。followup：`workbench.themes` 的 `title` 同样没有 `complete`（不写 `ns` 的文本引用补不了命名空间），是既有缺口，没在这里改。
