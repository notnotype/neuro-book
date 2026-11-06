# t06 计划：图标集、按状态换场景、由代码提供的场景

## Context

t06 原定四项扩展，画框已合入（决定 1 到 3，Spec 输出 13）。开发者 2026-11-06 说“剩下三点都用 autonomous-delivery 做完”，所以画框之后的三项一起做，不再等开发者先选。本计划按“照推荐做、事后追认”写：每项的外观与取舍记进 Work 的 `pending-confirmations.md`。

依据：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md)（`不承诺` 里列了这三项）、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[调研 dsh 社区主题](../../../../../docs/research/dsh-community-skins.md)（orca-link 的图标重绘与“按状态换内容”是这三项的来源，调研只是资料）。

约束：

- 贡献点定义只追加字段，不改已有字段（Spec 边界与兼容）。
- 声明里不出现 `url()`；素材只取插件自己目录里的文件。
- `prefers-contrast: more`、`forced-colors: active` 下，场景不画，图标集不换（保持系统默认图标，保证辨识度）。
- 没有写这些字段的主题（NeuroBook、macOS、护眼、书房现状）外观不变。
- 书房的第二张场景要等 t05 的素材定稿（需要收费出图，由开发者定内容和张数），本计划不生成图片；书房先不写 `workingScene`，用示例插件与测试里的主题验证。

## 关键设计

### 一、`Look.icons`：图标集（`workbench/shared/themes.ts`、`ui/theme/document-theme.ts`）

```ts
type Look = {
    …;
    icons?: Record<string, string>;   // 键：图标名（`i-lucide-<name>` 的 <name>）；值：插件目录内的 .svg 相对路径
};
```

- 形状：产品里的图标全是 `i-lucide-*` 类，nb-ui 的垫片（`packages/nb-ui/src/tailwind.css` 的 `[class*="i-lucide-"]`）用 `mask-image: var(--svg)` 画，每个图标类自己带一条只写 `--svg` 的规则。换图标 = 在无层级的样式表里重写某个类的 `--svg`（无层级规则压过 `@layer` 里的规则）。不改 nb-ui，不改任何使用图标的组件。
- 写入：`createDocumentThemeWriter` 在 `DocumentTheme` 上收可选的 `icons: Readonly<Record<string, string>>`（图标名 → 已解析的 URL），写成 `<head>` 里一个 `style[data-nb-skin-icons]`，内容是 `.i-lucide-<name>{--svg:url("<url>")}` 逐条；`clear()` 与换成没有 `icons` 的主题时删掉它。图标名只收 `[a-z0-9-]+`，URL 由工作台自己解析出来（同 `scene`），拼进样式表前对 `"` 与 `\` 转义。
- 校验（`lookProblem`）：键匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`，值与 `scene` 同样是相对路径、不带方案、不能 `..`，并且以 `.svg` 结尾；一条 Look 最多 64 个。`declarationProblem` 里 `icons` 的值和 `scene` 一样不进“不能含 url()”的扫描（它们是路径，不是 CSS）。
- 不接受 `.svg` 以外的格式：SVG 经 CSS `mask-image` 加载，浏览器不会执行里面的脚本，也不会再加载它引用的外部资源。
- 范围：只换工作台自己用的 lucide 图标；文件类型图标（catppuccin）、用户内容里的图片不动。
- 书房：带一套 8 个左右的活动栏与常用图标（自己手写的 SVG，原创，不是生成的），亮暗共用同一套（图标是 `currentColor` 的蒙版，随前景色变）。`Look` 里两边都写 `icons`；声明上不加“共用”写法。

### 二、`Look.workingScene`：按状态换场景（`workbench/shared/themes.ts`、`workbench/web/themes.ts`、`workbench/web/plugin.ts`）

```ts
type Look = {…; workingScene?: string};   // 插件目录内的相对路径
```

