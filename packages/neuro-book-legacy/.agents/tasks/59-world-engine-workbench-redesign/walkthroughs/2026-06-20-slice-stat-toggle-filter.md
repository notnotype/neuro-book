# 2026-06-20 Slice Stat Toggle Filter

## Context

Slice List 的 open / done / clean / draft 统计卡已经成为 status 快捷过滤入口，并且计数已经改为稳定分布语义。继续检查交互闭环时发现：如果当前已经处于某个 status，再点击同一张统计卡仍只是重复设置同一过滤，用户仍需要去找下方清空 status 的入口。

对快捷入口来说，更自然的行为是：第一次点击切到该 status，再次点击恢复全部 status。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 新增 `toggleSliceHealthShortcutFilter(filter)`。
- 状态统计卡点击行为改为：
  - 当前不是该 status：切到该 status。
  - 当前已经是该 status：恢复 `status=all`。
- 四张状态统计卡的 title 增加 `再次点击恢复全部 status`，避免 toggle 行为过于隐蔽。
- 静态契约测试补充 toggle 函数和 title 文案断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：本轮再次尝试恢复 in-app browser，但初始化阶段仍超时，60 秒内没有返回 `browser.documentation()`，因此没有完成真实页面点击验收。

## Detour / Limitation

- 浏览器连接阻塞仍未解除，本轮继续用代码结构、静态契约测试和 typecheck 验证。
- 后续浏览器恢复后，需要补验：
  - 点击 `open slices / issues` 后进入 `status=open`。
  - 再次点击同一张卡后恢复 `status=all`。
  - done / clean / draft 三张卡行为一致。

## Notes

- 本轮仍是 mock-only UI/UX 优化，不接真实 API，不改后端 DTO。
- 这个调整让状态快捷卡形成完整的“进入 / 退出”交互闭环，减少用户寻找清空入口的成本。
