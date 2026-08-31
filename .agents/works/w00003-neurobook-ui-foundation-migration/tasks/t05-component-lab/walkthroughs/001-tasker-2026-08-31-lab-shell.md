---
schema: nbook.walkthrough/v1
taskId: t05-component-lab
sequence: 1
role: tasker
status: in-progress
createdAt: 2026-08-31T00:00:00Z
---

# t05 批次一：Lab 骨架、索引扫描与产物门禁

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

## 已完成

先写文档、后写实现，两份组件文档（`58fa666d`）早于实现（`da436000`）提交，提交历史可证明这个顺序。

- 组件规范收窄「开发工具自身不受本规范约束」一句：开发工具的页面与整体外壳仍不受约束，但其中的零件受约束。分界是「给一份 props 就能在别处渲染出来的是零件」。不改这一句，Lab 自己的零件就没有组件文档，而索引正是扫文档得来的，Lab 展示不了自己。
- 新增 `app/component-lab/`：`CollapsibleSidePanel.vue`、`ViewportCanvas.vue`、`LabShell.vue`、`component-index.ts`、`fixtures/`。
- 新增 `app/pages/lab.vue`。
- `nuxt.config.ts` 加 `pages:extend` 钩子，非开发环境移除 Lab 路由。
- 三个展品入驻：可收起侧栏 4 个场景、尺寸画布 3 个场景、JsonViewer 4 个场景。批次划分里入驻属于批次二，提前做了——没有任何东西能挂载的话，批次一的「画布能挂东西」无法验证。

## 已验证

- `bun run --cwd=packages/neuro-book typecheck`：无输出，退出码 0。
- **产物门禁成立。**跑真实生产构建后在 `.nuxt/product-raw` 全文搜索，`component-lab`、`ViewportCanvas`、`CollapsibleSidePanel`、`LabShell`、`Fixture`、`组件 Lab` 六个词命中文件数均为 0；产物路由表中无 `/lab`。
- **上面这个否定结论是有效的**：同一套路由提取在同一份产物里抓出了 14 条 preview 路由和其余全部路由，说明提取方法能找到东西，「没找到 lab」不是方法失灵。
- 开发服务下 Lab 的六个模块经 Vite 转换均返回 200 且内容非空（`LabShell.vue` 33.7KB、`component-index.ts` 44.9KB）。`component-index.ts` 体积说明文档扫描确实把 `.md` 内容内联进来了。

## 未验证

- **浏览器里的实际渲染、交互与视觉全部未验证。**模块能编译不等于能正确渲染。三栏布局、收起行为、拖拽手柄、键盘调尺寸、场景切换都需要人工走查。
- 桌面与 `390×844` 的实际表现未验证。
- 没有覆盖新零件的自动化测试。

## 发现一：preview 页面确实随产品发布，从推断升级为实证

t05 README 此前记为「从代码读出，未跑构建验证」。本次生产构建的产物路由表中确实存在全部 14 条 preview 路由，包括 `/world-engine.workbench-preview`。这条现在有构建输出作证据。

它同时说明产物门禁不是可有可无的收尾工作：仓库此前从未有过任何按环境排除页面的机制，Lab 若不自带门禁，会立刻成为第 15 个随产品发布的开发页面。

## 发现二：`build` 脚本不是生产构建

`packages/neuro-book` 的 `build` 脚本是 `nuxt prepare && bun run generate && prepare-system-assets && tsc`，不调用 `nuxt build`。按 t05 README 原本写的验证步骤跑 `bun run build`，只会跑一遍类型检查，产物根本不会生成，门禁验证会在什么都没检查的情况下「通过」。

真正的产品构建由 Product Runtime Image Builder 负责。本次改用 `NODE_ENV=production bun x nuxt build` 直接构建到 `.nuxt/product-raw`，验证后删除该目录。后续批次沿用这个命令。

## 发现三：文档把一条责任放在了错误的组件上，已改文档而非记偏差

`ViewportCanvas.md` 初稿写「盒子里换了组件时焦点移到舞台上」。实现时发现这个零件**没有可靠办法察觉 slot 内容被换掉**——它只知道 slot 里有东西，不知道什么时候变的。要做到就得加一个「内容变了」的 prop，等于让调用方告诉它，那还不如由调用方直接处理。

这不是实现没跟上文档，是文档把责任分错了地方，因此改文档，不记「已知偏差」。已改为：换组件时的焦点去向由负责换组件的那一方管。

**这正是先写文档的价值**：责任分错在写实现的第一分钟就暴露了，如果按老办法先写实现再补文档，这条会以「实现就是这样」的形式固化下来，没人会发现它本该属于别人。

## 发现四：Splitter 与可收起侧栏是两套机制，批次一没用 Splitter

原计划三栏用 nb-ui `Splitter` 拖宽。实际拼装时发现冲突：`CollapsibleSidePanel` 收起后宽度变成 40 像素，但 Splitter 面板仍按自己的比例占位，两者各说各话会留下一块空白。要么让 Splitter 的 `collapsible` 接管收起（那本零件就没用了），要么收起时同步改 Splitter 的面板尺寸（两套状态互相同步，容易不一致）。

批次一改用固定宽度的普通布局，不引入 Splitter。开发者给的形态里只要求「可收起」，没要求「可拖宽」，因此这不是缩范围。要加拖宽时需要先决定这两套机制谁管谁，那时再引入。

## 发现五：nb-ui `ToggleGroup` 的类型声明比运行时窄

`update:model-value` 的声明类型是 `string | string[]`，不含 `undefined`；但 t04 已经查明 reka 单选模式下再次点击当前项会发出 `undefined`。类型挡不住这个值，只能在处理函数里挡。`LabShell` 的尺寸预设按此写法防了一道。

这是 nb-ui 的类型准确性问题，不在本 Task 范围，登记于此。

## 发现六：Lab 规范对 `persist:` 没有明确归属

Lab 规范说「不含 `persist:`、不含 `io:` 且不含 `state:shared-write` 的组件可在 Lab 中验证」，又说「含 `io:` 或 `state:shared-write` 的只能在正式界面验证」。带 `persist:` 但不带另两类的组件落在两句之间，没有说该归哪边。

索引扫描按**不可挂载**处理，理由是规范另有一条「fixture 不得依赖浏览器持久化状态」。判断写在 `component-index.ts` 的注释里。这是执行时的选择，不是规范原文，Lab 界面合同补写时应当把这条明确掉。

## 发现七：SPA 下用状态码验证路由存在性是无效的

主应用 `ssr: false`，所有路径都返回同一个 200 外壳。开发服务上 `curl /lab` 得到 200，`curl /definitely-not-a-route` 同样得到 200——这个检查区分不出任何东西。

改用「取 Vite 转换后的模块」验证开发侧，用「搜产物全文与路由表」验证产品侧。后续批次不要用状态码判断 Lab 是否注册。
