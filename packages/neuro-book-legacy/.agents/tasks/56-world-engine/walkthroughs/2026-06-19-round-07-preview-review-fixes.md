# Round 07 - Preview Review Fixes

## Scope

本轮是对 `/world-engine.preview` 的代码审查式修复。Round 06 已经能通过前端真实 API 操作 World Engine，但从用户试用路径看还有两个明显问题：

1. 默认 subject 创建时间和默认 slice 写入时间相同，用户很容易先创建 `world`，再直接写 slice，然后撞上“同一 instant 只能一个 slice”。
2. Preview 页面没有暴露 `editSlice`，而第一版重要决策之一就是同 instant 已有切面时应修改已有 slice。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `suggestSliceTime(examples)`，从 calendar example 推导普通 slice 的后续时间。
  - 默认支持 `HH:MM:SS` 末尾后一秒；无法推导时回退到第二个 example 或第一个 example。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `suggestSliceTime()` 的默认后一秒、不可解析格式和秒数 59 fallback。
- 更新 `app/pages/world-engine.preview.vue`：
  - 默认 `sliceForm.time` 使用 `suggestSliceTime()`，避开 subject init 的 instant。
  - 创建 subject 成功后，如果 slice 时间仍等于 subject init 时间，会自动挪到后续时间。
  - Timeline slice 列表新增“载入编辑”按钮。
  - Write Slice 表单支持编辑模式：
    - 载入已有 slice 的 time / title / summary / kind / mutations。
    - 保存时调用 `/api/projects/world-engine/slices/:sliceId/edit`。
    - 提供取消编辑。
  - API 回读的 slice mutations 在页面内作为展示 / 回填边界使用 `unknown`，提交前仍由 `parseMutationJson()` 严格校验为 World Engine mutation。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts server/api/projects/world-engine/[...segments].test.ts server/world-engine/world-engine.facade.test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 所有断言通过，但 Vitest worker fork 意外退出，命令最终 exit 1。判断为并发测试运行层面问题。
- 拆分复跑：
  - `bunx vitest run app/utils/world-engine-preview.test.ts`
    - 通过：1 个测试文件，4 个用例。
  - `bunx vitest run server/api/projects/world-engine/[...segments].test.ts server/world-engine/world-engine.facade.test.ts`
    - 通过：2 个测试文件，7 个用例。
  - `bunx vitest run server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
    - 通过：2 个测试文件，6 个用例。
- `bun run typecheck`
  - 第一次发现 Vue template 对递归 `JsonValue` 类型展开过深；已把 API 回读 mutations 改为页面边界 `unknown`，并把 slice 编辑事件改成只传 `slice.id`。
  - 复跑通过。

## Browser Testing

仍未自动执行浏览器验证。项目指令要求不要自动浏览器验证；当前 `/world-engine.preview` 已更适合浏览器验证，下一步在用户确认后运行：

1. 启动 dev server。
2. 打开 `/world-engine.preview`。
3. 新建 Project。
4. 创建 subject。
5. 直接写默认 slice，确认不再撞同 instant。
6. 载入 timeline 中的 slice，编辑并保存。
7. 查询 state。

## Code Review Notes

- 这轮修复降低了第一版最容易踩到的同 instant 冲突。
- Preview 的 edit 行为是整块替换，符合当前 `editSlice` 决策。
- 仍未做正式结构化 mutation editor；JSON textarea 只作为 preview 验证入口。

## Walkthrough Delta

本轮是审查 -> 修复轮。绕道点：并发 Vitest worker 意外退出，已拆分同一测试集合复跑确认功能测试全部通过。
