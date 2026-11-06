---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: theme.skins
owners:
  - nbook.workbench
  - nbook.editor
  - nbook.markdown
---

# 主题皮肤

## 目标与非目标

**目标**：插件能提供一整套外观：配色、字体、活动栏、图标集、浮层的画框、一张场景图（或由代码画的场景图）在各位置的裁切。写作者在一个“主题”列表里选，选了之后界面整体换一个样子。场景放在内容区的留白处，正文底下始终是干净的面。

**不承诺**：

- 半透明与磨砂：场景不压暗、不磨砂，文字不叠在半透明面上。
- 画框只有一种（双线），不接受自定义图案或素材；图标集只按名覆盖产品里的 lucide 图标，不整套替换、不换文件类型图标；场景只按“空闲/工作中”两态换，不取 Agent 的细状态；场景换图时不做交叉淡化。
- 第三方主题的对比度：不做运行时检查，由作者负责。
- 运行期热插拔：插件禁用、启用要重启后生效（[`runtime.plugin-hot-plug`](../runtime/plugin-hot-plug.md)）。

## 术语与参与者

- **主题**：`workbench.themes` 的一条贡献。`nbook`、`macos` 与两套护眼主题也是主题，只是没有场景。
- **主题包**：nb-ui 的形状、密度与动效（[`theme.system`](system.md)）。一条主题经 `base` 选一个。
- **场景图**：每个明暗一张，各位置裁它的不同部分。
- 参与者：`nbook.workbench`（贡献点、选择、写文档根、活动栏、侧栏与右栏下角）、`nbook.editor`（空状态）、`nbook.markdown`（正文两侧与正文字体）、提供主题的插件。

## 输入与前置条件

贡献点 `workbench.themes`，拥有者 `nbook.workbench`，顶层声明式，不需要实现，不写入口的插件也能贡献：

```ts
type ThemeDeclaration = {
    title: Text;
    base: "nbook" | "macos";
    sceneProvider?: string;                        // 由代码画场景图：workbench.theme-scenes 的贡献 id
    fonts?: {display?: string; prose?: string};    // 系统字体栈
    crop?: {
        empty?: {position?: string; contentX?: number};   // contentX：内容中心在内容区宽度的比例，0.25–0.5，缺省 0.5（居中）；偏右的以后再加
        marginLeft?: {size: string; position: string};    // CSS background-size、background-position
        marginRight?: {size: string; position: string};
        sidebarCorner?: {size: string; position: string};
        auxiliaryCorner?: {size: string; position: string};   // 右栏（auxiliarybar）
    };
    light: Look;
    dark: Look;
};
type Look = {
    colors?: Partial<ColorVars>;                   // 配色变量；缺的取 base 的缺省配色
    vars?: Partial<Record<RoleVar, string>>;       // 只收主题角色变量里的白名单
    activityBar?: {surface: string; foreground: string; active: string; ornament?: string};
    scene?: string;                                // 插件目录内的相对路径
    workingScene?: string;                         // Agent 工作中用的场景图，相对路径；没写时仍用 scene
    icons?: Record<string, string>;                // 图标名（i-lucide-<名> 的 <名>）到插件目录内 .svg 的相对路径
    frame?: {line: string};                        // 浮层画框那道细线的颜色
};
```

规则：

- 贡献 id：无点的 id 只有 `nbook.workbench` 能用（`nbook`、`macos`）；其余以 `<插件 id>.` 开头。
- `scene`、`workingScene` 与 `icons` 的值都是插件目录内的相对路径（不能带方案、不能是绝对路径、不能有 `..`）；`icons` 的值必须以 `.svg` 结尾，键只收小写字母、数字与连字符，一条 Look 最多 64 个；`sceneProvider` 是点分的小写贡献 id。
- 取值不能含反斜杠，也不能含 `url`、`src`、`image`、`image-set`、`cross-fade`、`element`、`paint` 后接括号的写法：CSS 先解转义再认函数名，`u\72l(` 就是 `url(`。`scene` 不能是绝对路径、带方案的地址，也不能有 `..`。
- 不合规则的贡献不接受，记诊断，其它主题照常（[`runtime.plugin-manifest`](../runtime/plugin-manifest.md)）。

配置项 `nbook.workbench/theme` 是主题 id，缺省 `nbook`，用户层与项目层都允许。

