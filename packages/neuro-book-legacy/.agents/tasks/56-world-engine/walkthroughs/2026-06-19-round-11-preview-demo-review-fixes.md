# Round 11 - Preview Demo Review Fixes

## Scope

本轮按目标流程进入“代码审查 -> 修复”环节，继续检查 Round 10 新增的 `/world-engine.preview` 一键示例世界。重点不是扩展新能力，而是减少用户真实试用时遇到的半成品写入、时间冲突和不清楚失败原因。

## Findings

- 示例世界原本只检查 schema 是否存在 `world / location / character / item` 类型。如果用户改过 schema，类型仍存在但缺少 `events / inventory / durability` 等属性，按钮会先创建一部分 subject，然后在写事件 slice 时失败，留下半成品。
- 示例 slice 时间原本只在同一分钟内寻找空闲秒点。正常使用足够，但连续多次点击或已有很多测试 slice 时，可能退回到已占用时间，最后由后端唯一约束报错。

## Actual Changes

- 更新 `app/pages/world-engine.preview.vue`：
  - 新增 `DemoAttrRequirement` 与 `demoAttrRequirements`，在创建示例世界前检查示例依赖的属性：
    - `world.events` 必须是 `list`
    - `location.events` 必须是 `list`
    - `character.location` 必须是 `scalar`
    - `character.inventory` 必须是 `collection`
    - `character.events` 必须是 `list`
    - `item.durability` 必须是 `scalar`
    - `item.events` 必须是 `list`
  - 如果属性声明了类型，还会检查是否和示例值兼容，例如 `inventory` 期望 `ref(item)`，`durability` 期望 `int` 或 `float`。
  - schema 不兼容时直接在按钮写入前报错，不再先创建 subject。
- 更新 `app/utils/world-engine-preview.ts`：
  - `suggestNextPreviewTime()` 从“同一分钟内找空闲秒点”扩展为“同一小时内递增秒数”，最多可避开 3599 个占用点。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 增加分钟进位用例，确认 `00:00:59` 被占用后可选择 `00:01:00`。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 通过：1 个测试文件，6 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；下一步需要用户确认后，在 `/world-engine.preview` 中从用户视角跑完整例子。

## Code Review Notes

- 这轮修复避免了“示例 subject 已写入，但示例事件失败”的半成功状态，真实试用更干净。
- 时间建议仍是 preview 层启发式逻辑；最终唯一性仍由后端 `WorldSlice.instant` 唯一约束兜底。
- 如果后续需要支持任意自定义 calendar 的复杂时间递增，应该让后端提供“按 instant 偏移并 format”的工具，而不是在前端继续猜格式。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
