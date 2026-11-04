# nb-ui 项目规则

本包位于 `packages/nb-ui`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留 nb-ui 的项目专属规则，不复制根共享正文。

本包是 NeuroBook 的独立 Vue/Nuxt 组件库。任何修改都必须保持公共组件、主题包和 playground 三个表面一致。

## 开工前

- 修改组件、样式、主题、配色、token、playground 或导出前，必须读取 [`docs/ui-development-spec.md`](docs/ui-development-spec.md)。
- 修改视觉规则时再读取 [`docs/design-language.md`](docs/design-language.md)；修改主题格式或主题包时再读取 [`docs/authoring-themes.md`](docs/authoring-themes.md)。
- 修改公开符号前查完全仓调用方。迁移必须更新全部调用方、测试、README 与 Component Lab 的登记。

## 实施

- 规范与代码同步演进：开发、审查、微调或重构组件时，随时主动更新 [`docs/ui-development-spec.md`](docs/ui-development-spec.md) 与相关 UI 规范，使规范文档始终作为活文档与代码实现严格对齐。
- 公共交互优先由 Reka UI 原语承担；原生元素已经提供完整语义和键盘行为时保留原生实现。
- 组件只消费已登记的语义 token 与 `src/styles.css` 公共基座。新增变量先判断归属，禁止为单个消费点增加公共 token。
- playground 调试代码留在 `playground/`，不从包入口导出；组件场景登记在新应用的 Component Lab（[`ui/component-lab`](../../docs/specs/ui/component-lab.md)），登记文件在 `packages/neuro-book/src/plugins/lab/web/fixtures/nb-ui/`；Lab 经公开入口 `@notnotype/nb-ui/lab-sources` 读取组件文档与实现，组件名在 Lab 的全部来源中唯一。
- nb-ui 不发预编译的 CSS 产物：宿主的 Tailwind v4 编译本包源码，入口是 `src/tailwind.css`（导出为 `@notnotype/nb-ui/tailwind.css`），宿主接入写法见 [`README.md`](README.md#宿主里的样式)。组件改了类名、图标、token 或 `src/styles.css` 不需要再生成产物。

## 完成门禁

验证范围与工具按仓库 [验证门禁](../../docs/testing/README.md#验证门禁) 执行；本包只补条件：

- 组件行为变化运行受影响的 Vitest 合同；公开类型、props/emits 或导出变化运行 `bun run typecheck`。
- 组件类名、图标、token 或 `src/styles.css` 变化不需要生成产物；样式层序与写法的改动，先读 `src/tailwind.css` 的头注释和 [`docs/design-language.md`](docs/design-language.md) 的分层相关条目。
- 只有改动覆盖的行为有 e2e 专属边界时才运行 `bun run test:e2e`；不因修改位于本包而默认跑全套。
- 组件组合或公开用法变化时，在 Component Lab 检查相应场景。
- UI 行为/观感变化按 [UI 验收分档](../../docs/testing/README.md#ui-验收分档) 取证；共享基础组件按四种主题/配色组合及 390px 视口验收。真实 playground 的浏览器工具按测试规范的 [浏览器工具](../../docs/testing/README.md#浏览器工具) 选择。
