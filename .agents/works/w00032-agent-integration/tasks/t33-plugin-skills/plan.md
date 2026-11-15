# t33 计划：插件的 Skill 与 SDK 构建

## Context

**为什么做。** [t15](../t15-skills/README.md) 定了 Skill 的三个来源：内置、插件、`user://skills/`。插件这一路拆到了本 Task（t15 第 20 条），[`agent/skills.md`](../../../../../docs/specs/agent/skills.md) 现在写着“插件贡献的 Skill 以后另定”。期望的结果：

- 插件经贡献点 `agent.skills` 带上 Skill；
- `nbooke build` 把每个 Skill 的脚本连同 npm 依赖打成单文件，装好就能用、不用初始化；
- 打不进单文件的，构建失败并说明原因。

**开发者已定的事。**

- t15 第 7 条：构建时带齐依赖，`bun build --target bun`；打不进的（原生模块、运行时读包内数据文件、Python 脚本）构建失败。
- t15 第 9 条：最小安装单位是插件。
- t15 第 13 条：id 带来源前缀，插件的是插件 id，不做同名覆盖。
- t15 第 20 条：目录服务按来源设计，接上只多一个来源。
- [t10](../t10-agent-plugin/README.md)“后续修改”：构建预设顺带打包 Skill。

**工作方式。** worktree `.worktree/w00032-t33-plugin-skills`，分支 `feat/w00032-t33-plugin-skills`。按切片提交，实现审查前后端各一路，合入 master 不请示。

**现状里决定设计的几件事**（调研时核实过）：

- 插件构建 `src/plugin-platform/build/build-plugin.ts` 用 Vite/Rolldown 打入口。它只往 `dist/` 放代码、样式、`locales/` 与 `package.json`，Skill 文件夹不会被带进去。
- 插件代码拿不到自己的安装目录。服务端内部有 `InstalledPlugin.root`，浏览器经插件文件端点按路径逐段读。有过“声明一个相对路径”的先例：主题的 `scene`，它的路径规则在 `workbench/shared/themes.ts` 的 `pathProblem`。
- 第三方插件的安装、启停、卸载都在下一次启动生效（`plugin-install.md`）。所以一次运行里，插件集合与它们的安装目录不变。
- 现在还没有内置 Skill：目录服务的 builtin 根是 `null`。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 打包 Skill 脚本 | `Bun.build`（`target: "bun"`、`metafile`） | 第 7 条点名 `bun build --target bun`；`nbooke` 只在 Bun 上跑；Skill 脚本由 shell 用 Bun 运行 | 插件入口那套 Vite/Rolldown：外部引用按“宿主模块”划分，每个脚本都要单独配一份，和“依赖全部打进去”正好相反 |
| 查打不进单文件的情况 | 打进产物的每个源文件（从 metafile 的 `inputs` 取）与产物本身，用 `vite` 的 `parseAst`（oxc，SDK 的构建依赖里已有）解析，按语法查；内置模块用 `node:module` 的 `isBuiltin` | 按语法查，字符串与注释不会误判；按源文件查，能指出是哪个依赖；Bun 的 `isBuiltin` 认 `undici`、`ws`、`bun:*` | 在产物文本里搜（字符串、注释会误判）；`Bun.Transpiler.scanImports`（认不出 `__require(...)`）；metafile 的外部引用（cheerio 误报 `./stringify`）；查“产物里有作者目录的绝对路径”（`import.meta.url` 不会被换成绝对路径，查不出） |
| 读 `SKILL.md` | 复用 `backend/skills/package.ts` 的 `readSkillPackage` | 构建时与运行时判“无效”用同一套规则 | — |

不加新依赖。`readSkillPackage` 用到的 `yaml` 要登记进 SDK 的构建依赖（`plugin-sdk/dependencies.ts`）。

**实验**（实验文件在仓库外，不入库）：

- 拿 Skill 常用的十个 npm 包各写一个脚本打包：zod、yaml、jszip、exceljs、pdf-lib、docx、cheerio、csv-parse、marked、sharp。九个通过下面全部检查。sharp 被“运行时还要取模块”拦下：它按平台拼名字加载原生库，打不进单文件，拦对了。
- 十个产物按 TS 的加载器解析都通过。
- 自造一个带 `.node` 的包：打包成功，但多出一个 `.node` 附件。
- 自造一个按 `__dirname` 读数据文件的包：打包成功，Bun 把 `__dirname` 换成了构建机器上的绝对路径。
- 自造一个 ESM 包，用 `new URL("./data.txt", import.meta.url)` 读文件：打包成功，产物里没有绝对路径。
- 设计审查之后改成按语法、逐个源文件查“用到自己的位置”（见“构建”的第 4 项）：两个自造包与 sharp 都查出来，九个常用包零误报。

## 关键设计

