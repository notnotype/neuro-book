# 消费者复核裁定（2026-09-16）

独立报告：[t41 首轮复核](../../t41-grid-consumer-review/walkthroughs/review.md)。这是同一合同内的返工，无需新产品决定。

## 当前必须闭合

追加已实测的原语阻断：[可满足约束仍溢出](leader-allocation-probe.md)，100px容器输出130px且无诊断。收口前必须一并修复。

1. F1：Shell 对非管理轴写了上限 0，按原语合法传播后整树高度/宽度坍缩。改正确宿主约束，不放松原语合同。
2. F2：隐藏叶先以 0 传入，又被 min 夹起；渲染才过滤导致比例失真。让建树与布局都表达可见集合，恢复时保留宿主意图。包含隐藏 titlebar、activity、left、right 的组合。
3. F3：Branch 从 active 集选首个叶，右侧 sash 会选 editor，Shell 没保存 right。当前已改了手势消费，必须保证既有左右拖动行为不回退。可让 Branch 发出完整原子手势，再由 Shell 选择其管理字段；禁止逐叶循环 resize 造成重复补偿。
4. 真实 sashSizes 必须用于 renderer。当前报告说 renderer MUST 消费，但组件仍未消费；不可满足约束时也不能让 Reka 原始 min/max 把已降级几何重新撑开。t38拥有Splitter公共实现；若必须扩展其接口，先在报告说明所需合同，由Leader协调，不并发改其文件。
5. 核对布局呈现与意图不相等时 deltaPx 的单位。用户拖动显示像素不能直接当比例不同的意图像素。多兄弟时Reka相邻补偿与grid按比例补偿的差别需要真实消费者回归；不要只用纯grid用例掩盖。

Splitter接口协调已落地：t38正在新增可选prop `sashSizes?: readonly number[]`（按面板间边界顺序的实际像素，缺省1px，零值无占用且不可交互）。本Task可按此消费，仍不编辑Splitter文件。与隐藏集合保持一致映射，去除不再需要的Shell藏sash CSS authority。

## 已裁定的审查意见

- F4 的 include 缺失已由Leader修复，正确worktree绝对cwd独立跑过2文件21用例（见 leader-test-entry.md）。所有命令必须显式用worktree绝对cwd；OMP相对cwd可能落到主工作区。
- F5 外来确认不抢当前手势是后续Storage宿主接线的门禁，不能现在声称已覆盖。保留后续记录。
- F6 sash事实重复可随F2合并为唯一产品计算入口。
- ref当前泛型允许对象而String(ref)会丢身份：应明确稳定ref编码/解析合同，或限制快照API只接受稳定字符串ref，不以类型断言掩盖。

## 验证与边界

以实际组件或可挂载适配层验证左右拖动、显隐与窄容器几何；保留纯函数对照。若新增测试文件，由当前已配置的workbench目录测试入口运行。
不运行全包typecheck/build，不启动产品服务，不访问3001，不改两个descriptors用户文件。t38仍并行实现，不能编辑Splitter及其测试。
先复现再修复，完成后改写implementation报告反映最终状态。最终统一typecheck与浏览器验证由Leader执行。