- 状态只有两个：**空闲**与**工作中**。“工作中”= 公开状态 `nbook.agent/active` 为真（有 Agent 会话在运行或等用户处理，状态栏“Agent：1 运行中”的同一个信号，`agent/web/plugin.ts` 已发布）。不新增状态，不取各会话的细状态。
- 工作台经已依赖的 `publicStateKey` 读 `nbook.agent/active`；该键没有注册（`agent` 插件被禁用）或没有绑定时按“空闲”。
- 取图：`ThemeCatalog.resolve(id, appearance, working)` 多一个参数；工作中且这一明暗写了 `workingScene` 时 `--skin-scene` 用它，否则用 `scene`。裁切不变（同一份 `crop`）；`data-nb-skin-scene` 的有无按取到的那张是否解析成功。切换不做交叉淡化（见下“不做”）。
- `workingScene` 的校验、路径规则与 `scene` 一致（共用 `lookProblem` 里的同一段）。
- 工作台的响应：`themes` 的写入点（`workbench/web/plugin.ts` 里算 `ProductTheme` 的 effect）读 `working`，状态变了重算并 `apply`；`apply` 里 `skin` 与明暗都没变，所以不会触发整页渐变（system.md 运行时流程第 6 条）。
- “我的主题”不收 `workingScene`（编辑器没有这一项，`userThemeProblem` 用同一份 Schema，所以 Schema 里它是可选的，但编辑器不产出）。

### 三、`ThemeDeclaration.sceneProvider`：由代码提供的场景（新贡献点 `workbench.theme-scenes`）

- 新贡献点 `workbench.theme-scenes`，拥有者 `nbook.workbench`，**有实现**（只在浏览器位置）：

  ```ts
  type SceneProviderDeclaration = {title: Text};
  type SceneProviderImplementation = {
      /** 返回这个明暗、这个状态下的场景图；Blob 必须是图片。可以被取消（signal）。 */
      scene(request: {appearance: "light" | "dark"; working: boolean}, signal: AbortSignal): Promise<Blob>;
  };
  ```

- `ThemeDeclaration` 追加可选的 `sceneProvider: string`（贡献 id，要以提供它的插件 id 开头，不要求与主题同插件）。有它的主题，场景图由提供者画：`Look.scene` / `Look.workingScene` 都可以不写；写了的，提供者失败或还没画完时先用它们（“先静态后动态”）。
- 工作台在 `ThemeCatalog` 里为每个（主题 id、明暗、working）缓存一个结果：对象 URL（`URL.createObjectURL`），换掉时 `revokeObjectURL`；同一个键同一时刻只有一个请求在飞，新的请求取消旧的（`AbortSignal`）。提供者 reject、返回的 Blob 不是 `image/*`、或超过 4 MB 时：记一条诊断，那一位置按没有提供者处理。加载好之前只有配色（Spec 状态与转换，和现有的场景图加载一致）。
- 不改变“声明只有数据”的信任边界：提供者是插件代码，和任何插件代码一样拥有插件的全部能力；声明里仍然没有可执行内容。`sceneProvider` 只是个贡献 id。
- 提供者禁用或卸载后，引用它的主题退回 `Look.scene`（没有时没有场景），同一 id 记一条诊断；不影响主题的配色。
- “我的主题”不收 `sceneProvider`（用户层数据里放贡献 id 没有意义，提供者可能不在）：`userThemeProblem` 拒绝它。

### 四、书房作为示例主题（只动文档与示例，不动产品）

- 决定：书房**留在内置**，不搬到 SDK 示例里。理由：t04、t07 的 e2e 与欢迎页的行为依赖它随产品提供（Spec 输出 11），搬走要同时改“内置的书房”这条产品承诺。
- “示例”落成：`plugin-sdk/examples/README.md` 加“主题”一节，列三份可读的参考——最小的 `external/theme-dusk`（只有配色与场景）、完整的 `theme-study/plugin.ts`（字体、裁切、活动栏、画框、图标集）、带代码的场景提供者示例（见下）；`theme-study/plugin.ts` 开头的注释写明它既是产品内置也是完整参考，改字段要同步 Spec。
- 新的示例插件 `plugin-sdk/examples/plugins/scene-clock`（代码插件）：贡献一个 `workbench.theme-scenes` 提供者，画“按小时变的天空”（Canvas 渐变，原创，无素材），并贡献一个用它的主题；有场景测试核对贡献被工作台接受。讲解式注释，按 `plugin-sdk/examples/` 的写法。

## Spec 与文档改动

- `docs/specs/theme/skins.md`：`不承诺` 里去掉三项；输入的类型加 `icons`、`workingScene`、`sceneProvider`；规则里加校验；输出加：16 图标集、17 按状态换场景、18 由代码提供的场景；验收加 16 到 18；贡献点 `workbench.theme-scenes` 写进输入与实现合同；边界与兼容里写“追加字段”。
- `docs/specs/theme/system.md`：运行时流程里一条：`apply` 的 `icons`、状态变化不渐变。
- `docs/specs/theme/editor.md`：说明“我的主题”不收这三项（只有一句）。
- `plugin-sdk/examples/README.md`：上面第四节。
- 同名 `.md`：若改了组件则同步（预计不改组件）。

