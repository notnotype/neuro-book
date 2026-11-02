# NeuroBook 插件 SDK

`@notnotype/nb-plugin-sdk` 给 NeuroBook 插件的作者用：类型、构建期实现、构建预设与命令 `nbooke`。插件运行时用的是 NeuroBook 自己的那一份（宿主模块表），这个包里的实现只在你构建插件、写测试时执行。

本文讲怎么做。规则细节链接到包里 `specs/` 下的 Spec 副本，它们与这个 SDK 是同一个版本；副本之间的链接在包里能打开；指向没有随包的文档（别的 Spec、架构决策、提案）的链接改成了文字，标出它在 NeuroBook 仓库里的路径。三份附表：

- `docs/exports.md`：每个子路径导出了什么，服务端入口能不能用；
- `docs/components.md`：能用的界面组件；
- `docs/tokens.md`：写样式能用的主题变量。

包里的入口：

| 导入 | 内容 | 在哪里用 |
|---|---|---|
| `@notnotype/nb-plugin-sdk` | 插件框架：`definePlugin`、入口、服务、远程服务、诊断、宿主能力 | 各运行位置 |
| `@notnotype/nb-plugin-sdk/text` | 界面文字的类型（`Text`、`TextRef`、`LocaleMap`、`TextParams`）与构造文字引用的 `pluginText` | 各运行位置 |
| `@notnotype/nb-plugin-sdk/text/browser` | 组件里取文字：`usePluginText`、`useText`、`TextPort` | 只在浏览器入口 |
| `@notnotype/nb-plugin-sdk/state` | 内置插件 `nbook.state`：插件状态 `defineStore`、公开状态 `definePublicState` | 各运行位置 |
| `@notnotype/nb-plugin-sdk/storage` | 内置插件 `nbook.storage`：私有存储 `defineRecord`、`storageKey` | 各运行位置 |
| `@notnotype/nb-plugin-sdk/settings` | 内置插件 `nbook.settings`：设置项 `setting`、list 分区 `section`、`settingsKey` | 各运行位置 |
| `@notnotype/nb-plugin-sdk/settings/browser` | 设置页 `settingsPage`、选项来源 `choices`、设置页组件 `SettingsRow` 等 | 只在浏览器入口 |
| `@notnotype/nb-plugin-sdk/commands` | 内置插件 `nbook.commands`：命令 `command`、从代码执行命令的 `commandServiceKey` | 各运行位置 |
| `@notnotype/nb-plugin-sdk/workbench` | 内置插件 `nbook.workbench`：视图 `view`、状态栏条目 `statusItem` | 只在浏览器入口 |
| `@notnotype/nb-plugin-sdk/components` | 界面组件（见 `docs/components.md`） | 只在浏览器入口 |
| `@notnotype/nb-plugin-sdk/build` | 构建预设 `buildPlugin`，自己写构建脚本时用 | Bun 脚本 |

## 前置条件

- **一个能装插件的 NeuroBook**：`bun add -g @notnotype/neuro-book` 装上命令 `nbook`，运行 `nbook` 在前台启动并打开浏览器。装好的插件放在它的状态根里（平台的数据目录，或 `--state-root`、`NBOOK_STATE_ROOT` 给的目录）。
- **重启**：安装、升级、启停与卸载都在下一次启动后生效。在运行 NeuroBook 的终端里按 Ctrl+C 停掉，再运行一次 `nbook`。
- **在哪里看到插件**：设置窗口（书架页右上角、作品工作台左下角的齿轮）的“插件”页管安装与启停；视图、状态栏条目只在打开一部作品之后的工作台里出现，书架页没有。

## 生成插件

命令 `nbooke` 在 SDK 包 `@notnotype/nb-plugin-sdk` 里，不用全局安装，用 `bunx -p` 借它生成插件：

```sh
bunx -p @notnotype/nb-plugin-sdk nbooke create hello --publisher acme
cd hello
bun install          # 装上 SDK 与 create 写进 package.json 的依赖
bun run build        # 产物在 dist/
nbook plugin install dist
```

第一次运行 `bunx` 要下载 SDK 与构建用的依赖（Vite 等），直连 npm 慢时会停一会儿。之后插件项目里的 `nbooke` 用的是项目自己装的那份 SDK，版本写在 `package.json` 里。

