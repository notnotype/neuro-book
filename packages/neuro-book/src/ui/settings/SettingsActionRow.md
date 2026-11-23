---
标签: []
别名: ["设置动作行", "Settings Action Row"]
---

# SettingsActionRow

设置页里一个“动作”的一行：左边标题与说明，右边一个按钮（“测试代理”“现在更新”），行下是这个动作的状态（进行中、结果、失败的原因）。它不对应任何配置项，所以没有已修改、恢复默认与层的规则；版式与 [`SettingsRow`](SettingsRow.md) 一致，和配置项的行排在同一组里时控件右缘对齐。网络页（`plugins/network/web/components/NetworkPage.vue`）的两个动作用它。

## 布局

同 `SettingsRow` 的缺省排法：可换行的弹性布局，标题与说明在左（最小宽 200px），动作靠右；放不下时动作换到标题下面，仍靠右。动作右边留 24px 一格（`SettingsRow` 放“恢复默认”的那一格），各行右缘对齐。标题 20px、说明 18px 的整数行高同 `SettingsRow`。

状态在整行下面另起一行，小字号、任意处折行；有状态时这一行按高度展开（`--motion-move`、`--ease-layout`），没有时收起，换内容时淡入淡出（`--motion-fast`）；色调由 `tone` 定：`info` 信息色、`success` 成功色、`danger` 危险色、`muted` 淡色，各带一个图标（`info` 与 `muted` 是圆圈 i，`success` 是勾，`danger` 是感叹号）。没有状态时这一行不占高度。

## 交互

- 动作由调用方放进插槽（通常是 nb-ui 的 `Button`），点击、停用、进行中的文字都由调用方管。
- 状态区常驻（`role="status"`，`aria-live="polite"`）：内容变了读屏会播；没有状态时它是空的，不显示。不要把动作按钮放进状态区。

文字选择：标题、说明与状态可选（可复制去搜，同 `SettingsRow`）。

## 数据

```ts
type Props = {
    /** 标题（已翻好的文字）。必填。 */
    title: string;
    /** 说明；缺省没有。 */
    description?: string | null;
    /** 行下状态的文字；空串或 null 时没有状态。缺省 null。 */
    status?: string | null;
    /** 状态的色调；缺省 "info"。 */
    tone?: "info" | "success" | "danger" | "muted";
};

type Slots = {
    /**
     * 动作。`describedby` 是标题、说明与状态区的 id，接进按钮的 `aria-describedby`：按钮的名字仍是它自己的文字（“测试”“取消”），
     * 不用 `<label for>`（它会盖掉按钮的文字，进行中换成“取消”时读屏仍念标题）。
     */
    default(props: {describedby: string}): unknown;
};
```

没有 emits 与 expose；attrs 落在根上。根带 `data-settings-action-row`；状态区带 `data-settings-action-status`，有状态时另带 `data-tone`。

## 状态

- 空闲：没有状态。
- 有状态：行下一行，见“布局”。
- 加载、空数据、停用：没有，由调用方的按钮表达。

## 不支持

- 配置项的规则（已修改、恢复默认、本作品沿用）：那是 `SettingsRow`。
- 多个动作：一行一个；要并排两个按钮时放进同一个插槽。

## 隐藏通道理由

无。
