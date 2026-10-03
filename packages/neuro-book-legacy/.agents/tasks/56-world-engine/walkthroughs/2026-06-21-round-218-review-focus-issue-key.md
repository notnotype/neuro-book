# Round 218 - Review Focus Issue Key

## 背景

继续检查作者从 Review Queue 点击 issue 后的具体审查链路。上一轮已保证 issue 能定位到已加载 slice，并在目标未加载时给出提示；本轮发现另一个更细的串线风险：`highlightedMutationFocus` 只保存 `subjectId + attr`，底部审查工作台再用这两个字段查当前 slice 的 issue。

如果同一 slice / subject / attr 下同时存在多条 issue，用户点击第二条时，底部 `Review Focus` 仍可能显示第一条同属性 issue 的 code/message/status。

## 本轮调整

- `WorldWorkbenchPreviewMutationFocus` 新增可选 `issueKey`。
- `focusReviewIssue()` 在设置高亮焦点时写入 `issueKey: item.key`。
- `currentReviewQueueIndex` 优先按 `issueKey` 找精确队列项；找不到时再回退到旧的 `subjectId + attr`。
- `WorldEngineWorkbenchPreviewMutationEditor` 的 `reviewFocusContext` 同样优先按 `issueKey` 找当前 issue，避免显示错 code/message/status。
- 静态契约测试补充 `issueKey` 类型、焦点写入和按 key 查找逻辑。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 3 个测试通过。
- `bun run typecheck`
  - 通过。

本轮未自动执行浏览器验证。

## 后续

- 如果后续引入持久化 issue resolution，`issueKey` 的稳定性需要从前端会话态进一步升级为后端/持久合同；当前仍只是 UI 精确焦点，不改变后端 DTO。