## 切片

1. **图标集**（关键设计一）：`themes.ts` 校验与 Schema、`document-theme.ts` 的 `icons` 与 `style` 元素、`themes.ts` 的 `themeVars` 同层产出 `icons`（`ProductTheme` 加 `icons?`）、工作台写入点、书房的 SVG 与声明。验证：`themes.test.ts`、`document-theme` 的 dom 测试、`themes.e2e.ts` 新用例（书房下活动栏的 `--svg` 已换；高对比度下不换；换回 NeuroBook 后恢复）。
2. **按状态换场景**（关键设计二）：Schema 与校验、`ThemeCatalog.resolve` 多参数、工作台读 `nbook.agent/active`、`theme-dusk` 示例补 `workingScene`（用已有素材做一份调暗的派生图，≤ 300 KB，PIL 脚本处理，不收费）。验证：`themes.test.ts`；`themes.e2e.ts` 新用例（装一个带 `workingScene` 的主题插件，让一个 Agent 会话进入运行态，`--skin-scene` 换了，结束后换回）。
3. **由代码提供的场景**（关键设计三）：新贡献点、`ThemeCatalog` 的提供者缓存、诊断、`scene-clock` 示例插件与场景测试。验证：`themes.test.ts`（目录层，用真实 Blob 与 happy-dom 的对象 URL）、示例的场景测试、外置示例构建测试（`external-examples.test.ts` 加 `scene-clock`）。浏览器端到端：用 e2e 的“装插件”机制装 `scene-clock` 构建产物，核对 `--skin-scene` 是 `blob:` 地址。
4. **文档与示例 README**、Task 收口。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `theme.skins` 输出 16、验收 16 | `themes.test.ts`（校验）、`document-theme` dom 测试（`style` 元素写入与清理）、`themes.e2e.ts` |
| 输出 17、验收 17 | `themes.test.ts`（`resolve` 的 working 取图）、`themes.e2e.ts`（Agent 运行态切换） |
| 输出 18、验收 18 | `themes.test.ts`（提供者成功、reject、非图片、超大、被取消、卸载后退回）、`scene-clock` 场景测试、`themes.e2e.ts` |
| 校验类（验收 1 的新增项） | `themes.test.ts`：`icons` 键名/路径/数量、`workingScene` 路径、`sceneProvider` 前缀、“我的主题”拒绝三项 |

## 验证

只跑受影响的：`bun test src/plugins/workbench`、`bun run test:vitest -- document-theme`、`themes.e2e.ts`、`theme-editor.e2e.ts`（确认“我的主题”没有被牵连）、`plugin-sdk` 的示例与外置构建测试、`typecheck`、`governance:check`、`docs:check`。未验证边界：真实 Agent 模型运行（e2e 用已有的测试会话进入运行态，不调真模型）；第三方提供者里写死循环的情形（提供者是插件代码，和别的插件代码一样，不防）。

## 不做与风险

- 不做交叉淡化：orca-link 有 640 毫秒的淡化，CSS 变量里的 `url()` 不能直接淡化，要做两层叠放，影响所有场景位置；以后要做另开 Task。
- 不做图标颜色/粗细之外的调整、不换文件类型图标、不做图标集的“整套替换”（只按名覆盖，没写的保持 lucide）。
- 不做“我的主题”里的三项编辑（编辑器的入口留给以后）。
- 不新增 Agent 的状态键；“工作中”只有一个二值信号。
- 风险：一，图标样式表以无层级规则压层级规则，依赖 nb-ui 垫片把 `--svg` 当唯一入口（`tailwind.css` 那段注释已写“预生成模式每条规则只输出 `--svg`”）；二，书房的图标是手写的，不是设计师稿，辨识度靠 e2e 之外的截图判断；三，对象 URL 的生命周期要跟随目录的替换。

## 待确认项（也记进 `pending-confirmations.md`）

1. 书房留在内置、只补文档与示例，不搬到 SDK。
2. “工作中”= `nbook.agent/active`，只有空闲/工作中两态。
3. 图标集按名覆盖 lucide，只收 SVG，亮暗各写一份。
4. 场景提供者是新的贡献点，不放进 `ThemeDeclaration` 里内联函数。
5. 不做交叉淡化。
