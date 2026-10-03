# Round 392 - Preview Delete App Dialog

## Context

主 IDE Workbench 的删除 slice、关闭草稿、打开工作区文件等高风险确认已经迁到应用内 `useDialog()`，并完成主要取消分支浏览器验收。但独立 `/world-engine.preview` 的删除 slice 仍使用原生 `window.confirm`。

这会造成两个问题：

- 真实体验不一致：主 Workbench 是应用内 Dialog，Preview 仍弹浏览器原生确认。
- 自动化验收不稳定：此前 in-app browser 对原生 confirm 取消分支一直难以稳定 dismiss。

本轮只对齐独立 Preview 的删除确认，不重构 Preview 页面。

## Scope

- 独立 `/world-engine.preview` 删除 slice 改用 `useDialog().confirm()`。
- 删除取消分支不发 DELETE 请求，不改变 Project SQLite。
- 不改主 Workbench 删除逻辑。

## Implementation

- `app/pages/world-engine.preview.vue`
  - 引入 `useDialog`。
  - 增加 `const {confirm: confirmDialog} = useDialog();`。
  - `deleteSlice()` 中用 `confirmDialog(..., "删除 World Engine Slice")` 替换原生 `window.confirm(...)`。
- `app/utils/world-engine-ide-entry.test.ts`
  - 固定 Preview 引入 `useDialog`。
  - 固定 Preview 删除使用 `confirmDialog`。
  - 断言不再包含 `window.confirm(` 删除 slice。

## Verification

### Static Tests

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts
```

结果：1 个测试文件，3 条测试通过。

### Browser Acceptance

Project：`workspace/ming-ding-zhi-shi-2`

浏览器步骤：

1. 打开 `http://localhost:3001/world-engine.preview?project=workspace%2Fming-ding-zhi-shi-2`。
2. 点击 timeline 第一条 slice 的 `删除`。
3. 确认出现应用内 `删除 World Engine Slice` Dialog，而不是原生 JS dialog。
4. 点击 `取消`。
5. 确认 Dialog 消失，slice 数量仍为 `9 slices`，没有 `已删除 slice` 提示。

实际结果：

- 删除确认显示为应用内 Dialog：`删除 World Engine Slice / 确定要删除 slice「创建 命定之诗世界」吗？此操作不可恢复。`
- `tab.getJsDialog()` 返回空，确认没有原生 JS dialog。
- 点击 `取消` 后 Dialog 消失，页面仍显示 `World State / 7 subjects · 9 slices`。
- 没有出现删除成功提示，没有保存、删除或写 Project SQLite。
- 临时 `bunx nuxt dev --port 3001` 已关闭，确认 `port 3001 free`。

## Actual vs Plan

- 计划：把独立 Preview 删除确认迁到应用内 Dialog，并验取消分支。
- 实际：实现和验收都完成；取消不会删除 slice。
- 与计划出入：首次打开 Preview 时遇到 Nuxt 首次热编译导致导航超时，等待编译完成后重试正常，不影响功能结论。

## Follow-up

- 主 Workbench 和独立 Preview 的删除确认体验已对齐。后续如果继续统一 Preview 的其它确认，应先确认是否仍是作者常用路径，不要为了“全清单”继续追低频边角。
