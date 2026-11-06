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
- 不接受 `.svg` 以外的格式。SVG 经 CSS `mask-image` 当图片用，走浏览器的“SVG 作为图片”的静态模式：不执行脚本、不加载外部资源（这是 SVG 与 CSS 规范对图片用法的要求，不是本产品加的）。这一条用真实 Chromium 核实：e2e 用一个引用了外部地址的 SVG，核对页面没有发出那条请求（设计审查第 14 条）。内置的书房图标是手写的纯几何。
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
- “我的主题”：见下“用户层”一节。

### 三、`ThemeDeclaration.sceneProvider`：由代码提供的场景（新贡献点 `workbench.theme-scenes`）

设计审查（[evidences/design-review.txt](evidences/design-review.txt)）对这一节提了异步回流、缓存失效、入口激活、生命周期、解码、对象 URL 回收几条，下面是修订后的合同。

- 新贡献点 `workbench.theme-scenes`，拥有者 `nbook.workbench`，**有实现**，只在浏览器位置：

  ```ts
  type SceneProviderDeclaration = {title: Text};
  type SceneRequest = {appearance: "light" | "dark"; working: boolean};
  type SceneResult = {image: Blob; /** 到这个时刻（毫秒时间戳）重画；没有则只画一次 */ expiresAt?: number};
  type SceneProviderImplementation = {scene(request: SceneRequest, signal: AbortSignal): Promise<SceneResult>};
  ```

- `ThemeDeclaration` 追加可选的 `sceneProvider: string`（贡献 id，以提供它的插件 id 开头，不要求与主题同插件）。有它的主题，场景图由提供者画；`Look.scene` / `Look.workingScene` 在提供者没画好、失败或没有发布时作为后备。
- **入口激活**：提供者的实现随浏览器入口的激活交付（runtime 合同）。工作台不去激活入口，只读已发布的句柄：提供者所在入口要在启动时激活（`activationEvents` 里写启动），这是写提供者的插件的责任，Spec 与 `scene-clock` 示例都写明；没发布的提供者一律按“没有提供者”处理，用后备图。接受这个取舍的理由：激活入口的路径要经 `WindowPlugins`，把主题目录和插件激活绑在一起，范围远大于场景本身。
- **目录里的状态**（`ThemeCatalog`）：
  - 动态结果放在 `shallowRef<ReadonlyMap<键, URL>>`，键 = 主题 id + 明暗 + working。`resolve` 读这个表，所以结果落下时 `WorkbenchDocument` 的 `watchEffect` 自动重算并 `apply`（不会因此触发整页渐变：skin 和明暗没变）。
  - `resolve` 在表里没有这个键、也没有在飞的请求时启动一次加载（按键去重的幂等动作，启动记在一张非响应式的表里，不在 effect 里写响应式状态）。
  - 加载 = 调 `scene(request, signal)` → 检查 `image/*` 且不超过 4 MB → `URL.createObjectURL` → 用 `Image.decode()` 确认浏览器解得开 → 才放进表。任何一步失败：撤销对象 URL，用后备图，记一条诊断（按**提供者 id** 去重，不是按主题）。
  - `expiresAt`：到点重新请求同一个键；新结果解码成功后再换进表并撤销旧 URL，期间旧图继续显示。定时器随目录 `dispose()` 清掉。
  - **代次**：目录给每个主题条目记一个代次，`published`/`revoke` 时加一；迟到的结果代次对不上就丢弃并撤销它的 URL，不回写。提供者句柄撤回（入口关闭）同理：取消在飞的请求、撤销该提供者名下的全部 URL、清定时器，主题退回后备图。
  - `dispose()`：页面卸载时取消在飞请求、清定时器、撤销全部对象 URL。`WorkbenchDocument` 挂载期间才有目录的消费者，目录在工作台插件作用域结束时 `dispose`。
- **禁用与卸载**：当前插件禁用、卸载要重启后生效（Spec“不承诺”；热插拔另有 `runtime.plugin-hot-plug`），所以“提供者没了就退回后备图”在产品里观察到的是重启后的状态；撤回路径用目录接收者的单元测试覆盖，不称在线禁用。
- 信任边界不变：声明里仍然没有可执行内容；提供者是插件代码，拥有插件的全部能力。
- “我的主题”：见下“用户层”一节。

