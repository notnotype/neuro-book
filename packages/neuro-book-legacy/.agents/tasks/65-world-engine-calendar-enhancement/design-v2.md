# Calendar 系统重构设计 V2

> 基于 2026-06-23 讨论，完全重构 calendar 系统架构。
> 
> 当前状态：本设计中的 `calendar.yaml` 向后兼容 / fallback 段落已被后续硬切决策取代。稳定契约以 `README.md` 和 `reference/world-engine/calendar-system.md` 为准：`world-engine/calendar.ts` 是唯一入口，不再兼容 `calendar.yaml`。

## 设计决策（已确认）

1. **配置格式**：calendar.ts/js 替代 calendar.yaml，支持：
   - 声明式配置（units 链）
   - 手写 format/parse 函数
2. **公元前后算法**：方案 B（数学连续，有公元0年）
   - instant > 0 → 正年份
   - instant = 0 → 0年（或1年，由配置决定）
   - instant < 0 → 负年份，显示时加纪元前缀（如"公元前"）
3. **动态 ratio**：通用单位系统不支持动态闰年/闰月；复杂历法必须手写或继承预置 Calendar
4. **format token 歧义**：明确区分 `{dayOfYear}` / `{dayOfWeek}`
5. **week 单位**：`{ name: 'week', parent: 'day', ratio: 7 }` 声明，instant 取模算星期几
6. **era 前后缀可配置**：`eraBefore: "蒙昧纪元"` / `eraAfter: "新生纪元"`

---

## 整体架构

```
┌──────────────────────────────────────────────┐
│  project/world-engine/calendar.ts            │
│  用户配置文件（TS/JS）                        │
├──────────────────────────────────────────────┤
│  export default {                            │
│    type: 'simple' | 'gregorian' | 'custom', │
│    units: [...],  // 仅 simple 需要          │
│    format(instant) { ... }, // 仅 custom需要 │
│    parse(input) { ... }                      │
│  }                                           │
└──────────────────────────────────────────────┘
              ↓ WorldCalendarLoader 动态 import
┌──────────────────────────────────────────────┐
│  CalendarStrategy (抽象接口)                 │
│  - format(instant: Instant): string          │
│  - parse(input: string): Instant             │
│  - projection(): {format, examples}          │
├──────────────────────────────────────────────┤
│  SimpleCalendar    (units 链自动算)          │
│  GregorianCalendar (预置公历闰年)            │
│  CustomCalendar    (用户函数包装)            │
└──────────────────────────────────────────────┘
              ↓ WorldCalendar 包装
┌──────────────────────────────────────────────┐
│  WorldCalendar (facade，工具层调用)          │
│  - format() / parse() 转发给 strategy        │
└──────────────────────────────────────────────┘
```

---

## 配置格式设计

### 类型 1：Simple Calendar（通用单位链）

```typescript
// project/world-engine/calendar.ts
export default {
  type: 'simple',
  eraBefore: '蒙昧纪元',  // instant < 0 时的纪元名
  eraAfter: '新生纪元',   // instant >= 0 时的纪元名
  baseUnit: 'second',     // instant 的单位（1 刻 = 1 秒）
  units: [
    { name: 'minute', parent: 'second', ratio: 60 },
    { name: 'hour', parent: 'minute', ratio: 60 },
    { name: 'day', parent: 'hour', ratio: 36 },  // 一天 36 小时
    { name: 'week', parent: 'day', ratio: 7,
      cycleNames: ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'] },
    { name: 'month', parent: 'day', ratio: 30 },
    { name: 'year', parent: 'month', ratio: 12 }
  ],
  format: '{eraName}{year}年{month}月{day}日 {hour}:{minute:02}'
  // 可用 token：
  // - {eraName}: 根据 instant 正负自动选 eraBefore/eraAfter
  // - {year}, {month}, {day}, {hour}, {minute}, {second}
  // - {dayOfYear}: 一年中的第几天
  // - {dayOfWeek}: 一周中的第几天（数字，从1开始）
  // - {weekName}: 如果 week 单位有 cycleNames，输出对应名字
  // - {hour:02}, {minute:02}, {second:02}: 补零格式
};
```

