---
schema: nbook.task/v2
taskId: t19-answer-notify-fixes
status: done
updated: 2026-11-10
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
| `9f0061a00`（合入 `bd10898b4`） | 开发者 11-10：会话用 Monitor 挂等待老是 30 分钟就超时。`answers --wait` 缺省从 30 分钟改成 6 小时；发布与 `ask` 输出的等待提示、design-review 写明 Claude Code 用 Bash 的 `run_in_background`、不用 Monitor（Monitor 最长 30 分钟）。`tests/artifacts-cli.test.ts` 19 个与 `tsc` 通过 |

## 验证

- 修好的判定对 6 格空闲的真实 Claude 会话（只读调用默认 herdr 的 `agent.explain` 与 `agent.read`）都判可投；修之前取样的 3 格都是 `unknown_screen`。
- 类型检查、`build:web`、`governance:check` 通过；dev-panel 全量 464 个用例 463 过，失败的一个是 `tests/leases-cli.test.ts` 的“只靠 HERDR_PANE_ID 认人”到 5 秒超时（与本次改动无关），单独重跑这个文件 14 个全过。

“清除选择”2026-11-05 在隔离的面板上看过：选了之后出现，点了回到没答、提交数减一；真实面板上这会儿没有待答的单选题。

未验证：

- 自动投递：2026-11-10 查审计，11-05 重启 4400 之后到 11-06 共 12 次 `manual: false` 的投递，全部 `delivered`（w00041、w00032 的会话），已在真实面板上成立。

## 当前状态

2026-11-02 合入 `master`（`bd8116055`），2026-11-05 重启 4400 后生效；真实的自动通知已等到（见上面“未验证”一节的核对），已完成。

## 下一步

无。
