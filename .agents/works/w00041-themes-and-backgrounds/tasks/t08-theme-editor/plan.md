# t08 实施计划：主题编辑器

## Context

- **为什么做**：开发者 2026-11-06 要“一个相对完整的主题编辑器，绝大部分声明式主题都能用它做出来”。现在做主题要手写声明与插件包，装上还要重启（热插拔未做），没有实时预览。
- **依据**：[`theme.editor`](../../../../../docs/specs/theme/editor.md)（planned，本计划先改它再实现）、[`theme.skins`](../../../../../docs/specs/theme/skins.md)、[`workspace.files`](../../../../../docs/specs/workspace/files.md)；第一版背景图片的上传路由做法（w00025 t19，提交 `738297ae5`，审查记录在该 Task 的 `evidences/`）。
- **开发者已定**（2026-11-06，[README](README.md) 决定 1 到 10）：主题存在“我的主题”库、改完即时生效；编辑器是视图，页签与浮动窗口都能放；配色先推导整套再微调；取景在原图上拖框；导出成可安装的主题插件；左竖导航分区；顶部切亮暗；对比度逐项实时显示加汇总；五个取景框叠在同一张图上。
- **现状限制**：布局包的应用内浮动（w00026 t09）是 `planned`，浮动窗口先用 nb-ui 的 `FloatingWindow`，承载方式同设置窗口；t09 做完后改走布局包，编辑器主体不改。
- **工作方式**：worktree `.worktree/w00041-t08-theme-editor`。Spec 与记录在主工作区。编辑器界面的实现按 [ui-development](../../../../skills/ui-development/SKILL.md) 与同名 `.md` 约定，组件配 Lab 场景。

## 关键设计

### 1. 颜色计算（`src/ui/theme/`，纯 TS）

- `color.ts`：解析 `#rgb`、`#rrggbb`、`rgb()/hsl()` 与 `color-mix` 以外的常见写法（只收编辑器自己写的 `#rrggbb[aa]`，读到别的写法按“读不懂”处理，不猜）；sRGB 与 OKLCH 互转；WCAG 相对亮度与对比度。
- `derive-palette.ts`：`derivePalette({background, text, accent, appearance}) → Record<ColorVar, string>`，33 个变量全出。规则：面板、侧栏、悬停、输入框在背景色上按 OKLCH 明度小幅偏移（亮色往暗、暗色往亮），边框取背景与文字的混合，次要与弱化文字在文字与背景之间取点并夹到对比度 4.5，强调色的底色与文字色按强调色明度推；状态色（信息、成功、警告、危险）取固定色相、明度按明暗取，每档三件套。结果过一遍对比度：主文字、次要文字、链接对背景不足 4.5 时调明度直到够。
- 复用：`nbColorwayVarKeys`（`packages/nb-ui/src/colorway/colorway-contract.ts`）给出 33 个键；不另列。
- 测试：纯函数，真实色值；断言每个输出键都在、对比度达标、同样输入同样输出，亮暗各一组主色。

### 2. 写场景素材的路由（`src/plugins/files/backend/`）

照第一版 `738297ae5` 的做法（从 git 历史取）：`theme-asset-route.ts`，`PUT /api/nbook.files/theme-assets`，并入 `nbook.files` 现有 `http.routes`；限长接收、按字节判定类型（`src/shared/image-type.ts` 在第一版里提出来，同样提）、文件名取 SHA-256、拒绝符号链接目录、已存在核对摘要；写入归属 `{kind: "system", plugin: "nbook.files"}`。第一版的设计审查与实现审查的处理结果（`.agents/works/w00025-editor/tasks/t19-background-image/evidences/`）要先读，其中“暂存与提交的走法”“符号链接目录”“并发同内容”的结论照用。测试用真实文件服务，场景见 Spec“写场景素材”一节。

### 3. 我的主题库（`src/plugins/workbench/`）

