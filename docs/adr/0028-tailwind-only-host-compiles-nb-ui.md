---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-20
superseded-by: null
---

# ADR 0028：全仓只用 Tailwind v4 一套原子 CSS 引擎，宿主编译 nb-ui 源码

- 日期：2026-10-20
- 决策者：开发者
- 关联工作：[w00030 t02](../../.agents/works/w00030-nb-ui-library-structure/tasks/t02-tailwind-unify/README.md)
- 相关文档：[`packages/nb-ui/src/tailwind.css`](../../packages/nb-ui/src/tailwind.css) 的头注释（宿主写法）、[`packages/nb-ui/README.md`](../../packages/nb-ui/README.md#宿主里的样式)、[`docs/standards/code/frontend.md`](../standards/code/frontend.md)
- 部分取代：[ADR 0023](0023-v2-frontend-backend-stack.md) 决策 2 中的 UnoCSS；0023 的其余决定不变

## 背景

ADR 0023 让新应用沿用旧应用的 UnoCSS。nb-ui 自己用 Tailwind v4，向宿主发一份预编译、不分层的 `dist/nb-ui.css`，好让 UnoCSS 宿主也能直接导入。于是同一页面上有两套原子 CSS 引擎，各自生成同名类：

- 同名类的值不同时，谁赢取决于导入顺序。组件的字号随宿主变（UnoCSS 的 `text-sm` 是 14px，nb-ui 的 token 是 13px）；两边都生成 `rotate-180` 时角度叠加，应用为此维护一份从产物现读的封禁名单。
- nb-story、dev-panel 也用 Tailwind，为了不输给不分层的产物，放弃了 Tailwind 的标准分层写法。
- 产物要入库、改了组件要记得重新生成，过期时 UnoCSS 会补出大部分类，截图看不出来。

选 UnoCSS 的理由是“旧应用在用”，新应用从零重建，这条理由已不成立；改 UnoCSS 的配置也消除不了两套引擎并存本身。

## 决策

1. 全仓的宿主（neuro-book、nb-story、dev-panel、nb-ui 的 playground）只用 Tailwind v4。旧应用 `packages/neuro-book-legacy` 不改，开发者接受它失去 nb-ui 的样式。llmlint 的检测页是另一个应用、不用 nb-ui，不在此列。
2. nb-ui 不发预编译 CSS，只提供样式入口 `@notnotype/nb-ui/tailwind.css`，由宿主的 Tailwind 按入口里的 `@source` 编译 nb-ui 源码。
3. 层序按 Tailwind 标准 `theme, base, components, utilities`：nb-ui 与 Tailwind 主题键同名的 token 用 `@theme static`，其余 token 进 base 层，语义类进 components 层。调用方的原子类因此总能压过组件的语义类。必须压过原子类的状态样式（焦点光晕）用层内 `!important`。
4. 宿主不分层的全局规则里，特异性低于一个类的（reset、通配归零、`html`、`body`、`*`）放进 base 层，否则它们压过所有原子类。宿主自己的语义类可以不分层。

## 备选方案

- **nb-ui 产物里的原子类加前缀（`nb:`）**：避开同名，但两套引擎仍在同一页面，宿主仍要为产物安排导入顺序，nb-ui 也要改全部模板。开发者先选了它，随后改为本决定。
- **整个产物包进 `@layer nb-ui`**：只解决谁赢，不解决重复生成与产物维护。

## 后果

- 宿主的 `text-xs`、`text-sm` 改为 nb-ui token 的 12px、13px，开发者接受。Tailwind v3 与 v4 刻度改名的类（应用里只有 `outline-none`）随迁移改名。
- 组件模板里与语义类设同一属性的原子类，分层前是死代码，分层后会生效；新写组件时不要在模板上重复语义类已经给出的属性。
- 宿主必须有 Tailwind v4 的构建；不用 Tailwind 的宿主不能直接导入 nb-ui 的样式。
