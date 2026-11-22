# t47 计划：nb-layout 的编译产物与发布通道（第 2 稿）

第 2 稿按第 1 轮设计审查（omp `@review`，阻断 2、重要 3、建议 4（第 9 条与第 8 条重复），[证据](evidences/design-review.txt)）改：网页构建与发布构建分开输出目录；`private` 时发版准备与 Release 说明都跳过它；第三方声明只按自家包的许可过滤；nb-story 的网页包带上第三方声明；网页包的新旧记录按真正打进去的源文件；冒烟用类型检查碰四个入口；CI 的 `app-package` 作业加一步完整构建。逐条处理见文末“设计审查”。

## Context

- **为什么做**：[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 5、6、7 条把“nb-layout 发 MIT、发编译产物”排在第二档，[提案](../../../../../docs/proposals/nb-layout-general-library.md)的“第二档：发布流水线”与“MIT：要处理的事实”写了要接的地方与凭记忆列的坑。第二档顺序开发者 2026-11-22 追认（t43 → t44 → t45 → t46 → t47 …）。
- **开发者已定**：nb-layout 发 MIT（2026-11-18：“可以发 MIT”）；第一个外部使用方是 nb-story（2026-11-18）；发到 npm 由开发者执行（Task README）。
- **输入**：
  - [t43](../t43-tier2-verification/README.md) 的“给 t47 的输入”与[原型构建](../t43-tier2-verification/evidences/proto-build.txt)：出声明用 `rolldown-plugin-dts`、声明不可复现、`style.css` 与 `sideEffects`、`lab-sources` 不发、产物去注释、Trellis 核对已完成；
  - [t46](../t46-english-default-text/README.md)：nb-layout 的变更记录要写“没有注入时的缺省语言从 zh-CN 改成 en-US”与新增 `layoutCatalogTranslate`；
  - t44、t45 的接入记录（nb-story 用公开面的体验，给 t48、t49）。
- **本稿开工前的两个探针**（[证据](evidences/probes.txt)）：
  1. **字节稳定**：同一份源码连续构建 4 次，JS、CSS 与文件名都相同，`vue.d.ts` 有 3 种（两个组件的事件、属性在类型字面量里的先后不同）；同一个目录打两次 tarball 字节相同，所以 tarball 跟着 `vue.d.ts` 变。`eager: true` 仍不稳（5 次 2 种）。改成先用 `vue-tsc --emitDeclarationOnly` 一次出全部声明（4 次相同），再用 `rolldown-plugin-dts` 的 `dtsInput` 只打包这些 `.d.ts`（3 次相同）。
  2. **nb-story 改读产物**：见“关键设计”的 nb-story 一节与探针证据（`frame`、`viewer` e2e 在压缩产物加显式 `style.css` 上的结果）。
- **工作方式**：autonomous-delivery。计划审查交 omp（`--model @review`，后端与发布脚本），阻塞。worktree 在 t45 合入 master 之后开。不 push，不发 npm。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| JS 与 CSS | Vite 库模式（`build.lib`，仓库已有，SDK 的 `pack.ts` 同样用） | t43 原型一次过，产物逐字节可复现 | — |
| 类型声明 | `vue-tsc --declaration --emitDeclarationOnly` 出到临时目录，再用 rolldown 加 `rolldown-plugin-dts`（`dtsInput: true`）打成四个入口 | 一个程序按固定顺序出，探针 4 次相同；只打包已有的 `.d.ts`，不再调类型检查器 | 直接用 `rolldown-plugin-dts` 的 `vue: true`（SDK 的做法）：类型字面量的成员先后随文件处理顺序变，tarball 每次不同；不打包、发 65 个声明文件：内部文件结构成了可见的一部分，与 SDK 的形状不一致 |
| 打包 tarball | `bun pm pack`（`pack-smoke.ts` 已用） | 同一目录两次打包字节相同 | — |
| 冒烟的宿主与浏览器 | 空的 Vite 项目加 `playwright-core` 的 Chromium（`pack-smoke.ts` 已有 `smokeVueHost`、`checkPages`） | 照现有冒烟的写法 | — |

## 关键设计

### 产物：`packages/nb-layout/scripts/pack.ts`（新），脚本 `build:package`

- 产出 `packages/nb-layout/dist/package/`（`dist/` 已被忽略）：`index.js`、`vue.js`、`text.js`、`locales.js` 与共享块、`style.css`、四个入口的 `.d.ts` 与共享声明块、`package.json`、`README.md`、`LICENSE`。
- 入口四个：`.`（`src/index.ts`）、`./vue`、`./text`、`./locales`；`lab-sources` 不进（`import.meta.glob` 只有 Vite 宿主能用）。外置 `vue`、`tabbable`。
- JS：`minify: true`（源码注释与 Spec 编号不进包）；共享块名字中性（`chunkFileNames: "shared-[hash].js"`）；`cssFileName: "style"`。
- 声明：先 `vue-tsc` 出到 `dist/.types/`（专用的 `tsconfig.package.json`：`include` 是 `src`，排除测试、夹具与 `lab-sources`），再打包，删掉临时目录。声明里的 `//#region <路径>` 注释带构建目录的相对路径，打包时从同一个固定目录读，不随调用位置变。
- 声明里的 JSDoc 留着（它就是使用方在编辑器里看到的说明），但不带 Spec 编号：源码里公开类型注释的“输出 N”“docs/specs/…”（探针数到约 25 处）改成直接写行为或链到 GitHub 上的 Spec 文件，与 README 的做法（`readme.test`）一致。
- 两种输出，目录分开（审查第 2 条：发布冒烟里 nb-story 的 `prepack` 会在 nb-layout 完整构建之后再跑网页构建，同一个目录会把声明冲掉）：
  - `build:package`：完整构建，写 `dist/package/`（约 8 秒）。只有它写这个目录。
  - `build:package --web`：只出 JS 与 CSS，写 `dist/web-build/`（约 1.5 秒），给 nb-story 的网页构建用；不写 `package.json`、不出声明。
- 两种输出都写一份 `inputs.json`：Vite 实际处理过的 nb-layout 源文件（相对包目录，按字母排），给 nb-story 的网页包新旧记录用（审查第 6 条）。
- 生成的 `package.json`：名字、版本、描述、仓库、`publishConfig` 取源码包的；`license: "MIT"`；`type: "module"`；`sideEffects: ["**/*.css"]`；`exports` 每个入口 `{types, import}`，另加 `"./style.css"`；`dependencies` 只有 `tabbable`、`peerDependencies` 只有 `vue`（从源码包抄，`typescript` 这个 peer 不抄：产物不需要它）；`private` 照抄源码包（见“第一次发布的开关”）；`files` 列 `*.js`、`*.d.ts`、`style.css`、`README.md`、`LICENSE`（发布清单检查按它找会发布的文件）。不写 `engines.bun`：这是给浏览器的库。键的先后固定（按上面的次序写），同一份输入写出同一份字节。
- 构建完自查，失败就以 1 退出：
  - 每个入口产物的导出名与源码入口的导出名相同（各 `import` 一次比 `Object.keys`）；
  - `index.js`、`text.js`、`locales.js` 的导入图里没有 `vue`；
  - 包里没有 `lab-sources`、测试、夹具；JS、CSS、声明里没有 `输出 \d+`、`docs/specs/`。
  自查的判断写成纯函数，在 `scripts/pack.test.ts` 里用小样本单测；完整构建不进快速测试（约 8 秒，超出 200 毫秒的预算），由下面的冒烟跑。
- 源码包的 `exports` 加 `"./style.css": "./src/vue/global.css"`：仓库里走源码时，组件的 scoped 样式由宿主的 Vite 编译，`global.css` 已由 `./vue` 导入，同一个模块不会重复；这样使用方写同一句 `import "@notnotype/nb-layout/style.css"`，走源码与走产物都成立。

### 第一次发布的开关：源码包的 `private`

npm 要包已经存在才能配置流水线的信任（[发布手册](../../../../../docs/standards/releasing.md)的“新包首发”），所以 nb-layout 的第一次发布只能由开发者在本机做。不加开关的话，nb-layout 进了发布清单、registry 上没有这个版本，下一个 `v*` 标签就会让流水线去发它，又因为没有信任配置失败。

- 源码包 `private: true` 时（现在就是）：冒烟照样生成、检查、打 tarball、装进空项目验一遍，但它不写进 `release-manifest.json`、不进发布计划、`release:publish` 不发。tarball 打在冒烟的临时目录，不放 `dist/release/`。
- 开发者决定首发时：删掉 `private`、在 `CHANGELOG.md` 的 `[Unreleased]` 下补好条目，合入 master，再按发布手册的“本机发布”发、配信任。之后它和源码包一样：提了版本号就是这次发。
- `prepare` 与 `release-notes` 判断“这次发不发”时，上一个桌面版本标签下的 `package.json` 是 `private` 的，按“那时还没有这个包”算（`previousVersion` 为 null）：第一次发布要有 `[<版本>]` 段。
- 这条开关与“MIT 对已发的版本不可逆”是同一件事：删 `private` 就是开发者的发布决定，写进最终汇报的第一条。

### 发布脚本：独立版本的生成包（`scripts/release/`）

现在的两条通道：源码包（`RELEASE_PACKAGES`，版本手工提）与生成包（`BUILT_PACKAGES`，版本就是产品版本）。nb-layout 是“生成的、版本独立”。不另加第三张清单，给生成包的条目加两个字段：

```ts
type BuiltPackage = {
    name: string; source: string; script: string; outDir: string; repositoryDirectory: string;
    /** "product"：版本就是产品版本（应用与 SDK）；"own"：版本取源码包的 package.json，手工提（nb-layout）。 */
    version: "product" | "own";
    /** 发布清单检查要求的许可；"MIT" 的包 LICENSE 与源码包里的相同、不与仓库根比，也不要求 engines.bun。 */
    license: "AGPL-3.0-only" | "MIT";
};
```

要改的地方（每处都假定了“生成的就是产品版本”或“列在清单里的就是 AGPL 的源码包”）：

- `packages.ts`：`checkReleasePackages` 的许可、`LICENSE`、`engines` 按包的 `license` 判断（源码包都是 AGPL）；`private` 的生成包不算“发布的包”（`releaseNames`），检查时跳过 `private` 一项；`releaseDirectories()` 已经含生成包的源码目录（`packages/nb-layout`），它的干净检查用 `--untracked-files=all`，产物在已忽略的 `dist/` 下不受影响。
- `publish.ts`：`productPackages` 只收 `version: "product"` 的（第 251 行现在收全部生成包）；typecheck 的包名到源码目录的对应（第 152 到 153 行）照旧按 `source`。
- `pack-smoke.ts`：生成循环照旧跑每个条目的 `script`；`private` 的不进 `release-manifest.json`；`--from registry`（第 479 到 480 行）给生成包配清单时，`own` 的版本取源码包的 `package.json`，`private` 的跳过；`FORBIDDEN` 对新包同样成立（产物里没有测试与 `AGENTS.md`）。
- `prepare.ts`、`release-notes.ts`：要看版本与变更记录的包从“`RELEASE_PACKAGES`”改成“版本手工提的包”（源码包加 `own` 的生成包，版本都在 `packages/<目录>/package.json`）。现在是 `private` 的整个跳过：不定稿它的变更记录、不在 Release 说明里列它（审查第 5 条）；上一个标签下是 `private`、现在不是的，按“那时还没有这个包”算，要有 `[<版本>]` 段。
- 核过不用改的：`tag.ts verify-built` 只按名字查应用包与 SDK 的版本（`builtVersionProblems`）；`registry-wait` 与 `release.yml` 的 `registry-smoke` 只等清单里的包（`private` 的不在）；`release.yml` 的 `npm-packages` 与 B′ 作业经 `release:smoke` 生成，nb-layout 的 `build:package` 跟着跑。
- nb-story 的 `devDependencies` 里 `@notnotype/nb-layout` 从 `workspace:*` 改成 `workspace:^`：nb-layout 首发之后算“发布的包”，`checkReleasePackages` 对发布的内部依赖一律要 `workspace:^`（第 179 行，含 `devDependencies`）。

### MIT

- `packages/nb-layout/LICENSE` 换成 MIT 全文（`Copyright (c) 2026 notnotype`，与仓库地址里的名字一致）；源码包 `license` 改 `MIT`；README 的末尾写明许可与仓库根不同。
- 根 `README.md` 的许可证两处补一句例外（徽章那段与“许可证”一节）。
- `packages/nb-layout/AGENTS.md` 写“MIT 的包不从 AGPL 的代码搬内容；要从 AGPL 的包复制进来的逐文件复核”。
- 第三方声明：`packages/neuro-book/scripts/third-party-notices.ts` 的两处过滤（`packageNotices`、`viteLicenseNotices`）现在是“名字以 `@notnotype/` 开头就不列”。改成只对自家的包看许可：`@notnotype/*` 里许可是 `AGPL-3.0-only` 的不列（与发布包同一许可），别的（nb-layout 的 MIT）列出；别人家的包不论什么许可都照列（审查第 3 条：只按许可过滤会把第三方 AGPL 依赖的声明也删掉）。单测三种样本：自家 AGPL 不列、自家 MIT 列、第三方 AGPL 列。
- nb-story 发的包里 `dist/web` 打进了 vue、sigma 等 MIT 的依赖，现在就没有第三方声明（t47 之前就如此）；t47 再打进 MIT 的 nb-layout（审查第 4 条）。nb-story 的 `vite.config.ts` 开 Vite 的 `build.license`（`fileName: "THIRD-PARTY-NOTICES.md"`，写进 `dist/web`，随 `files` 里的 `dist/web` 进包），一次补齐。实施时先核它列不列走别名的 nb-layout（应用与 SDK 的清单里列出了工作区包，所以过滤器才要排掉 `@notnotype/*`）；不列就在同一个插件的 `writeBundle` 里补上 nb-layout 的 `LICENSE` 全文。冒烟查 nb-story 的 tarball 里有这个文件、写着 `@notnotype/nb-layout` 与 MIT。
- `packages/nb-layout/CHANGELOG.md` 现在建（ADR 0053 第 4 条写“下一次提版时建”，nb-layout 的第一次发布就是那一次）：`[Unreleased]` 下写编译产物与 `style.css`、MIT、t46 的缺省英文与 `layoutCatalogTranslate`。

### nb-story 的网页构建读产物：`packages/nb-story/vite.config.ts`、`package.json`

- `build:web` 先跑 `bun run --cwd ../nb-layout build:package --web`，再 `vite build`；`vite.config.ts` 在 `command === "build"` 时把 `@notnotype/nb-layout`、`/vue`、`/text`、`/locales`、`/style.css` 指到 `../nb-layout/dist/web-build/` 里的产物（精确匹配的别名）。产物不在时 Vite 解析失败、构建失败，不退回源码。
- `src/web/main.ts` 导入 `@notnotype/nb-layout/style.css`（走源码时是 `global.css`）。
- 跑 nb-story `vite build` 的路径都经 `build:web`：`prepack`、`test:e2e`、`serve` 提示的重打命令、冒烟（`prepack`）。直接 `vite build` 而没先出产物的，按上一条失败。nb-story 没有 Vite 开发服务（`nbstory serve` 发的是 `dist/web`）；开发者面板 `nbdev dev start` 起的是新应用，新应用、工作台、Lab、开发者面板照旧走 nb-layout 的源码。
- 网页包比源码旧的提示（[`story/cli-skill`](../../../../../docs/specs/story/cli-skill.md) 输出 19）：现在记的是打进包的源文件；读产物之后，打进包的是 nb-layout 的产物，它的源码改了不会被发现（探针：记了 6 个产物文件、0 个 nb-layout 源文件）。`webStamp` 看到 `dist/web-build/` 里的文件时，改记那份 `inputs.json` 列的源文件：只记真正进了产物的，组件说明、README、`lab-sources` 这些没进的不记（审查第 6 条）。单测：产物文件换成源文件；没进产物的文件变了不报旧。
- 这样 nb-story 的 e2e 每次都跑在压缩产物加 `style.css` 上，两条路（仓库里走源码、第三方走产物）每次构建都比一次；拖动会话、落点反馈、内容层这些冒烟里不做的，由 nb-story 的 `side-by-side`、`frame` e2e 盖到。

### 冒烟：`scripts/release/pack-smoke.ts` 加 `smokeLayoutHost`

- 空的 Vite 项目只装 nb-layout 的 tarball（`overrides` 同现有做法）与 `vue`、`vite`、`@vitejs/plugin-vue`、`vue-tsc`、`typescript`；`App.vue` 原样取 README“起步”那段（它与 Lab 的 starter 场景一字不差，`readme.test` 核对），`main.ts` 导入 `style.css` 后挂上它：README 的例子在产物上能用，就是使用方照着写能用。
- 另放一个类型样本 `types.ts`，从四个入口各导入值与类型并用上（`LAYOUT_TEXT_KEY`、`layoutCatalogTranslate`、语言目录的类型等，审查第 7 条：起步例子只碰根入口与 `./vue`）。
- `vue-tsc --noEmit`（`skipLibCheck: false`）通过；`vite build` 通过；`vite preview` 起在空闲端口，Chromium 里：分隔线有 `role="separator"` 与读屏名称；按方向键与拖动各改一次宽度（读两侧的宽度）；样式生效（分隔线的计算光标是 `col-resize`）；页面没有报错。
- 字节稳定：冒烟里把 nb-layout 的 `build:package` 连跑两次，产物目录逐文件相同才往下走（防住声明的不可复现回来，整轮重跑时发布计划会因此失败）。

### CI：`.github/workflows/ci.yml` 的 `app-package` 作业

加一步 `bun run build:package`（`packages/nb-layout`）：构建脚本、插件选项与自查在每个 PR 上跑一次，不等到发版演练（审查第 8 条）。作业名改成“应用包、SDK 与 nb-layout 的产物能打出来”。浏览器冒烟仍只在 `release:smoke`。

## Spec 与文档改动

- [`story/cli-skill`](../../../../../docs/specs/story/cli-skill.md) 输出 19：补一句“读编译产物的工作区包，记它的源文件”（行为不变，写明范围）。
- [`docs/standards/releasing.md`](../../../../../docs/standards/releasing.md)：“阶段与版本”加“独立版本的生成包”（nb-layout：版本手工提、`private` 是首发开关、MIT），并写一句：nb-layout 改了之后 nb-story 的网页包字节也变，发布计划会提示 nb-story“字节不同”，要不要同批提 nb-story 的版本由开发者定（审查第 1 条）；“本机发布”的包数；“一次性准备”的新包首发补 nb-layout 的步骤。
- 根 `README.md` 两份包表加 nb-layout；搜“12 个包”“十二”这类包数一并改（`packages.ts` 的注释要求）。
- `packages/nb-layout/README.md`：安装一节现在写“包以源码发布（`exports` 指向 `.ts` 与 `.vue`）”与对等依赖 `typescript`，改成编译产物、导入 `style.css` 一步、对等依赖只有 `vue`、宿主是 Vue 3 加 Vite（其余打包器没测过）；加许可证一节。
- [`packages/AGENTS.md`](../../../../../packages/AGENTS.md)：nb-layout 那句补“MIT、以编译产物发布”。
- 不新增 Spec：包的发布形态写在 ADR 0054 第 6 条与包 README；nb-layout 的行为合同（`ui/nested-grid` 等）不变。

## 切片

1. **产物**：`pack.ts`、`tsconfig.package.json`、自查与单测、源码包 `./style.css`、公开类型注释去 Spec 编号。验证：`bun run build:package` 两次逐文件相同；`bun test scripts`；`bun run typecheck`；nb-layout 的 `bun run test`。
2. **MIT 与声明**：`LICENSE`、`license`、README、根 README、`AGENTS.md`、`CHANGELOG.md`、`third-party-notices.ts` 按许可过滤与单测。验证：`bun test packages/neuro-book/scripts`（声明的单测）、`bun run docs:check`。
3. **发布脚本**：`BuiltPackage` 的两个字段、`packages.ts`、`publish.ts`、`pack-smoke.ts`（清单与 `--from registry`）、`prepare.ts`、`release-notes.ts`；nb-story 的 `workspace:^`。验证：`bun test scripts/release`；`bun run release:check`。
4. **冒烟与 CI**：`smokeLayoutHost`（含类型样本）、两次构建比对、nb-story tarball 的第三方声明；`ci.yml` 的 `app-package` 加一步。验证：`prox bun run release:smoke`（要工作树干净，先提交再跑；不发布）。
5. **nb-story 读产物**：`build:web`、`vite.config.ts` 的别名、`build.license` 与 `webStamp`、`main.ts` 的样式导入。验证：nb-story `bun run typecheck`、`bun test src`（含 web-stamp 的单测）、`build:web` 后跑 `frame`、`side-by-side`、`viewer` 三个 e2e 文件；改一个 nb-layout 源文件，`nbstory serve` 提示网页包旧。
6. **收口**：发布手册、包表、`packages/AGENTS.md`、Task README、待确认清单；实现审查（omp `--model @review`，脚本与构建；nb-story 一节很小，一并审）。

## 验收映射

| 依据 | 覆盖 |
|---|---|
| ADR 0054 第 6 条：ESM、类型声明、`style.css`，承诺 Vue 3 加 Vite | 切片 1 的自查；冒烟 `smokeLayoutHost`（`vue-tsc`、`vite build`、浏览器） |
| ADR 0054 第 5 条：MIT、发布脚本按包判许可、不丢 MIT 声明 | `packages.test.ts`（MIT 的生成包过检查、AGPL 的照旧）；`third-party-notices` 单测 |
| 提案“第二档：发布流水线”：版本独立、同版本不同字节的处理 | `release-plan.test.ts`（`own` 的生成包按历史包处理）；冒烟的两次构建比对 |
| 首发由开发者做 | `pack-smoke`、`publish` 的单测：`private` 的生成包不进清单；`prepare`、`release-notes` 的单测：上一标签下 `private` 的按新包 |
| `story/cli-skill` 输出 19 | `web-stamp` 单测：产物文件换成 `inputs.json` 列的源文件；没进产物的文件变了不报旧 |
| 不丢 MIT 声明（nb-story 的包） | 冒烟：nb-story 的 tarball 里有 `dist/web/THIRD-PARTY-NOTICES.md`，写着 `@notnotype/nb-layout` 与 MIT |
| 产物在每个 PR 上能打出来 | CI 的 `app-package` 作业 |
| 两条路一致 | nb-story 的 `frame`、`side-by-side`、`viewer` e2e 跑在产物上 |

## 验证

- 切片内按上表；收口跑一次 `release:smoke`（本机，`prox`，工作树干净）与 nb-story 的三个 e2e 文件。
- 不验证：npm 上的实际发布、流水线里的信任配置（都是开发者的动作）；webpack、Nuxt 等别的宿主（不承诺）。

## 不做与风险

- 不做 API 报告与 `@stable` 标注（t48），不改 nb-layout 的行为。
- 风险：`vue-tsc` 出的声明与 `rolldown-plugin-dts` 直接出的有细节差别（例如组件的泛型、`defineSlots`）。兜底是冒烟里空项目的 `vue-tsc`（`skipLibCheck: false`）用起步例子把主要入口都碰一遍，与 t43 原型同样的用法。
- 风险：nb-story 每次 `build:web` 多约 1.5 秒；变异检查脚本照旧经 `build:web` 重建。
- 插件 SDK 的声明也是 `rolldown-plugin-dts` 的 `vue: true` 出的，可能同样每次不同（它是产品包，整轮重跑时发布计划会因此失败）。切片 1 顺带把 `build:sdk` 连跑两次比声明，结果记进证据；不同的话记进 Work 的后续，不在本 Task 改。

## 待确认清单（实施时写进 Work 的清单）

- 源码包的 `private` 作首发开关，删它由开发者做；首发前 nb-layout 只在冒烟里验，不进发布清单。
- 声明里留 JSDoc、去 Spec 编号（改成写行为或链 GitHub）。
- nb-story 的网页构建一律读产物（`build:web` 先出 nb-layout 的 JS 与 CSS）。
- nb-story 的网页包带第三方声明（`build.license`），连之前就缺的 vue、sigma 一起补。
- 变更记录在首发之前建。

## 设计审查

第 1 轮：omp `--model @review`，90 分钟到时间上限截停，报告写了 8 条，用原会话续跑两次（第一次上游断开）补齐汇总与第 9 条（与第 8 条重复）（[证据](evidences/design-review.txt)）。

1. nb-layout 发新版而 nb-story 没提版时，npm 上 nb-story 的网页仍是旧的（重要）：不成立。t47 之前就是这样：nb-story 打进网页的 nb-ui、nb-agent-ui 等改了也一样，发布计划会提示 nb-story“字节不同”，提不提版由开发者定（[发布手册](../../../../../docs/standards/releasing.md)“源码改过没提版本号的老版本是常态”）。补一句进发布手册。
2. 网页构建冲掉发布目录（阻断）：成立，两种输出分目录。
3. 按许可过滤会删掉第三方 AGPL 依赖的声明（重要）：成立，只对自家包看许可。
4. nb-story 的包带 MIT 代码而没有声明（重要）：成立，开 `build.license` 一次补齐（连 vue、sigma 之前就缺的）。
5. `private` 时仍会定稿、列进 Release 说明（阻断）：成立，现在是 `private` 的整个跳过。
6. 网页包新旧记录记整个 `src`（建议）：成立，按产物的 `inputs.json`。
7. `text`、`locales` 的声明没被类型检查（建议）：成立，冒烟加类型样本。
8. PR 的 CI 不跑完整构建（建议）：成立，`app-package` 作业加一步。
9. 同第 8 条（续跑时重写了一遍）。

审查者对待确认项的判断与第 2 稿的改法一致（`private` 要连发版准备、Release 说明一起跳过；网页构建用单独的目录；nb-story 的包要带声明）。第 2 稿照审查的改法改，不再开第 2 轮；实现审查仍交 omp。
