# World Engine — 时间系统与 Calendar

本文讲清 World Engine 的时间真相源（Instant）与 Calendar（日历/历法）的概念和契约。读者是需要理解"时间如何表达、如何落盘、如何在工具边界被接受"的 Agent 和作者。

> World Engine 用事件溯源（event sourcing）表达世界演化：任意时刻的世界状态 = 该时刻前所有切面（slice）按时间排序后 reduce 得来。时间在这套模型里是排序与截断的唯一依据。

## 1. 唯一时间真相源 = Instant

World Engine 里**唯一的时间真相源是 Instant**：自世界零点起经过的秒数（BigInt）。

- **类型是 BigInt，可正可负**。以秒为刻，BigInt 可覆盖量劫级跨度（约 2920 亿年）。
- **序列化为字符串存储**，避免 JSON number 精度丢失。切面底层只存这个 instant 字符串。
- **比较运算用 BigInt 原生 `<` / `>` / `===`**。timeline 排序、reduce 截断只依赖 instant 比较。

```typescript
// 唯一真值源：自零点起的秒数，可负。持久化为 string。
type Instant = bigint;
```

**读者不直接接触 instant**。Agent 和作者读写的永远是"项目日历字符串"（如 `复兴纪元312年5月15日 14:00`），由 Calendar 在工具边界做双向转换。

## 2. 零点与纪元锚点

- **零点 `Instant = 0` 是作者命名的世界元年起点**，类比公元元年或 Unix epoch。
- **`Instant < 0` 天然表示"零点前"**，不需要额外字段。负 instant 经 Calendar format 后是零点前的人读时间。
- **world subject 的创建时间锚定纪元**。world 这个主体的起始 instant 就是纪元锚点。

## 3. Calendar 是独立显示模块

时间的格式化（instant → 人读字符串）**是一个独立的显示模块，不是时间真相源的一部分**。

- 切面底层**只存 instant**；人读字符串由 Calendar 实时 format，**不落盘**。
- 因此**改历法、改月份名、改一天小时数都不需要迁移任何已存数据**——instant 不变，只换 format/parse 规则。
- Calendar 同时承担**两个方向**：format（instant → 人读字符串）和 parse（人读字符串 → instant）。

## 4. Calendar 配置：calendar.ts

Calendar 配置是项目级资产，放 Project Workspace 的 `world-engine/calendar.ts`。

`calendar.ts` 是**单文件配置入口**。本地文件、绝对路径和 URL/protocol `import` / `export ... from`（例如 `./calendar-config`、`../time-helper`、`C:/helper.ts`、`file:///...`）会被 loader 拒绝；请把配置和自定义 `format/parse` helper 合并到 `calendar.ts`，或只使用包级 import 与 `node:` 内置模块。

### 4.1 三种 Calendar 类型

**Type 1：Simple Calendar（通用单位链）**

用户自定义单位层级（秒 → 分 → 时 → 日 → 月 → 年），每个单位有固定换算比例（ratio）。适合固定月数、固定天数的奇幻历法。

**Type 2：Gregorian Calendar（预置公历）**

内置真实公历规则：闰年（4/100/400规则）、大小月（1/3/5/7/8/10/12月31天，4/6/9/11月30天，2月平年28/闰年29）。适合现代背景或需要真实公历的故事。

**Type 3：Custom Calendar（用户手写函数）**

用户直接写 `format(instant)` / `parse(input)` 函数。适合复杂历法（如农历闰月）或任意自定义规则。

---

