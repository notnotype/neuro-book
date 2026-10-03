# Round 287: 示例世界 Schema 入口保护

## Context

Round 286 让作者可以从 Workbench 直接打开 `world-engine/schema.yaml` / `world-engine/calendar.yaml`。继续沿着真实作者路径走时，新的第一卡点出现在空 Project 主画布：已经设置成自定义 schema 的项目仍会显示“一键示例世界”，但内置示例依赖固定的 `world/location/character/item` 字段组合。

以 `ming-ding-zhi-shi-2` 为例，`character` schema 没有 `events` 字段，按钮点下去才会报 `当前 schema 不适合内置示例：character.events 缺失`。这不是后端边界问题，而是入口误导。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `demoWorldSchemaError` / `canSeedDemoWorld` / `demoWorldButtonTitle`。
  - 顶栏和空状态里的示例世界按钮统一使用 `canSeedDemoWorld` 禁用，并用 title 暴露不可用原因。
  - `seedDemoWorld()` 继续保留运行时 guard，但复用同一个 schema error 计算。
  - 空 Project 且内置示例不可用时：
    - 已有 World Engine subject：空状态动作降级为 `新建 Slice`。
    - 没有 World Engine subject：空状态动作降级为 `创建 Subject`。
  - 空状态文案说明“内置示例暂不可用”的具体 schema 原因，避免作者点进必报错路径。
- `world-engine-ide-entry.test.ts`
  - 增加静态契约，钉住 demo schema 预检、按钮禁用、title 和 `create-subject` 空状态动作。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划目标是继续找“作者真的拿它写世界，第一个卡住的地方”。实际只处理了内置示例世界在自定义 schema 下的误导入口；没有改 schema 文件、没有新增后端 API，也没有扩展浏览器验收。
