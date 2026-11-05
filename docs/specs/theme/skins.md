---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: theme.skins
owners:
  - nbook.workbench
  - nbook.editor
  - nbook.markdown
---

# 主题皮肤

## 目标与非目标

**目标**：插件能提供一整套外观：配色、字体、活动栏、一张场景图在各位置的裁切。写作者在一个“主题”列表里选，选了之后界面整体换一个样子。场景放在内容区的留白处，正文底下始终是干净的面。

**不承诺**：

- 半透明与磨砂：场景不压暗、不磨砂，文字不叠在半透明面上。
- 图标集、菜单与设置窗口的画框、按状态换场景、由代码提供的场景。
- 书架页与设置窗口的场景：它们只跟配色。
- 第三方主题的对比度：不做运行时检查，由作者负责。
- 运行期热插拔：插件禁用、启用要重启后生效（[`runtime.plugin-hot-plug`](../runtime/plugin-hot-plug.md)）。

## 术语与参与者

- **主题**：`workbench.themes` 的一条贡献。`nbook`、`macos` 也是主题，只是没有场景。
- **主题包**：nb-ui 的形状、密度与动效（[`theme.system`](system.md)）。一条主题经 `base` 选一个。
- **场景图**：每个明暗一张，各位置裁它的不同部分。
- 参与者：`nbook.workbench`（贡献点、选择、写文档根、活动栏、侧栏下角）、`nbook.editor`（空状态）、`nbook.markdown`（正文两侧与正文字体）、提供主题的插件。

## 输入与前置条件

贡献点 `workbench.themes`，拥有者 `nbook.workbench`，顶层声明式，不需要实现，不写入口的插件也能贡献：

```ts
type ThemeDeclaration = {
    title: Text;
    base: "nbook" | "macos";
    fonts?: {display?: string; prose?: string};    // 系统字体栈
    crop?: {
        empty?: {position?: string; contentX?: number};   // contentX：内容中心在内容区宽度的比例，0–1，缺省 0.5
        marginLeft?: {size: string; position: string};    // CSS background-size、background-position
        marginRight?: {size: string; position: string};
        sidebarCorner?: {size: string; position: string};
    };
    light: Look;
    dark: Look;
};
type Look = {
    colors?: Partial<ColorVars>;                   // 配色变量；缺的取 base 的缺省配色
    vars?: Partial<Record<RoleVar, string>>;       // 只收主题角色变量里的白名单
    activityBar?: {surface: string; foreground: string; active: string; ornament?: string};
    scene?: string;                                // 插件目录内的相对路径
};
```

规则：

- 贡献 id：无点的 id 只有 `nbook.workbench` 能用（`nbook`、`macos`）；其余以 `<插件 id>.` 开头。
- 取值不能含 `url(`；`scene` 不能是绝对路径、带方案的地址，也不能有 `..`。
- 不合规则的贡献不接受，记诊断，其它主题照常（[`runtime.plugin-manifest`](../runtime/plugin-manifest.md)）。

配置项 `nbook.workbench/theme` 是主题 id，缺省 `nbook`，用户层与项目层都允许。

## 输出与可观察行为

