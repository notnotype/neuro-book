---
标签: []
---

# NovelIdeActivityBar

主页面左侧的**产品活动栏**，是通用 `WorkbenchActivityBar` 的产品适配器：上半是**主侧栏容器的单选**（由页面按生效落位求值后传入），下半是 `createWorkbenchActivityItems` 给出的非容器命令（工具组 + 账户 / 设置），图标表、译文表与 `NovelIdeAccountMenu` 都在这一层适配。

它**不新增也不删除任何产品入口**：`open-home` / `open-container` / `open-plot-workbench` / `open-world-engine` / `open-trace-viewer` / `open-history-inbox` / `open-settings` / `open-profile` / `open-admin` / `logout` 与接入前的真实命令一一对应（`open-tab` / `toggle-agent-panel` 是已退役的旧入口：工具视图归主侧栏容器，Agent 面板有自己的入口）。测量、溢出、卡片材质、每项 40px / 步距 44px 都在通用组件里，这一层只做取数与路由。

## 依赖与可挂载性

- 可挂载：靠纯 props 与**假 `AuthUserDto`** 即可渲染；Lab 场景见 `app/component-lab/fixtures/NovelIdeActivityBarFixture.vue`（`default` / `disabled` / `account`），全部交互只进 Lab 事件面板，fixture 不发任何产品请求、不读写产品存储。
- 依赖而非自持：译文来自产品 i18n 目录（`ide.header.*` / `ide.toolPanel.*` / `ide.activityBar.*` / `settings.title`），图标是 UnoCSS 的 lucide 类名；组件本身不读 store、不读 storage、不发请求。
- 账户格整项走通用组件的 `item-account` 插槽，渲染 `NovelIdeAccountMenu`（个人中心 / 管理员后台 / 本地退出）；没有登录态时它显示占位首字母。
- 这一层仍依赖 Nuxt 自动导入（`useI18n`），所以组件测试里要补 `useI18n` 桩。

## 数据与接口

```ts
type Props = {
    containers: readonly WorkbenchActivityContainer[];   // {containerId, title, icon}：标题与图标已由页面解析
    activeContainerId: string | null;
    desktopAvailable: boolean;
    surfaceActive: boolean;
    userAssetsMode: boolean;
    currentUser: AuthUserDto | null;
};

type Emits = {
    (e: "open-home"): void;
    (e: "open-container", containerId: string): void;
    (e: "open-world-engine"): void;
    (e: "open-trace-viewer"): void;
    (e: "open-history-inbox"): void;
    (e: "open-plot-workbench"): void;
    (e: "open-settings"): void;
    (e: "open-profile"): void;
    (e: "open-admin"): void;
    (e: "logout"): void;
};
```

## 与能力表的对应

- `primary` ← `containers`（主侧栏当前生效的容器；条目 id 就是 containerId，`active` 只跟 `activeContainerId`）。
- `secondary` ← `createWorkbenchActivityItems().tools`（`home` / `plot` / `world` / `trace` / `history`，放不下从尾部进 More）。
- `footer` ← `createWorkbenchActivityItems().footer`（`account` / `settings`）；`account` 由插槽替换成账户菜单，`settings` 仍走默认图标按钮。
- 容器条目点击回传 `open-container`；**重复点击当前项**的语义（保持选择并显式打开被隐藏 / 拖收起的主侧栏）归页面命令，组件不切成 null。
- 禁用理由统一取 `ide.activityBar.needOpenProject`，由通用组件拼进 tooltip 与 `aria-label`；容器条目不参与这套门禁（选择只改可见性偏好，不因书架态被禁）。

## 注意事项

- 账户菜单浮层的位置参数（`root-class` / `menu-class`）是产品口径，仍写在这一层；通用组件不知道账户的存在。
- 书架态（`surfaceActive: false`）下工具入口在但不可用，这是给"还没打开 Project"看的；不要在这里再补一套禁用逻辑，能力表已经给出。
- 活动栏的宽度与四周留白由外壳（`layout.ts` 的 activity 叶）决定，组件与 `.workbench-activity-bar` 卡片都不写宽度。