**Units 配置规则**：

- **严格层级**：每个单位必须有 `parent`（除了 `baseUnit`），形成链式依赖
- **静态 ratio**：ratio 只能是正整数，不支持函数（动态闰年走 custom/gregorian）
- **cycleNames**：可选，用于"周"这种循环单位，提供每天的名字
- **无分叉**：week 和 month 都基于 day，但 week 不参与 instant 的主线换算（instant → year/month/day 主线，week 只是辅助显示）

**Instant ↔ Parts 算法**（SimpleCalendar 实现）：

```
partsFromInstant(instant):
  1. 从 units 链的最高层（year）开始，逐层往下除：
     rest = instant
     for unit in [year, month, day, hour, minute, second]:
       unitSeconds = 计算该单位对应的秒数（向下递归乘 ratio）
       parts[unit.name] = floorDiv(rest, unitSeconds)
       rest -= parts[unit.name] * unitSeconds
  2. 辅助单位（week）单独算：
     totalDays = instant / secondsPerDay
     dayOfWeek = (totalDays % 7) + 1

instantFromParts(parts):
  1. 从最高层（year）开始，逐层累加：
     instant = 0
     for unit in [year, month, day, hour, minute, second]:
       instant += parts[unit.name] * unitSeconds(unit)
  2. 校验：month <= monthsPerYear, day <= daysPerMonth, etc.
```

**Format token 解析**：

- `{eraName}` → 根据 instant 正负选 eraBefore/eraAfter
- `{year}` → parts.year（可能是负数，显示时取绝对值）
- `{dayOfYear}` → 从年初到当前的累计天数
- `{dayOfWeek}` → (totalDays % 7) + 1
- `{week}` / `{weekName}` → units 中找到 week 单位的 cycleNames[(dayOfWeek - 1) % cycleNames.length]
- `{weekOfDay}` → 等同于 `{dayOfWeek}`（数字形式）
- `{weekOfMonth}` → floor((dayOfMonth - 1) / 7) + 1（一个月中的第几周）

---

### 类型 2：Gregorian Calendar（预置公历）

```typescript
import { GregorianCalendar } from 'nbook/server/world-engine/calendars/gregorian';

export default new GregorianCalendar({
  eraBefore: '公元前',
  eraAfter: '公元',
  format: '{eraName}{year}年{month}月{day}日'
});
```

或者更简洁的配置：

```typescript
export default {
  type: 'gregorian',
  eraBefore: '公元前',
  eraAfter: '公元',
  format: '{eraName}{year}年{month}月{day}日'
};
```

**GregorianCalendar 内置逻辑**：

- 闰年规则：`(year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)`
- 大小月：1/3/5/7/8/10/12 月 31 天，4/6/9/11 月 30 天，2 月看闰年（28/29）
- instant ↔ parts 算法需要逐年遍历（因为闰年动态），复杂度 O(year)
- 优化：可以缓存"每400年的秒数"做快速跳跃，降到 O(year / 400)

---

### 类型 3：Custom Calendar（用户手写）

```typescript
export default {
  type: 'custom',
  format(instant: bigint): string {
    // 用户自己实现 instant → 人读字符串
    const year = Number(instant / 31536000n) + 1;
    return `自定义历${year}年`;
  },
  parse(input: string): bigint {
    // 用户自己实现 人读字符串 → instant
    const match = /自定义历(\d+)年/.exec(input);
    if (!match) throw new Error('格式错误');
    return BigInt((Number(match[1]) - 1) * 31536000);
  },
  projection() {
    return {
      format: '自定义历{year}年',
      examples: ['自定义历1年', '自定义历488年']
    };
  }
};
```

**CustomCalendar 类**只是简单包装用户函数，不做任何逻辑。

---

## Era 前后缀设计

### 方案 B：数学连续（有公元0年）

**Instant 到年份的映射**：

```
instant >= 0:
  year = floorDiv(instant, secondsPerYear) + 1  // 1年、2年、3年...
  eraName = eraAfter

instant < 0:
  year = floorDiv(instant, secondsPerYear)      // 0年、-1年、-2年...
  eraName = eraBefore
  displayYear = abs(year)  // 显示时取绝对值
```

