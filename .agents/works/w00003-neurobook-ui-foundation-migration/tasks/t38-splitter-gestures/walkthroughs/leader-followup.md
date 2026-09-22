# Splitter 首轮裁定与返工

首轮omp exit0但报告仍写进行中，不能算完成。t39已独立实测并判定需要修复。
用户已授权落实Spec，D1–D6是现有合同缺陷：直接修复，不通过新增“已知偏差”或删除collapsible公共能力回避，不需开发者再次批准。

## 当前恢复

最新：可续跑会话已有源码变更，聚焦2文件27用例与nb-ui typecheck真实通过；因模型服务额度不足退出，未做浏览器验收或更新报告。
继续当前产物；先重读本文件的浏览器取证链接，再检查D1–D6是否全部覆盖、修复未闭合项。implementation仍是首稿，不可信。
不要重读所有规范/依赖源码；本会话已加载。最终源码应符合类型合同，不以`as unknown as`构造组件公共句柄。

后一次sol会话因20分钟到时退出（exit1/aborted），仅重复阅读，没有修改Splitter或落下修复。
这次先完成D1–D6代码与聚焦测试，报告明确阶段结果，再运行浏览器；不要用全部时间继续调研。
已有源码与可复现探针足以开工；只读取需要修改的段落及未加载的约束，不对node_modules全目录无界grep。
所有bash的cwd用当前worktree的绝对路径；不可用主仓 packages/neuro-book 或相对cwd误跑主工作区测试。
本轮会话保存在系统Temp，可续跑；20分钟内至少提交到文件系统一个已验证增量，不需要git提交。

## 修复目标

- D1/D3：pointercancel/touchcancel/window blur/卸载需要同时收口上游拖动状态与本组件手势；取消不再提交，后续无按键移动不改布局，下一次鼠标/键盘调整可用。
  使用Reka公开能力或其实际输入事件的适配边界，不复制第二套几何算法、不越过类型系统修改私有状态。若确认必须依赖补丁才能解决，在报告提出具体边界，主Agent再按真实证据裁定。
- D2：约束/外部程序布局变化不能并入用户提交。可取消失去基线的手势，保证取消发生在程序重排被记录之前；窗口resize同样核对。
- D4：Enter折叠/恢复继续可用且与layout/gesture一致。安装版Reka Panel公开collapse/expand/getSize，可研究用公开能力统一这条用户操作；不要让旧eager layout影响下一次调整。
- D5：DOM id/aria-controls加实例命名空间；gesture仍使用宿主语义id，支持主grid/插件grid同名叶。
- D6：wrapper全部unmount，确保Reka模块状态清洁；探针转成有意义的正式断言。
- active需区分“相邻候选”与“实际主动改变”，不能让触界未变化的字段冒充用户意图；文档明确sizes是百分比，宿主应使用主动字段合成，不能整份直接覆盖Storage。

## 主Agent真实浏览器首轮

cwd packages/nb-ui；PowerShell环境 `NB_UI_E2E_PORT=3138`, `NB_UI_E2E_REUSE_SERVER=0`；
`bun run test:e2e e2e/splitter.spec.ts`，55.9s，exit1，1通过/3失败。

1. 指针拖动/几何/提交次数的断言已通过；最后解析事件面板title为JSON失败，因为它是截短展示文案。用明确完整载荷或可观察几何断言，不解析截短字符串。
2. 键盘测试按Tab后实际焦点到了第二条sash，提交正确是editor~inspector，但断言仍期待outline~editor。应核对真实焦点，不能写错预期。
3. 390×844未触发手势，state仍none。需核对可见区域、滚动、命中遮挡和组件几何；不能删窄屏用例或仅增加等待。
失败上下文在nb-ui/test-results（运行生成态）；最终证据应放系统Temp验收路径，避免在源码存业务临时数据。

Leader已实测定位窄屏根因，见 [浏览器取证](leader-browser-diagnostic.md)：手柄原先在视口外，同时responsive画布被内容撑到895px。
阶段性修复单测后，按这份取证修真实窄屏验证；最小lab.css改动已纳入t38范围。

## 执行与收口

3001不碰；3138曾由上一omp遗留Nuxt进程，主Agent核对PID/命令后已关闭旧进程并重新实跑，最后playwright正常结束。
本轮仍拒绝reuseExistingServer。启动/关闭只管理自己明确创建的进程，命令不管道到tail掩盖退出码。
工具已增加edit，单点用edit/write，批量先dry-run；不再用sed无预览批改。
先完成聚焦单测再浏览器。只跑Splitter聚焦验证，t37仍改grid，统一类型检查与全包门禁由主Agent做。
最终更新implementation报告，真实记录实际文件、命令、退出码、用例数与未验证项，不以空final/exit0充当产物。