### 贡献点 `agent.skills`（`src/plugins/agent/shared/points.ts`）

- `skillsPoint`：`implementation: "none"`（只有顶层声明），`idPrefix: "plugin"`。声明 `{directory: string}`，是相对插件目录的路径；规则同主题的 `scene`：不是绝对路径，不含 `..`，不带协议。
- 一个贡献声明一个目录，里面每个子文件夹是一个 Skill（与 `user://skills/` 同一种形状）。Skill id 是 `<插件 id>.<文件夹名>`。
- 同一插件的两个贡献里有同名文件夹时，按贡献 id 的顺序第一个生效，后面的标无效（`duplicate`）。
- SDK 的 `/agent` 子路径加助手 `agentSkills(id, {directory})`，交回顶层贡献。
- Agent 插件的 `contributionPoints` 与 `receives` 加上它，入口交一个接收者（只用 `published` 与 `revoke`）。先例是工作台的主题：`workbench.themes` 同样是 `implementation: "none"`，也是收在接收者里。声明发布时加一个插件根，撤回时拿掉，运行中登记、停掉插件都跟着变。

### 平台：服务端查插件包里的目录（`src/plugin-platform/backend/`）

- 新服务 `pluginPackagesKey`（`plugin-platform/packages`），在 `src/server/start.ts` 的 `capabilities` 里由服务端宿主提供（与 `host.plugin-inventory` 并列），用本次启动的 `installed` 建：
  - `directory(plugin, path): Promise<string | null>`：本次启动的第三方插件当前版本目录里的子目录。逐段 `lstat`、不跟随链接（同插件文件端点的 `regularFile`），交回真实路径；不存在、在目录之外、是链接，或是内置插件时交回 null。
  - `title(plugin): string | null`：清单的 `displayName`。
- 路径的安全检查放在平台：平台知道版本目录在哪，也已经有逐段检查的写法；Agent 插件不碰安装布局。
- Agent 插件的入口把它列为可选依赖（`required: false`）：没有它的宿主（项目子进程、只装 Agent 的测试）照常启动；插件的 `agent.skills` 贡献到达时，写诊断 `skills-root-unavailable`，不出 Skill。

### Skill 目录加插件来源（`backend/skills/catalog.ts`、`shared/skills.ts`、`backend/plugin.ts`）

- **根的身份。** 现在的根是 `{source, root, watch}`，id 由 `skillId(source, 文件夹)` 生成，同一个来源只能有一个根。改成每个根带：
  - 稳定的 `key`；
  - id 前缀 `prefix`：`user`、`builtin`，或插件 id；
  - `source`；
  - 插件的 `{id, title}`（只有插件的根有）。

  `skillId(prefix, 文件夹)` 生成 id。重扫按根的 `key` 找根：`#rescanRoot(key)`；条目记住所属根的 `key`，`#rescanSkill` 按它重建 id。
- **增删根。** 目录加 `addRoot(root)`、`removeRoot(key)`，都排进原有的重扫队列，内容变了照常发 `skillsChanged`。
  - 接收者的 `published` 用 `pluginPackages.directory` 解析声明的目录。找到了，加一个插件根，`key` 是贡献 id；找不到，写诊断。
  - `revoke` 拿掉这个根。用这个插件 Skill 的 `$` 之后得 `not-found`，`skills://` 里也没有了。
  - Profile 白名单的 `"all"` 每次现算，不用另外清缓存。
- **id 撞车。** 插件的 Skill id 是 `<插件 id>.<文件夹名>`。用户与内置的名字不含 `.`，与插件的 id 撞不上。同一插件两个贡献里有同名文件夹时，按贡献 id 的码元顺序第一个生效，后面的标无效（`duplicate`）。
- **状态。**
  - 插件的 Skill 里没有 `package.json` 时是 `ready`。
  - 有 `package.json` 时是 `invalid`，原因 `plugin-skill-unbuilt`（“插件里的 Skill 没有经 nbooke build 打包”）。插件不用 `nbooke build`、直接装文件夹时就会这样。
  - 初始化只认 `user` 来源，插件的照样得 `not-initializable`。
- **监视。** 插件根不监视：装好的版本目录一次运行里不变，换版本要重启。
- **排序。** 我的 → 插件（按插件名，再按 Skill 名）→ 内置。
- **地址。** `skills://<id>/` 经 `catalog.item(id).directory` 取目录，不用改。shell 拿到的真实路径是安装目录。Agent 写入照样得 `permission-denied`。

### 构建：`nbooke build` 打包 Skill

- `build-plugin.ts` 加选项 `contributionBuilds`，每项 `{capability, build({root, out, contributions}): Promise<ManifestProblem[]>}`：
  - 在读完定义、算出清单之后调用，写进构建的临时目录；
  - 写出的内容与别的产物一起移进输出目录；
  - 问题并进 `PluginBuildError`。

  通用平台不认识 Skill。`plugin-sdk/build.ts` 把 Skill 这一步交进去。
