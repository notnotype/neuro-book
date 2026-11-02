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
- S1 `b1646e61e`：共享词表 `shared-types.ts`，尺寸、语调、弹出位置与文案属性各收成一套写法，调用方一起迁移（模板检查报出 58 处）。与计划的出入写回了 plan.md 第 2、3 节：`DialogSize` 不动；`SegmentedControl` 的 `tone` 从未渲染、整个删掉；`NotificationTone` 原来有两份、收成一份；工作台通知服务仍用 `error`，在边界映射；读屏覆盖属性只补 `Breadcrumb`。迁移说明 `migration-0.4.md` 从这一片开始写。验证：九个模板检查入口零报错；`test:affected` 只剩 nb-story 原有那条；nb-ui e2e 与 S0 相同（59 过，6 条原有失败）。
- S2 `715daa108`：`DropdownMenu`、`Menubar` 的项 `value` 改 `id`，`Menubar` 项 `type: "default"` 改 `"item"`，`Select` 的 `indicatorClass` 改 `tone`。开发者同日定 `iconClass` 与菜单 `shortcut` 不改名（理由见 plan.md 第 4 节）。调用方迁移交给 Haiku 子代理（32 个文件），主会话审 diff、自己跑验证。同一片修掉 master 上原有的 6 条弹出列表 e2e 失败：5 条断言按 t04 的 30px、14px 改；`suggestion-menu` 那条是分组标题行高带小数、最后一项差 0.19px 滚不进视口，行高向下取整。验证：九个模板检查入口零报错；`test:affected` 只剩 nb-story 原有那条；nb-ui 单测 652 条、e2e 65 条全部通过。
- S3a `51ceb179a`：浮层的打开态、关闭请求与关闭原因。`Dialog` 改 `open`、关不关只看 `closeOnRequest`、`confirm` 不关闭、删 `cancel` 事件；`ContextMenu` 改 `open` 与 `request-close`；`QuickPick` 的 `close` 改 `request-close`；`Dialog`、`Drawer`、`ContextMenu` 补 `closed`。迁移时只有 `AddProviderDialog` 同时绑了打开态更新与 `request-close`，加 `close-on-request="false"`；`ModeNotice` 改听 `request-close`。新增 `overlay-close.test.ts`。验证：九个模板检查入口零报错；nb-ui 单测 666 条、e2e 65 条通过；`test:affected` 只剩 nb-story 原有那条。这一片改了所有对话框的关闭行为，提交后当场派 Sonnet 审（后台，不阻塞）。
- S3b `30540854d`：浮动窗口拆成公开组件 `FloatingWindow`，`Dialog` 只做模态；内部外框 `DialogSurface` 与 `dialog-frame.ts`；`useOverlayLayer` 统一两条层级带、嵌套层数与局部浮层层级；模态遮罩共用 `.nb-ui-overlay` 的淡入淡出（`AlertDialog`、`Drawer` 原来引用的动画类名在产物里不存在，实际没有动画）。与计划的出入写回了 plan.md 第 5 节：`Dialog.teleportTarget` 保留 `false`；遮罩只共用入退场、不统一底色与模糊。同一提交处理了 S3a 的审查（Sonnet，7 条：重要 2、建议 5，全部成立，处理见 [`evidences/s3a-review.txt`](evidences/s3a-review.txt)）。验证：九个模板检查入口零报错；nb-ui 单测、e2e 65 条通过；应用整套 e2e 298 条通过、1 条失败（`plugins.e2e.ts` 的“安装 → 重启……”，在分支起点 `f9fcb4a4f` 上同样失败，原有问题）；`test:affected` 只剩 nb-story 原有那条。
- 待开发者定：插件 SDK 里会有两个同名的 `NotificationTone`，工作台服务的（`error`）与 nb-ui 组件的（`danger`），取值不同。工作台服务是否也改 `danger` 属于应用合同（`docs/specs/workbench/notifications.md`），不在本 Task 范围。
- 动态绑定清单（类型检查管不到，每片改名时逐处核对）：Lab 的 nb-ui 场景 `subject.bindings`（登记表的键受类型检查）；`MenuNodes.vue` 的 `common(item)`；`Tabs.vue` 的 `item.attrs`；`CollapsibleCard.vue`、`CollapsibleRow.vue` 传给 `Spinner` 的对象；`DropdownMenu.vue` 的 `contentProps`（S1 处理）；nb-form `NodeField.vue` 的 `controlProps`（传给 nb-form 自己的控件）。
- master 上原有的失败（不是本 Task 引起的）：nb-story `src/server/qa-service.ts(548)` 的 TS2352；应用 `e2e/plugins.e2e.ts` 的“安装 → 重启后配置项出现……”（设置窗口里多出“其它”分区）；nb-ui `e2e/popup-lists.spec.ts` 5 条行高断言仍按 28px（t04 已把菜单行改为 30px），`e2e/suggestion-menu.spec.ts` 1 条 `toBeInViewport`（这两类 S2 已修）。

发版时必做（本 Task 不改版本号）：内置主题 `hostVersion` 与 `NB_UI_VERSION` 改 0.4；依赖 nb-ui 的已发布包一起升版本发布；应用与 SDK 升 0.13.0。详见计划第 7 节。

## 下一步

S4：`SuggestionMenu` 的传送目标缺省、`./grid` 并入 `./layout`、SDK 与迁移说明收尾（计划第 6、7 节）。
