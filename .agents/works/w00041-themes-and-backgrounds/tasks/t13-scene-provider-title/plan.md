# t13 计划：场景提供者的显示名与编辑器分区导航滚动

## Context

t12 做主题编辑器的“场景提供者”下拉时，声明 `workbench.theme-scenes` 没有任何字段，下拉只能显示贡献 id（例如 `example.scene-clock.sky-painter`），作者以外的人认不出它画什么（t12 设计审查第 11 条，当时接受取舍，[处理](../t12-theme-editor-assets/evidences/design-review-disposition.txt)）。开发者 2026-11-06 要求做掉。同一条里一并收尾：窄屏分区导航（横向滚动的一排按钮）切到靠右的分区时不滚动到当前项（t12 实现审查前端第 17 条，六个分区时就有，第七个“图标”更明显）。

依据：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 18、[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 20。公开接口规则：贡献点“只追加字段”（skins.md 的边界），所以加可选 `title` 不破坏已有提供者。

## 关键设计

### `packages/neuro-book/src/plugins/workbench/shared/themes.ts`、`shared/theme-points.ts`

- `SceneProviderDeclarationSchema` 加可选 `title`，只收**字符串或语言映射**（`Type.Union([Type.String(), LocaleMapSchema])`），**不收文本引用**（`TextRef`）：`workbench.theme-scenes` 贡献点没有 `complete`，宿主不会给不写 `ns` 的文本引用补命名空间（`themesPoint` 同样没有，是既有缺口，另记 followup，不在本 Task 改），收了就会在运行时拿到不带命名空间的引用（设计审查第二段第 4 条）。`additionalProperties: false` 保留，原来的 `{}` 声明仍然合法。
- 提供者没写 `title` 时，下拉与以前一样显示贡献 id，不自造名字。

### `packages/neuro-book/src/sdk/workbench-helpers.ts`

- `sceneProvider(plugin, {name, title?})`：`title` 进 `contribution.declaration`。类型是 `string | Readonly<Record<string, string>>`（与上面的 schema 一致，不引 `Text`）。
- 示例 `plugin-sdk/examples/plugins/scene-clock/web/plugin.ts` 补一个双语标题，作教学材料（注释写它出现在主题编辑器的下拉里）。

### `packages/neuro-book/src/plugins/workbench/web/scene-providers.ts`、`themes.ts`

- `SceneProviders.published` 现在返回排序的 id 数组。（读者已全仓核对，只有 `web/themes.ts` 的 `sceneProviders`、`theme-editor-model.ts`、`ThemeEditorScene.vue`、`provider-options.ts` 与 `scene-providers.test.ts`。）改为返回 `ReadonlyArray<{id: string; title?: string | Readonly<Record<string, string>>}>`（按 id 排序，仍只含 `handle.published === true` 的），`ThemeCatalog.sceneProviders` 同形。唯一的消费者是编辑器模型（`theme-editor-model.ts` 的 `sceneProviders`）与 `ThemeEditorScene.vue`，一并改。
- 句柄的声明在发布时就在句柄上（`handle.declaration`），不另存一份。

### `packages/neuro-book/src/plugins/workbench/web/components/theme-editor/provider-options.ts`、`ThemeEditorScene.vue`

- `providerOptions(published, current, labels, resolve)`：已发布项 `label = title ? resolve(title) : id`，有标题时 `description = id`。nb-ui `Select` 的 `description` 是**同一行右侧**的次要文字、放不下先截掉（`Select.md`），不是第二行；贡献 id 较长时在窄处会被截，作者靠标题区分，id 看选项的完整可访问名。重名标题（两个插件都叫“天空”）时不另想办法，作者可以在插件管理里看到 id；“未发布”项不变（只有 id，因为没有句柄就没有标题）。`resolve` 由组件传 `useText().t`，纯函数不依赖 Vue。
- `unpublished` 提示行不变。

### `packages/neuro-book/src/plugins/workbench/web/components/theme-editor/ThemeEditor.vue`

- 分区导航：只改导航条自己的 `scrollLeft`（按当前项的 `offsetLeft` 与宽度算，让当前项落进可视范围），**不调 `scrollIntoView`**（它会牵动所有可滚动的祖先，在浮动窗口或编辑区里会连带滚动外层）。触发三处：`model.section` 变化；组件挂载时（`section` 存在组件外的编辑状态里，切走再切回或在页签与浮动窗口间换着开会重新挂载，此时 `watch` 不触发）；导航条宽度变化时（`ResizeObserver`，窗口变窄竖排换成横排，`section` 不变）。桌面竖排时 `scrollLeft` 不可滚，无影响。不新增状态。（设计审查第二段第 6 条）

## Spec 与文档改动

- `theme/skins.md`：输出 18 加一句“提供者的声明可以写 `title`（字符串或语言映射，不收文本引用），主题编辑器的下拉用它显示”；声明类型示例若有则补字段。
- `theme/editor.md`：输出 20 把“显示贡献 id”改为“有 `title` 的显示标题（右侧次要文字是贡献 id，放不下时截断），没有就显示贡献 id”；验收 19 加一条“有标题的提供者显示标题”。
- `plugin-sdk/examples/README.md` 的 scene-clock 一行补“带显示名”；组件文档 `ThemeEditorScene.md` 同步下拉的写法。

## 切片

1. 声明、SDK 助手、示例、目录与下拉选项（共享、web、SDK、Spec 同一提交）。验证：`bun test src/plugins/workbench/scene-providers.test.ts src/plugins/workbench/provider-options.test.ts src/sdk/sdk.test.ts plugin-sdk/examples/scenarios/08-scene-provider.test.ts`（注意 `provider-options.test.ts` 在 `workbench/` 下，写错路径 bun 不报错只是少跑；看输出的用例数），类型检查。示例场景要断言标题：工作台测试替身（`plugin-sdk/examples/testing/workbench.ts`）只给提供者的实现、不给声明，这个文件在允许改动内，加一个读声明的入口，或用 `definitionAt` 读插件定义里的贡献声明，实现时选更小的。
2. 分区导航滚动。验证：`theme-editor.e2e` 的 390px 用例。

## 验收映射

- `theme.editor` 输出 20、验收 19：`provider-options.test.ts`（有标题、无标题、未发布、语言映射按当前语言）；`plugin-code.e2e.ts` 的下拉用例改为断言显示 scene-clock 的标题并带 id 第二行。
- `theme.skins` 输出 18（声明字段）：`scene-providers.test.ts`（`sceneProviders` 带标题、撤回后消失）；`sdk.test.ts`（助手把 `title` 写进声明）；示例场景 `08-scene-provider.test.ts`（标题可见）。
- 导航滚动（editor.md 的响应式条目）：`theme-editor.e2e.ts`：桌面宽度点“图标”，再把视口改成 390px（竖排变横排），**不点击**，断言当前项的矩形在导航条的矩形内（Playwright 的 `click()` 自己会把目标滚进视口，用点击验证修不修都通过）；再加一条：切到别的编辑区页签再切回来（组件重新挂载），同样断言。
- 标题不收文本引用：`scene-providers.test.ts` 用真实内核注册，写文本引用的提供者被贡献点校验拒绝。

## 验证

上面两个切片的命令，加 `bun run --cwd packages/neuro-book typecheck`；e2e 只跑 `theme-editor.e2e` 与 `plugin-code.e2e` 里受影响的用例（先 `bun run build`、`bun run build:e2e`）。

## 不做与风险

- 不加 `description`、`icon` 等别的声明字段，只加 `title`。
- 不为已发布提供者的标题做响应式刷新：标题随句柄一起发布，句柄重新发布（热更新）时目录里的 `shallowRef` 本来就会换新。
- 风险：`published` 的返回类型变了，凡是把它当 id 数组的调用方都要改；全仓搜索 `sceneProviders`、`.published` 确认只有编辑器与测试。
