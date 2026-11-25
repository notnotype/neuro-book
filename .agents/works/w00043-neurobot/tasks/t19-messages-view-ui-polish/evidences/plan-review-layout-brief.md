# 任务：只读设计审查 w00043 t19 实施计划（布局记录、投影、预算、位置限制、网格手势与过渡部分）

仓库 `/home/notnotype/CodeRepository/neuro-book`（主工作区 master，提交 2f8e6f696，只读）。Work worktree `/home/notnotype/CodeRepository/neuro-book/.worktree/w00043-neurobot`（分支 `feat/w00043-neurobot`，与 master 同一提交，可以在这里跑单测与类型检查）。

审查对象（固定副本）：`/tmp/review-t19-plan/plan.md`（实施计划第 1 稿）。依据：已接受的提案 `/tmp/review-t19-plan/workbench-side-rails.md`（你在提案阶段审过两轮，报告在 `/tmp/review-t19-rails-gpt/report.txt` 与 `/tmp/review-t19-rails-gpt/r2/report.txt`）、状态清单 `/tmp/review-t19-plan/rail-states.md`；Spec（planned，已提交）：`docs/specs/ui/workbench-layout.md` 输出 50、51 与验收 35–37，`docs/specs/workbench/views.md` 输出 21、22。开发者已定的见提案“决策记录”。

**只审计划里这几节**：`packages/nb-workbench-layout/src/`、`packages/neuro-book/src/plugins/workbench/web/state/`、`packages/nb-layout/src/`，以及切片 1、2、4、6 与它们的验收映射。外壳组件、消息视图、焦点与测试分工由另一位审查者负责，不用审。

找出它的问题。假定作者过于自信：照计划字面实现会不会返工、漏掉哪条提交出口或重建路径、切片的提交边界会不会让某片单独提交时破坏不变量、单测能否用真实对象写出来、计划说的文件与函数是否真的存在并能承担它说的职责（读代码核对，不按名字推断）。提案阶段已解决的问题不要重报，除非计划又写出了新的冲突。

## 规则

- 只读：不修改仓库与 worktree 的文件，不 commit、push、stash、切换分支。实验文件只放 `/tmp/review-t19-plan/`。可以跑单测与内联断言，不跑 e2e 与开发服务。不开子代理。
- 报告写到 `/tmp/review-t19-plan/report-layout.txt`（绝对路径）：每条发现一次 `cat >> … <<'EOF' … EOF` 追加，每条 1500 字内，不用 write 工具。
- 每条：严重程度（阻断 / 重要 / 建议）、类别、位置（计划小节或文件:行）、现象、为什么是问题、如何核实、建议改法。最后写各级数量与有效编号。用中文。
