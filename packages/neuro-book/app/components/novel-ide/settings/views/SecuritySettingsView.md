---
标签: [state:local]
---

# SecuritySettingsView

「密码保护」区段的只读视图：启动期鉴权说明、`auth.enabled` 当前状态徽标、`config.yaml` 配置示例与安全警告。视图只消费一个 prop（`authEnabled`），没有任何 emit，也不提供保存入口——安全边界由根目录 `config.yaml` 与重启决定，不能在配置中心热更新，所以这页只解释、不写回。旧宿主 `NovelIdeSettingsDialog` 继续从 `useAuthSessionState()` 取 `session.authEnabled`，产品接线时再消费本视图。

三态文案与色调：已开启（`success` 软底）、已关闭（`warning` 软底）、尚未读到 session（`neutral` 软底）。示例 YAML 里的值随状态同步；状态未知时写 `<true|false>` 占位，不假装知道磁盘上的值。

Component Lab 中由 `SecuritySettingsViewFixture` 提供确定性场景（enabled / disabled / unknown）。

## 契约

```ts
type Props = {
    authEnabled: boolean | null;   // null = 尚未读到 session
};

type Emits = Record<string, never>;
```

## 布局规则

与设置外壳同源：不画卡片面，说明块与状态/示例块之间用 1px `--divider` 横线分段。状态徽标贴在该行右侧；示例 YAML 用等宽 `<pre>`，横向可滚动，长行不撑破内容列；警告行用 `--status-warning` 文字色，不加底色。视图自身不滚动（宿主负责滚动）。
