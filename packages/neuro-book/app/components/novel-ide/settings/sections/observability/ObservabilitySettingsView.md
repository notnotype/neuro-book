---
标签: [state:local]
---

# ObservabilitySettingsView

「可观测 · Pi 请求记录」区段的受控视图：一个总开关 + 每会话保留条数，外加隐私说明。它只消费宿主给的 `enabled` / `maxRecords`，任何修改立刻通过 `update:enabled` / `update:maxRecords` 交回宿主，不读 store、不调 API、不写持久化；旧面板 `NovelIdeObservabilitySettingsPanel` 继续负责快照读写与 `saveGlobal`，等产品接线时再消费本视图。

Component Lab 中由 `ObservabilitySettingsViewFixture` 提供确定性场景（default / disabled / boundary）。fixture 就地接受修改并写入数据面板，不落任何持久层。

## 契约

```ts
type Props = {
    enabled: boolean;
    maxRecords: number;      // 0 表示不裁剪
    disabled?: boolean;
};

type Emits = {
    (event: "update:enabled", value: boolean): void;
    (event: "update:maxRecords", value: number): void;
};
```

保留条数走 `FormInput`（`type="number"`）：合法输入立刻写回并夹到 `0..10000` 的整数；空串与非数字不写回——清空输入框的过程不该把 0 落进配置。

## 布局规则

与设置外壳同源：不画卡片面，标题、开关、条数、隐私说明之间用同款 1px `--divider` 横线分段；开关整行可就点；数字输入收窄到 220px，不随窗口拉伸。视图自身不滚动（宿主负责滚动），内容列宽度由宿主的 `max-w-3xl` 决定。保存失败走系统通知，视图不内联保存状态。
