---
schema: nbook.walkthrough/v1
taskId: t04-nb-ui-adoption
sequence: 1
role: tasker
status: in-progress
createdAt: 2026-08-30T00:00:00Z
---

# t04 接入 nb-ui 与第一个消费者

## 已完成

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

- `packages/nb-ui` 许可证由 `PolyForm-Noncommercial-1.0.0` 改为 `AGPL-3.0-only`，`LICENSE` 替换为与仓库根一致的 AGPL 全文，`PROJECT-STATUS.md` 的许可证描述同步更新。
- `packages/neuro-book` 新增 `@notnotype/nb-ui` workspace 依赖，`bun install --linker hoisted` 更新 `bun.lock`（25 行新增、4 行删除）。
- `nuxt.config.ts` 在 reset 之后、领域样式之前加入 `@notnotype/nb-ui/styles.css`，并新增 `build.transpile`。未启用 nb-ui 的 Nuxt module。
- `JsonViewer.vue` 工具栏六个按钮全部切换到 nb-ui。三个动作按钮（复制、展开全部、折叠全部）用 `IconButton`，尺寸 `sm`；三个模式按钮（文本、树形、表格）用 `ToggleGroup` 的纯图标形态，单选。`.json-viewer__icon-button`、`.json-viewer__mode-button`、`.json-viewer__modes` 的全部样式已删除，文件内这三个类名出现次数均为 0。
- `packages/nb-ui/tsconfig.json` 不再继承 `playground/.nuxt/tsconfig.json`，改为自包含；新增 `playground/tsconfig.json` 承接 Nuxt 生成类型，`typecheck` 脚本追加 `vue-tsc --noEmit -p playground`。
- 新增 `app/components/common/JsonViewer.md`，本仓库第一份组件文档。

## 已验证

- 主应用 `typecheck`：无输出，退出码 0。执行前先运行 `generate` 补上新 worktree 缺失的 Prisma client。
- `bun --cwd=packages/nb-ui run typecheck`：两遍 `vue-tsc` 均无输出，退出码 0。
- `bun run docs:check`：`failures: []`。新增的组件同名文档没有触发文档结构检查。
- nb-ui 与主应用的 CSS 变量声明无同名冲突：nb-ui 声明 94 个（不含 `--tw-*`），主应用 `theme-vars.css` 声明 66 个，交集为 0。
- nb-ui 的 `dist/nb-ui.css` 中唯一的通配选择器是 Tailwind 的变量初始化块，只设置 `--tw-*`，不改变任何视觉属性；没有裸元素选择器重设现有元素样式。
- 开发服务可以正常启动并提供页面：修复 tsconfig 后重启，此前报错的 `packages/nb-ui/src/components/index.ts` 能正常返回转换后的 JS，日志中 `failed to resolve` 与 `Internal server error` 计数均为 0，根页面 http 200。

## 命令形式修正

仓库 `AGENTS.md` 的「常用命令」里 `bun --cwd packages/neuro-book run …` 这一空格形式在 bun 1.3.14 下不工作，会直接打印 `bun run` 用法并退出。该版本的 `--cwd` 必须写成等号形式 `bun --cwd=packages/neuro-book run …`，已实跑验证。受影响的命令有六条：`dev`、`dev:runtime`、`build`、`typecheck`、`migration:check`、`generate`。`AGENTS.md` 的订正未在本 Task 内执行。

## 未验证

- 浏览器行为、桌面与 `390×844` 视觉、六个按钮的实际点击结果与焦点环，均未运行。
- 没有覆盖 JsonViewer 工具栏的自动化测试。仓库内唯一引用该组件的测试文件不在 vitest 的 include 范围内，不构成回归防线。
- 产品构建未运行，样式在真实构建下的层叠顺序未验证。

## Nuxt 子目录 index.vue 命名探针

在 `novel-ide`（带前缀）与 `common`（免前缀）两个目录各放一对探针组件后运行 `nuxi prepare`，读取生成的 `.nuxt/components.d.ts`：

| 源文件 | 注册名 |
|---|---|
| `novel-ide/NamingProbe/index.vue` | `NovelIdeNamingProbe` |
| `novel-ide/NamingProbeFlat.vue` | `NovelIdeNamingProbeFlat` |
| `common/ProbeCommon/index.vue` | `ProbeCommon` |
| `common/ProbeCommonFlat.vue` | `ProbeCommonFlat` |

结论：`Foo/index.vue` 与 `Foo.vue` 得到完全相同的注册名，`index` 不进入组件名，免前缀目录同样成立。**组件目录化不会改变任何组件名，也不改变现有的同名碰撞情况。**探针已删除，仓库中不留该形态的组件。

