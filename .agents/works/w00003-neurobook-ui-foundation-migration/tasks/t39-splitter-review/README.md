---
schema: nbook.task/v2
taskId: t39-splitter-review
role: reviewer
---

# Splitter 手势公共接口独立审查

**本轮最新入口：** t38 writer已退出，已修第二轮F1/F2/F3，现为32聚焦用例。只对照最新源码核这些修复及其新增核心问题，结果写walkthroughs/review-final.md，固定hash。F4旧报告不一致已由Leader证伪，不再当阻断。不要重做完整设计审查；不跑全包测试/typecheck/build/E2E（Leader统一）；全部bash使用本worktree绝对cwd。若需要探针归本Task，不建.tmp、不递归删除。

恢复时先核 [t38最终门禁](../t38-splitter-gestures/walkthroughs/leader-final-gates.md)，涵盖实际sash尺寸、类型边界与390px真实宽度。所有命令必须用当前worktree绝对cwd；不创建仓库.tmp或递归删除目录，只能归档自己确切创建的单文件。

Work：[w00003](../../README.md)；实现：[t38](../t38-splitter-gestures/README.md)；
合同：[ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)。

审查当前未提交Splitter改动，HEAD `70c7168d`。首轮D1–D6已由t38补修，当前还在补窄屏实际宽度与sashSizes；追加报告写walkthroughs/review-followup.md，保留首轮历史。
**第二轮已完成**：[review-followup.md](walkthroughs/review-followup.md)（结论 `需要修复`：F1 禁用/零尺寸 sash 的 Enter、F2 等值重渲染误取消手势、F3 Enter 用例判别力、F4 t38 报告与工作区不一致）；[review.md](walkthroughs/review.md) 是第一轮 D1–D6 的历史记录，只读不改。
t38还在跑浏览器验收，代码主体已落盘；
先完成独立代码/聚焦测试审查，结束前核对是否又有变更，报告明确所审文件版本与未完成证据。
并行t37正在修grid，与本Task无关，不跑全包测试/typecheck/build；只跑splitter相关测试。

## 范围与核对

- Splitter.vue、splitter-gesture.ts、两个聚焦测试、barrel导出、Splitter.md/fixture/e2e/配置与相关UI规范。
- 读取真实Reka源码核对事件顺序；不要用作者报告代替事实。
- 程序布局与用户意图是否分开，尤其手势期间发生viewport/约束变化；键盘第一次调整能否被baseline捕获。
- 鼠标、键盘repeat/keyup/blur、Escape/pointercancel/touchcancel/卸载、改变面板/方向/禁用。
- 多实例/嵌套不串手势，panel/sash稳定身份是否仅实例内唯一；取消后Reka后续事件不能再提交。
- active/compensated是否足够说明实际主动改变字段；空操作与触界不能误存未改值；程序布局不冒充提交。
- 测试是否走真实Reka与DOM事件，清理是否销毁wrapper/监听；浏览器用例是否断言有效真实几何。
- 新增sashSizes：0/非1px的真实占用与Reka相邻面板定位、取消/disabled/Tab行为；手势中变更sash几何是否被当用户提交。
- Enter repeat以及Arrow→Enter/Enter→Arrow多键序列不能重新落入Reka不发layout的旧路径；组件公开ref不绕过类型边界。

## 边界与报告

只读审查，不编辑被审源码/Spec或其它Task。可写本Task报告；不再派代理，不联网，不提交。
用户3001后台服务禁止占用、复用、重启或关闭。若确需浏览器验收，先核对t38自己的3138宿主占用，使用其它独立端口且不复用不明服务。
产品数据无关；任何运行根使用系统Temp，不接默认State Root。统一Vitest临时根已由主Agent机械接线。
按严重度报告可复现缺陷、影响和最小修复方向；区分缺陷与未验证/风格建议。结论按reviewer合同四种值。
15分钟内写 `walkthroughs/review.md`，包含实际命令/结果与未运行项，不sleep、空返回或复述计划。