## 输出与可观察行为

1. **一个列表**：设置窗口的“主题”项与命令 `nbook.settings.switch-theme` 列出全部已接受的主题，标题取声明的 `title`。用户自己做的“我的主题”（[`theme.editor`](editor.md)，id 为 `user:<uuid>`）也在其中，声明与校验同一份。
2. **选了什么就写什么**：文档根的 `data-nb-theme` 是 `base`；配色变量是 `colors` 盖在 `base` 缺省配色上的结果，没有未定义的配色变量；`vars`、活动栏、字体、场景都写成变量。换主题时上一套写下的全部清掉。
3. **明暗**：`Look` 按解析后的明暗取，`system` 跟随系统。
4. **空状态**：编辑组没开文件，或活动页面声明了 `scene`（欢迎页），内容区铺场景图，裁切取 `crop.empty`，内容中心按 `contentX` 偏到留白上。别的页面标签不铺。
5. **正文两侧**：Markdown 编辑器的正文列两侧露出场景图，裁切取 `crop.marginLeft`、`crop.marginRight`，往正文方向淡出，从工具栏以下开始，不随正文滚动。一侧不足 120px 时那一侧不画。拆分后每组各自判断。源码编辑器、图片查看器不画。
6. **侧栏与右栏下角**：`sidebar` 与 `auxiliarybar` 这两个 Part 的下角露出场景图，裁切分别取 `crop.sidebarCorner`、`crop.auxiliaryCorner`，往上淡出，不接收指针，列表与对话长时盖在它上面。高度不足 300px 时不画。别的 Part 不画。编辑区放不下两侧时（默认布局下视口约 1760px 以下、右栏开着），右栏下角让界面仍有场景。
7. **活动栏**：面、前景色与当前项的颜色取 `activityBar`，有 `ornament` 时首尾各画一条。
8. **字体**：欢迎页标题用 `fonts.display`，Markdown 正文用 `fonts.prose`，没有时用现有字体。书架的展示字体不变：`fonts.display` 写成专用的变量，不写公共的 `--font-display`。
9. **无障碍偏好**：`prefers-contrast: more`、`forced-colors: active` 下不画场景；配色与活动栏照旧。
10. **没写的位置和没有主题时一样**：`nbook`、`macos` 的外观不因本能力改变。
11. **内置的“书房”**：随产品提供，不是缺省。
12. **内置的护眼主题**：`eye-green`（护眼绿）与 `eye-sepia`（护眼米黄），工作台提供，主题包是 `nbook`，亮暗各一套低饱和的配色，只换颜色，没有场景。正文、次要文字、链接与状态色都不低于 4.5。
13. **浮层画框**：`Look.frame` 有值时，菜单、气泡、对话框、抽屉与设置窗口等浮层（`.nb-ui-popover-surface`、`.nb-ui-dialog-surface`）在描边里面 4px 处再画一道 1px 的细线，颜色取 `frame.line`，不改浮层的尺寸与布局。小提示不画。`prefers-contrast: more`、`forced-colors: active` 下不画。没写 `frame` 时和没有主题一样。
14. **书架页**：带场景的主题，书架页整页铺场景图，裁切取 `crop.empty`（与欢迎页同一个），上面罩一层页面底色（`--bg-main` 的 62%）；场景钉在视口上，书多了页面变长也不被拉伸。卡片与文字仍在原来的面上，文字对比度不低于 4.5。`prefers-contrast: more`、`forced-colors: active` 下不画。没有场景的主题没有这一层。书架的展示字体不变（输出 8）。
15. **设置窗口**：带场景的主题，设置窗口内容区铺一层淡场景（图的 16% 不透明度），裁切取 `crop.empty`；不管窗口后面是什么页面，窗口自己都带着主题的味道。淡到文字与控件的对比度仍不低于 4.5。`prefers-contrast: more`、`forced-colors: active` 下不画。没有场景的主题没有这一层。

