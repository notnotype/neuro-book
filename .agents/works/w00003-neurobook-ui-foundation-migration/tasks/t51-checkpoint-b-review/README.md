---
schema: nbook.task/v2
taskId: t51-checkpoint-b-review
---

# 检查点 B：标题栏与主页面独立审查

**状态：待审查。** 对切片 5（t50）做对抗性复核，并按计划检查点 B 收集**逐 capability** 的成熟度证据。结论只按证据。

被审 revision：`a74c7fb8`（切片 5）。前置：t48 `8e9a803d`（主工作台接线）、t47 `8263726e`+`b5babea8`（迁移，已由 t49 两轮复核闭合）。
合同：[t50 Task](../t50-browser-titlebar/README.md)、[实施计划](../../storage-implementation-plan.md) 切片 5 与检查点 B、[source map](../../storage-consumer-source-map.md)。

## 只读约束

- 不改产品代码、不改产品测试、不改 t50 目录；只在 `walkthroughs/` 下新增探针与 `review.md`。
- 不提交、不 push、不联网；**不访问/占用/重启 3001**（开发者正在使用，隔离根 `Temp/nb-3001-8KseHT`）；探针如需要宿主请另用系统 Temp 根与空闲端口。
- 不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`；命令用 worktree 绝对 cwd。

## 问题清单

- **Q1 能力映射**：`app/utils/workbench-chrome.ts` 的映射是否**只**由宿主能力决定（无 UA 探测、无"桥存在即全部可用"）？浏览器侧是否确实隐藏退出应用/窗口控制/桌面缩放？未接入动作是否禁用且给出原因，而不是静默显示为可用？
- **Q2 编辑动作路由**：按真实焦点分派（文本框走原生撤销/重做，Studio 走会话）是否在所有分支成立？是否存在"把 studio undo 冒充所有输入框 undo"或反向的路径？焦点在不可编辑处时的行为是否可理解？
- **Q3 菜单呈现与键盘**：Teleport 到 body 后，面板定位在滚动/缩放/换组（ArrowLeft/Right 换锚点）时是否会留在旧锚点；outside/Escape/方向键/焦点归还是否都能在"焦点不在面板时"工作；祖先裁剪（父容器 overflow/transform）是否真的不再影响。
- **Q4 项目打开两条路径**：本标签打开是否仍走原有未保存领域守卫与 Storage 收口（不得用 Storage 释放替代领域守卫）；新标签链接是否在当前标签不改变 URL 与未保存内容的前提下打开标准 Project URL，且新标签独立执行 open/presence。
- **Q5 几何单一来源**：标题栏高度是否只有一处产品常量（`layout.ts` 的 `SHELL_TITLEBAR_HEIGHT`）驱动 CSS 变量；窄屏叶包装是否真的不再把标题栏拉高；有无第二处硬编码数值。
- **Q6 断言强度**：审计 t50 四个测试文件的断言是否真能失败（等价类、重复谓词、只断言不抛、把实现细节当行为）；指出"缺一例就漏一类缺陷"的空洞。
- **Q7 证据诚实性**：抽查 t50 报告里的真机读数与截图（§4.1 四主题表、§4.2 Storage 失败、§4.3 390 长名）是否与实际文件/复现一致；特别核对它标注的「combo2/combo4 提示条是拦截器残留」这一诚实性备注是否成立。
- **Q8 ADR 与 nb-ui portal**：ADR 0013 的一行 superseding 是否准确（引用 ADR 0021 `:5`）、范围是否只是该一句；t50 关于"nb-ui 无可用 portal 能力"的证据链（导出清单 + 逐项不满足原因 + 替代方案行号）是否成立——如发现存在未使用的可用能力，明确列出。

## 检查点 B 的成熟度证据（不做晋升，只给证据）

按 capability 给出**证据清单与缺口**（不修改任何 Spec/ADR 状态）：
`ui.workbench-shell`（标题栏 + 主工作台几何 + 入口等价）、`storage.persistence`（迁移门禁与消费接线）、`ui.nested-grid`（Lab fixture 与宿主）、
桌面 envelope（bridge 回归限制）。逐条写明：已覆盖的行为、未覆盖的入口、是否仍依赖未接入路径。

## 交付

- `walkthroughs/probes/`：至少 3 个对抗探针（优先 Q1 能力映射、Q3 键盘/定位、Q4 新标签路径），每个说明它试图证伪哪条声明。
- `walkthroughs/review.md`：结论先行（需修复 / 建议合并）、逐问题裁定与证据、被审文件 SHA256、命令与退出码、未验证项、非阻断观察、capability 证据表。
- 若判定需修复，缺陷交回 t50（原 Task 内闭合），修复后在本 Task 追加「追加复核（修复后）」小节再给最终裁定。