- 只用 Bun（版本见 SDK 包 `package.json` 的 `engines.bun`）。例外是类型检查：`vue-tsc` 在 Bun 的运行时里认不出 `.vue` 文件，`bun run typecheck` 按它自己的抬头行用 Node 运行，所以机器上要有 Node。
- `create` 也可以写进已有的目录：目录里只有 `package.json`、`bun.lock`、`node_modules`、`.git` 与 `.npmrc` 时照写，有别的文件时拒绝、什么也不写。已有的 `package.json` 合并：你写的字段与依赖保留（自己钉的 SDK 版本也保留），`publisher`、`name`、`version` 与 `type` 用生成的，脚本与开发依赖只补缺的。
- 要试 SDK 还没发布的改动：在 NeuroBook 仓库的 `packages/neuro-book` 里 `bun run build:sdk`，最后一行打印 tarball 的路径；`create` 加 `--sdk file:<tarball 路径>`，SDK 依赖就写成它。
- 插件 id 是 `<publisher>.<name>`。`--publisher` 缺省 `my`，发出去的插件请写自己的；`--name` 缺省取 `package.json` 的 `name`，没有时取目录名。两段都要以小写字母开头、只含小写字母、数字与连字符，不合规时 `create` 报错并提示用哪个开关指定。
- 完整的行为（合并规则、`--sdk`、退出码）见 [plugin-api 的“作者工具”](../../../docs/specs/runtime/plugin-api.md#作者工具)。

生成的插件能直接构建、类型检查（`bun run typecheck`）并安装：侧栏里一个视图显示设置里的问候语，命令面板里一条命令让视图里的计数加一。

## 目录结构

```text
hello/
├── package.json         publisher、name、version、脚本与依赖；构建预设从这里读插件的身份
├── plugin.ts            插件描述 descriptor：构建时读它生成清单
├── shared/contracts.ts  definePlugin（插件 id、版本、运行位置）、设置分区与设置项、远程服务合同；两端与别的插件都引用它
├── web/plugin.ts        浏览器入口
├── web/HelloView.vue    视图组件
├── locales/             界面文字的消息目录（zh-CN.json 是源语言，见下文“界面文字”）
├── backend/plugin.ts    服务端与项目入口（模板没有，要时自己加）
├── env.d.ts、tsconfig.json
└── dist/                构建产物，交给用户安装的就是它
```

- 插件 id、版本与运行位置写在三处：`package.json`（`publisher.name` 与 `version`）、`definePlugin({id, version, locations})`、实际有入口的模块。三处不一致时构建报错，改的时候一起改。贡献的 id 只写短名（见下文“写入口”），不用再写插件 id。
- 构建预设读的入口模块缺省是 `backend/plugin.ts` 与 `web/plugin.ts` 里存在的；放在别处时在 `package.json` 写 `"nbook": {"definitions": ["src/server.ts", "src/web.ts"]}`，写错（不是路径的数组）构建报错。
- 构建时会执行 `plugin.ts` 与入口模块的顶层一次（为了读出声明，不调用 `activate`），顶层不要有副作用。
- 给模板加服务端入口：`definePlugin` 的 `locations` 加上 `"server"`；新建 `backend/plugin.ts`，导出 `plugin.definition([plugin.entry({location: "server", activate: …})])`；构建预设会找到它，`package.json` 不用改。服务端入口只从两端都能用的子路径导入（根入口、`/text`、`/state`、`/storage`、`/settings`、`/commands`），完整的写法见下文“服务端入口与远程服务”的示例。

## 写入口

`shared/contracts.ts` 里调用一次 `definePlugin`，别的模块都从那里取 `plugin`：

```ts
// shared/contracts.ts
import {definePlugin} from "@notnotype/nb-plugin-sdk";
export const plugin = definePlugin({id: "acme.hello", version: "0.1.0", locations: ["browser"]});

// plugin.ts
import {plugin} from "./shared/contracts";
export const descriptor = plugin.descriptor();   // 有设置项、分区时：plugin.descriptor([分区, 设置项])
```

入口用 `plugin.entry` 定义：静态声明（运行位置、激活事件、依赖、贡献）加一个 `activate(context)`；`plugin.definition([入口…])` 是入口模块要导出的插件定义。

```ts
// web/plugin.ts
import {command} from "@notnotype/nb-plugin-sdk/commands";
import {view} from "@notnotype/nb-plugin-sdk/workbench";
import {plugin} from "../shared/contracts";

const hello = view(plugin, {name: "hello", title: "你好", icon: "i-lucide-hand", load: () => import("./HelloView.vue")});
const say = command(plugin, {name: "say", title: "打个招呼", description: "Say hello", effect: "write"});

export const browserPlugin = plugin.definition([plugin.entry({
    location: "browser",
    activationEvents: ["onStartup"],
    contributions: {hello, say},
    activate: () => ({contributions: {
        hello: hello.implement(() => ({greeting: "你好"})),
        say: say.implement(() => ({ok: true, value: null})),
    }}),
})]);
```

- **只写短名**：助手的 `name` 拼成贡献 id `<插件 id>.<name>`（设置项的键是 `<插件 id>/<name>`），不会写错前缀；短名不合规则（视图、条目、分区：小写字母开头，只含小写字母、数字与连字符；命令的段可以数字开头；设置项名是小驼峰）时加载就抛错，写明是哪一个。
- **声明与实现用同一个键**：`contributions: {键: 助手}` 声明，激活产出的 `contributions` 用同样的键交 `助手.implement(…)`。漏写一项、多写一项、在某个键上交了别的助手的实现，`bun run typecheck` 都报错，报错的最后几行写着是哪一项（前面几行是 TypeScript 展开的整个函数类型）。漏写实现、产出了远程服务却没写 `remoteProvides` 只有类型检查查得出，构建不执行 `activate`、查不到：构建之前先跑一遍 `bun run typecheck`。入口 id 缺省取运行位置名；同一个插件的两个入口不能同 id（不按位置分），重复时组装就抛错。
- **助手从它所属的内置插件的子路径导入**，第一个参数是 `plugin`：看导入路径就知道在用哪个内置插件。要 Vue 的部分：整个内置插件只在浏览器里有意义的（工作台）占一个只给浏览器的子路径；两端都要的（设置）把浏览器部分放在 `/settings/browser`。只给浏览器的助手（`view`、`statusItem`、`settingsPage`、`choices`）写进服务端入口编译不过。
- **在编辑器里就报的错**（`bun run typecheck`，报错里写着问题与改法）：短名带大写、空格或下划线；设置项名不是小驼峰；参数有必填项的命令没写 `expose: {human: false}`；`context.services.require` 了没写进 `dependencies` 的服务（可选依赖用 `resolve`；按服务的接口核对，两个服务的接口一模一样时分辨不出，取了没声明的那个时入口激活失败、写明是哪个服务）；产出了远程服务或服务却没写 `remoteProvides`、`provides`。把助手包进一个泛型函数（`<Name extends string>(name: Name) => command(plugin, {name, …})`）时短名的核对推不出来，直接调用助手。记录 schema 写 `additionalProperties: true` 这类 TypeBox 类型里看不出来的，构建时报。
- **激活上下文**：`context.services.require(键)` 取 `dependencies` 里声明的服务，`context.remote` 调用远程服务，`context.signal` 在入口开始停止时触发，`context.onStop(() => …)` 登记入口停止时要做的事（取消计时器、关掉句柄）；没有 `scope`，不用自己管作用域。随这一代入口自动结束、不用 `onStop` 的：远程订阅、记录句柄的 `subscribe`、设置服务的 `onDidChange`、`eventSource` 的订阅；要自己在 `onStop` 里收掉的：宿主时钟 `schedule` 的计时、自己开的定时器、连接与句柄。完整的成员见 [plugin-api 的“激活上下文”](../../../docs/specs/runtime/plugin-api.md#激活上下文)，入口与服务、远程服务、贡献怎么选见同文的[“选用规则”](../../../docs/specs/runtime/plugin-api.md#选用规则)，助手的完整规则见同文的[“作者 API”](../../../docs/specs/runtime/plugin-api.md#作者-api)。
- **不经助手的贡献**：向别的插件自己定义的贡献点提交时，声明写在入口的 `rawContributions`（`{capability, id, declaration}` 的数组），实现写在产出的 `rawContributions: {贡献点: {id: 实现}}`；id 用 `` `${plugin.id}.<名>` as const `` 拼。自己定义贡献点时写在 `plugin.definition({contributionPoints, entries})` 里，接收的入口写 `receives` 并在产出里交 `receivers`。示例 menu、file-menu 是这两种写法。

### 运行位置

| 运行位置 | 实例 | 代码放在 |
|---|---|---|
| `server` | 服务端进程，一个 | `backend/` |
| `project` | 每个打开的项目一个 | `backend/`（与服务端共用目录，入口的 `location` 不同） |
| `browser` | 每个窗口一个 | `web/` |

服务端与浏览器的入口分模块写：服务端的产物只能引用 `@vue/reactivity`、SDK 里服务端能用的子路径与 Node 内置模块，服务端模块（以及它导入的东西）一旦导入了 `/workbench`、`/settings/browser`、`/components` 或 `.vue` 文件，构建就报“未共享”。两端共用的合同与 schema 放在 `shared/`，只写纯数据与 TypeBox schema。

### 激活事件

- **不写**：有别的入口依赖它提供的服务，或者有远程调用到达它的 `remoteProvides` 时才激活。
- **`onStartup`**：实例启动就激活。视图、状态栏条目与命令的实现是在入口激活时交出的，工作台和命令面板现在没有按需激活的事件，所以给它们交实现的浏览器入口要写 `onStartup`，否则视图只有标题和加载占位，命令执行不了。代价是每个窗口启动时都下载并执行这个入口：入口模块的顶层保持轻，视图组件用 `load: () => import("./X.vue")` 在第一次显示时才加载。
- **设置页、选项来源的事件**：`settingsPage`、`choices` 助手带着自己的激活事件（用户打开那一页、设置窗口要选项时），`plugin.entry` 自动并进来，不用写。

激活事件的完整规则见 [plugin-manifest 的“输入与前置条件”](../../../docs/specs/runtime/plugin-manifest.md#输入与前置条件)。

### 贡献

声明里的界面文字（`title`、`description` 这类）怎么写见下文“界面文字”。贡献、贡献点（包括自己定义贡献点时的 `schema` 与 `idPrefix`）与激活事件的规则见 [plugins](../../../docs/specs/runtime/plugins.md)。

- **设置分区与设置项**：`/settings` 的 `section(plugin, {name, title, icon, groups})` 是设置窗口左栏的一项（list 分区，`category` 缺省 `plugins`），窗口按设置项的 schema 画控件；`setting(plugin, {name, schema, default, title, layers, applies, section, group})` 是一个设置项，`section` 收分区本身，`group` 只能是那个分区的组 id，写错编译不过。`layers` 是用户能在哪几层改它：缺省 `["user", "project"]`（用户层与作品层，作品层覆盖用户层）；服务端入口只读得到缺省值与用户层（作品层属于项目，项目实例与打开了项目的窗口才读得到），给服务端用的设置项写 `layers: ["user"]`。`applies` 告诉用户改了何时生效，只影响设置窗口的提示：缺省 `now`，另有 `next-run`、`next-session`、`restart`。两者都写进 `plugin.descriptor([…])`，漏写的构建时报。读写要在入口的 `dependencies` 里声明 `settingsKey`，激活时 `context.services.require(settingsKey)` 拿到服务：`get(设置项)` 读有效值，`inspect` 读各层，`update(设置项, 值, {layer})` 写本插件声明的项，`onDidChange((keys) => …)` 在有效值变化时通知（`keys` 是变了的键，和 `设置项.key` 比）。规则见 [configuration](../../../docs/specs/settings/configuration.md)，写法见模板的 `shared/contracts.ts`。
- **page 分区**：值是列表、对象这类通用控件画不了的，用 `/settings/browser` 的 `settingsPage(plugin, {name, title, icon, load})` 自己画页面，每一项用 `SettingsRow` 排；规则见 [settings-window 的“分区声明”](../../../docs/specs/settings/settings-window.md#分区声明)，写法见示例 snippets。
- **视图**：`/workbench` 的 `view(plugin, {name, title, icon, load})`，`location` 缺省 `sidebar`，`layout` 缺省 `scroll`。`implement(() => 属性)` 交出实现：组件收到宿主给的 `context`（视图 id、是否可见、所在位置）与这个函数返回的属性。组件里拿不到服务，入口激活时拿到的服务、状态与回调都经这个函数交过去；它在渲染时求值，读到的响应式值变了视图跟着更新。`bun run typecheck`（vue-tsc）按组件的 `defineProps` 检查这些属性：必填属性漏写、名字写错或类型不对都报错，可选属性的笔误查不出来。声明的字段见 [views 的“输入与前置条件”](../../../docs/specs/workbench/views.md#输入与前置条件)，写法见模板的 `web/plugin.ts`。
- **命令**：`/commands` 的 `command(plugin, {name, title, description, effect, args?})`，`title` 给人看，`description` 用英文写给 Agent 看，`effect` 是 `read` 或 `write`（只读模式下 Agent 不能执行 `write` 的命令）。Agent 缺省不能调用命令：`expose.agent` 不写就是不开放，写 `"confirm"` 时每次调用先问用户，写 `"auto"` 时直接执行（同时写了 `hints.destructive: true` 的仍按 `"confirm"`）。`args` 缺省为空对象，写了没写 `additionalProperties` 的补成 `false`。命令面板不收集参数：**给人用的命令，参数要全部可选**（不带参数也能通过校验）；参数有必填项的命令只给 Agent 与代码调用，要写 `expose: {human: false}`，否则加载就抛错。实现 `command.implement((args) => 结果)` 返回 `{ok: true, value}` 或 `{ok: false, code, reason}`（类型 `CommandResult`）。
- **状态栏条目**：`/workbench` 的 `statusItem(plugin, {name, title, command?, order?})`，`alignment` 缺省 `right`、`order` 与 `priority` 缺省 0，`command` 可以直接给命令助手（点了执行它，不带参数）或视图助手（点了打开那个视图）。实现是三个函数：

  ```ts
  const count = statusItem(plugin, {name: "count", title: "次数", command: say});
  // activate 里（total 是入口的 ref）：
  count.implement({
      text: () => `${total.value} 次`,
      tooltip: () => `已经打过 ${total.value} 次招呼`,
      state: () => "normal",
  });
  ```

  三个函数每次渲染都会调用，从响应式状态现算，不要缓存结果；条目显示不显示只由声明的 `when` 决定，不用让 `text()` 返回空串来隐藏。规则见 [workbench-shell 的“外壳四”](../../../docs/specs/ui/workbench-shell.md#外壳四标题栏状态栏与条目)第 33 条。

### 界面文字

界面文字是文字值 `Text`（`/text` 的类型）：三种写法，NeuroBook 在窗口里按用户的界面语言显示。

- **消息目录里的键**（推荐）：文字写在 `locales/<语言>.json` 里，`package.json` 写 `"l10n": {"source": "zh-CN"}` 指出源语言；目录可以嵌套，键是点号连起来的路径。构建预设把目录复制进产物，显示名与说明写在源语言目录的 `manifest.displayName`、`manifest.description`，不写在 `package.json`。目录的格式（复数形 `<键>_one`、`<键>_other`，插值 `{{name}}`）见 [i18n 的“目录与键”](../../../docs/specs/ui/i18n.md#目录与键)。
- **字符串**：不翻译的字面文字，各界面语言显示同一句。
- **语言映射** `{"zh-CN": …, "en-US": …}`：按语言取，取不到取 `en-US`。服务端也能按语言取，所以服务端算出、要给用户看的文字（例如公开状态的 `reason`）写它；服务端不翻译目录里的键。

在声明里：必填的 `title` 不写，宿主登记时补成约定键 `<短名>.<本地 id>.<字段>`，到插件自己的目录里取，例如命令 `say-hello` 是 `commands.say-hello.title`、设置项 `greeting` 是 `settings.greeting.title`、视图 `hello` 是 `views.hello.title`（各贡献点的短名见 [i18n 的“约定键”](../../../docs/specs/ui/i18n.md#约定键)）。可选的 `description` 省略就是没有，要显示就写一个引用：

```ts
import {pluginText} from "@notnotype/nb-plugin-sdk/text";

// 键按源语言目录的类型核对，写错编译不过（tsconfig 要开 resolveJsonModule）。
export const text = pluginText<typeof import("../locales/zh-CN.json")>(plugin.id);
// 声明里：description: text("settings.greeting.description")
```

在组件里：`/text/browser` 的 `usePluginText` 读 NeuroBook 在窗口根上注入的翻译端口，返回 `(键, 参数) => 当前语言的字符串`；在模板里调用，界面语言切换时组件跟着重画，不用自己传语言。只在 `setup` 里调用。

```ts
import {usePluginText} from "@notnotype/nb-plugin-sdk/text/browser";

const text = usePluginText<typeof import("../locales/zh-CN.json")>(plugin.id);
// 模板里：{{ text("hello.count", {count}) }}
```

要翻一个现成的文字值（例如别处交来的 `Text`）时用 `useText().t(文字)`。运行时现给的文字（状态栏条目的 `text()`、`tooltip()`）不经登记、不补命名空间，用 `pluginText` 构造引用返回。要显示的失败、状态在组件里存原始的码与数据，到模板里再拼成句子：存成拼好的字符串，界面语言切换后它还停在原来的语言。写法见模板的 `web/HelloView.vue` 与示例 snippets。

### 服务端入口与远程服务

- 服务端入口写在 `backend/plugin.ts`，`location: "server"`（每个打开的项目一份的写 `"project"`）。
- 跨实例给别人用的接口写成远程服务合同：`shared/contracts.ts` 里 `remoteService(plugin, {name, …})`（id 是插件 id 加短名；代理别的插件的合同时用 `defineRemoteService` 写完整 id），服务端入口声明 `remoteProvides` 并在激活产出里用 `provideRemote` 交出实现；浏览器（或别的实例）里 `context.remote.use(合同).at(目标)` 调用、订阅事件。方法的参数与结果要能结构化克隆，失败以结构化结果返回。规则见 [plugin-channel](../../../docs/specs/runtime/plugin-channel.md)。
- 方法的 `input` 与事件的 `filter` 没写 `additionalProperties` 时补成 `false`，多余字段被拒。业务失败的码写在方法的 `errors` 里，值是这个码的详情 schema（没有详情写 `Type.Undefined()`）；实现里用 `ok(值)`、`fail(码, 详情)` 构造结果，不用写 `as const`，详情的形状按合同检查，交出不合的详情时调用方得到 `provider-error`。方法实现的第二个参数除了 `signal` 还有按这个方法定型的 `ok`、`fail`（`add: async ({by}, {fail, ok}) => …`）：码或详情写错时报错落在这一次 `fail(…)` 上，第一行就列出能用的码。方法里用这一对；根入口的 `ok`、`fail` 留给写在方法外面的辅助函数。
- 合同的 schema 进清单，只能写纯 JSON Schema（不用 TypeBox 的 `Refine`、`Codec` 与自己注册的 format）。
- 推事件用 `eventSource<值>()`：它本身就是合同 `events` 里的那一项，`emit(值)` 推给此刻的订阅，`match` 按订阅的 filter 过滤，`onSubscribe` 给新订阅推初始值；在 `activate` 或 `provideRemote` 的工厂里建（工厂里建时每个调用方一份），不在模块顶层。
- 调用方拿到的失败按码区分：`if (!r.ok && r.code === "too-many") r.detail.max` 直接有类型；`unavailable`、`timeout` 这类运行时失败的 `detail` 是说明文字。
- 订阅（`events.<名>.subscribe(…)`）随入口停止自动结束，不用手动释放；想提前取消时调用订阅句柄（结果的 `value`）的 `release()`。
- 提供方入口激活失败时，调用方得到 `unavailable`，`detail` 里带着失败原因与错误消息。

一段完整的远程服务：服务端提供计数，浏览器读、加一并订阅变化。

```ts
// shared/contracts.ts
import {definePlugin, remoteService} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";

export const plugin = definePlugin({id: "acme.hello", version: "0.1.0", locations: ["browser", "server"]});
// 合同 id 是插件 id 加短名：acme.hello/counter。
export const counter = remoteService(plugin, {
    name: "counter",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        add: {input: Type.Object({by: Type.Integer()}), output: Type.Integer(), effect: "write", errors: {"too-many": Type.Object({max: Type.Integer()})}},
        current: {input: Type.Object({}), output: Type.Integer(), effect: "read"},
    },
    events: {changed: {filter: Type.Object({}), payload: Type.Integer()}},
});

// backend/plugin.ts
import {eventSource, provideRemote} from "@notnotype/nb-plugin-sdk";
import {counter, plugin} from "../shared/contracts";
export const serverPlugin = plugin.definition([plugin.entry({
    location: "server",
    remoteProvides: [counter],
    activate: () => {
        let value = 0;
        // 订阅集合由 eventSource 管：订阅结束时自动移出，这里只 emit。在 activate 里建，不在模块顶层。
        const changed = eventSource<number>();
        return {remote: [provideRemote(counter, () => ({
            methods: {
                add: async ({by}, {fail, ok}) => {
                    if (value + by > 1000) return fail("too-many", {max: 1000});
                    value += by;
                    changed.emit(value);
                    return ok(value);
                },
                current: async (_input, {ok}) => ok(value),
            },
            events: {changed},
        }))]};
    },
})]);

// web/plugin.ts 的 activate 里
const remote = context.remote.use(counter);                // provider 是 server，不用写 .at(…)
const added = await remote.add({by: 1});
if (!added.ok && added.code === "too-many") console.warn(`超过上限 ${added.detail.max}`);   // 详情随码收窄成合同里的类型
await remote.events.changed.subscribe({}, (value) => { total.value = value; });   // 入口停止时自动退订
```

SDK 包里 `examples/plugins/` 下的示例能照着读：`notes`（服务端远程服务、按调用方分开、浏览器端代理）、`counter`（服务端与项目两个入口、命令、插件状态）、`focus`（设置项、命令、视图、状态栏条目、服务端远程服务与私有存储放在一起的完整插件）。

### 插件状态与公开状态

- **插件状态**：`defineStore(名, ({persist, publish}) => ({state, actions}))` 在一处声明入口的状态：内存里的、持久化进 `nbook.storage` 的（`persist(记录, {initial})`）与派生的，只经 `actions` 写；入口激活时 `store.create(context, {storage, diagnostics})` 建一份，随这一代入口释放。规则见 store 的 Spec（`docs/specs/state/store.md`），写法见示例 counter 的 `backend/plugin.ts`。
- **公开状态**：`definePublicState(plugin.id, {键: {type: "boolean", unready, reason}})` 声明别的插件与命令的 `when` 能读的键；声明写进入口的 `rawContributions`，绑定由 store 的 `publish` 给出、写进产出的 `rawContributions`。命令写 `when: {requires: [公开状态.key("键")]}` 时，键为 false 命令就不可用，原因取 `reason`。

### 私有存储

插件自己的数据存进内置插件 `nbook.storage`，不自己写文件：

- 用 `defineRecord({key, scope, locality, version, schema, keyed?})` 定义记录，入口依赖 `storageKey`，激活后 `storage.open(记录)` 拿到句柄读写；改值用 `update(旧值 => 新值)`，它做条件保存、别人先写了就重读重算；坏记录与别的版本写下的不改写，返回同名失败与 revision。
- `scope: "user"` 存在服务端的用户分区，`"project"` 要在项目实例里打开。
- `locality` 必填：服务端入口的记录写 `"shared"`（各客户端共用一份）；`"local"` 按客户端分开存，服务端没有客户端身份，打不开它。
- `schema` 是对象 schema，没写 `additionalProperties` 的补成 `false`。
- 读写的写法（服务端入口的 `activate` 里）：

  ```ts
  import {defineRecord, storageKey} from "@notnotype/nb-plugin-sdk/storage";
  import type {RecordHandle} from "@notnotype/nb-plugin-sdk/storage";
  import {Type} from "typebox";

  const progress = defineRecord({key: "progress", scope: "user", locality: "shared", version: 1, schema: Type.Object({words: Type.Integer()})});

  const opened = await context.services.require(storageKey).open(progress);
  if (!opened.ok) throw new Error(`打不开记录：${opened.detail}`);       // 入口激活失败，插件页显示这条原因
  const handle: RecordHandle<{words: number}> = opened.handle;

  // 读出当前值（没有为 null）、算出新值、条件保存；别人先写了就重读重算。
  const added = await handle.update((current) => ({words: (current?.words ?? 0) + 500}));
  if (!added.ok) console.warn(`没记上：${added.code}`);

  // 订阅：先推一次当前快照，之后每次写入（本插件别处的写入也算）都推一次；入口停止时自动结束。
  await handle.subscribe((snapshot) => {
      if (snapshot.status === "ok") total.value = snapshot.value.words;
  });
  ```

- 改了值的形状要升 `version`，旧数据读出来是 `unsupported-version`，不会被当成新形状。这时普通的 `save` 被拒（`protected`），要么按旧形状迁移，要么用 `reset` 换成新值（原件留在存储的原件区）；什么都不做的话，老用户的这条记录从此读写都失败。SDK 包里示例 `examples/plugins/focus` 的服务端入口示范了 `reset`。

规则见 [persistence](../../../docs/specs/storage/persistence.md)；写法见示例 notes 的 `backend/plugin.ts`。

### 作者可用的内置命令

内置插件的命令很多，作者能依赖的（属于 `engines.neurobook` 的兼容范围）只有下面这些；别的内置命令随产品改动，不要写进插件。

| 命令 | 参数 | 做什么 |
|---|---|---|
| `nbook.view.open`（`/workbench` 的 `OPEN_VIEW_COMMAND`） | `{viewId?}`：视图 id，就是视图助手的 `.id` | 打开一个视图：选中它所在的容器、显示所在的区域，收起的展开；不移动焦点。不给 `viewId` 时弹出选择，用户挑一个，取消也算成功。没有这个视图（入口没激活、插件被禁用）得到 `invalid-args`，不在工作台页面得到 `unavailable`。状态栏条目直接收视图助手时就是执行它。 |

从代码执行命令：入口在 `dependencies` 里声明 `/commands` 的 `commandServiceKey`，激活后 `context.services.require(commandServiceKey).execute(id, args)`，得到 `{ok: true, value}` 或 `{ok: false, code, reason}`。

### 常用名字

根入口：`definePlugin`、`ok`、`fail`、`remoteService`、`eventSource`、`provideRemote`、`provideService`（同一实例里的本地服务）、`defineServiceKey`、`diagnosticsKey`、`hostClockKey`（宿主给的时钟：`now()` 取时间，`schedule(回调, 毫秒)` 定时并返回取消函数）。`/state`：`defineStore`、`definePublicState`。`/storage`：`defineRecord`、`storageKey`。`/settings`：`section`、`setting`、`settingsKey`。`/settings/browser`：`settingsPage`、`choices`、`SettingsRow`。`/commands`：`command`、`commandServiceKey`。`/workbench`：`view`、`statusItem`。`/text`：`pluginText`。`/text/browser`：`usePluginText`、`useText`。每个子路径的完整名单见 `docs/exports.md`，说明在各自的 `.d.ts` 里。

## 界面

- **从上一个版本升级**：组件 API 在 nb-ui 0.4 收成了一套写法（`Dialog` 的 `v-model:open`、关闭原因、`FloatingWindow` 等），逐项对照见 [nb-ui 的迁移说明](https://github.com/notnotype/neuro-book/blob/master/packages/nb-ui/docs/migration-0.4.md)。
- **只用 SDK 的组件、`<style scoped>` 与主题变量**：组件从 `@notnotype/nb-plugin-sdk/components` 导入（清单见 `docs/components.md`，属性看包里的 `components.d.ts`，编辑器里跳转到定义即可）；样式写在组件的 `<style scoped>` 里，尺寸、间距、颜色、字号都用主题变量（清单见 `docs/tokens.md`），例如 `padding: var(--space-3); color: var(--text-muted);`。
- **不写原子类**（`p-4`、`flex`、`text-sm` 这类）：NeuroBook 的原子类只按它自己的源码生成，插件里写了要么不生效，要么碰巧因为宿主某处也用了同一个类而生效，换个版本就失效。
- **不覆写组件内部的样式**（选组件的内部类名、`:deep(...)`）：构建预设把插件的样式整体包进 `@layer components`，与宿主组件的样式同一层，谁赢取决于样式表的先后，不可靠；要换外观用组件给的属性（`variant`、`size`）。
- **颜色随主题变**：颜色变量的值随用户选的配色与明暗变化，不写死颜色，也不按明暗自己分支；要淡一点的颜色用 `color-mix(in srgb, var(--accent-main) 12%, transparent)`。
- **图标写完整的字面量**：`i-lucide-<名字>`（[Lucide](https://lucide.dev/icons/) 图标），写在声明或源码里都行，构建预设按出现的类名生成图标规则。拼出来的类名（`` `i-lucide-${name}` ``）构建时找不到，不会显示：要按状态换图标就写一张字面量的表。别的图标集给构建警告、不显示。
- **视图的 `layout`**：内容是普通的一列（表单、短列表、说明文字）选 `scroll`，外壳给内边距并负责滚动，组件根上不要再加内边距；视图要占满、自己管滚动（长列表、树、编辑器）选 `fill`，内边距用外壳给的 `var(--view-inset-inline)`、`var(--view-inset-block)`。
- **视图的宽度**：侧栏默认约 240px，按这个宽度设计，按钮与长文字在窄宽下要能换行。内容窄于某个宽度就没法用时，声明 `minimumSize: {width: …}`；不要声明比需要更大的最小宽度，它会挤占同一栏里别的视图。
- **无障碍**：可点的东西用 `Button`、`IconButton` 这类真按钮，不在 `div` 上绑 `click`，键盘才能 Tab 到、Enter 或空格执行；只有图标的按钮给 `title` 或 `ariaLabel` 作读屏名称；状态变化（完成、出错）需要被听到时放进 `aria-live="polite"` 的区域，只播报一次。区域本身一直在页面上，每次播报换一个新的文字节点（例如给里面的元素一个随事件递增的 `:key`）：只改文字时，连着两次相同的文字不会改动 DOM，读屏不念第二次；操作后焦点留在用户刚操作的地方，不让它掉到页面开头。

构建预设怎样处理插件样式与图标，见 [plugin-code-loading 的“术语与参与者”](../../../docs/specs/runtime/plugin-code-loading.md#术语与参与者)里的“插件样式”。

## 构建与常见报错

`bun run build`（`nbooke build --clean`）先清掉上次的产物再构建。构建失败时退出码 1，逐行列出每个问题（问题的路径多是 `entries.<入口 id>` 或清单字段；模块执行时抛错的，路径是出错的那一行“文件:行:列”；要看打包器的日志与完整堆栈加 `--verbose`）；只有警告时打印到标准错误、退出码 0；用法不对退出码 2。

| 报错里有 | 原因 | 怎么改 |
|---|---|---|
| “打进了 vue 的实现”（或 `@vue/reactivity`、SDK、内核） | 产物里有了第二份宿主的包，常见于某个依赖自带一份 Vue，或者经相对路径绕过包名引用了它 | 从包名导入；换掉自带 Vue 的依赖。插件里出现第二份 Vue 时界面会静默失效，所以构建直接拦下 |
| “引用了宿主没有共享的模块 X”“该入口未共享” | 引用了这个运行位置的宿主模块表里没有的模块：服务端入口导入了 `/workbench`、`/settings/browser`、`/components` 或 `.vue`（报错后面附有原因）；引用了 SDK 或 Vue 没有共享的子路径 | 按报错里“由谁引入”找到那一行，换写法或把代码挪到对的一端 |
| 上一行再加“nb-ui 的组件从 @notnotype/nb-plugin-sdk/components 导入” | 直接导入了 `@notnotype/nb-ui` | 改从 `@notnotype/nb-plugin-sdk/components` 导入 |
| “不支持顶层 await” | 浏览器入口打成同步执行的登记工厂，模块顶层不能 `await` | 挪进 `activate` |
| 清单的 schema 问题（路径指向某个合同方法或贡献点的 `schema`） | 远程合同或贡献点的 schema 不是纯 JSON Schema（`Refine`、`Codec`、自己注册的 format、指向外部的 `$ref`） | 改成纯 JSON Schema；跨字段的规则放进实现里检查 |
| “写了 validate 函数：函数进不了清单” | 自己定义的贡献点写了 `validate` | 规则写成贡献点的 `schema` 与 `idPrefix: "plugin"`，跨条目的规则放在接收者里 |
| “必须是单个小写 id 段（字母开头…）” | `publisher` 或 `name` 以数字开头、有大写或别的字符 | 改 `package.json` 与 `definePlugin` 里的 id |
| “插件描述与 package.json 不一致” | `definePlugin` 的 id 或版本与 `package.json` 不同 | 两处改成一样 |
| “输出目录里不是这个插件上次的产物，不清理” | `--out` 指到了别的目录 | 检查 `--out`，或换一个空目录 |
| “定义了，却没有写进 plugin.descriptor([…])” | 用 `setting`、`section` 定义了，却没列进 `plugin.ts` 的 `plugin.descriptor([…])`：没列的不进清单，设置窗口里没有它 | 列进去 |

警告：图标类在 Lucide 里不存在、或不是 Lucide 图标时，构建成功但给警告，那个图标不会显示。

纯度检查的完整规则见 [plugin-code-loading 的“输出与可观察行为”](../../../docs/specs/runtime/plugin-code-loading.md#输出与可观察行为)第 5 条，清单字段与 schema 的要求见 [plugin-manifest 的“输入与前置条件”](../../../docs/specs/runtime/plugin-manifest.md#输入与前置条件)。

## 测试业务逻辑

SDK 还没有给作者的测试替身（内存里的存储、设置与时钟，激活一个入口再调用它的远程方法）。眼下把能单独验证的逻辑写成 `shared/` 里的纯函数（收当前状态与输入，返回新状态或失败），入口只做接线，用 `bun test` 测这些函数；接线与界面装进 NeuroBook 之后验证。

## 开发循环

1. 改代码，`bun run dev`（`nbooke build --clean --dev`）。产物的版本是 `<version>+dev.<UTC 时间到秒>.<毫秒>`，例如 `0.1.0+dev.20261023101500.123`。
2. `nbook plugin install dist`（应用的命令行，`bun add -g @notnotype/neuro-book` 装上；在服务端那台机器上运行，`--state-root` 或 `NBOOK_STATE_ROOT` 与启动 NeuroBook 时用的一致），或者在 NeuroBook 的“设置 → 插件”里点“安装…”、填 `dist` 的完整路径并确认。开发版本每次都比上一次新，按升级处理，不用改版本号，也不用先卸载。
3. 重启 NeuroBook（前台运行的 `nbook start` 按 Ctrl-C 后再启动），新版本生效。

开发版本也比同号的正式版本新：装过 `0.1.0+dev.…` 之后再装 `bun run build` 的 `0.1.0`，插件页按降级处理并提示数据迁移的风险，命令行安装降级要加 `--yes`。发布前先提高版本号。用 `bun run build` 构建的版本与已安装的相同时，安装会被拒绝（“已安装相同版本”）：提高版本号（`package.json` 与 `definePlugin` 一起改），或者先卸载、重启后再装。安装、升级、启停与卸载都在下一次启动后生效，规则见 [plugin-install](../../../docs/specs/runtime/plugin-install.md)。

## 调试

- **先看插件页**：插件装上、重启后没出现或用不了，先打开设置里的插件页。你的插件那一行列出此刻的问题：哪个入口激活失败（带错误消息）、哪个入口受阻（缺哪个服务）、哪项贡献被拒（贡献点、id 与原因）。服务端的问题是打开页面时的，本窗口的随时更新；在作品里运行的入口不在这里，看日志。
- **命令没反应**：从命令面板或快捷键执行失败时，右下角弹一条警告，写命令名与原因；点状态栏条目执行失败时眼下不弹，要查原因就从命令面板执行同一条命令。不带参数过不了校验的命令不出现在面板里（面板不收集参数），`/commands` 的 `command` 遇到这种写法会直接报错，除非写了 `expose: {human: false}`。远程调用得到 `unavailable` 时，详情里带着提供方入口激活失败的原因。
- **服务端日志**：`<状态根>/logs/server-current.jsonl`，一行一条 JSON，按插件 id 搜：服务端与项目入口的受阻、激活失败与装载失败都记在这里（事件 `plugins.diagnostic`），比插件页多出时间与上下文。服务端的 `console.warn`、`console.error` 也会记进去；要写结构化的记录就依赖 `diagnosticsKey`，用 `record({level, event, message, data, source: {plugin, entry}})`，`event` 写成以插件 id 开头的名字，方便搜。
- **浏览器**：开发者工具的控制台里有这个窗口的诊断，浏览器入口的激活失败也在这里；浏览器入口的产物带 source map（源文件路径相对你的插件目录），在 Sources 面板里按原文件名找到代码、打断点。视图渲染出错时只有这个视图原位显示错误与“重试”，别的视图照常。
- 服务端入口的产物同样带 source map（`server.js.map`）。

## 发布

`dist` 整个目录就是可以安装的插件：`package.json`（构建生成的清单）、每个入口一个 `.js` 与 `.map`、`style.css`。依赖已经打进入口文件，目录里没有也不需要 `node_modules`。把这个目录交给用户，用户在插件页填它在服务端机器上的路径安装。

- 兼容的 NeuroBook 版本写在 `package.json` 的 `engines.neurobook`，缺省是构建时 SDK 版本的 `^<版本>`。NeuroBook 是 0.x 时，minor 号变化可能带不兼容的改动。
- 依赖别的第三方插件的版本范围写在 `package.json` 的 `pluginVersions`。

## 附表与 Spec

- `docs/components.md`：组件清单，由 SDK 的组件入口生成。
- `docs/tokens.md`：主题变量清单，由 NeuroBook 的主题文件生成。
- `examples/`：示例插件的源码，`plugins/` 下每个目录是一个插件，`external/declarative` 是只有声明的插件。
- `specs/`：本文引用的 Spec 的副本：[plugin-api](../../../docs/specs/runtime/plugin-api.md)（SDK 与作者工具）、[plugin-code-loading](../../../docs/specs/runtime/plugin-code-loading.md)（构建预设、宿主模块表、纯度检查、插件样式）、[plugin-manifest](../../../docs/specs/runtime/plugin-manifest.md)（清单与 id 规则）、[plugin-install](../../../docs/specs/runtime/plugin-install.md)（安装、升级、卸载）、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md)（远程服务）、[views](../../../docs/specs/workbench/views.md)（视图）、[workbench-shell](../../../docs/specs/ui/workbench-shell.md)（状态栏条目）、[configuration](../../../docs/specs/settings/configuration.md)（设置项）、[settings-window](../../../docs/specs/settings/settings-window.md)（设置分区）、[persistence](../../../docs/specs/storage/persistence.md)（私有存储）。
