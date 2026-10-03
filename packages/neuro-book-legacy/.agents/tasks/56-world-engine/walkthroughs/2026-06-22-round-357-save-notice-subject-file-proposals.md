# Round 357 - Save Notice Subject File Proposals

## 背景

上一轮已经把主体文件建议的内容质量收口到可用状态：direct / world-context 来源清晰，JSONL 候选可复制，事件值 fallback 和 title 去重也已处理。继续抠事件句子边界的收益开始下降，当前更重要的问题是作者真实写完 slice 后，能不能自然发现“下一步要去处理 `simulation/subjects` 六文件建议”。

## 本轮目标

- 不新增自动写文件能力。
- 不扩展后端 / Agent 工具。
- 在保存 slice 后，如果当前切片确实能生成主体文件建议，就把成功提示导向右侧 Inspector。

## 实现

- `WorldEngineWorkbenchDialog.vue`
  - 在 Slice Composer 写入 / 编辑成功后，先显示原有保存结果。
  - 刷新真实 timeline 后，使用现有 `buildWorldWorkbenchSubjectFileProposals()` 对保存后的 slice 计算 proposal 数量。
  - 如果 proposal 数量大于 0，成功提示追加：`可在右侧 Inspector 查看 N 个主体文件建议。`
  - 该逻辑只读取已加载的 `subjectSystemSummaries`、`subjectNameMap`、focused subject 和保存后的 slice，不写 `simulation/subjects`。

- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，防止后续保存回流再次丢失主体文件建议提示。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收；按当前项目约束，浏览器验收需要用户明确允许后再执行。

## 与计划出入

- 原计划下一步是从作者流角度检查 P0 bridge 是否可发现。本轮确实只补了“保存后发现入口”这一小块，没有继续扩大到 badge、自动打开 Inspector 或自动写主体文件。
- 没有触碰 P1 explicit commit，也没有把 `world.engine` profile 接入 subject memory tools。