1. **一个列表**：设置窗口的“主题”项与命令 `nbook.settings.switch-theme` 列出全部已接受的主题，标题取声明的 `title`。
2. **选了什么就写什么**：文档根的 `data-nb-theme` 是 `base`；配色变量是 `colors` 盖在 `base` 缺省配色上的结果，没有未定义的配色变量；`vars`、活动栏、字体、场景都写成变量。换主题时上一套写下的全部清掉。
3. **明暗**：`Look` 按解析后的明暗取，`system` 跟随系统。
4. **空状态**：编辑组没开文件，或活动页面声明了 `scene`（欢迎页），内容区铺场景图，裁切取 `crop.empty`，内容中心按 `contentX` 偏到留白上。别的页面标签不铺。
5. **正文两侧**：Markdown 编辑器的正文列两侧露出场景图，裁切取 `crop.marginLeft`、`crop.marginRight`，往正文方向淡出，从工具栏以下开始，不随正文滚动。一侧不足 120px 时那一侧不画。拆分后每组各自判断。源码编辑器、图片查看器不画。
6. **侧栏下角**：`sidebar` 这个 Part 的下角露出场景图，裁切取 `crop.sidebarCorner`，往上淡出，不接收指针，列表长时盖在它上面。高度不足 300px 时不画。别的 Part 不画。
7. **活动栏**：面、前景色与当前项的颜色取 `activityBar`，有 `ornament` 时首尾各画一条。
8. **字体**：欢迎页标题用 `fonts.display`，Markdown 正文用 `fonts.prose`，没有时用现有字体。
9. **无障碍偏好**：`prefers-contrast: more`、`forced-colors: active` 下不画场景；配色与活动栏照旧。
10. **没写的位置和没有主题时一样**：`nbook`、`macos` 的外观不因本能力改变。
11. **内置的“书房”**：随产品提供，不是缺省。

## 状态与转换

显示由“设置 × 明暗 × 已接受的主题 × 无障碍偏好”算出，不另存状态。图片加载好之前只有配色，加载好后显示。

主题写在文档根，只在工作台页面挂载期间生效（[`theme.system`](system.md)）；Lab 不受影响。

## 副作用与数据

配置里只存主题 id。场景图是插件的文件，经[插件文件端点](../runtime/plugin-code-loading.md)取；内置插件的随前端构建。

## 失败与恢复

| 情形 | 结果 |
|---|---|
| 设置里的 id 不是已接受的主题（插件禁用、卸载，或设置文件写错） | 项目层的值退到用户层，再退到缺省；设置不改写，插件回来后恢复；同一 id 记一条诊断 |
| 命令传的 id 不是已接受的主题 | `invalid-args`，设置不变 |
| 场景图不见或解码失败 | 那一位置没有图，配色照旧 |

## 边界与兼容

- 公开接口：贡献点与声明，只追加字段；配置值 `nbook`、`macos` 不变。
- 信任边界：声明只有数据，素材只取插件自己目录里的文件。插件的样式表能写任何选择器，这里只承诺上面的位置，别的选择器不保证升级后还能用。
- 单张场景图建议 300 KB 以内，是作者建议，不是限制。

## 验收与 Smoke

1. Given 不符合规则的贡献（裸 id、前缀不对、重复 id、`vars` 不在白名单、取值含 `url(`、`scene` 是远程地址或越出目录）；Then 不接受并记诊断，其它主题照常。
2. Given 设置值 `nbook`、`macos`；Then 文档根的取值和没有本能力时逐项相同。
3. Given 只写了部分配色的主题；Then 配色变量没有未定义的，缺的取 `base`。
4. Given 书房；When 打开作品；Then 没开文件与欢迎页有场景，设置类页面没有；欢迎页文字、活动栏、侧栏、正文的对比度不低于 4.5。
5. Given 书房与 Markdown 文件；When 正文滚动；Then 两侧不动；When 窗口窄到一侧不足 120px；Then 不画；When 拆分；Then 每组各自判断；When 切到源码编辑器；Then 不画。
6. Given 书房；When 模拟高对比度或强制颜色；Then 没有场景。
7. Given 书房；When 切回 NeuroBook；Then 文档根没有残留的变量；Lab 始终不受影响。
8. Given 项目层写了不存在的 id、用户层是书房；Then 显示书房；用户层也不存在时显示 NeuroBook；设置都不改写。
9. Given 命令 `switch-theme` 传不存在的 id；Then `invalid-args`。
10. Given 一个不写代码的主题插件；When 安装并重启；Then 列表里有它，选了生效；When 禁用并重启；Then 退回且设置不变；When 启用并重启；Then 恢复。

Smoke：`e2e/themes.e2e.ts`。

## 证据

- 批准依据：开发者 2026-11-05 的决定，记在主工作区 master 的 `.agents/works/w00041-themes-and-backgrounds/tasks/t01-research-and-design/README.md`。
