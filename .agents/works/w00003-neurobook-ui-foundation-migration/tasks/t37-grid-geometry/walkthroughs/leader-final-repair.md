# 同合同最终修复入口

当前并行 writer 均已退出。Leader 已独立读取最新源码；本文件覆盖旧报告的完成判断。
只处理以下五项，保留已修复的非管理轴不限、隐藏叶摘除、sashSizes 接线与 Spike 可见树。

1. `grid-geometry.ts shareAxis` 可满足分配溢出。先读 `leader-allocation-probe.md`。宽100输出130、issues为空是确定缺陷。实现顺序无关的同时上下界分配，不用事后统一缩放绕过约束。覆盖兄弟顺序交换、两轴、有sash、零权重及 resize 补偿。
2. `WorkbenchBranch.vue onGestureEnd` 取 active 中第一个 id；editor/right 拖动取 editor，Shell只保存left/right导致右侧回弹。一次手势提交完整分支目标尺寸，不能逐叶resize重复补偿。
3. 当前 viewport 呈现px与快照意图px并不等价。提供并使用一个原子分支手势入口，明确当前容器基线与目标呈现尺寸，转换回尺寸意图且保持非主动兄弟合理；必须覆盖viewport缩放后拖动与三兄弟邻近补偿。更新主Shell与Spike直接消费者到同一合同，不能仅新增未消费API。
4. `WorkbenchBranch.vue buildPanels` 直接把原min/max再交给Reka，窄容器降级后可能被夹回溢出。Renderer须接受grid给出的实际几何与相应有效交互约束，不创建第二套不一致算法。覆盖不可满足容器的真实消费者输出。
5. `grid-snapshot.ts serializeTree` 的 `String(node.ref)` 对泛型对象无稳定编码，会塌成[object Object]。明确稳定ref编码器，或收紧有根据的public API；更新所有调用方/文档并测试两个不同对象往返。不用类型hack隐去问题。

必要业务实现仅在t37已有范围；可以新增同目录consumer helper与测试，以纯函数收拢手势映射，勿编辑Splitter及其测试。保留descriptors两文件。全部shell必须绝对cwd，执行前核位置。只跑聚焦grid、workbench/layout、spike测试，不跑全包typecheck/build/E2E。无网络、无产品服务、无3001、无目录递归删除、无新代理、无提交。15分钟内留第一批可核查修复，完成后逐项给证据，未完成项直说。