- `shared/user-themes.ts` 与 `web/user-themes-store.ts`：Storage 用户记录 `user-themes`（scope user、locality shared，不用配置项：配置项会在设置窗口的“其它”里显示一大块 JSON），经 `defineStore` 的 `persist` 投影；schema 是 `{id: "user:<uuid>", declaration: ThemeDeclaration, editor?: {touched: string[]}}` 的数组。id 用 `user:` 前缀：冒号不会出现在插件 id 里，不会和第三方撞。
- `web/themes.ts` 的 `ThemeCatalog`：增加第二个来源，读这份记录经 `declarationProblem`（同一份校验）逐条过，不合格的记诊断、不进目录。素材地址：`scene` 是文件名，我的主题解析为 `/api/nbook.files/raw/user/theme-assets/<名>`；解析函数在 `web/plugin.ts` 登记素材表的地方补一个“我的主题”分支。
- 设置里的主题列表与命令 `switch-theme`：`THEME_CHOICES_PROVIDER` 列出时包含我的主题，标题后标“我的”；退回规则不变。
- 编辑器预览：`WorkbenchDocument.vue` 的 `resolveTheme` 之前加一个“预览覆盖”：编辑器开着时用编辑中的主题与顶部选的明暗；关闭即清掉。覆盖放在工作台的一个小服务（`windowThemePreviewKey`），编辑器写、文档写入方读。
- 测试：库的校验与退回（合同测试）、预览覆盖（DOM 测试，真实写入方）、素材地址。

### 4. 编辑器（`src/plugins/workbench/web/theme-editor/`）

- 组件：`ThemeEditor.vue`（主体）、`ThemeEditorNav.vue`、各分区 `sections/`（基本信息、配色、字体、活动栏与画框、场景与取景、对比度）、`ColorField.vue`（取色器加色值输入加对比度徽标）、`CropEditor.vue`（原图加五个取景框）；每个有同名 `.md` 与 Lab 场景。复用 nb-ui 的输入、选择、分段、按钮、对话框；表单行沿用设置页的行组件风格，不另造。
- 页签：`editor.pages` 贡献页面 `nbook.workbench.theme-editor`；命令 `nbook.workbench.theme-editor.open`。浮动：`ThemeEditorWindow.vue` 用 `FloatingWindow` 包同一个主体，命令 `…open-floating`。同一时刻只有一个，由一个小的单例状态管，再开是聚焦。
- 数据流：编辑器只读写 `user-themes` store，自己不存声明副本；输入框改动防抖后写入；写失败时不改显示（回到库里的值）。
- 取景的读写（`crop-model.ts`，纯 TS）：只认编辑器自己写的几种形式，其余不解析：空状态 `position: "<x>% <y>%"` 加 `contentX`；正文两侧 `size: "auto <H>%"` 加 `position: "<x>% <y>%"`；两个角 `size: "<W>px auto"` 加 `position`。每个位置有一个参照盒子（空状态按内容区、两侧按默认宽度的版心留白、角按默认栏宽与 240px 高），框的几何与数值互相换算。读不懂返回 `null`，界面把框标成不可拖。
- 上传：浏览器侧缩到最长边 2560px、转 WebP（canvas），经路由写入；超 300 KB 提示不拒绝。
- 对比度：`ColorField` 按它的“另一端”（文字对 `--bg-main`/`--bg-panel`/`--bg-sidebar`，强调文字对 `--accent-bg`，状态色对各自的底色）算，汇总分区列全部不合格对。
- 编辑面板始终用实心面：根上不透明背景，不用玻璃面。

### 5. 导出与导入（`src/plugins/workbench/web/theme-editor/package.ts`）

