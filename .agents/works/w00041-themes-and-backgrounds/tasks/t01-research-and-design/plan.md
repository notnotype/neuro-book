# w00041 实施计划：插件提供的主题皮肤

## Context

- **为什么做**：开发者 2026-11-05 体验第一版背景图片（w00025 t19）后要求重做：要整套换皮肤，不是贴一张图，也不是靠半透明磨砂。
- **依据**：[DSH 社区皮肤的做法](../../../../../docs/research/dsh-community-skins.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)。
- **开发者已定**：见 [Task README](README.md) 决定 1–10。皮肤由插件提供，皮肤系统属于 `nbook.workbench`；主题与皮肤是一个列表；空状态放完整场景，写作时正文两侧露场景、正文底下干净；首套样例是“书房”。
- **更正**：之前说“选皮肤时配色项收起”，核对后产品里根本没有配色设置：只有主题与明暗两项，配色取主题的 `defaultColorway`（`src/ui/theme/product-themes.ts`）。所以不用收起，也不用动“主题与配色正交”这条 nb-ui 的规则：固定配色只是这套皮肤给的缺省。
- **工作方式**：一个 worktree，从 master 拉。Spec 与记录在主工作区。不压暗、不磨砂，场景边缘用渐变淡出。

## 关键设计

设计审查（[报告](evidences/design-review.txt)、[处理](evidences/design-review-disposition.txt)）后重写。

### 1. 贡献点 `workbench.themes`（`plugins/workbench/shared/themes.ts`）

顶层声明式（`implementation: "none"`），定义放 shared，三个运行位置都带，否则服务端的插件页会标“未知贡献点”。声明用 TypeBox 写，整份“先明暗再键”，和静态稿一样每个明暗一张场景图，各位置给裁切：

```ts
type ThemeDeclaration = {
    title: Text;
    base: "nbook" | "macos";                       // nb-ui 主题包：形状、密度、动效
    fonts?: {display?: string; prose?: string};    // 系统字体栈，不内嵌字体
    crop?: {                                       // 同一张图在各位置怎么裁
        empty?: {position?: string; contentX?: number};   // contentX：内容中心在内容区宽度的比例，0–1，缺省 0.5
        marginLeft?: {size: string; position: string};
        marginRight?: {size: string; position: string};
        sidebarCorner?: {size: string; position: string};
    };
    light: Look;
    dark: Look;
};
type Look = {
    colors?: Partial<ColorVars>;                   // 33 个配色变量；缺的取 base 的缺省配色
    vars?: Partial<Record<RoleVar, string>>;       // 白名单：nbThemeTokens 的角色与装饰子集，从书房用到的开始；取值不能含 url()
    activityBar?: {surface: string; foreground: string; active: string; ornament?: string};
    scene?: string;                                // 插件目录内的相对路径，不接受远程地址
};
```

- **id**：不写 `idPrefix`，用贡献点的校验：无点的 id 只许 `nbook.workbench`，其余以 `<插件 id>.` 开头。所以 `nbook`、`macos` 继续用，设置值不用迁移。
- `nbook`、`macos` 也是这种贡献，只有 `title` 与 `base`。
- 目录用 receiver 收，顶层声明会补交给接收者，以后热插拔不用改。
- 不做：图标集、菜单与设置窗口的画框、按状态换场景、由代码提供的场景。以后加字段或加一种要实现的贡献，不推翻这份。

### 2. 素材怎么变成 URL

声明里只有相对路径，描述文件不 import 图片：服务端构建会把图片打进产物，URL 也和 Vite 的对不上（审查实测）。

- 新窗口能力 `windowPluginFilesKey`（`src/shared/host.ts`）：`fileUrl(pluginId, path): string | null`。第三方走现有 `pluginFileUrl`。
- 内置插件在 `src/web/plugins.ts` 登记解析表（`import.meta.glob` 取 URL），和那里登记消息目录是同一种做法。

### 3. 选择（`themeSetting`、`web/commands/theme-commands.ts`）

- schema 改字符串，`choices: {from: "nbook.workbench.themes"}`；工作台浏览器入口贡献提供者。控件因此从分段变下拉，相关断言跟着改；约定键 `settings.theme.choices.*` 去掉，标题用声明的 `title`；Lab 的设置场景补一个提供者。
- `switch-theme` 的参数不再列枚举，运行时按目录核对，不认识的 id 回 `invalid-args`；Agent 可见的说明同步。
- **退回**：解析后的值是目录里没有的 id 时，项目层退到用户层，再退到缺省，设置不改写，插件回来后恢复；诊断按 id 只记一次。

### 4. 怎么生效（`WorkbenchDocument.vue`、`src/ui/theme/`）

- `src/ui/theme/skin-vars.ts` 放变量名常量，写入方、各位置与 Spec 都引它。
- `productTheme(theme, appearance)` 收解析好的主题，不 import 工作台（`architecture.test.ts` 不许）：`data-nb-theme` 取 `base`，配色合并到 base 的缺省配色上，`vars`、活动栏、字体写成变量，场景写成 `--skin-scene: url(...)` 加各位置的裁切变量，有场景时根上标 `data-nb-skin-scene`。页面卸载时一并去掉。
- `nb-ui` 不改。