**示例**：

```
instant = 0           → 新生纪元1年1月1日（或0年，配置决定）
instant = 31536000    → 新生纪元2年1月1日
instant = -1          → 蒙昧纪元1年 最后一秒（或0年，配置决定）
instant = -31536000   → 蒙昧纪元2年 开始
```

**配置项**：

```typescript
{
  eraBefore: '蒙昧纪元',
  eraAfter: '新生纪元',
  yearZeroMode: 'hasZero' | 'noZero',  // 可选，默认 hasZero
  // hasZero:  instant=0 → 0年，instant=-1秒 → -1年
  // noZero:   instant=0 → 1年，instant=-1秒 → 前1年（跳过0）
}
```

如果 `yearZeroMode: 'noZero'`（对齐真实公历），算法改成：

```
instant >= 0:
  year = floorDiv(instant, secondsPerYear) + 1  // 1, 2, 3...

instant < 0:
  year = floorDiv(instant, secondsPerYear)      // -1, -2, -3... (跳过0)
  displayYear = abs(year)
```

---

## Format Token 完整列表

### 主单位（从 units 链提取）

- `{year}` → 年份（可能负数，显示时根据 yearZeroMode 处理）
- `{month}` → 月份数字（1-based）
- `{day}` → 日期数字（1-based）
- `{hour}` → 小时（0-based）
- `{minute}` → 分钟
- `{second}` → 秒
- `{hour:02}`, `{minute:02}`, `{second:02}` → 补零格式

### 扩展 Token

- `{eraName}` → 根据 instant 正负自动选 eraBefore/eraAfter
- `{dayOfYear}` → 一年中的第几天（1-based）
- `{dayOfWeek}` → 一周中的第几天（1-based，周一=1）
- `{week}` → 等同于 `{weekName}`（简写）
- `{weekName}` → 如果 week 单位有 cycleNames，输出对应名字（如"月曜日"）
- `{weekOfDay}` → 一周中的第几天（数字，1-based）
- `{weekOfMonth}` → 一个月中的第几周（数字，1-based）
- `{monthName}` → 如果 month 单位有 cycleNames，输出月份名（如"风信之月"）

### 月份名支持（Simple Calendar）

```typescript
units: [
  ...
  { name: 'month', parent: 'day', ratio: 30,
    cycleNames: ['风信之月', '炎夏之月', '金秋之月', ...] },
  ...
]
```

Format 里写 `{monthName}` 就输出 cycleNames[month - 1]。

---

## Week 单位的特殊处理

Week 是"辅助单位"——它和 month 都基于 day，但不参与 instant 主线换算：

**Units 配置**：

```typescript
{ name: 'week', parent: 'day', ratio: 7,
  cycleNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] }
```

**算法**：

```typescript
// week 不参与 instantFromParts(year, month, day) 的计算
// 只在 format 时额外算：
const totalDays = floorDiv(instant, secondsPerDay);
const dayOfWeek = (totalDays % 7n) + 1n;  // 1-7
const weekName = cycleNames[Number(dayOfWeek - 1n)];
```

**Format**：

```
'{year}年{month}月{day}日 {week}'
→ '312年5月15日 周三'

'{year}年{month}月{day}日 第{weekOfMonth}周 {weekName}'
→ '312年5月15日 第3周 周三'
```

**问题**：totalDays 从 instant=0 开始算，instant=0 是周几？

**方案**：配置 `weekStartOffset`

```typescript
{ name: 'week', parent: 'day', ratio: 7,
  cycleNames: ['周一', ...],
  startOffset: 0  // instant=0 是周一；startOffset=1 表示 instant=0 是周二
}

dayOfWeek = ((totalDays + startOffset) % 7) + 1
```

---

## 旧设想：向后兼容（calendar.yaml，已废弃）

以下 fallback 方案是设计过程中的旧设想，后续硬切决策已废弃它。当前实现只加载 `world-engine/calendar.ts`，缺文件时由前端引导创建默认草稿，后端不再回退 `calendar.yaml`。

