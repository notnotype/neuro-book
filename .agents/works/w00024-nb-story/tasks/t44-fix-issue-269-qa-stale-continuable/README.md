---
schema: nbook.task/v2
taskId: t44-fix-issue-269-qa-stale-continuable
status: done
updated: 2026-10-31
---

# issue 269：第一轮答完后仍显示“不能续问：第一轮还在运行”

## 目标与范围

新对话的第一轮结束后，横幅与输入框不再沿用运行中读到的“第一轮还在运行”。不改服务端的 `qa.get`。

合同：[`story.viewer`](../../../../docs/specs/story/viewer.md) 新增输出 65。来源：[issue 269](https://github.com/notnotype/neuro-book/issues/269)。

## 核对（2026-10-31）

issue 的推测属实，但原因更具体：`web/qa/source.ts` 收到 `ended` 帧时只更新 `run`，`continuable` 还是开头 `qa.get` 在“记录不存在、运行中”时给的“第一轮还在运行”，要等推送流关闭再重读（`qa.get`）回来才换。页面横幅的条件是 `!running`，运行一结束它就露出这句旧原因。

issue 写的“约 3 秒”没有复现，也没有量出来：推送流在 `ended` 帧之后一个微任务就关闭（`server/http.ts`），传输上没有延迟，剩下的只有重读 `qa.get` 本身的耗时（它要对日志做剧透过滤，书大时可能慢）。不管那段多长，旧原因都不该显示，所以修在状态上，没有去优化重读。

## 做法

- `ended` 帧到达时按结果换 `continuable`（`web/qa/source.ts` 的 `continuableAfterEnd`）：原来是“第一轮还在运行”的，保存了换成能续问，没保存换成“第一轮没有保存，不能续问”；其它原因和已有记录的对话（追问结束）不动。
- 两句原因提成 `contract.ts` 的 `QA_FIRST_TURN_RUNNING`、`QA_FIRST_TURN_UNSAVED`，服务端 `qa-service.ts` 与网页数据源共用，免得两边各写一份。

## 验证

- `web/qa/source.test.ts` 新增 3 条：首轮结束并保存后 `continuable` 立刻是能续问（重读还没回）；结束但没保存换成没保存的原因；追问结束不改 `continuable`。前两条在修复前失败。
- nb-story 类型检查（含 web、e2e）通过；`server/qa.test.ts` 与 `web/qa` 共 93 条通过。
- 没有跑真实浏览器和真实模型：e2e 用的是几毫秒就读完的小书，重读太快，复现不出 issue 里的那几秒，加断言也卡不住这个缺陷。

## 当前状态

已完成并合入 master，没有单独的实现审查（改动 14 行加 3 条单测）。

## 没覆盖的

- 重读 `qa.get` 在 100 回书上的耗时没量。如果它确实要几秒，结束后对话里的“答案卡片”等记录派生的部分也会晚到几秒，那是另一个问题。