不压暗、不磨砂，场景边缘用渐变淡出。`prefers-contrast: more`、`forced-colors: active` 由各位置的 CSS `@media` 关掉。图片比颜色晚到，接受：颜色先对，图片加载好再显示。

### 5. 各位置由谁画

都只读变量，变量没有时和现在一模一样。

| 位置 | 组件 | 规则 |
|---|---|---|
| 空状态 | `editor` 的 `EditorGroup` | 没开文件，或活动页声明了 `scene`（`editor.pages` 的声明加这个可选字段，欢迎页写它，设置类页面不写）。铺满内容区；`contentX` 变成容器的内边距，页面不用改 |
| 正文两侧 | `markdown` 的 `MarkdownControl` | 放在控件根里、和滚动容器同级，所以不随正文滚；工具栏经传送放在外面，自然从工具栏以下开始；往正文淡出；一侧不足 120px 不画；源码编辑器、图片查看器不画 |
| 侧栏下角 | `sidebar` Part 的外壳 | 只这一个 Part，挂在外壳不挂视图；往上淡出，不接收指针；高度不足 300px 不画 |
| 活动栏 | `WorkbenchActivityBar` | 读活动栏变量，装饰是首尾两条 |
| 字体 | 欢迎页标题、`MarkdownControl` 正文 | 读 `--font-display`、`--font-prose`，缺省回落现有字体 |

### 6. “书房”（`plugins/theme-study/`）

内置插件，`locations: []`，只有声明；素材用草稿，解析表在 `src/web/plugins.ts`。缺省主题仍是 NeuroBook。

### 7. 第三方路径

`plugin-sdk/examples/plugins/` 加一个不写代码的主题示例，核实构建预设对零入口插件会带上素材目录。`packages/nb-ui/docs/authoring-themes.md` 里“插件尚未开放”改掉，写主题插件的说明放 SDK 文档；单张素材建议 300 KB 以内，写成建议，内置的用测试核对。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/theme/system.md` | 贡献点、声明、选择与退回、文档根写什么、无障碍偏好、各位置规则 |
| `docs/specs/settings/settings-window.md` | 主题项的选项来自贡献点 |
| `docs/specs/workbench/commands.md` | `switch-theme` 的参数 |
| `packages/nb-ui/docs/authoring-themes.md` | nb-ui 主题包与插件主题的分工 |

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S0 | Spec | `docs:check`、`governance:check` |
| S1 | 贡献点、校验、`nbook` 与 `macos` 迁入，文档根按解析后的主题写；产品外观不变 | 合同测试；现有主题 e2e 原样通过 |
| S2 | 动态选项、命令、退回 | 合同测试、`settings.e2e.ts` |
| S3 | 素材解析、书房插件、五个位置 | e2e；真实工作台截图交开发者看 |
| S4 | 不写代码的示例插件与第三方路径 | e2e：装、选、禁用后重启退回、启用后重启恢复 |
| S5 | 收口：实现审查、`test:affected`、Spec 晋升 | |

## 验收场景

| 场景 | 片 |
|---|---|
| 裸 id 只许工作台，第三方前缀不对、重复 id 被拒并记诊断 | S1 |
| `vars` 不在白名单、取值含 `url()`、`scene` 是远程地址或越出目录被拒 | S1 |
| 配色缺键取 base 的值，不留未定义变量 | S1 |
| 设置值 `nbook`、`macos` 不变，外观不变 | S1 |
| 选项列出全部主题；未知 id 退回（项目层→用户层→缺省）、设置不改写、诊断一次 | S2 |
| 命令切换；传未知 id 为 `invalid-args` | S2 |
| 服务端校验：设置文件写任意字符串不报错，由窗口退回 | S2 |
| 没开文件、欢迎页有场景；设置类页面没有 | S3 |
| 正文滚动时两侧不动；窄到一侧不足 120px 不画；拆分后每组各自判断；源码编辑器不画 | S3 |
| 高对比度、强制颜色下不画场景 | S3 |
| Lab 不受影响；切回 NeuroBook 后所有变量清掉 | S3 |
| 内置素材每张不超过 300 KB | S3 |
| 不写代码的插件：装上能选；禁用后重启退回；启用后重启恢复 | S4 |

## 验证

- **对比度**：沿用第一版的量法（藏字截图逐像素算，有正向对照；提交 `a9ec4f147` 的 `e2e/backgrounds.e2e.ts`）：书房亮暗的欢迎页文字、活动栏、侧栏、正文。
- **窄窗口**：390px 不溢出，两侧与侧栏下角不画。
- **未验证**：第三方主题的对比度不做运行时检查，由作者负责。运行期热插拔还没实现，禁用与启用都要重启才生效。

## 不做与风险

- 不做：书架页、设置窗口的场景（只跟配色）；按作品的单独皮肤以外的新层（主题设置现有的两层不变）。
- 风险：`vars` 白名单定小了皮肤做不出来，定大了以后改名会破坏第三方；从书房实际用到的开始。
- 风险：Part 的外壳与 `EditorGroup` 的背景可能被其它层盖住；S3 看真实界面。

## 开发者已确认（2026-11-05）

1. 正文两侧从工具栏以下开始，不改布局；S3 截真实界面给开发者看。
2. 书架页与设置窗口只跟配色，不放场景。
3. 书房内置但不设缺省；素材定稿另定。
