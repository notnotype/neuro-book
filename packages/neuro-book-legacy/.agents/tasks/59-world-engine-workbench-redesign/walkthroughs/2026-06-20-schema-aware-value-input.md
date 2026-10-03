# 2026-06-20 Schema-aware Value Input

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 mock 编辑体验，不接真实 API，不改后端 DTO。重点把 Mutation Editor 的 value 输入从统一文本框推进到 schema-aware 控件。

## Finding

Mutation Editor 已经能编辑 mutation value，但所有 value 都使用同一种文本输入。对于 World Engine 的数据类型来说，这会让用户在 mock 里仍然需要记忆值格式，例如：

- `ref(location)` 要手写 `subject://capital`。
- `int / float` 要手写数字。
- `object` 要在单行 input 里塞 JSON。
- `bool` 没有显式 true / false 选择。

这不符合“完整可用”的工作台目标，也不利于后续快速接入真实 API。

## Changes

- 新增 `WorldEngineWorkbenchPreviewValueInput.vue`。
- `WorldEngineWorkbenchPreviewMutationEditor` 改为复用 value input 子组件，并接收 `schema` prop。
- 页面层把 `mockWorkbenchSchema` 传入 Mutation Editor。
- value input 根据 schema / 当前 value 选择控件：
  - `ref(type)`：subject 下拉，value 为 `subject://id`。
  - `int / float` 或 number value：`type="number"`。
  - `bool`：true / false 下拉。
  - enum：枚举下拉。
  - object / array：textarea。
  - 其他：普通文本输入。
- 目标测试补充 value input 组件静态契约，确保 ref / bool / number / json 控件入口不会被误删。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 1366×768 smoke：
  - 页面 root 正常挂载，`scrollWidth` 为 1366。
  - 展开 Mutation Editor 后，默认 `雨城` subject 的 `era / weather` 显示为文本输入。
  - 切到 `东塔` 后，`security` object mutation 显示为 textarea。
  - 切到 `slice-erina-arrives` 的 `艾莉娜` 后，`location` 和 `inventory` 显示为 ref subject 下拉。
  - 切到 `旧剑` 后，`durability add -5` 显示为 number 输入。

## Plan Deviation

- 本轮没有接入真实业务逻辑；控件选择完全基于 mock schema 和当前 mutation value。
- 本轮没有做完整点击编辑提交链路，因为上一轮已经验证 value patch / snapshot 同步；这轮重点验证控件渲染是否符合 schema。

## Next Notes

- 后续可以让 schema-aware input 继续支持 collection remove 的当前状态候选项。
- 如果 value input 继续扩展，建议把 schema attr resolve 逻辑抽成 util 并补行为测试。