- 都在浏览器里做，用根依赖里已有的 `fflate`（核实它在浏览器构建里可用）：导出读场景图（走素材读取地址），打成 zip 经 Blob 下载；导入读 zip，校验后把素材经路由写入，再写 `user-themes` 记录。
- 导出包：`package.json`（发布者 `local`，名字取标题的拼写，版本 `0.1.0`，`engines`，一条 `workbench.themes` 贡献，贡献 id `local.<name>.<slug>`）加 `assets/`，格式与 `plugin-sdk/examples/external/theme-dusk` 相同；测试里把导出包交给真实的插件安装（`createPluginInventory`，同 `themes.e2e.ts` 的装法），重启后在列表里出现。
- 导入校验：zip 20 MiB、文件数 64、单文件 20 MiB、路径无 `..` 与根；`package.json` 与声明走同一份校验；素材按字节判类型。不合格不写任何东西（先全部校验，再写）。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/theme/editor.md` | 已写（planned）；实现闭合后晋升 `implemented`，补“实现合同”与证据 |
| `docs/specs/theme/skins.md` | 已加“我的主题在列表里”；随实现补 |
| `docs/specs/workspace/files.md` | 已加指向；随实现补 |
| `packages/neuro-book/plugin-sdk/` 文档 | 一句：用编辑器导出的主题包就是不写代码的主题插件 |

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S1 | 颜色计算（第 1 节） | 单元测试 |
| S2 | 写场景素材的路由（第 2 节） | 真实文件服务的合同测试 |
| S3 | 我的主题库、列表、预览覆盖（第 3 节） | 合同测试、DOM 测试；`themes.e2e.ts` 原样通过 |
| S4 | 编辑器骨架：页签与浮动、导航、亮暗、库的增复制删、基本信息、配色（推导、分组、行内对比度） | Lab 场景；e2e：开、改、实时变、关回 |
| S5 | 字体、活动栏与画框、对比度汇总 | Lab 场景；e2e |
| S6 | 场景与取景：上传、取景框、数值同步 | Lab 场景；e2e：拖框与数值同步、读不懂的取景 |
| S7 | 导出与导入 | 合同测试；e2e：导出的包被真实安装；坏 zip 全部拒绝 |
| S8 | 收口：实现审查（前端 Sonnet，路由与导入校验 omp）、`test:affected`、真实截图给开发者、Spec 晋升 | |

## 验收映射

Spec 编号都在 [`theme.editor`](../../../../../docs/specs/theme/editor.md)。

| 编号 | 由谁覆盖 |
|---|---|
| 输出 1、2、3 | S3、S4 的 e2e（`theme-editor.e2e.ts`） |
| 输出 4 | S3 的 DOM 测试加 S4 的 e2e |
| 输出 5 | S1 的单元测试（比值）加 S4 的 e2e（编辑后再推导） |
| 输出 6 到 11 | S4、S5 的 e2e 与 Lab |
| 输出 12、13 | S6 的 e2e 与 `crop-model` 单元测试 |
| 输出 14 | S5 的 e2e |
| 输出 15、16 | S7 |
| 输出 17 | S3 的合同测试 |
| 输出 18 | S4 到 S6 的 e2e（实心面按对比度测量，沿用 `themes.e2e.ts` 的量法）；390px 溢出 |
| 写场景素材 | S2 |
| 验收 1 到 14 | 同上各片；验收 9、10 是 S7；验收 13、14 是 S8 的真实页面测量 |

## 验证

- 每片：对应单元与 DOM 测试、Lab 的 `lab:shot`；e2e 只跑受影响文件，跑 e2e 前停掉多余开发服务。
- 收口：`bun run test:affected --typecheck`、`docs:check`、`governance:check`；对比度与取景用真实页面截图，亮暗各一，交开发者看。
- 明确留下的未验证：浏览器侧 WebP 转码在不同浏览器的压缩结果；导出的包在真实重启后生效这一步（只在测试里装、列出，不重启整个应用）。

## 不做与风险

- 不做：图标集、按状态换场景、由代码提供的场景（声明里没有）；选本机字体；云同步；插件主题的原地修改。
- 风险：推导规则的观感——规则是我定的，对比度能保证，好不好看要开发者看；S4 做完先给开发者看推导的几组结果再继续。
- 风险：取景框与真实位置的换算依赖“参照盒子”，窗口尺寸变了真实裁切会和框有出入；编辑器里说明这是示意，真实位置同时变化可核对。
- 风险：`fflate` 进浏览器构建的体积；导出导入放在动态导入里，进编辑器才加载。
- 风险：编辑器改动会触发整套主题变量重写；防抖写入，避免拖滑块时卡顿，S4 量一次。

## 待开发者确认

1. **推导出的配色观感**：S4 完成时给几组结果看，不满意再改规则。
2. **“我的”主题的 id 用 `user:<uuid>`**：冒号不会和插件 id 撞；设置文件里能看到这个值。
3. **素材整理在编辑器关闭时做**：不再被引用的素材才删。若想保留历史素材，改成不自动删。
