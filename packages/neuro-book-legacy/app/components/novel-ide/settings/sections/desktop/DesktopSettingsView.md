---
标签: [state:local]
---

# DesktopSettingsView

「桌面应用」区段的受控视图：设备说明（连接方式与版本）、界面缩放、系统托盘、关闭窗口行为。视图只消费 props 并把改动通过 `update:settings` 交回宿主，自己不探测桌面环境——`window.neuroBookDesktop` 的探测、拉取时机与失败提示都是宿主策略（Desktop Envelope 里真值在 Desktop Bridge，网页宿主下整段不渲染）。宿主 `NovelIdeSettingsDialog.vue` 持有 `desktopSettings` / `desktopStatus` / `desktopSaving` / `desktopSaveError`，并由 `updateDesktopSettings` 调 `bridge.updateSettings` 后就地覆盖设置。

缩放滑杆拖动中不写回，松手（`change`）才 emit：桌面设置经桥落到本机文件，不适合按像素写。`<output>` 上的百分比由 props 推导，因此也随宿主回填更新。

Component Lab 中由 `DesktopSettingsViewFixture` 提供确定性场景（default / remote-zoom-max / error）。

## 契约

```ts
type Props = {
    settings: DesktopSettings;        // schema, zoomFactor, trayEnabled, closeBehavior
    status?: DesktopStatus | null;    // 只渲染 connection 与 version；null 表示非桌面宿主
    saving?: boolean;
    saveError?: string;
};

type Emits = {
    (event: "update:settings", patch: DesktopSettingsPatch): void;   // {zoomFactor?} | {trayEnabled?} | {closeBehavior?}
};
```

`status` 为 `null` 时只省略「本地服务 / 远端服务 · 版本」那一行，其余照常渲染：是否渲染整个区段由宿主决定（宿主用 `desktopAvailable` 判断），视图不再做第二次可用性判断。缩放值不在这里夹紧——`updateSettings` 的契约由 `patchDesktopSettings` 校验，越界直接失败。

## 布局规则

与设置外壳同源：不画卡片面，说明块、缩放、托盘、关闭行为之间用 1px `--divider` 横线分段。滑杆占满整行，百分比贴在标题右侧；关闭行为下拉限宽（`max-width: 280px`），不跟着内容区拉满。`saving` 与 `saveError` 各占一行且不吞掉当前值。视图依托 `container-type: inline-size` 供未来的窄容器规则使用，自身不滚动（宿主负责滚动）。
