# World Engine Calendar Enhancement

> 状态：**已完成并硬切到 `world-engine/calendar.ts`** | 创建日期：2026-06-22

## Relative documents refs

- [docs/tasks/56-world-engine/README.md](../56-world-engine/README.md)：World Engine 核心模型与当前实现
- [docs/tasks/64-world-engine-prompt-engineering/world-engine-initialization-requirements.md](../64-world-engine-prompt-engineering/world-engine-initialization-requirements.md)：初始化与提示词需求来源
- [reference/world-engine/calendar-system.md](../../reference/world-engine/calendar-system.md)：稳定 Calendar 契约与示例
- [server/world-engine/calendar.ts](../../server/world-engine/calendar.ts)：当前 Calendar loader / facade

## User Request / Topic

扩展 World Engine 的 Calendar 系统，让用户能自定义时间序列化 / 反序列化方式，支持奇幻历法、公历和任意复杂规则。

最初需求从“扩展 `calendar.yaml` 支持自定义月份名和月份天数”开始；后续路线已调整为 **`calendar.ts` 替代 `calendar.yaml`**，允许声明式配置或手写函数。

## Goal

当前目标已经完成：

- `world-engine/calendar.ts` 是唯一稳定入口，不再向后兼容 `calendar.yaml`。
- 支持三种 Calendar：
  - `simple`：通用单位链，适合固定月数 / 固定天数的奇幻历法。
  - `gregorian`：预置公历，含闰年和无公元 0 年模式。
  - `custom`：用户手写 `format` / `parse`，适合农历闰月等复杂规则。
- Project 模板、示范 Project、reference 文档、初始化 skill 与前端入口都已切到 `world-engine/calendar.ts`。

## Current Contract

当前唯一入口是 `world-engine/calendar.ts`。`calendar.yaml` 不再加载、不 fallback、不作为兼容格式；历史 Project 缺少 `calendar.ts` 时，应创建新的 `calendar.ts` 草稿再继续。

### Simple Calendar

```ts
export default {
    type: "simple",
    eraBefore: "蒙昧纪元",
    eraAfter: "新生纪元",
    baseUnit: "second",
    units: [
        {name: "minute", parent: "second", ratio: 60},
        {name: "hour", parent: "minute", ratio: 60},
        {name: "day", parent: "hour", ratio: 24},
        {name: "month", parent: "day", ratio: 30},
        {name: "year", parent: "month", ratio: 12},
    ],
    format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}",
};
```

### Gregorian Calendar

```ts
export default {
    type: "gregorian",
    eraBefore: "公元前",
    eraAfter: "公元",
    yearZeroMode: "noZero",
    format: "{eraName}{year}年{month:02}月{day:02}日 {hour:02}:{minute:02}:{second:02}",
};
```

### Custom Calendar

```ts
export default {
    type: "custom",
    format(instant) {
        return `自定义时间 ${instant.toString()}`;
    },
    parse(input) {
        const match = /^自定义时间 (-?\d+)$/.exec(input);
        if (!match) throw new Error("无法解析时间");
        return BigInt(match[1]);
    },
};
```

## Implementation Result

- Phase 1：定义 `CalendarStrategy`，`WorldCalendar` 重构为 facade，`WorldCalendarLoader` 改为加载 `calendar.ts`。
- Phase 2：实现 `SimpleCalendar`，支持自定义单位链、cycleNames、era 前后缀、week / month token 和可逆 parse / format。
- Phase 3：实现 `GregorianCalendar`，支持真实公历闰年、大小月和 `yearZeroMode: "noZero"`。
- Phase 4：实现 `CustomCalendar`，包装用户 `format` / `parse` 函数并校验返回值。
- Phase 5：重写 [reference/world-engine/calendar-system.md](../../reference/world-engine/calendar-system.md)，提供 simple / gregorian / custom 三套示例。
- 硬切收口：移除 legacy `calendar.yaml` 加载逻辑；模板、skill、`ming-ding-zhi-shi-2`、前端配置入口都使用 `calendar.ts`。

## Verification

- Calendar 单元测试与手动验证已覆盖三种类型。
- `bun run typecheck` 在 Task 65 实现时无新增错误。
- Round 420 / 421 已完成前端入口和真实浏览器窄验收：
  - Preview / 主 Workbench 都打开 `world-engine/calendar.ts`。
  - 旧 Project 缺少 `calendar.ts` 时，主 IDE 会创建默认 Simple Calendar 草稿再打开。
  - Round 421 验收确认不会再先触发缺文件 ENOENT 日志。

## Notes

- 历史设计稿中关于 `calendar.yaml` 兼容、fallback 或 months 扩展的内容已经过时，仅作为方案演化记录保留。
- 后续若继续增强 Calendar，应基于 `calendar.ts` 的 simple / gregorian / custom 三类策略扩展，不再恢复 `calendar.yaml`。