- 新文件 `src/plugins/agent/build/skills.ts`，逐个贡献、逐个 Skill：
  1. 目录在作者目录里、存在、不是链接；`readSkillPackage` 判无效的作为构建问题。
  2. 遍历文件，跳过 `node_modules`、以点开头的、`package.json`、`bun.lock`、`bun.lockb`、`package-lock.json`。
  3. JS/TS 文件（`.js .mjs .cjs .jsx .ts .mts .cts .tsx`）各自 `Bun.build` 成单文件，写回同一个相对路径、同一个文件名（`SKILL.md` 里写的命令不用改）。
  4. `.py`：Skill 带 Python 第三方依赖时失败，判据同 `skills.md` 输出 4（有 `pyproject.toml`、`requirements.txt`、`uv.lock`，或有带 `# /// script` 内联依赖的 `.py`）；只用标准库的原样复制。这一条改了 t15 第 7 条的字面（开发者 2026-11-15，决定 2），t15 的记录与 Spec 一并写明。
  5. 其余原样复制。
- 每个脚本的检查（问题写明哪个 Skill、哪个文件、哪个依赖或源文件）：
  1. 打包器报错（例如找不到模块）。
  2. 产物不止一个文件：依赖带原生模块或附带文件（`.node`、`.wasm` 之类）。
  3. 产物里还有运行时加载模块的调用：`require`、`__require`、`import()`、`import.meta.require`。参数不是字符串字面量（按变量拼名字）的失败；参数是字符串、但不是内置模块的也失败。
  4. 打进产物的源文件里，除入口脚本自己，有用到自己位置的就失败：`__dirname`、`__filename`、`import.meta` 的 `url`、`dir`、`dirname`、`path`、`filename`、`file`、`resolve`、`require`，以及 `require.resolve`。
     - 依赖包：打包后它的文件不在了。
     - 作者自己的辅助模块：被内联进入口之后，位置就变了。
     - 入口脚本自己用这些没问题：Skill 文件夹原样带着，相对位置不变。
  5. 按原扩展名的加载器解析产物（兜底，实验里十个都过）。
- `--dev` 同样处理。SDK 包要带上这个模块（`pack.test.ts` 核对）。

### 界面（`web/components/SkillsSettingsPage.vue`）

- Skill 页分组：我的 → 每个插件一组（组头写插件名，没有 `displayName` 时写 id）→ 内置。插件的行与内置的同一种：没有“初始化”，“打开”经 `skills://<id>/SKILL.md` 只读。
- `$` 菜单不变：id 带 `.`，重名时插 `${id}`，原有规则已覆盖。
- 只是多一种同样式的分组，不出静态稿。Lab 场景加一组插件的 Skill。

### 例子与作者文档

- `plugin-sdk/examples/plugins/` 加一个带 Skill 的例子：一个 Skill，它的脚本用仓库里已有的 `yaml`。场景测试：构建，再在没有 `node_modules` 的临时目录里用 Bun 运行产物里的脚本。
- `plugin-sdk/README.md` 加一节：Skill 放哪、怎样声明、构建时做什么、哪些情况会失败。

## Spec 与文档改动

- [`agent/skills.md`](../../../../../docs/specs/agent/skills.md)：
  - “不承诺”改成插件来源已支持，内置插件不经 `agent.skills` 带 Skill；
  - 术语加插件来源；
  - 输出 1 的条目加 `plugin?`，输出 25 的分组加插件；
  - 末尾追加插件来源的条目（id、状态、没打包的无效、不能初始化），实现完成前标 planned。