### 三点五、用户层（“我的主题”）与新字段

设计审查第 1、10 条指出：编辑器 Spec（`theme.editor`）要求复制任一插件主题，并保留编辑器还不认识的新字段；若 `userThemeProblem` 拒绝新字段，复制书房会失败，若原样留着，插件相对路径又会被当成用户素材名。修订后的合同：

- `sceneProvider`：用户层**保留**。它只是个贡献 id，不涉及文件；提供者不在时用后备图。
- `icons`、`workingScene`：用户层没有对应的素材管线（用户素材是按内容哈希命名的场景图，编辑器没有这两项的上传），所以用户层**不持有**。`userThemeProblem` 拒绝它们（读取时那一条不进目录，沿用现有的“不合格的那一条”处理）；**复制插件主题与导入主题包时丢弃这两项**，复制得到的主题没有图标集和工作态场景，编辑器的复制提示里说明（一句文案）。
- 这是对“保留新字段”的一处有说明的降级：只限需要素材的两项，写进 `theme.editor` 的边界与兼容，不是静默丢弃。
- 实现点：`theme-editor-model.ts` 的复制（深拷贝声明处）、`transfer.ts` 的导入（只转 `scene` 的地方）、`shared/user-themes.ts` 的 `userThemeProblem`。验证：`theme-editor.test.ts` / `user-themes.test.ts` 加“复制带图标集的插件主题得到不含 icons 的我的主题”“导入含 icons 的包，icons 被丢弃”；`theme-editor.e2e.ts` 复制书房仍成功。

### 四、书房作为示例主题（只动文档与示例，不动产品）

- 决定：书房**留在内置**，不搬到 SDK 示例里。理由：t04、t07 的 e2e 与欢迎页的行为依赖它随产品提供（Spec 输出 11），搬走要同时改“内置的书房”这条产品承诺。
- “示例”落成：`plugin-sdk/examples/README.md` 加“主题”一节，列三份可读的参考——最小的 `external/theme-dusk`（只有配色与场景）、完整的 `theme-study/plugin.ts`（字体、裁切、活动栏、画框、图标集）、带代码的场景提供者示例（见下）；`theme-study/plugin.ts` 开头的注释写明它既是产品内置也是完整参考，改字段要同步 Spec。
- 新的示例插件 `plugin-sdk/examples/plugins/scene-clock`（代码插件）：贡献一个 `workbench.theme-scenes` 提供者，画“按小时变的天空”（Canvas 渐变，原创，无素材；`expiresAt` 取下一个整点），入口在启动时激活，并贡献一个用它的主题；有场景测试核对贡献被工作台接受、`expiresAt` 到点后重新请求。讲解式注释，按 `plugin-sdk/examples/` 的写法。

## Spec 与文档改动

- `docs/specs/theme/skins.md`：`不承诺` 里去掉三项；输入的类型加 `icons`、`workingScene`、`sceneProvider`；规则里加校验；输出加：16 图标集、17 按状态换场景、18 由代码提供的场景；验收加 16 到 18；贡献点 `workbench.theme-scenes` 写进输入与实现合同；边界与兼容里写“追加字段”。
- `docs/specs/theme/system.md`：运行时流程里一条：`apply` 的 `icons`、状态变化不渐变。
- `docs/specs/theme/editor.md`：说明“我的主题”不收这三项（只有一句）。
- `plugin-sdk/examples/README.md`：上面第四节。
- 同名 `.md`：若改了组件则同步（预计不改组件）。

## 切片

