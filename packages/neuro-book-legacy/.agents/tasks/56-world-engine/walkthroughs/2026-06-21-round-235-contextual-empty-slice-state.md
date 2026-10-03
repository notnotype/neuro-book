# Round 235: 无选中 slice 的空状态按视角区分

继续处理创建 / 同步 subject 后的空时间线体验。Round 234 已让没有 default、没有生成切片的 preferred subject 保持空 subject 视角，不再回落旧 slice；但底部空状态仍固定显示“当前 Project 还没有 slice”，这会把“当前 subject 没有时间线”“当前没有选中 slice”“待接入 subject 尚未同步”等不同情况混成 Project 全空。

本轮把空状态文案改成当前视角驱动，让作者知道下一步该同步主体系统、新建 Slice、清空 subject 过滤，还是写入示例世界。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `emptySliceState`，按当前 subject 过滤、World Engine subject 注册状态、timeline 是否为空和 Project 是否已有 slice 生成标题、说明和推荐动作。
  - 待接入 subject 显示“当前 subject 尚未接入 World Engine”，提示先使用左侧“同步主体系统”或选择已注册 subject。
  - 已注册 subject 但当前时间线为空时，显示“当前 subject 时间线暂无 slice”，提供“新建 Slice”和“清空 subject 过滤”。
  - Project 已有 slice 但当前未选中时，显示“当前未选择 slice”，避免误报 Project 没有 slice。
  - Project 真正没有 slice 时，保留“一键示例世界”入口。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 `emptySliceState`、subject 空时间线、未选择 slice、`new-slice` 动作和清空 subject 过滤入口存在。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是修正上一轮引出的真实 UI 语义问题。实际改动只调整主 Workbench 的空状态显示和动作入口，不改变后端 / API / 数据模型，也不改 subject 同步或 slice 选择规则。
