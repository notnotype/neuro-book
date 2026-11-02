---
schema: nbook.task/v2
taskId: t05-public-api-alignment
status: planned
updated: 2026-11-02
---

# nb-ui 公开 API 一次对齐（附迁移表与对外版本）

## 目标与范围

浮层、尺寸、语调、文案、列表数据的公开 API 各只有一套写法，仓库内调用方一次迁完，插件作者有迁移表

行为合同未变：产品行为不改，改的是 nb-ui 的公开 API 与 `packages/nb-ui/docs/` 的规范；对外是一次不兼容版本，迁移说明随本 Task 写。计划见 [plan.md](plan.md)，接过 [t01 总计划](../t01-plan/plan.md) 的“t04：公开 API 对齐”一节。

## 当前状态

2026-11-02 开发者同意按当前 master 重新核对 t01 计划的 t04 条目、写成本 Task 的计划；核对结果与计划已写进 [plan.md](plan.md)，开发者同日确认计划末尾三项（都取推荐）。同日计划审查：Sonnet 17 条、omp 8 条，全部成立，计划已据此修订（不抽外壳组件、保留取消与关闭按钮两个原因、不设强制的列表公共接口、`ContextMenu`/`Menubar` 传送目标与最上层判定不改、L07 第 2 点不做），处理见 [`evidences/design-review.txt`](evidences/design-review.txt)。worktree `.worktree/w00030-t05-api-alignment`（分支 `refactor/w00030-t05-api-alignment`）。

- S0 `a095ccea9`：八个 vue tsconfig 打开 `checkUnknownProps`、`checkUnknownEvents`。只开这两项时报约 3400 处，几乎都是合法透传；开发者同日选择保留检查并清掉报错。最后的做法：透传 HTML 属性的组件在 `defineProps` 里用 `/* @vue-ignore */` 声明落点元素的属性类型；`aria-attributes.ts` 对所有组件放行 ARIA 与 `role`；传给 reka、tiptap 的原生事件与 `id`、`title` 写进 `v-bind` 对象。试过但放弃的：`fallthroughAttributes`（Lab 场景表的类型推导失效）、全局放行全部 HTML 属性（与组件自己的同名事件冲突，并污染 Lab 的属性推导）。检查顺带查出三处无效写法并删掉；`NeuroBookMark` 加了 `decorative`。验证：九个模板检查入口零报错，故意写错的属性与事件会报；`test:affected --since master --typecheck --with-consumers` 只剩下面第一条；nb-ui e2e 59 条通过，失败的 6 条在 master 上同样失败。
- 动态绑定清单（类型检查管不到，每片改名时逐处核对）：Lab 的 nb-ui 场景 `subject.bindings`（登记表的键受类型检查）；`MenuNodes.vue` 的 `common(item)`；`Tabs.vue` 的 `item.attrs`；`CollapsibleCard.vue`、`CollapsibleRow.vue` 传给 `Spinner` 的对象；`DropdownMenu.vue` 的 `contentProps`（S1 处理）；nb-form `NodeField.vue` 的 `controlProps`（传给 nb-form 自己的控件）。
- master 上原有的失败（不是本 Task 引起的）：nb-story `src/server/qa-service.ts(548)` 的 TS2352；nb-ui `e2e/popup-lists.spec.ts` 5 条行高断言仍按 28px（t04 已把菜单行改为 30px），`e2e/suggestion-menu.spec.ts` 1 条 `toBeInViewport`。

发版时必做（本 Task 不改版本号）：内置主题 `hostVersion` 与 `NB_UI_VERSION` 改 0.4；依赖 nb-ui 的已发布包一起升版本发布；应用与 SDK 升 0.13.0。详见计划第 7 节。

## 下一步

S1：共享词表与文案属性（计划第 2、3 节）。
