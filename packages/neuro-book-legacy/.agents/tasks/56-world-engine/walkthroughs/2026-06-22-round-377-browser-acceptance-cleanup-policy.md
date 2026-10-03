# Round 377 - Browser Acceptance Cleanup Policy

## 背景

Round 376 已把真实浏览器验收细化成可执行 runbook，但该 runbook 会在 `ming-ding-zhi-shi-2 / 命定之诗2` 的 Project SQLite 中写入 `[验收]` slice。继续推进前，需要把“跑完后这些验收 slice 怎么处理”说清楚，避免真实 Project 被测试数据长期污染，或误删本应保留的验收证据。

本轮只更新文档，不执行浏览器验收，不删除任何数据。

## 策略

默认策略：验收完成后先保留 `[验收]` slice，直到验收结果写入 walkthrough。

原因：

- 浏览器验收需要可回查证据，尤其是 proposal、metadata/value 编辑、state query 和删除前后行为。
- 立刻清理会让后续分析缺少真实上下文。
- 删除操作本身也是验收项，应该只删除专门的 `[验收-可删除]` slice，不应删除三条主线验收 slice。

验收记录写完后，再由用户决定：

- 保留 `[验收]` slice：作为 World Engine 作者流演示记录。
- 删除 `[验收]` slice：恢复 `命定之诗2` timeline，避免测试数据污染小说世界。

## 清理对象

若用户决定清理，目标 slice 标题前缀为：

- `[验收] 薇洛丝观察召唤大厅余波`
- `[验收] 眼镜女生试探搭话`
- `[验收] 薇洛丝意识到自己未被重点监视（已编辑）`

专门删除测试 slice：

- `[验收-可删除] 删除动作测试`

这条应在浏览器验收过程中通过 UI 删除；如果验收后仍存在，说明删除步骤未完成或失败，应先记录为验收发现，再决定是否补删。

## 推荐清理方式

优先使用 Workbench UI 删除，而不是直接改 SQLite：

1. 打开 `ming-ding-zhi-shi-2` 的 World Engine Workbench。
2. 在 timeline 搜索 `[验收]`。
3. 逐条选中目标 slice。
4. 使用 Workbench 删除入口。
5. 确认删除返回 issues 是否为空或可解释。
6. 刷新 timeline，确认目标 slice 不再显示。

理由：

- UI 删除路径本身会经过真实 API 和 Review Queue 处理。
- 可以确认删除后 timeline / Inspector / issues 没有状态错挂。
- 不绕过产品路径。

## 不推荐方式

- 不直接编辑 `.nbook/project.sqlite`。
- 不用临时脚本批量删除真实 Project 数据，除非用户明确要求。
- 不删除非 `[验收]` 前缀 slice。
- 不把复制出的主体文件建议写入 `simulation/subjects` 六文件，除非另开显式落地任务。

## 验证

本轮只更新文档，没有运行测试，没有执行浏览器验收，没有修改真实 Project 数据。

## 与计划出入

- 原本下一步已接近浏览器验收；本轮补了真实数据污染边界，确保验收前后都有明确处理策略。