1. **图标集**（关键设计一）：`themes.ts` 校验与 Schema、`document-theme.ts` 的 `icons` 与 `style` 元素、`themes.ts` 的 `themeVars` 同层产出 `icons`（`ProductTheme` 加 `icons?`）、工作台写入点、书房的 SVG 与声明。验证：`themes.test.ts`、`document-theme` 的 dom 测试、`themes.e2e.ts` 新用例（书房下活动栏的 `--svg` 已换；高对比度下不换；换回 NeuroBook 后恢复）。
2. **按状态换场景**（关键设计二）：Schema 与校验、`ThemeCatalog.resolve` 多参数、工作台读 `nbook.agent/active`、`theme-dusk` 示例补 `workingScene`（用已有素材做一份调暗的派生图，≤ 300 KB，PIL 脚本处理，不收费）。验证：`themes.test.ts`；`themes.e2e.ts` 新用例（装一个带 `workingScene` 的主题插件，让一个 Agent 会话进入运行态，`--skin-scene` 换了，结束后换回）。
3. **由代码提供的场景**（关键设计三、三点五）：新贡献点、`ThemeCatalog` 的提供者结果表（响应式、代次、`expiresAt`、`dispose`）、诊断、用户层的复制/导入/校验、`scene-clock` 示例插件与场景测试。验证：目录单测放在浏览器环境（Vitest + 真实浏览器 API 的部分用 happy-dom 不够时放 e2e：对象 URL 与 `Image.decode` 要真实 Chromium）；示例的场景测试；外置示例构建测试（`external-examples.test.ts` 加 `scene-clock`）。端到端：用 e2e 的“装插件”机制装 `scene-clock` 构建产物，核对 `--skin-scene` 是 `blob:` 地址、损坏图片回退到后备图、跨 `expiresAt` 后地址变化。
4. **文档与示例 README**、Task 收口。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `theme.skins` 输出 16、验收 16 | `themes.test.ts`（校验）、`document-theme` dom 测试（`style` 元素写入与清理）、`themes.e2e.ts` |
| 输出 17、验收 17 | `themes.test.ts`（`resolve` 的 working 取图）、`themes.e2e.ts`（Agent 运行态切换） |
| 输出 18、验收 18 | 目录单测（reject、非图片、超大、被取消、撤回、同 id 重发、迟到结果被丢）、`scene-clock` 场景测试、`themes.e2e.ts`（成功、损坏图片回退、`expiresAt` 刷新） |
| 校验类（验收 1 的新增项） | `themes.test.ts`：`icons` 键名/路径/数量、`workingScene` 路径、`sceneProvider` 前缀；`user-themes.test.ts`：用户层拒绝 `icons`、`workingScene`，保留 `sceneProvider` |
| `theme.editor` 复制与导入 | `theme-editor.test.ts`、`transfer` 测试：复制/导入丢弃 `icons`、`workingScene`；`theme-editor.e2e.ts` 复制书房成功 |

## 验证

只跑受影响的：`bun test src/plugins/workbench`、`bun run test:vitest -- document-theme`、`themes.e2e.ts`、`theme-editor.e2e.ts`（确认“我的主题”没有被牵连）、`plugin-sdk` 的示例与外置构建测试、`typecheck`、`governance:check`、`docs:check`。未验证边界：真实 Agent 模型运行（e2e 用已有的测试会话进入运行态，不调真模型）；第三方提供者里写死循环的情形（提供者是插件代码，和别的插件代码一样，不防）。

## 不做与风险

- 不做交叉淡化：orca-link 有 640 毫秒的淡化，CSS 变量里的 `url()` 不能直接淡化，要做两层叠放，影响所有场景位置；以后要做另开 Task。
- 不做图标颜色/粗细之外的调整、不换文件类型图标、不做图标集的“整套替换”（只按名覆盖，没写的保持 lucide）。
- 不做“我的主题”里这些项的编辑（编辑器的入口留给以后）。
- 不做提供者入口的按需激活（见三）。
- 不新增 Agent 的状态键；“工作中”只有一个二值信号。
- 风险：一，图标样式表以无层级规则压层级规则，依赖 nb-ui 垫片把 `--svg` 当唯一入口（`tailwind.css` 那段注释已写“预生成模式每条规则只输出 `--svg`”）；二，书房的图标是手写的，不是设计师稿，辨识度靠 e2e 之外的截图判断；三，对象 URL 的生命周期要跟随目录的替换。

## 待确认项（也记进 `pending-confirmations.md`）

1. 书房留在内置、只补文档与示例，不搬到 SDK。
2. “工作中”= `nbook.agent/active`，只有空闲/工作中两态。
3. 图标集按名覆盖 lucide，只收 SVG，亮暗各写一份。
4. 场景提供者是新的贡献点，不放进 `ThemeDeclaration` 里内联函数。
5. 不做交叉淡化。
6. 用户层不持有 `icons`、`workingScene`，复制和导入时丢弃（有说明的降级）；保留 `sceneProvider`。
7. 提供者所在入口要在启动时激活，工作台不替它激活。