16. **图标集**：`Look.icons` 有值时，工作台自己用的 lucide 图标里，名字在表里的换成对应的 SVG（经 CSS 蒙版画，随前景色变），没写的保持原图标；亮暗各写各的。`prefers-contrast: more`、`forced-colors: active` 下不换。SVG 当图片用，浏览器不执行里面的脚本、不加载它引用的外部资源。素材读不到的那个图标显示为空（作者负责，工作台不检查文件在不在）。没写 `icons` 时和没有主题一样；换回别的主题后恢复。
17. **按状态换场景**：Agent 工作中（有会话在运行或等用户处理，即公开状态 `nbook.agent/active`，状态栏“Agent：1 运行中”的同一个信号）且这一明暗写了 `workingScene` 时，所有位置的场景图换成它，裁切不变；会话结束后换回 `scene`。`workingScene` 没写或读不到时仍用 `scene`。Agent 插件没启用时按空闲。换图不触发整页渐变，也不做交叉淡化。
18. **由代码提供的场景**：主题写了 `sceneProvider` 时，场景图由那个提供者画：提供者是浏览器入口向 `workbench.theme-scenes` 的贡献，实现是 `scene({appearance, working}, signal) => Promise<{image: Blob, expiresAt?: number}>`。图要是 `image/*`、不超过 4 MB，并且浏览器解码成功才采用；否则（提供者一直没发布、reject、不是图片、超限、解码失败）那一位置用后备的静态图（`scene` / `workingScene`），没有后备就没有场景，并按提供者记一条诊断，同一个提供者只记一次（提供者撤回后清掉记录），第一次画就失败的不重试。每个（主题、明暗、是否工作中）画一张；`expiresAt` 到点重新请求，至少隔 5 秒（过去的时刻、0 不会变成请求死循环，不是数的当作没有），新图解码成功后才替换旧图；刷新失败时旧图继续显示，60 秒后再试。提供者撤回（入口停止）、主题重新发布、换了提供者或删掉时，取消在飞的请求、撤销已画的图；工作台（插件）停止时撤销全部。工作台不替提供者激活入口，所以提供者所在的入口要写 `onStartup`；主题引用的提供者启动 5 秒后还没发布，按提供者记一条诊断（说明要写 `onStartup`）。

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

- 公开接口：贡献点 `workbench.themes` 与 `workbench.theme-scenes` 及声明，只追加字段；配置值 `nbook`、`macos` 不变。SDK 的 `/workbench` 导出 `sceneProvider` 助手与相关类型。
- “我的主题”的素材写素材文件名（内容摘要加扩展名，放在 `user://theme-assets/`）：`scene`、`workingScene` 是位图的文件名，`icons` 的值是 SVG 的文件名（[`theme.editor`](editor.md) 的“写场景素材”“写图标素材”）；不合这个写法的记录，那一条不进列表。`sceneProvider` 只是个贡献 id，原样保留。
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
11. Given 护眼绿或护眼米黄与明暗任一；Then 没有场景；欢迎页文字、活动栏、侧栏、正文的对比度不低于 4.5。
12. Given 书房、右栏开着、编辑区窄到放不下两侧；Then 右栏下角有场景，压在图上的文字（正文与次要文字）对比度不低于 4.5；When 模拟高对比度或强制颜色；Then 右栏下角没有场景。
13. Given 书房；When 打开菜单与设置窗口；Then 描边里面有一道细线，亮暗各取各的颜色；小提示没有；When 模拟高对比度；Then 没有；When 切回 NeuroBook；Then 浮层没有这道线。
14. Given 书房；When 打开书架页；Then 整页有场景，书架标题、作品数与书房名的对比度不低于 4.5；When 模拟高对比度或强制颜色；Then 没有；When 换成 NeuroBook；Then 没有。
15. Given 书房；When 打开设置窗口；Then 窗口内容区有一层淡场景（不透明度 16%），标题、行与导航文字的对比度不低于 4.5；When 模拟高对比度或强制颜色；Then 没有；When 换成 NeuroBook；Then 没有。

