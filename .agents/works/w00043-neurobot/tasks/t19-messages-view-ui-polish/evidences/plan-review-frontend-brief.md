# 任务：只读设计审查 w00043 t19 实施计划（前端：外壳组件、侧轨组件、视图段接口、消息视图、焦点与过渡、测试分工）

仓库 `/home/notnotype/CodeRepository/neuro-book`（主工作区 master，提交 2f8e6f696，只读）。

审查对象（固定副本）：`/tmp/review-t19-plan/plan.md`（实施计划第 1 稿）。依据：已接受的提案 `/tmp/review-t19-plan/workbench-side-rails.md`、状态清单 `/tmp/review-t19-plan/rail-states.md`；Spec（planned，已提交）：`docs/specs/ui/workbench-layout.md` 输出 50、51，`docs/specs/workbench/views.md` 输出 21、22，`docs/specs/agent/conversation.md` 输出 57。开发者已定的见提案“决策记录”。UI 规范：`.agents/skills/ui-development/SKILL.md`、`packages/nb-ui/docs/ui-development-spec.md`、`packages/nb-ui/docs/design-language.md`。前一轮 UI 审查报告：`/tmp/review-t19-rails-ui/report.txt`。

**只审计划里这几节**：`packages/neuro-book/src/plugins/workbench/web/shell/` 与 `components/`、`shared/contracts.ts` 与 `web/views/`、`packages/nb-agent-ui/src/vue/messages/`、`packages/neuro-book/src/plugins/agent/web/`，切片 3、5、7、8，“测试分工”（含元素标记约定）与对应的验收映射。布局记录、投影、预算与网格由另一位审查者负责。

找出它的问题：照计划字面实现会不会返工；计划说的组件与文件能否承担它说的职责（读代码核对，例如 `WorkbenchToolStrip.vue` 能否扩展成右轨、`MessagesHost.vue` 去掉标题接管会牵动什么、`AgentMessagesList` 能否原样放进展开的视图段）；元素标记约定是否够 e2e 用、有没有和现有标记冲突或漏掉的；测试分工的分段是否可行（用例先于实现时，子代理凭约定能写到什么程度）；组件 `.md`、Lab 场景、英文 390 宽场景是否计入；动效与真实页面验证是否落到可执行的步骤。

## 规则

- 只读：不修改仓库文件，不 commit、push、stash、切换分支。可以跑 dom 测试与类型检查，不跑 e2e 与开发服务。
- 报告写到 `/tmp/review-t19-plan/report-frontend.txt`（绝对路径）：每条发现一次 `cat >>` 追加，每条 1500 字内；写不成就放进最终回复。
- 每条：严重程度（阻断 / 重要 / 建议）、类别、位置、现象、为什么是问题、建议改法。最后写各级数量。用中文。
