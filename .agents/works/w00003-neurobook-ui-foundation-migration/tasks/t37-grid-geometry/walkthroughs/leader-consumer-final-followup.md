# 消费者接线的最终反馈

Leader读取当前新稿，数值算法已独立通过10000布局和3000合法手势（归t41 evidence）。两个直接消费者问题需同Task收口：

1. `WorkbenchBranch.onGestureEnd`转发完整target时丢弃了SplitterGestureState.active/compensated；`resizeShellBranch`只要left/right值变化就写偏好。拖动left~editor触界而远端right补偿时，right不应被写成用户偏好。完整目标仍供原语一次结算，但callback/helper需保留主动字段信息，Shell持久化只合入active侧栏。加一条远端补偿不改偏好的回归；Lab全树快照仍注明仅演示，不声称产品原件合成已落地。
2. WorkbenchBranch根div仍h-full/w-full，内部百分比按layout.sizes之和归一。当全部子项到max且sumMax小于父容器时，grid明确返回更小的branch呈现+未吸收诊断，renderer却把它拉满父容器，导致像素max/手势baseline不一致。请让分支实际容器尺寸服从layout.sizes[node.id]，或用有证据的等价方案保持实际留白，别改算法谎称用满。覆盖两叶max100在500容器的布局与renderer配置/尺寸。不要新增业务布局编辑功能。

这两项是已声明“程序呈现不得冒充偏好”和“renderer画同一几何”的接线，不新增产品范围。