## 发现一：nb-ui 的 tsconfig 继承一个 gitignore 的生成物

`packages/nb-ui/tsconfig.json` 原本第一行是 `"extends": "./playground/.nuxt/tsconfig.json"`，而该路径由 `.gitignore` 排除，是 `nuxt prepare playground` 的产物。任何新克隆或新 worktree 里这个文件都不存在，nb-ui 的根 tsconfig 因此无法解析。

这是 nb-ui 自身的既有缺陷，不是 t04 引入的；但 t04 让主应用第一次编译 nb-ui 源码，Vite 会为它转换的每个 `.ts` 文件向上找最近的 tsconfig 并解析 `extends` 链，于是缺陷变成主应用的 `Internal server error`，开发服务无法使用。

修复放在缺陷所属的包：根 tsconfig 改为自包含，playground 的 Nuxt 类型移到 `playground/tsconfig.json`，`typecheck` 脚本补上对 playground 的第二遍检查以免类型覆盖被悄悄削掉。两遍 `vue-tsc` 均无输出，此前担心的潜藏类型错误没有出现。

考虑过但否决的两个办法：让开发者先跑一次 `nuxt prepare playground`（把每台机器的手工步骤当依赖，CI 与新克隆仍然会坏），以及在主应用里用 `vite.esbuild.tsconfigRaw` 覆盖（在错误的包里加全局 hack）。

对照仓库里其余包：nb-history、nb-workflow、nb-memory、neuro-book-contracts 的 tsconfig 都是自包含的，nb-ui 是唯一的例外。

## 发现二：模式按钮可以迁移，ToggleGroup 覆盖这个形态

本走查的初版曾结论「nb-ui 没有组件覆盖纯图标加选中态」，该结论错误，当时只看了 `IconButton` 与 `SegmentedControl`，漏掉 `ToggleGroup`。

`ToggleGroup` 的 `label` 可选，只给 `iconClass` 即为纯图标；底层 reka-ui 最终渲染 `<button type="button" aria-pressed="…" data-state="on|off">`，并由 roving focus 提供方向键切换，选中语义完整。三个模式按钮已据此迁移。

一处必须挡住的行为差异：reka-ui 单选模式下再次点击当前项会把值设为空以取消选择（`useSingleOrMultipleValue.changeModelValue`）。查看器必须始终处于某个模式，因此 `switchMode` 对空值直接返回，保持原模式。这与旧按钮「点击当前模式无变化」的表现一致。

一处可见变化：`ToggleGroup` 会给整组套一个带边框和浅底色的容器，而旧实现是三个各自独立的方块。此前两组按钮边框风格不一致（左组有边框、右组无边框）的问题随之消失。

## 发现三：ToggleGroup 的可访问名称只有 title

`IconButton` 有 `:aria-label="props.ariaLabel || props.title"`，`ToggleGroupOption` 没有 `ariaLabel` 字段，纯图标项只能靠 `title` 提供名称。`title` 是可访问名称计算的最末位来源，弱于 `aria-label`。

迁移前的旧模式按钮同样只有 `title`，因此这不是回退，且迁移额外带来了 `aria-pressed`。缺口登记在此，修法是给 nb-ui 的 `ToggleGroupOption` 补 `ariaLabel`，属于公共组件的接口扩展，不在本 Task 范围内。

## 发现四：nb-ui 依赖宿主提供两个未定义变量

nb-ui 引用 106 个自定义属性。逐一比对后，`--overlay-bg` 与 `--shadow-panel` 既不由 `dist/nb-ui.css` 声明，也不在主应用 `theme-vars.css` 中，且在部分用法上没有兜底值。nb-ui 自己的 README 也把这两个列为需要宿主提供的变量。

本 Task 不受影响，`IconButton` 与 `ToggleGroup` 均未使用它们。但迁移浮层与面板类组件（Dialog、Dropdown、Panel）时会得到空值，需要在对应切片前补齐宿主变量或为它们提供兜底。

## 发现五：组件文档的详略分档没有覆盖配方偏离

JsonViewer 的标签为 `state:local` 与 `env:clipboard`，不落在五种推荐配方内，属于档位 D 配方偏离。组件规范的详略分档表只写了纯零件、受控零件、领域视图、宿主与流式宿主，没有说配方偏离该写多少。

本次按「写出 Lab 演示不出来的部分」处理，完整写了六节。规范需要补一条对配方偏离的默认要求。
