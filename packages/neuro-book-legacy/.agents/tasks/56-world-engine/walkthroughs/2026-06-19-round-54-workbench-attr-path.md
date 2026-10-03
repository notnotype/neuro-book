# Round 54 - Workbench Mutation Builder attr path 输入

## 背景

Round 53 已为 Workbench Mutation Builder 增加 schema-aware value 控件，但 object 仍主要依赖用户手写完整 JSON。继续审查后发现后端 `getWorldSchema()` 已经通过 `flattenAttrs()` 投影固定 `fields` object 的细路径，例如 `equipment.weapon`；缺口主要在前端交互：

- 固定 object fields 可以从扁平 schema attr 里选择，但没有独立的实际 attr path 输入。
- 开放 object（如 `memory`，`itemType: text`）没有可枚举子字段，用户需要能输入 `memory.师门`。
- 输入开放 object key 后，value 控件应继承根 object 的 `itemType` 投影，而不是退回完全无类型文本。

## 本轮计划

1. 调研 schema 投影是否保留 object fields / itemType 信息。
2. 在不扩大后端 API 合同的前提下，补 Workbench Mutation Builder 的嵌套 attr path 输入。
3. 补契约测试与 util 测试。
4. 运行相关测试与 typecheck。

## 实现

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `resolvePreviewAttrPath(attrs, attrPath)`。
  - 先匹配 schema 已投影的精确 attr，例如 `equipment.weapon`。
  - 若未命中且是 `root.key` 形式，并且 `root` 是带 `type` 投影的 `object`，则把它视为开放 object key，继承根 object 的 `type/enum/desc`，并按 scalar 处理。
  - 固定 fields object 的未知子字段不在前端伪造类型，仍交给后端 schema 校验拒绝。
- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - Mutation Builder 保留 schema attr 下拉。
  - 新增实际 `attr path` 输入框，支持 `equipment.weapon` / `memory.师门`。
  - value 控件、op 选项、ref 目标下拉都改为通过 `resolvePreviewAttrPath()` 解析后的 attr 推导。
- 更新测试：
  - `app/utils/world-engine-preview.test.ts` 覆盖开放 object key 继承 itemType、固定 object 未声明子字段不伪造类型、空 path 拒绝。
  - `app/utils/world-engine-ide-entry.test.ts` 覆盖 Workbench Mutation Editor 引入 attr path 能力。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 没有改后端 schema/API 合同，风险集中在前端 Builder 的输入辅助。
- 开放 object key 的推导只在 root object 已带 `type` 投影时生效，符合当前 `flattenAttrs()` 对 `itemType` 的投影方式。
- 固定 fields object 的未知字段不会被前端放宽；后端仍是最终校验边界。
- 本轮未做浏览器验证，符合项目要求：浏览器验证需要用户明确确认后再执行。

## Walkthrough

本轮原计划是判断 schema 投影是否足够承载 object 子字段输入。实际发现固定 fields 已经被后端拍平成 attr path，因此没有必要扩大 schema projection；最终实现转为 Workbench 侧的 attr path 输入和开放 object key 类型推导。计划与实际有轻微调整，但范围仍落在 Workbench Mutation Builder 产品化内。
