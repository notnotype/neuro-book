# Round 12 - Preview Demo API Example Test

## Scope

本轮继续推进 World Engine 目标里的“从用户角度跑实际例子”。由于项目指令要求不要自动浏览器验证，本轮先补一条浏览器前的 API 级真实例子测试，用来证明 `/world-engine.preview` 一键示例世界背后的后端链路和 reduce 语义是通的。

这不能替代后续浏览器测试，但可以在打开页面前提前覆盖大部分业务风险。

## Actual Changes

- 更新 `server/api/projects/world-engine/[...segments].test.ts`：
  - 扩展测试 Project schema，加入 preview 示例需要的 `world / character / location / item` 类型和属性。
  - 新增“跑通 preview 一键示例世界背后的真实 API 链路”测试：
    - 创建 `world / capital / erina / old-sword` 四个 subject。
    - 验证同一 init time 的 subject 初始化可合并到同一个 init slice。
    - 写入“艾莉娜抵达王都”事件 slice。
    - 查询 `erina / old-sword / world` 的状态投影。
    - 验证 `erina.location = subject://capital`、`erina.inventory` 包含 `subject://old-sword`、`old-sword.durability = 95`、`world.events` 含示例启动事件。
  - `affectedSubjects` 断言使用集合语义，不依赖返回顺序。

## Verification

- 第一次运行：
  - `bunx vitest run server/api/projects/world-engine/[...segments].test.ts app/utils/world-engine-preview.test.ts`
  - 失败：新增测试把 `affectedSubjects` 顺序写死，但实际返回顺序是 `capital, erina, old-sword, world`。业务结果正确，断言过窄。
- 修复后运行：
  - `bunx vitest run server/api/projects/world-engine/[...segments].test.ts app/utils/world-engine-preview.test.ts`
  - 通过：2 个测试文件，9 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；当前已有更强的浏览器前证据，但最终仍需要用户确认后打开 `/world-engine.preview`，从真实页面跑：

1. 新建 Project。
2. 点击“创建示例世界”。
3. 检查 subjects、timeline 和 state query 展示。
4. 重复点击一次，检查跳过已有 subject 与新增 slice。
5. 载入较早 slice 编辑，检查 `needsResettle` 提示与重结算。

## Code Review Notes

- 新测试覆盖了 preview 示例的核心业务语义，但没有覆盖 Vue 按钮点击、loading 状态、布局和表单展示。
- 测试发现并修正了一个断言问题：`affectedSubjects` 是集合含义，不应把顺序作为 API 契约。
- 这轮没有改生产代码，只增强测试证据。

## Walkthrough Delta

计划与实际基本一致。唯一偏差是第一次测试暴露了断言顺序假设，已在同轮修复并记录。