```typescript
class WorldCalendarLoader {
  async load(projectPath: string): Promise<WorldCalendar> {
    // 优先尝试 calendar.ts
    const tsPath = path.join(projectPath, 'world-engine/calendar.ts');
    if (await exists(tsPath)) {
      const module = await import(tsPath);
      return this.buildFromConfig(module.default);
    }

    // 旧设想：fallback 到 calendar.yaml（当前已废弃）
    const yamlPath = path.join(projectPath, 'world-engine/calendar.yaml');
    if (await exists(yamlPath)) {
      const yaml = await fs.readFile(yamlPath, 'utf-8');
      return this.buildLegacyCalendar(yaml);  // 当前 normalizeCalendarConfig 逻辑
    }

    // 都不存在，使用默认
    return this.buildDefaultCalendar();
  }
}
```

---

## 实现计划

### Phase 1：重构基础架构

1. [ ] 定义 `CalendarStrategy` 接口
2. [ ] 重构现有 `WorldCalendar` 为 `LegacySimpleCalendar`（保持当前逻辑不变）
3. [ ] 修改 `WorldCalendarLoader` 支持 calendar.ts 动态 import

### Phase 2：实现 SimpleCalendar（Units 链）

1. [ ] 定义 Units 配置 TypeBox schema
2. [ ] 实现 `instantFromParts` / `partsFromInstant`（遍历 units 链）
3. [ ] 实现 format token 解析（支持 `{eraName}` / `{dayOfWeek}` / `{weekName}` 等）
4. [ ] 实现 era 前后缀逻辑（eraBefore/eraAfter + yearZeroMode）
5. [ ] 单元测试：4 月制历法、36 小时制、week 取模

### Phase 3：实现 GregorianCalendar

1. [ ] 实现闰年算法（4/100/400 规则）
2. [ ] 实现大小月（1-12 月天数数组）
3. [ ] 实现 instant ↔ parts 转换（逐年遍历，累加闰年天数）
4. [ ] 单元测试：闰年边界（2000/1900/2024）
5. [ ] 性能优化：400 年周期跳跃

### Phase 4：实现 CustomCalendar

1. [ ] 简单包装用户 format/parse 函数
2. [ ] 校验用户函数签名
3. [ ] 错误处理（用户函数抛错 → 400）

### Phase 5：文档与示例

1. [ ] 更新 `reference/world-engine/calendar-system.md`
2. [ ] 提供 3 套示例 calendar.ts（simple / gregorian / custom）
3. [ ] 更新 `novel-workflow-world-engine-init` skill

### Phase 6：迁移与测试

1. [ ] 端到端测试：ming-ding-zhi-shi-2 项目迁移到 calendar.ts
2. [x] 硬切验证：保留 calendar.yaml 不能作为兼容入口，项目需迁移到 calendar.ts

---

## 设计决策（已确认）

### Q1：yearZeroMode 默认值

**决定**：默认 `hasZero`（数学连续，有公元0年），GregorianCalendar 预设强制 `noZero`（对齐真实公历）。

### Q2：cycleNames 长度校验

**决定**：加载期严格校验 `cycleNames.length == ratio`，不匹配报 400。

### Q3：Units 链层数限制

**决定**：不做硬性限制，文档建议不超过 8 层。

### Q4：startOffset 默认值

**决定**：默认 0（instant=0 是 cycleNames[0]），可省略。

### Q5：Week token 变体

**决定**：支持 `{week}`（等同 `{weekName}`）、`{weekName}`、`{weekOfDay}`（数字）、`{weekOfMonth}`（一个月中的第几周）。

### Q6：月份名冲突（数字 vs 名字）

**建议**：允许重复（用户自己决定），不做互斥校验。

### Q7：parse 的宽容度

**建议**：Phase 2 先做严格模式（parse 对齐 format），Phase 7（可选）再加宽容模式开关。

---

## 与 Task 64 的关系

- Task 64 已完成：reference 文档、leader/writer 提示词、skills 已迁移到 World Engine
- Task 65 已硬切：`calendar.ts` 不是增强入口，而是当前唯一入口。
- Task 64 的 `novel-workflow-world-engine-init` skill 必须引导用户选择 simple/gregorian/custom，并生成或编辑 `world-engine/calendar.ts`。