16. Given 书房；When 看活动栏等处的 lucide 图标；Then 画的是书房的 SVG，亮暗同一批；When 模拟高对比度；Then 恢复原图标；When 换成 NeuroBook；Then 恢复原图标，文档里没有图标样式表；Given 图标 SVG 里引用了外部地址；Then 浏览器不发出那条请求。
17. Given 写了 `workingScene` 的主题；When 一个 Agent 会话开始运行；Then 场景图换成工作态的；When 会话结束；Then 换回 `scene`。
18. Given 主题写了 `sceneProvider`，提供者所在入口启动即激活；Then 场景变量是画好并解码过的 `blob:` 地址；When 换明暗；Then 另画一张；When 提供者 reject、返回非图片或超限的图、或解码失败；Then 用后备图并记一条诊断；When 提供者启动后一直没发布；Then 记一条说明要写 `onStartup` 的诊断；When 提供者撤回；Then 取消在飞的请求、撤销已画的图；When 主题重新发布或换了提供者；Then 旧图作废、迟到的结果不被采用；When `expiresAt` 到点（或是过去的时刻）；Then 至少隔 5 秒重新请求，新图解码成功后才替换，刷新失败时旧图继续显示。

Smoke：`e2e/themes.e2e.ts`（图标集）、`e2e/agent-conversation.e2e.ts`（按状态换场景）、`e2e/plugin-code.e2e.ts`（外置的场景提供者）。

## 实现合同

- 公开入口：`workbench/shared/contracts.ts`（`WORKBENCH_THEMES_POINT`、`ThemeDeclaration`、`THEME_CHOICES_PROVIDER`）；`shared/host.ts` 的 `windowPluginFilesKey`（插件的静态文件：内置的随前端构建，第三方的经插件文件端点）。
- owner 与依赖方向：贡献点、选择、文档根的写入、活动栏、侧栏与右栏下角归 `nbook.workbench`；空状态归 `nbook.editor`（`editor.pages` 的声明加了可选的 `scene`）；正文两侧与正文字体归 `nbook.markdown`。各位置只读 `src/ui/theme/skin-vars.ts` 里的变量，没有变量时和没有主题一样。
- 不变量：声明里的素材只有相对路径，描述文件不 import 图片：服务端构建会把图片打进产物，URL 也和前端的不一样。内置素材的 URL 表在 `web/plugins.ts`。
- 不变量：贡献点定义写在 shared，三个运行位置都带；没有入口的位置经描述里的 `contributionPoints` 登记，否则服务端的插件页把第三方主题标成“未知贡献点”。
- 不变量：主题目录经 receiver 收，不取激活时的快照，以后热插拔不用改。场景提供者的结果放在响应式表里，结果落下时读过它的主题计算自动重算；主题条目重新发布、撤回或换了提供者时，名下的请求与结果作废，迟到的结果不回写，对象 URL 由目录负责撤销。
- 不变量：图标覆盖规则写成一张不进任何 `@layer` 的样式表，整张包在 `@media not ((prefers-contrast: more) or (forced-colors: active))` 里：不进层才压得过 nb-ui 预生成的 `@layer` 里的 `--svg`，媒体条件不满足时原规则自然生效。
- 不变量：写偏移的规则要排在元素自己的 `padding` 之后，否则会被简写盖掉（`themes.e2e.ts` 断言空状态下标志的位置）。

## 证据

- 批准依据：开发者 2026-11-05 的决定，记在主工作区 master 的 `.agents/works/w00041-themes-and-backgrounds/tasks/t01-research-and-design/README.md`。
- 实现入口：[`workbench/shared/themes.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/themes.ts)、[`workbench/web/themes.ts`](../../../packages/neuro-book/src/plugins/workbench/web/themes.ts)、[`ui/theme/`](../../../packages/neuro-book/src/ui/theme/skin-vars.ts)、[`theme-study/plugin.ts`](../../../packages/neuro-book/src/plugins/theme-study/plugin.ts)
- 合同测试：[`workbench/themes.test.ts`](../../../packages/neuro-book/src/plugins/workbench/themes.test.ts)、[`workbench/scene-providers.test.ts`](../../../packages/neuro-book/src/plugins/workbench/scene-providers.test.ts)；示例：[`plugin-sdk/examples/plugins/scene-clock`](../../../packages/neuro-book/plugin-sdk/examples/plugins/scene-clock/plugin.ts)与场景 [`08-scene-provider`](../../../packages/neuro-book/plugin-sdk/examples/scenarios/08-scene-provider.test.ts)
- Smoke：[`themes.e2e.ts`](../../../packages/neuro-book/e2e/themes.e2e.ts)；量出来的对比度在 master 的 `.agents/works/w00041-themes-and-backgrounds/tasks/t01-research-and-design/evidences/` 与测试输出，最低 4.82
