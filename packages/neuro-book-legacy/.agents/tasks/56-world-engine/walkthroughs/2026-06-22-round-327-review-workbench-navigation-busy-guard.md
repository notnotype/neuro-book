# Round 327 - Review Workbench Navigation Busy Guard

## Context

继续从作者真实推演流程检查主 IDE Workbench。Round 326 已让右侧 Inspector 的完整世界状态读取避开 `workbenchActionBusy`。

本轮检查底部审查工作台时发现：value 保存 / 清空类入口已经会在 busy 中返回，但一些“跳转上下文”的入口仍看起来可点：

- `跳到草稿` 会切换到另一个有未应用 value 草稿的 slice。
- Review issue 行、上一个 issue、下一个 issue 会定位 issue，并可能触发父层切换 slice / subject。
- Subject 视图的上一个 / 下一个相关 slice 会切换当前选中 slice。

这些入口在父层多数已有 guard，但按钮视觉和子组件函数层不一致，作者会遇到“看似可点但只提示等待”的体验。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - `focusReviewIssue()` 在 `props.busy` 时直接返回。
  - `navigateSubjectSlice()` 在 `props.busy` 时直接返回。
  - `navigateToOtherDraft()` 在 `props.busy` 时直接返回。
  - `跳到草稿` toolbar / banner 按钮在 busy 时禁用。
  - Review issue 行、上一个 issue、下一个 issue 在 busy 时禁用。
  - Subject 视图上一个 / 下一个相关 slice 在 busy 时禁用。
  - 保留 `清除定位`、本地 triage 状态、review queue 模式切换、底部 tab 切换和折叠/展开可用；这些不直接发真实请求或切换 timeline 数据源。
- `world-engine-ide-entry.test.ts`
  - 补充静态契约断言，锁住底部审查工作台上下文跳转入口的 busy guard。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

本轮仍然不扩后端边界，也没有增加浏览器自动验收；只是继续减少真实作者流程中同步回流与手动跳转的交错点。
