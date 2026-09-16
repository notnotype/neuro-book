# Splitter最终消费者门禁

## 未闭合

1. 必须读 [390px实测](leader-browser-diagnostic.md)：4条E2E通过只证明外层无溢出，被测Splitter仍851px。修复responsive画布min-content和fixture长文案，断言被测target真实宽度受容器约束。允许最小编辑 playground/app/assets/css/lab.css，保持固定phone/tablet画布可滚动。
2. 消费者grid已返回每分支逐条实际sash像素；Splitter仍固定1px会破坏小容器守恒，Shell只能靠CSS藏sash。新增可选公开prop sashSizes?: readonly number[]，按面板间边界顺序表达实际像素；未提供时保持1px。零值边界无布局占用、不可交互/不可Tab聚焦；保证Reka其它边界仍找到正确相邻面板。非法非有限/负值采取有诊断的明确策略，不能产生坏CSS；数组语义写同名文档。
   由本Task独占Splitter实现和公开导出；t37只消费这个prop，不编辑你的文件。主轴布局必须算真实宽度，禁止依赖新CSS掩盖不一致。
3. 组件ref目前用 handle as unknown as SplitterPanelHandle，违反类型边界要求。使用Reka导出的公开类型、Vue组件公开实例类型或窄化检查；不双重断言绕过类型系统。
4. Enter在keyboard手势已开始时直接return，重复Enter可能漏preventDefault而进入Reka有缺陷的旧路径。用真实组件验证键盘repeat/多键序列的layout与提交一致；需要时按现有合同修复。

## 验证

聚焦组件测试、真实浏览器拖动/取消/键盘、桌面与390px四主题组合。所有命令用worktree绝对cwd，纯nb-ui playground用你控制的3138或其它空闲端口，绝不访问3001。
不要运行全包typecheck/build；Leader会统一运行。CSS若变化如实报告，由Leader生成并核两次确定性。
禁止创建仓库.tmp或递归删除目录；只清理自己的确切单文件/结束自己本次服务。
写出最终报告后退出，不能把一部分通过写成Task完成。
