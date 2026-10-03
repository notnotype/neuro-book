# Round 53 - schema-aware Mutation Builder value 控件

## 背景

Round 52 后，主 IDE World Engine Workbench 已经能创建 subject、写入 / 编辑 slice，并且 Mutation Editor 有 dirty guard。但 Builder 的 value 仍是单个文本框：数字、布尔、enum 和 ref 都需要用户知道应该输入什么字符串。

本轮目标是把 value 输入做成 schema-aware 控件，减少手写 JSON 的负担。

## 本轮计划

1. 保持 API payload 不变，仍输出同一份 mutation JSON。
2. 在 `WorldEngineMutationEditor` 内根据 schema attr 的 `type / enum` 和 op 推导 value 控件形态。
3. 覆盖数字、布尔、enum、ref 四类高频输入。
4. 补契约测试和文档。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 新增 `BuilderValueMode = hidden | number | boolean | enum | ref | text`。
  - 新增 `builderAttr`、`builderValueMode`、`enumValueOptions`、`refValueOptions`。
  - `unset` 时 value 控件隐藏为 disabled 占位。
  - `int / float` 使用 number input。
  - `bool` 使用 true / false select。
  - `enum` 使用 schema enum 下拉，复杂 enum value 仍通过 JSON 字符串进入 `parseLooseJsonValue()`。
  - `ref(type)` 如果已有目标 type subject，使用 subject 下拉并生成 `subject://<id>`；没有目标时保留手填 `subject://` 输入。
  - 其它属性继续使用文本输入，兼容 listAppend 和普通 text。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 契约覆盖 `builderValueMode`、enum/ref options、number/boolean/enum/ref 控件分支。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`
  - 2 个测试文件通过。
  - 14 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 代码审查自检

- 没有改变后端 API、mutation DTO 或 service 行为。
- 没有新增 `any` / `unknown`。
- `WorldEngineMutationEditor.vue` 当前 447 行，仍低于大型单文件组件风险线。
- 新控件只改变输入体验，最终仍交给 `parseLooseJsonValue()` 和 `parseMutationJson()` 统一校验。

## 与计划的出入

本轮按计划完成了 schema-aware value 控件。没有实现完整 object 子字段表单；object 当前仍走文本/JSON 输入，后续可单独设计，因为 object fields 的嵌套结构比 scalar/ref/enum 更复杂。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮由契约测试和 typecheck 覆盖。

## 后续

- 为 object / nested path 设计字段级子表单。
- 增加常见 mutation 模板，例如“追加经历”“移动到地点”“获得物品”“数值增减”。
- 用户确认后，在浏览器中从主 IDE Workbench 跑一遍完整例子并评估体验。
