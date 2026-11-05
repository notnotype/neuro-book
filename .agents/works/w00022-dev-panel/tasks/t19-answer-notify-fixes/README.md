---
schema: nbook.task/v2
taskId: t19-answer-notify-fixes
status: active
updated: 2026-11-02
---

# 评审板能不选、自动通知认带会话名的输入框

## 目标与范围

开发者 2026-11-02 提的两条（[followups](../../followups.md) 同日两行，附核实的原因）：

1. 评审板上有的题不能不选，有些题本该是选答。
2. 很多会话发了评审板不挂等待，开发者答完要自己去通知；面板的自动通知也不发，明明输入框是空的。

分支 `feat/w00022-t19-answer-notify-fixes`，worktree `.worktree/w00022-t19-answer-notify-fixes`。开发者 11-02 定：本 Task 不做审查。

合同：投递判定（`packages/dev-panel/docs/panel.md` 的通知与会话页）不变，只是认得新版 Claude 的屏幕；`artifact publish` 与 `ask` 的 `data` 多一个 `waitCommand`（[命令行合同](../../../../../packages/dev-panel/docs/cli.md)）；答复表单的行为写在 `src/web/parts/AnswerForm.md`。

## 做了什么

| 提交 | 内容 |
|---|---|
| `8169000d2` | 投递判定认得上沿横线里写着会话名的 Claude 输入框。Claude Code 2.1.316 把会话名写进输入框上沿的横线（`──── 会话名 ─`），原来只认纯横线，带会话名的会话全判成 `unknown_screen`，10-13 以后一次也没自动投成。测试样本补了一份只读取样的真实屏幕（会话 id 换成全零），另测框里有字仍不可投、横线前有字或名字后没有横线的不算横线 |
| `b1cf29fbe` | `artifact publish`（有活的题时）与 `ask` 的输出多一行怎样挂等待，`--json` 时在 `data.waitCommand` |
| `2abb7b02f` | 答复表单里清空了的题回到“没答”、不交：多选全取消、文字只剩空白不再让整份答复交不了；待答的单选、确认题选了之后多一个“清除选择” |
| `a652f2d11` | design-review 写明什么题标选答（不答也能往下做的标 `data-nbdev-optional`），发布后就挂等待 |

## 验证

- 修好的判定对 6 格空闲的真实 Claude 会话（只读调用默认 herdr 的 `agent.explain` 与 `agent.read`）都判可投；修之前取样的 3 格都是 `unknown_screen`。
- 类型检查、`build:web`、`governance:check` 通过；dev-panel 全量 464 个用例 463 过，失败的一个是 `tests/leases-cli.test.ts` 的“只靠 HERDR_PANE_ID 认人”到 5 秒超时（与本次改动无关），单独重跑这个文件 14 个全过。

未验证：

- 答复表单的“清除选择”没有在浏览器里看过外观（面板的组件没有挂载测试，判定逻辑在 `host/answers.ts` 的 `isBlankAnswer` 测了）；合入、重启 4400 之后在真实面板上看。
- 自动投递修好之后还没有在真实面板上等到一次自动通知；合入、重启 4400 之后，下次有会话等答复时看审计里 `manual: false` 的投递。

## 当前状态

2026-11-02 合入 `master`（`bd8116055`）。4400 还没重启，面板仍跑旧代码：自动通知与“清除选择”要重启后才生效。

## 下一步

开发者授权后重启 4400（`bun run --cwd packages/dev-panel service:restart`），在真实面板上核对上面两条未验证，再把 Task 改成完成。