- [`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)：贡献点表加 `agent.skills`。
- [`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)：`nbooke build` 一条加打包 Skill 的规则与失败原因。
- [`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)：加服务端宿主给内置插件的“查插件包里的目录”。
- `plugin-sdk/README.md`；SDK 的 `/agent` 助手注释。
- [t15](../t15-skills/README.md) 第 7 条后面注明：Python 脚本的部分由 t33 决定 2 改为“只在带第三方依赖时失败”。

## 切片

1. **平台服务、贡献点与目录的插件来源**（后端）：`pluginPackagesKey`、`skillsPoint` 与 SDK 助手、目录服务的插件来源与状态、Spec 改动。验证：`plugin-platform/backend` 与 `agent/backend/skills` 的测试，应用 typecheck。
2. **构建步骤**：`contributionBuilds` 选项、`agent/build/skills.ts`、`build-plugin.test.ts` 的用例（每种失败一条，加一条成功的：产物脚本在没有 `node_modules` 的目录里能跑），SDK 打包核对。验证：`plugin-sdk` 的测试，`pack.test.ts`。
3. **端到端串起来**：一条集成测试走真实的构建与安装链：
   1. 用 `buildPlugin` 构建一个带 Skill 的作者项目；
   2. 用插件管理的 `install` 装进状态根；
   3. 用 `prepareInstalledPlugins` 得到 `installed`，再用 `thirdPartyDefinitionsAt("server", …)` 得到它的插件定义；
   4. 交给 `agentWorld`，平台服务作为宿主能力挂上（`agentWorld` 加一个 `capabilities` 选项）。

   核对：
   - `skills()` 列出它、状态可用；
   - `$` 带上它的正文；
   - shell 经 `skills://` 的真实路径运行它的脚本，输出证明依赖打进去了；
   - 第二个插件装好但启动时不登记，运行中用 `register` 登记后它的 Skill 出现，`stop` 后消失；
   - 内置插件、找不到的目录交回 null 并写诊断。
4. **界面与例子**：Skill 页分组、DOM 测试、Lab 场景；例子插件与场景测试；作者文档。验证：DOM 测试、`lab-scenes`、e2e `agent-skills`，`plugins` 那份在安装流程受影响时跑。

## 验收映射

Spec 条目编号在写 Spec 时定，这里按行为列：

- 贡献点的路径规则 → `points` 的用例（被拒的路径）。
- 插件来源出现在目录里、id、状态 `ready`、有 `package.json` 时无效、不能初始化 → `catalog.test.ts`、`install.test.ts`。
- 平台只交回版本目录里、不经过链接的目录 → `plugin-platform/backend` 的测试。
- 构建的每种失败与原因文字、成功时产物能独立运行、路径与文件名不变、跳过的文件 → `build-plugin.test.ts`。
- 装好之后 `$` 带上与 shell 运行；运行中登记、停掉插件时 Skill 出现与消失；没有平台服务或找不到目录时写诊断 → 切片 3 的集成测试。
- 同一插件两个贡献里的同名文件夹、根的增删与重扫 → `catalog.test.ts`。
- Skill 页分组 → `skills-page.dom.test.ts`。

## 验证

- 应用 typecheck（含两份 vue-tsc）。
- `test:affected`。
- e2e `agent-skills`；构建预设改了，再跑 `plugins` 与 `lab-scenes`。
- 例子的场景测试在没有 `node_modules` 的目录里真实运行打包后的脚本，执行的是仓库自己的例子代码。

## 不做与风险

- **内置 Skill。** 现在一个都没有。第 7 条说“内置 Skill 用同一套”，等第一个内置 Skill 出现时再接上。内置插件不经 `agent.skills` 带 Skill（平台的 `directory` 对它们交回 null）。
- **查不出的读文件方式。** 依赖按工作目录、环境变量或写死的路径找数据文件时，源文件里没有“自己的位置”可查，构建通过、运行时才失败。要查出来只能把读文件的调用都判失败，那样常用包大多过不了。所以按“接受取舍”记进待确认清单，Spec 写明。
- **可选依赖会被误判。** 依赖里“试着加载、没有也行”的写法（`try { require("可选包") }`）会被第 3 项检查判失败，作者没有豁免的办法。按第 7 条的“打不进就失败”从严，同样记进待确认清单。
- **体积。** 每个脚本各带一份依赖，同一个 Skill 里几个脚本用同一个大包时会重复。
- **SDK 构建依赖。** 构建依赖多一个 `yaml`，作者装 SDK 时会多装它（体积很小）。

## 待确认（开发者 2026-11-15 全部按推荐）

1. **贡献的形状。** 推荐：一个贡献声明一个装着若干 Skill 文件夹的目录，同 `user://skills/`。另一种是每个 Skill 一个贡献。
2. **哪些文件打包。** 推荐：Skill 文件夹里全部 JS/TS 文件。有的 Skill 的脚本不在 `scripts/` 下，例如放在子目录的 `scripts/`。另一种是只打 `scripts/` 下的。
3. **路径与文件名。** 推荐：打包后保留原来的相对路径与文件名（`.ts` 里放打包后的 JS，Bun 照常运行），`SKILL.md` 里的命令不用改。
4. **Python 脚本。** 第 7 条写“Python 脚本打不进单文件，构建失败”。两种做法：
   - 推荐：只在 Python 脚本带第三方依赖时失败，判据同 `skills.md` 输出 4：Skill 里有 `pyproject.toml`、`requirements.txt`、`uv.lock`，或有带 `# /// script` 内联依赖的 `.py`。只用标准库的 `.py` 原样复制。
   - 照第 7 条字面：有 `.py` 就失败。
5. **Skill 页分组。** 我的 → 各插件一组（组头写插件名）→ 内置。
6. **没经构建的插件 Skill。** 插件 Skill 里有 `package.json` 时标无效，原因写“没有经 nbooke build 打包”。
