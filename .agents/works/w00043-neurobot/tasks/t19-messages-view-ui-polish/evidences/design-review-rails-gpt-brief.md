# 任务：只读设计审查 w00043 t19：提案“侧栏的侧轨”

仓库 `/home/notnotype/CodeRepository/neuro-book`（主工作区 master，只读；提交 30d126fb8）。审查对象是固定副本：`/tmp/review-t19-rails-gpt/workbench-side-rails.md`（提案）与 `/tmp/review-t19-rails-gpt/rail-states.md`（状态与动作清单）。仓库里同名文件可能在你审查期间被改，以副本为准。

找出它的问题。假定作者过于自信：找没写出来的假设、没处理的边界、隐含的耦合与共享状态、违反现有合同的方式、被破坏的既有约定、异常输入下的失败。不要复述、不要给总体评价；找不到问题时明确写“仔细检查后没有发现”。

## 依据

- Spec：`docs/specs/ui/workbench-layout.md`（输出 1、4–13、18–22、24–28、38–49 与“状态与转换”）、`docs/specs/workbench/views.md`（视图声明的 `movable`、`floatable`，输出 19 接管标题区与自绘头）、`docs/specs/agent/conversation.md` 输出 44、51。
- ADR：`docs/adr/0044-workbench-single-layout-tree.md`、`docs/adr/0046-workbench-view-containers.md`；提案 `docs/proposals/workbench-view-containers.md` 第 3 节（入口条作条节点的六处冲突）。
- 代码：`packages/nb-workbench-layout/src/`（`layout-project.ts`、`layout-doc.ts`、`layout-doc-validate.ts`、`intent-writeback.ts` 等）；`packages/neuro-book/src/plugins/workbench/web/`（`state/default-tree.ts`、`state/layout-constraints.ts`、`state/layout-doc-store.ts`、`shell/adjacency.ts`、`components/WorkbenchSurface.vue`、`WorkbenchShell.vue`、`WorkbenchToolStrip.vue`、`WorkbenchRegionStrip.vue`、`entry-drop.ts`、`layout-drag.ts`）；`packages/neuro-book/src/plugins/workbench/shared/contracts.ts`（`ViewHead`、`VIEW_OWN_HEAD`）；`packages/nb-agent-ui/src/vue/messages/AgentMessages.vue` 与同名 `.md`。
- 前期调研（作者一方的，可质疑）：`.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/evidences/foundation-research.txt`。
- 开发者已确认的决定：提案的“决策记录”一节，逐条写了日期与原话出处（w00043 t19 评审板第 1 到 5 轮与会话）。

## 重点

1. **几何与意图回写**：右轨作为投影里 body 横向分支的呈现专属叶（不进文档），展开只改它的厚度、由编辑组吸收。核对 `projectLayoutDoc`、尺寸求解、`rebaseIntents`/意图回写、手势落账、收起阈值、拖到零、隐藏、放不下（输出 10）、最大化在这种放法下是否真的成立，有没有漏掉的路径（例如 nb-layout 的分隔线挨着这片叶时能不能拖、命中区、过渡）。
2. **展开宽度能拖**：轨的内侧边在展开时是一条可拖的分隔线，宽度记在锚上的可选字段。这与“条两侧缝宽为 0、厚度不进意图”的现有规则怎么共存；拖动手势的预览、落账、撤销与布局过渡怎么走。
3. **持久化与回滚**：锚与浮动窗记录上的可选字段 `railExpanded?`、`railWidth?`。核对校验、深拷贝、形状比较、模板、旧版本读写与回滚，以及浮动窗“矩形按收着的宽记、展开多出的只在呈现时加”对夹取、拖动、缩放的影响。
4. **`ViewRail` 与 `Teleport`**：视图段由视图画、送进工作台给的位置；实例换代、加载中、渲染出错、交付撤回、区域隐藏时的寿命；Teleport 换目标丢滚动与焦点；F6 与读屏（侧轨整条一站、按从左到右）与现有输出 18 的冲突。
5. **位置限制**：只停左右侧栏、容器不接收别的视图、浮动只能单独一个标签。核对接受矩阵（输出 24–28）、“移动到”菜单、`nbook.view.open` 等命令、默认布局、插件声明的容器把别的视图放进来、旧布局记录里已经违反限制时的读法。
6. **性能承诺**：“位置与宽度变化走网格的布局过渡、视图段一次 transform 过渡、没有逐帧脚本”是否成立；网格在厚度变化时有没有过渡（`NestedGrid.md`）。

## 审查维度

1. 与已定设计一致：提案与开发者的决定逐条覆盖，没有悄悄改变已定项。
2. 依赖的机制真的存在：方案依赖现有机制的顺序、时序或寿命保证时，读该机制的 Spec 或实现确认，不按名字推断。
3. 接口与合同：类型与语义一致；失败有通道；照字面实现会不会返工。
4. 遗漏：失败路径、资源释放、兼容与迁移。
5. 对照需求与参照：对照开发者原话与现有同类交互（活动栏、右栏入口条、自绘头），列出参照有、方案没有的项。
6. 验收映射：每条判据能否用真实运行时写出测试。
7. 别扭与反常之处：多出来的状态与特殊情况、绕路的流程；给出改法。
8. 上游选择：方案在迁就的更底层选择（ADR 0044 的一棵树、活动栏是条节点、nb-layout 的网格）的理由现在还成不成立。

## 规则

- 只读：不修改仓库文件，不 commit、push、stash、切换分支，不删除文件。实验文件只放在 `/tmp/review-t19-rails-gpt/` 下。
- 可以跑单元测试与类型检查；不跑 e2e 与开发服务。
- 不开子审查（子代理），自己按顺序读。
- 每核实一条就追加写入报告，不要等到最后：每条发现用一次 `cat >> /tmp/review-t19-rails-gpt/report.txt <<'EOF' … EOF`，不用 write 工具，每条 1500 字内。报告路径写绝对路径，不要用相对路径。
- 有数字就给数字，问题是真的就直说。用中文。

## 报告格式

按影响排序：正确性与不变量在前，结构问题其次。每条：严重程度（阻断 / 重要 / 建议）、类别、位置（文件:行或提案小节）、现象、为什么是问题、如何核实、建议改法。撤回或收窄的条目在原标题后追加“（撤回）”或“（收窄）”。最后写“未发现问题的方面”与各级数量，最后一行列出有效发现的编号。