## 5. Simple Calendar 配置示例

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
      cycleNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      startOffset: 0 },
    { name: 'month', parent: 'day', ratio: 30 },
    { name: 'year', parent: 'month', ratio: 4 }  // 一年 4 个月
  ],
  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'
};
```

**Units 配置规则**：

- **name / parent / ratio**：必填。`ratio` 是正整数，表示"1 个当前单位 = ratio 个父单位"。
- **cycleNames**：可选，长度必须等于 ratio。用于输出循环名称（如星期名）。不要把 `ratio: 30/90` 的月份配 4 个名称；这会加载失败。
- **startOffset**：可选，默认 0。用于 week 等循环单位，表示 instant=0 是 cycleNames 的第几个（0-based）。
- **拓扑排序**：units 可以乱序输入，系统自动按依赖关系排序（从 baseUnit 开始向上构建）。

**Format Token**：

- 主单位：`{year}` `{month}` `{day}` `{hour}` `{minute}` `{second}` `{hour:02}` `{minute:02}` `{second:02}`
- Era：`{eraName}`（根据 instant 正负自动选 eraBefore/eraAfter）
- Week：`{week}`（等同 `{weekName}`）、`{weekName}`、`{weekOfDay}`（数字）、`{weekOfMonth}`（一个月中的第几周）
- Month：`{month}`（数字月份）。`{monthName}` 只在 `month.cycleNames.length === month.ratio` 时可用。
- 扩展：`{dayOfYear}`（一年中的第几天）

**限制**：

- 不支持动态 ratio（闰年/闰月必须走 Gregorian 或 Custom）
- Units 必须形成严格层级（不能有环或孤立节点）

---

## 6. Gregorian Calendar 配置示例

```typescript
// project/world-engine/calendar.ts
export default {
  type: 'gregorian',
  eraBefore: '公元前',
  eraAfter: '公元',
  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'
};
```

**内置规则**：

- 闰年：`(year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)`
- 大小月：1/3/5/7/8/10/12 月 31 天，4/6/9/11 月 30 天，2 月平年 28、闰年 29
- **yearZeroMode 强制 `noZero`**（无公元0年，对齐真实公历）

**Format Token**：

- 主单位：`{year}` `{month}` `{day}` `{hour}` `{minute}` `{second}` `{hour:02}` `{minute:02}` `{second:02}`
- Era：`{eraName}`

**性能**：instant ↔ parts 需要逐年遍历（闰年动态），复杂度 O(year)。

---

## 7. Custom Calendar 配置示例

```typescript
// project/world-engine/calendar.ts
export default {
  type: 'custom',
  format(instant: bigint): string {
    const year = Number(instant / 31536000n) + 1;
    const rest = instant % 31536000n;
    const day = Number(rest / 86400n) + 1;
    return `自定义历${year}年第${day}日`;
  },
  parse(input: string): bigint {
    const match = /自定义历(\d+)年第(\d+)日/.exec(input);
    if (!match) throw new Error('格式错误');
    const year = BigInt(match[1]) - 1n;
    const day = BigInt(match[2]) - 1n;
    return year * 31536000n + day * 86400n;
  },
  projection() {
    return {
      format: '自定义历{year}年第{day}日',
      examples: ['自定义历1年第1日', '自定义历488年第200日']
    };
  }
};
```

**契约**：

- `format(instant: bigint): string` 必须返回字符串
- `parse(input: string): bigint` 必须返回 bigint
- `projection(): {format: string; examples: string[]}` 可选，用于 schema 投影

---

## 8. Agent / HTTP 时间边界

**公开入参只接受项目日历字符串**：

- HTTP API 只接受当前项目 Calendar 能 parse 的人读字符串；Agent 的 `execute_world` 沙箱内使用 instant bigint，并通过 `world.time.parse()` / `world.time.format()` 与项目日历字符串互转。
- **禁止 raw instant 格式**：公开入参拒绝 `instant:<number>`（底层 parse 仍兼容，仅供直调测试）。
- **禁止首尾空白**：公开时间字符串带首尾空白返回 400（底层 parse 仍 trim）。

简言之：在工具/HTTP 层，时间永远是"项目日历字符串"，instant 是引擎内部实现细节。

---

## 9. 完整示例：四月历法

```typescript
// project/world-engine/calendar.ts
export default {
  type: 'simple',
  eraBefore: '旧纪元',
  eraAfter: '新纪元',
  baseUnit: 'second',
  units: [
    { name: 'minute', parent: 'second', ratio: 60 },
    { name: 'hour', parent: 'minute', ratio: 60 },
    { name: 'day', parent: 'hour', ratio: 24 },
    { name: 'week', parent: 'day', ratio: 7,
      cycleNames: ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜'] },
    { name: 'month', parent: 'day', ratio: 90 },
    { name: 'year', parent: 'month', ratio: 4 }
  ],
  format: '{eraName}{year}年{month}月{day}日 {week}'
};
```

**效果**：

- instant=0 → "新纪元1年1月1日 月曜"
- 一年 4 个月，每月 90 天，一天 24 小时
- 支持 week token（`{week}` 输出 cycleNames）
- `month` 使用数字月份；若要输出少量月份名，不要给 `ratio: 90` 配 4 个 `cycleNames`，应改用 Custom Calendar。

---

## 相关文档

- [README.md](README.md)：World Engine reference 书架入口
- [subject-lifecycle.md](subject-lifecycle.md)：subject 注册、切面演化、reduce、查询契约
- [workflow.md](workflow.md)：写作模式整体工作流与时间透明原则
- [`.agents/tasks/65-world-engine-calendar-enhancement/design-v2.md`](../../../.agents/tasks/65-world-engine-calendar-enhancement/design-v2.md)：Calendar 系统重构设计文档
