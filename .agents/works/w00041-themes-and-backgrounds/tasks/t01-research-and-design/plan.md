# w00041 实施计划：插件提供的主题皮肤

## Context

- **为什么做**：开发者 2026-11-05 体验第一版背景图片（w00025 t19）后要求重做：要整套换皮肤，不是贴一张图，也不是靠半透明磨砂。
- **依据**：[DSH 社区皮肤的做法](../../../../../docs/research/dsh-community-skins.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)。
- **开发者已定**：见 [Task README](README.md) 决定 1–8。皮肤由插件提供，皮肤系统属于 `nbook.workbench`；主题与皮肤是一个列表；空状态放完整场景，写作时正文两侧露场景、正文底下干净；首套样例是“书房”。
- **更正**：之前说“选皮肤时配色项收起”，核对后产品里根本没有配色设置：只有主题与明暗两项，配色取主题的 `defaultColorway`（`src/ui/theme/product-themes.ts`）。所以不用收起，也不用动“主题与配色正交”这条 nb-ui 的规则：固定配色只是这套皮肤给的缺省。
- **工作方式**：一个 worktree，从 master 拉。Spec 与记录在主工作区。不写透明度与模糊，没有遮罩。

## 关键设计

### 1. 贡献点 `workbench.themes`（`plugins/workbench/shared/themes.ts`）

顶层声明式（`implementation: "none"`），所以不写代码的插件也能提供，不用激活插件就能读到。贡献 id 以插件 id 为前缀。声明的结构用 TypeBox 写，内核按它校验，不合格的贡献不接受并记诊断：

```ts
type ThemeDeclaration = {
    title: Text;
    base: "nbook" | "macos";                 // nb-ui 主题包：形状、密度、动效
    colors?: {light: ColorVars; dark: ColorVars};   // 没有就用 base 的缺省配色
    vars?: Record<RoleVar, string>;          // 只收白名单里的变量，取值不能有 url()
    fonts?: {display?: string; prose?: string};     // 字体栈，不内嵌字体
    activityBar?: {surface: Both; foreground: Both; active: Both; ornament?: Both};
    scene?: {
        empty?: {light: Asset; dark: Asset; position?: string; contentX?: number};
        margins?: {light: {left?: Asset; right?: Asset}; dark: {left?: Asset; right?: Asset}};
        sidebarCorner?: {light: Asset; dark: Asset};
    };
};
```

- `Asset` 是插件目录内的相对路径，经现有插件文件端点取；内置插件在构建里给 URL。不接受远程地址。
- `nbook`、`macos` 也改成这个贡献，只有 `title` 与 `base`，没有特殊路径。
- 不做：图标集、菜单与设置窗口的画框、按状态换场景、由代码提供的场景。以后加字段或加一种要实现的贡献，不推翻这份。

### 2. 选择（`themeSetting`）

- schema 从字面量联合改成字符串，选项经 `settings.choices` 从贡献点取；`switch-theme` 命令同样读贡献点。
- 设置里的 id 找不到（插件被禁用、卸载）时显示缺省主题，设置不改写，插件回来后恢复；记一条诊断。

### 3. 怎么生效（`WorkbenchDocument.vue`、`src/ui/theme/`）

`productTheme` 按贡献算出文档根要写的东西：`data-nb-theme` 取 `base`，配色变量、`vars`、活动栏与字体写成变量，场景写成 `--skin-scene-*: url(...)`，有场景时根上标 `data-nb-skin-scene`。页面卸载时一并去掉。`nb-ui` 不改：它仍只认主题包与变量。

`prefers-contrast: more`、`forced-colors: active` 下不写场景变量。

### 4. 各位置由谁画

都只读变量，变量没有时和现在一模一样。

| 位置 | 组件 | 规则 |
|---|---|---|
| 空状态 | `editor` 的 `EditorGroup`（没开文件、欢迎页） | 铺满内容区，内容按 `contentX` 落在留白上 |
| 正文两侧 | `markdown` 的 `MarkdownControl` | 工具栏以下、正文列两侧，往正文淡出；一侧不足 120px 时不画；源码编辑器、图片查看器不画 |
| 侧栏下角 | `workbench` 的侧栏 | 往上淡出，不接收指针，内容长时盖在它上面 |
| 活动栏 | `WorkbenchActivityBar` | 读活动栏变量，装饰是首尾两条 |

### 5. “书房”（`plugins/theme-study/`）

内置插件，只有声明与素材，不写入口。缺省主题仍是 NeuroBook。素材定稿前用现在的草稿。

### 6. 第三方路径

`plugin-sdk/examples/plugins/` 加一个不写代码的主题示例，验收装上就能选、禁用退回缺省、启用恢复。`packages/nb-ui/docs/authoring-themes.md` 里“插件尚未开放”改掉，写主题插件的说明放 SDK 文档。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/theme/system.md` | 贡献点、声明、选择与退回、文档根写什么、无障碍偏好、各位置规则 |
| `docs/specs/settings/settings-window.md` | 主题项的选项来自贡献点 |
| `packages/nb-ui/docs/authoring-themes.md` | nb-ui 主题包与插件主题的分工 |

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S0 | Spec | `docs:check`、`governance:check` |
| S1 | 贡献点与声明校验；`nbook`、`macos` 迁入；产品外观不变 | 合同测试；现有主题 e2e 原样通过 |
| S2 | 动态选项、退回、命令 | 合同测试、`settings.e2e.ts` |
| S3 | 文档根的写入与四个位置 | e2e；真实工作台截图交开发者看 |
| S4 | 书房插件 | e2e：对比度 |
| S5 | 不写代码的示例插件与第三方路径 | e2e：装、选、禁用、恢复；首屏不闪 |
| S6 | 收口：实现审查、`test:affected`、Spec 晋升 | |

## 验证

- **对比度**：沿用第一版的量法（藏字截图逐像素算，有正向对照；提交 `a9ec4f147` 的 `e2e/backgrounds.e2e.ts`）：书房亮暗的欢迎页文字、活动栏、侧栏、正文。
- **无障碍偏好**：两个媒体特性都模拟，不画场景。
- **窄窗口**：390px 不溢出，两侧与侧栏下角不画；拆分后每组各自判断。
- **未验证**：第三方主题的对比度不做运行时检查，由作者负责。

## 不做与风险

- 不做：书架页、设置窗口的场景（只跟配色）；按作品的单独皮肤以外的新层（主题设置现有的两层不变）。
- 风险：第三方主题的声明要等插件登记才有，首屏可能先画缺省主题再切；S5 实测，不够就让宿主提前拿到目录。
- 风险：`vars` 白名单定小了皮肤做不出来，定大了以后改名会破坏第三方；从书房实际用到的开始。
- 风险：图片体积。每张限 300 KB，超了拒绝加载并记诊断。

## 开发者已确认（2026-11-05）

1. 正文两侧从工具栏以下开始，不改布局；S3 截真实界面给开发者看。
2. 书架页与设置窗口只跟配色，不放场景。
3. 书房内置但不设缺省；素材定稿另定。
