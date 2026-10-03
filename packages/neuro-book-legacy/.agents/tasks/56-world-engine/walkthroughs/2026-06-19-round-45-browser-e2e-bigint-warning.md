# Round 45 - 浏览器实跑与 BigInt warning 修复

## 背景

本轮按任务目标补一次用户视角浏览器验证：从 `/world-engine.preview` 新建 Project，跑一键示例世界，再覆盖写入后续 slice、编辑较早 slice、显式 re-settle 的主流程。

验证过程中，Preview 功能链路跑通，但 Nuxt dev server 首次构建时出现 esbuild warning：

```text
Big integer literals are not available in the configured target environment ("es2019") and may crash at run-time
```

warning 指向 `server/world-engine/calendar.ts` 和 `server/world-engine/world-engine.service.ts` 的运行时代码。虽然当前运行环境支持 BigInt，但 dev/build target 提示这是一个真实可移植性风险，应该修掉。

## 本轮计划

1. 启动本地 Nuxt dev server。
2. 用浏览器打开 `/world-engine.preview`。
3. 新建真实 Project 并运行一键示例世界。
4. 手工写入后续 slice，再编辑较早 slice，验证 `needsResettle` 与显式 re-settle。
5. 修复浏览器实跑暴露的运行时 warning。
6. 跑相关测试和 typecheck。

## 浏览器验证

- 启动：`bun run dev -- --port 3000 --host 127.0.0.1`。
- 页面：`http://127.0.0.1:3000/world-engine.preview`。
- 新建 Project：
  - `workspace/shi-jie-yin-qing-liu-lan-qi-shi-yong-1-7-8-1-8-3-2-5-8-0-7-7-5`
- 一键示例世界结果：
  - 页面显示 `4 subjects · 2 slices`。
  - `STATE QUERY` 返回 `erina`、`old-sword`、`world` 状态。
  - `erina.inventory` 包含 `subject://old-sword`。
  - `old-sword.durability` reduce 为 `95`。
- 手工追加后续 slice：
  - 时间：`复兴纪元1年 1月1日 00:00:02`。
  - mutation：`erina.hp add -15`，`erina.events listAppend "训练中受伤"`。
  - 返回 `needsResettle: false`。
- 编辑较早 slice：
  - 载入 `复兴纪元1年 1月1日 00:00:01` 的示例事件。
  - 追加 `erina.hp add -5` 与 `erina.events listAppend "抵达王都时擦伤"`。
  - 返回 `needsResettle: true`，`affectedMutations: 2`。
  - Preview 自动填充 re-settle 表单：`from=复兴纪元1年 1月1日 00:00:01`，`subjectIds=capital, erina, old-sword, world`。
- 显式 re-settle：
  - 点击 `重结算` 后无浏览器 console error / warn。
  - 页面展示 re-settle 结果：`复兴纪元1年 1月1日 00:00:01 · 13 mutations`。
  - 状态查询中 `erina.events` 同时包含 `抵达王都时擦伤` 与 `训练中受伤`。
- Round 44 按钮规则复验：
  - `subjectIds` 填成空白 / 逗号时，`重结算` 按钮禁用。
  - 恢复有效 subjectIds 后，按钮启用。

## 实现

- 更新 `server/world-engine/calendar.ts`：
  - 增加 `ZERO` / `ONE` / 默认日历单位 BigInt 常量。
  - 将运行时代码中的 BigInt 字面量替换为 `BigInt(...)` 或常量。
- 更新 `server/world-engine/world-engine.service.ts`：
  - 将默认 instant 的 `0n` 替换为 `BigInt(0)`。

## 验证

- `rg -n "[0-9]+n" server/world-engine -g "!*.test.ts"`
  - 非测试运行时代码无 BigInt 字面量残留。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts app/utils/world-engine-preview.test.ts`
  - 2 个测试文件通过。
  - 43 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 53 个测试用例通过。
- `bun run typecheck`
  - 通过。
- 浏览器 console：
  - 实跑期间无 `error` / `warn`。

## 与计划的出入

- 浏览器实跑完整覆盖了新建 Project、一键示例世界、写入 slice、编辑 slice、显式 re-settle 和按钮禁用规则。
- 修复 BigInt warning 后，浏览器 `reload()` 被内置浏览器 URL policy 拒绝；没有绕过该限制。后续以测试、typecheck、运行时代码 `rg` 检查和 dev server 热更新日志作为补充证据。
- dev server 已退出，未留下 3000 端口监听。

## 体验评估

- 好用的部分：
  - 一键示例世界能很快给用户一个可观察的 reduce 状态。
  - `needsResettle` 后自动填充 from / subjectIds，显著降低手工操作成本。
  - 同一页面能完成 subject、slice、query、resettle 的端到端验证。
- 需要继续优化：
  - Project 下拉会显示大量历史测试 Project，列表很快变长，真实使用时需要搜索 / 最近项目 / 清理入口。
  - re-settle 结果目前是轻量文本，能确认成功但不够醒目；后续可展示 subjects 与 mutation count 的小结果块。
  - Preview 仍是调试台，不是正式主 IDE UI。

## 后续

- 继续评估正式主 IDE UI 应如何承载 World Engine：timeline、subject 状态视图、mutation 编辑器、re-settle 提示。
- 后续需要决定是否给测试 Project 增加清理入口，避免浏览器验证长期污染 Project 列表。
