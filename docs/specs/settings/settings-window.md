---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: settings.window
owners:
  - nbook.settings
---

# 设置窗口

## 目标与非目标

**目标**：给用户一个查看与修改配置项（[`settings.configuration`](configuration.md)）的窗口。左栏列出分区，右边一次显示一个分区；插件经两个贡献点贡献分区：`settings.sections` 的 list 分区由窗口按配置项的声明画出控件，`settings.pages` 的 page 分区由贡献方自己画，窗口只画标题与说明；`settings.choices` 的选项提供者给配置项的动态选项。绑定作品的窗口里，“用户 | 本作品”两个标签分别编辑用户层与项目层。通用列表经用户编辑路径（configuration 输出 19）写入；page 分区经自己插件的配置服务写自己声明的项。给页面用的 `SettingsRow`、`SettingsPageList`、`SettingsPageActions` 与 `SettingsSaveBar` 让各插件的页面与通用列表看起来一致。

**不承诺**：

- 搜索动态选项的选项名；密钥项的界面（随第一个密钥使用者）；本机层（configuration 输出 22）；设置文件视图的语法高亮；用户自定义快捷键。
- 刷新或关闭浏览器页面、页面所属插件停止时拦住未保存的改动（输出 22）。
- 路径类控件（选择目录）：路径类的项由所属插件贡献 page 分区，自己给选择方式。
- 手机宽度：只做桌面宽度。
- 入口按钮的样子：工作台活动栏底部的齿轮见 [`ui.workbench-shell`](../ui/workbench-shell.md) 输出 40，书架顶部的齿轮见 [`workbench.bookshelf`](../workbench/bookshelf.md) 输出 1；本 Spec 只定它们执行的命令、读的公开状态与谁贡献它们（“打开窗口”）。
- 窗口的位置不记，每次居中。

## 术语与参与者

- **分区**：左栏的一项；贡献点 `settings.sections` 或 `settings.pages` 上一条已接受的声明，贡献 id 就是分区 id。
- **list 分区**、**page 分区**：前者是 `settings.sections` 的声明，窗口按配置项的声明画控件；后者是 `settings.pages` 的贡献，贡献方交出页面组件。
- **小组**：list 分区里带小标题的一组配置项。小组 id 是分区声明的公开合同，别的插件的配置项按 id 引用。
- **标签**：窗口顶部的“用户 | 本作品”，决定编辑哪一层；未绑定作品的窗口只有用户层，没有标签。
- **书名**：窗口绑定的作品的显示名：书名，没有书名时是目录原名（[`runtime.projects`](../runtime/projects.md) 术语）；不是地址栏用的短名。覆盖提示（输出 11）与页面上下文的 `projectTitle` 用它。
- **“其它”**：窗口自己的分区，不是贡献；收留没写 `section` 或指向不存在的分区的配置项。左栏与标题显示为“插件设置”。
- **“设置文件”**：窗口自己的一项（id `file`），整份编辑当前标签那一层的设置文件（输出 23）。
- **交付状态**、**交付句柄**：同 [`workbench.views`](../workbench/views.md) 的定义，只对 page 分区有意义。
- 参与者：贡献分区的插件入口；声明配置项的插件；`nbook.settings`（贡献点拥有者、窗口、用户编辑的调用方）；`nbook.workbench`（通知、页面浮层与入口按钮）；用户。

## 输入与前置条件

### 分区声明

两个贡献点，拥有者都是 `nbook.settings`：

- `settings.sections`：list 分区，**顶层声明式贡献**（写在插件描述的 `contributions` 里，没有实现）。三个运行位置的 `nbook.settings` 都定义这个贡献点，每个实例都登记、都知道全部 list 分区。
- `settings.pages`：page 分区，只接受浏览器入口的贡献，实现是 `{load()}`。

```ts
// 登记后的声明：title 总有值。作者写下的形状是 WrittenSettingsSectionDeclaration、WrittenSettingsPageDeclaration
// （同一模块），其中分区、小组与 page 分区的 title 可以省略，登记时补约定键（见下文“约定键”）
// settings.sections
interface SettingsSectionDeclaration {
    readonly title: Text;
    readonly description?: Text;                   // 分区标题下的一行说明
    readonly icon: string;                         // 图标类名，例如 i-lucide-palette
    readonly category: "app" | "ai" | "plugins";   // 左栏分组：应用、AI、插件
    readonly order?: number;                       // 组内顺序，缺省 0，同值按 id
    readonly groups?: ReadonlyArray<{readonly id: string; readonly title: Text}>;
}
// settings.pages
interface SettingsPageDeclaration {
    readonly title: Text;
    readonly description?: Text;
    readonly icon: string;
    readonly category: "app" | "ai" | "plugins";
    readonly order?: number;
    readonly layout?: "column" | "fill";           // 缺省 column
    readonly layers?: ReadonlyArray<"user" | "project">;   // 在哪些标签下可用，缺省两者
    readonly keywords?: ReadonlyArray<Text>;               // 设置内搜索时另外比对的词（输出 21），至多 20 个
}
interface SettingsPageImplementation {
    load(): Promise<Component>;                    // 只取得组件定义；实例由窗口创建；props：{context: SettingsPageContext}
}
// 包页面：load 可以交模块（() => import("./Page.vue")）或组件；props() 在渲染时求值，补上 context 之外的属性
function settingsPage(load: () => Promise<Component | {default: Component}>, props?: () => Record<string, unknown>): SettingsPageImplementation;
// page 分区的入口按需激活时写进 activationEvents 的事件：`onSettingsPage:<分区 id>`（前缀归 nbook.settings）
function settingsPageEvent(sectionId: string): string;
interface SettingsPageContext {
    readonly id: string;
    readonly layer: Readonly<Ref<"user" | "project">>;    // 当前标签；页面只编辑这一层
    readonly projectTitle: Readonly<Ref<string | null>>;  // 绑定作品的书名（见术语），没有绑定时为 null
    readonly options: FormOptionSources;                   // 全部选项提供者的选项源（输出 20），交给页面里的 SchemaField、SchemaForm
    readonly writable: Readonly<Ref<boolean>>;             // 当前标签那一层能不能写：层 invalid、unavailable 时为假（输出 13）
    dirty(value: boolean): void;                           // 有没有未保存的改动（输出 22）；页面卸载后再调用不起作用
}
```

| 规则 | 不满足时 |
|---|---|
| `settings.sections` 写在插件描述的顶层；`settings.pages` 写在浏览器入口下 | 前者写在入口下为 `implementation-not-accepted`；后者写在顶层为 `implementation-required`，不是浏览器入口的贡献为 `invalid-declaration` |
| 分区 id 是点分的小写段（`a-z`、`0-9`、`-`，每段以字母开头，至少两段）、至多 128 个字符；`nbook.*` 插件写 `nbook.<名>`，其它插件以自己的插件 id 加 `.` 开头 | `invalid-declaration` |
| `title`（登记时补全后）、`description` 是文字（字符串、语言映射或文字引用，见 [`ui/i18n`](../ui/i18n.md)）；`icon` 非空；`category`、`layout`、`layers` 取上面的值；`order` 在 -1000000 到 1000000 之间；`keywords` 至多 20 个、每个都是文字 | 同上 |
| 小组 id 是一个小写段、至多 64 个字符，同一分区里不重复 | 同上 |
| `layers` 非空、不重复 | 同上 |
| 声明不认识的字段（包括已删除的 `kind`，以及 list 写 `layout`、`layers`，page 写 `groups`） | 同上 |
| 同一分区 id 出现在两个贡献点上（内核按贡献点分别去重，不跨点查重） | 这个 id 的分区都不显示，记一条诊断，与登记顺序无关；指向它的配置项按“分区不存在”归入“其它” |

配置项一侧的 `section`、`group`、`order`、`choices`、`applies` 见 [`settings.configuration`](configuration.md)“声明”。

### 约定键

宿主登记 `settings.properties`、`settings.sections`、`settings.pages` 的声明时，给省略的标题补上贡献方插件目录里的约定键，给没写命名空间的文字引用补上贡献方插件 id；通用规则见 [`ui/i18n`](../ui/i18n.md)“约定键”。写了的标题原样保留，不论是字符串、语言映射还是文字引用。

| 贡献点 | 省略的字段 | 约定键 |
|---|---|---|
| `settings.properties`（键 `<插件 id>/<名>`） | `title` | `settings.<名>.title` |
| 同上 | 字面量选项 `choices[].title` | `settings.<名>.choices.<String(值)>.title` |
| `settings.sections` | `title` | `settingsSections.<本地 id>.title` |
| 同上 | `groups[].title` | `settingsSections.<本地 id>.groups.<小组 id>.title` |
| `settings.pages` | `title` | `settingsPages.<本地 id>.title` |

- 本地 id 是分区 id 去掉 `<插件 id>.` 前缀后的部分，不以插件 id 开头时是完整 id（内置插件的分区写 `nbook.<名>`，本地 id 就是 `nbook.<名>`）；配置项的本地 id 是名，名里的点照写成键路径（`code.fontSize` 的标题键是 `settings.code.fontSize.title`）。
- 选项值经 `String` 转成键里的段：`true` 写作 `true`，`1.5` 写作 `1.5`。值里的点同样拆成键路径，所以带点的选项值要在目录里按嵌套写；需要平铺的键时显式写 `title`。
- `description`、`keywords` 这类可选字段省略就是没有，不补键。
- 键在目录里缺不缺不在登记时核对（三个运行位置都登记同一份声明，内置插件的目录只在浏览器构建里）；内置插件的声明测试核对键都在源语言目录里，窗口里缺的键按 [`ui/i18n`](../ui/i18n.md) 的缺键规则显示并诊断。
- 设置行的标题与选项名从配置服务的 `declaration(定义)` 取补全后的声明（[`settings.configuration`](configuration.md)“接口”）；插件自己拿着的定义是写下的样子，省略的标题不在里面。

### 选项提供者

贡献点 `settings.choices`，拥有者 `nbook.settings`，只接受浏览器入口的贡献。贡献 id 就是提供者 id，配置项声明里 `choices: {from: "<提供者 id>"}` 引用它。

```ts
// settings.choices：声明没有字段
type SettingsChoicesDeclaration = {};
interface SettingsChoicesImplementation {
    // 设置窗口第一次要这个提供者的选项时调用，同一次交付只调一次；值可以是响应式的
    source(): MaybeRefOrGetter<OptionSource<string>>;   // OptionSource 见 ui.forms 输出 11
}
// 提供者的入口按需激活时写进 activationEvents 的事件：`onSettingsChoices:<提供者 id>`（前缀归 nbook.settings）
function settingsChoicesEvent(providerId: string): string;
```

| 规则 | 不满足时 |
|---|---|
| 写在浏览器入口下 | 写在顶层为 `implementation-required`，不是浏览器入口的贡献为 `invalid-declaration` |
| 提供者 id 的写法与前缀同分区 id | `invalid-declaration` |
| 声明是空对象 | 同上 |


### 打开窗口

- 命令 `nbook.settings.open`，参数 `{section?: string; layer?: "user" | "project"}`，默认键位 `Mod+,`（其它平台 `Ctrl+,`、macOS `⌘,`；显示与分发见 [`workbench.commands`](../workbench/commands.md)）；只读（`effect: "read"`），不对 Agent 开放。“其它”分区的 id 是 `other`（只有一段，分区贡献写不出来，不会撞名），它在左栏里时可以作 `section`。
- 公开状态 `nbook.settings/windowOpen`（布尔，[`state.public`](../state/public-state.md)）：本页的设置窗口开着时为真，没有绑定时为假。
- 入口：`nbook.settings` 的窗口入口（启动即激活）向工作台贡献两样，都随这个入口出现与消失：
  - 活动栏底部条目 `nbook.settings`（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 40）：标题“设置”、图标 `i-lucide-settings`、`order: 1000`（在头像占位之下）、命令 `nbook.settings.open`、`toggled: nbook.settings/windowOpen`。
  - 页面浮层 `nbook.settings.window`（输出 41）：窗口本身。工作台在页面根上挂一份，首页（书架）与工作台页都有，每个浏览器页面一份。
- 书架右上角的齿轮由 `nbook.projects` 自己画，执行同一条命令、读同一个公开键（[`workbench.bookshelf`](../workbench/bookshelf.md) 输出 1）。

### 给页面用的组件

宿主与插件共用的前端组件（`src/ui/settings/`，插件在运行时直接引用，各带同名组件文档）：

- 下面三个组件的文字经注入的翻译端口（`useText()`）取，没有 `locale` 属性。
- `SettingsRow`（`nbook/ui/settings/SettingsRow.vue`）：属性 `settings`（调用方插件的配置服务）、`setting`（配置定义）、`layer`（当前标签）、可选的 `projectTitle`（覆盖提示里的书名）与 `wide`（宽排法，输出 9）；控件放在默认插槽里，插槽拿到这一层显示的值、是否停用、给控件用的 id、可访问名称、行标题的 id（`labelId`，给组合控件作 `aria-labelledby`）与生效时机标注、说明的 id（`describedby`，都没有时没有）；行自己的写入没有成功时发 `write-failed`。
- `SettingsPageList`（`nbook/ui/settings/SettingsPageList.vue`）：页面里的一张列表加下一级页面（输出 19），属性 `items`（每项 `id`、`title`，可选 `description`、`icon`、`status` 与状态色调、`modified`）、`modelValue`（打开的项的 id，`null` 时显示列表；点一项发出这一项的 id，返回发出 `null`，由调用方改值）、`label`（可访问名称）、可选的 `locale`（显示语言）；打开的项的内容放在默认插槽里，插槽拿到这一项。
- `SettingsPageActions`（`nbook/ui/settings/SettingsPageActions.vue`）：页面级操作，默认插槽里的按钮画在窗口标题区的右侧（输出 3），页面卸载时一起消失；没有属性。
- `SettingsSaveBar`（`nbook/ui/settings/SettingsSaveBar.vue`）：保存栏，属性 `dirty`、`busy`、可选的 `canSave`（缺省为真；为假时只停用“保存”，例如这一层连不上，放弃只丢本地草稿、照常可用）与 `message`（栏左侧的状态文字，有改动时缺省为“有未保存的更改”）；发出 `save`、`discard`。没有改动或正在保存时两个按钮停用，没有改动时不写文字。

前置：`nbook.settings` 的浏览器入口已激活；它激活时读本窗口已接受的全部分区声明与配置项声明。

## 输出与可观察行为

1. **左栏**：窗口从两个贡献点上已接受的分区声明取得左栏，未交付实现的 page 分区也在其中，左栏不随交付先后跳动。分三组，自上而下应用、AI、插件，每组上面一个淡色组标题，依次是“通用”“写作助手”“扩展”；组内按 `order`（缺省 0），同值按分区 id。“其它”排在插件组的最后，没有项时不出现。左栏宽约 176px，右边一次只显示一个分区；分区标题放不下时截断，悬停或聚焦时显示全名。每个分区是一行列表项（图标加标题）：没有描边，悬停与当前项各是一层淡底色，按下不缩放。没有可列的项的 list 分区在左栏停用，以“这个分区还没有设置项”作提示。
2. **配置项落到分区**：配置项按 `section` 落到 list 分区；分区里先列没写 `group` 的项（没有小标题），再按分区声明的顺序列各小组（有小标题）；同一小组内按 `order`（缺省 0），同值按键。`group` 指向分区没有声明的小组时按没写处理，记一条诊断。没写 `section` 的项、`section` 指向不存在的分区的项（记一条诊断）归入“其它”，按声明者插件分小组。指向 page 分区的项不在列表里画，由页面负责。
3. **外壳画什么**：每个分区顶部的标题区由窗口画：左边是标题（界面字体，主题最大一档字号、加粗）与跟在标题后面同一行的说明，说明放不下时截断、悬停显示全文；右边从右往左是页面级操作（page 分区经 `SettingsPageActions` 放进来，list 分区没有）与层的警告（输出 13）。list 分区与 `layout: "column"` 的页面放在同一个内容列里（同样的内边距与封顶宽度约 720px，内容列滚动）；`layout: "fill"` 的页面拿到标题区下面的整块区域（外边距同内容列，不封顶），自己分栏、自己滚动（例如模型服务页左边服务商、右边详情）。
4. **page 的交付状态**：page 分区处于下列之一，在右边原位呈现：
   | 状态 | 含义 | 原位呈现 |
   |---|---|---|
   | `declared` | 有声明，所属入口尚未激活或激活中 | 加载占位 |
   | `entry-blocked` | 所属入口受阻 | 受阻原因，无动作 |
   | `entry-failed` | 所属入口激活失败 | 失败原因与“重试” |
   | `entry-stopped` | 已交付的实现被撤回 | 停止原因 |
   | `entry-not-activatable` | 所属入口还没激活，且不会被按需激活：没声明这个分区的激活事件，或触发被拒 | “插件没有声明打开分区时激活”与原因，无动作 |
   | `available` | 句柄已发布 | 页面内容 |
   list 分区只靠声明呈现，不看贡献方入口的状态，总是可用。

   **按需激活**：窗口每次显示一个 page 分区（窗口开着、它是当前分区、当前标签下可用），所属入口处于“已登记、未激活”时，先看这个入口是否声明了 `onSettingsPage:<分区 id>`：声明了就以 `nbook.settings` 的身份触发它（[`runtime.plugins`](../runtime/plugins.md) 输出 21），没声明就是 `entry-not-activatable` 并记一条诊断，不触发。别的入口声明了同一个事件不算数。触发之后分区的状态只看它自己的入口与交付句柄，不等事件的全部结果，别的监听者一直不结束也不影响它。内核把同一代次的激活合并成一次，反复进入不重复激活；等待中离开或关窗口不取消，激活照常完成，再进入时按当时的状态呈现。入口同时声明 `onStartup` 时启动就激活，与此无关。
5. **page 的加载与失败**：page 分区第一次显示时调用一次 `handle.implementation().load()`，取得组件后创建实例并交给它 `context`；结果回来时句柄已不是当前句柄、已不处于 `published` 或窗口已关闭，就丢弃这次结果，不挂组件，也不记为加载失败。`load()` 失败或交出的实现没有 `load()` 时原位显示错误摘要与“重新加载”（后者另记一条诊断）；组件渲染出错原位显示错误摘要与“重试”（卸载并重建这个页面）。一个分区的失败不影响别的分区与窗口。“重试”经宿主能力 `window.plugins` 恢复并重新激活该分区所属的入口（同 [`workbench.views`](../workbench/views.md) 输出 8）。
6. **页面上下文**：切换标签时 `context.layer` 变化，页面不重建；页面用自己插件的配置服务读写自己声明的项，写入带 `{layer: context.layer.value}`。离开分区时页面卸载，回到分区时重新创建（交付句柄没变时不重新加载组件定义）。上下文按一次显示给：页面挂着的这段时间（含切换标签）是同一个对象，页面卸载（离开、关窗口、重新加载、撤回、开始搜索）后它作废，下次显示另给一个；加载中就关了窗口的那次也作废。
7. **标签**：绑定作品的窗口在窗口标题下、左栏上方显示“用户 | 本作品”分段控件，缺省“用户”；未绑定作品的窗口不显示，只编辑用户层。
8. **分区在标签下可用**：list 分区在“本作品”标签下可用的条件是其中至少一项允许项目层，在“用户”标签下同理看用户层；page 分区看声明的 `layers`（缺省两者），由页面作者让它与页面里配置项的层一致。不可用的分区在左栏停用并以原因作提示；当前分区在新标签下不可用时仍是当前分区，右边原位显示不可用的原因。
9. **通用控件**：每项用 [`ui.forms`](../ui/forms.md) 的单个字段（`SchemaField`）画，控件按 `ui.forms` 输出 2 从 schema 选出：布尔用开关；字面量联合不超过 3 项用分段控件（选项带说明或名字长时用横排单选组，按 `ui.forms` 输出 2），多于 3 项用下拉，选项名取 `choices` 的 `title`，没有 `choices` 时是字面量本身；数字用数字输入框，范围与步长取 schema 的 `minimum`、`maximum`、`multipleOf`；字符串用输入框，长度取 `minLength`、`maxLength`；字符串数组、对象与对象数组画成可以直接编辑的列表与字段组，`ui.forms` 表外的写法用 JSON 编辑。声明的 `ui` 提示照用（例如 `widget: "multiline"` 画多行文本框）。动态选项（`choices: {from}`）的项列出选项提供者给的选项（输出 20）。`applies` 不是 `now` 时标题后用一枚小标签标注“下次运行生效”“下次会话生效”或“重启后生效”。每项的排法（混合排法）按选出的控件定（`ui.forms` 的 `widgetLayout`）：
   - **标题加控件**：开关、分段控件、横排单选组、下拉、数字与单行输入。标题与说明在左，控件靠右，最右边固定留一格放“恢复默认”（没改过的行也留着），所以各行控件的右缘对齐；宽度按类型定：下拉 220px、数字框 120px、单行输入 200 到 320px（随行宽收窄，放不下 200px 才换到标题下面；都不超过行宽），分段控件与单选组按选项名给足宽度、各项完整显示，开关原样。
   - **宽排法**：多行文本、竖排单选组、复选组、列表、对象与 JSON。标题与说明在左上，“恢复默认”（本作品标签是“移除本作品的设置”）在标题那一行的右端、与上一种排法的那一格对齐，控件另起一行、占满内容列宽度；本作品标签沿用时同样把控件画在下面、可用，显示沿用的值（输出 12）。page 页面里的宽控件用 `SettingsRow` 的 `wide` 得到同样的排法。
   - 控件的名字是行的标题；生效时机的标注与说明经 `aria-describedby` 接上，不进名字；分段控件、单选组、复选组经 `aria-labelledby` 指向行的标题。
   - 只读的项（schema 的 `readOnly`）不画控件，只写当前值（正文色，可以选中复制），“恢复默认”那一格放一个锁形图标，悬停提示“只读”与原因。
   - 行的状态原因收在标题后面的图标里：出错（输出 14）是危险色图标，选项拿不到（输出 20）是淡色图标；悬停图标或焦点在控件上时用提示显示原因，原因经 `aria-describedby` 接到控件上。行不因原因的出现与消失改变高度。
10. **已修改**：当前标签这一层写了这个键就算改过：标题后面一个强调色小圆点（悬停提示“已修改”），控件后面那一格放“恢复默认”，点了从这一层删掉这个键（`unset`），控件回到下一层的值。
11. **被本作品覆盖**：用户标签里，本作品层写了的项在标题下一行用信息色提示“《书名》已单独设为 X，此处的更改在该作品中不生效”。
12. **本作品标签**：本作品层没写的项照常画控件、显示当前生效的值（下一层的值），标题后一枚描边小标签“来自用户设置”（与填色的生效时机标签分开）；改控件就写进本作品层。写了的项有小圆点，显示控件与“移除本作品的设置”（`unset`；与“恢复默认”同一个图标按钮、提示文字不同）。只允许用户层的项不列出，分区末尾一行淡色字列出这些项的标题，写“仅可在用户设置中修改”（“用户”标签下只允许项目层的项同理，写“仅可在本作品中设置”）。
13. **层的状态**：当前标签那一层 `invalid` 时，标题区右侧一个警告按钮“设置文件格式有误”加“打开”，悬停提示出错的位置与原因（第几行第几列、哪里不对）、“修复前，这一层的设置无法保存”与这一层的文件路径（层快照带路径时，见 [`settings.configuration`](configuration.md) 输出 23：项目层带，用户层的文件在状态根下、不带）；这一层的控件停用并显示上一份有效值。点它切到左栏的“设置文件”（输出 23），打开这一层的文件，光标放在出错处、那一行标出错底色，标题区右侧改写为“第 N 行第 M 列：<原因>，改好后保存”；保存成功后警告消失，不自动回到原来的分区。`unavailable` 时标题区右侧写“暂时无法连接，无法保存”（没有按钮），控件停用。层不能写时，page 分区经 `SettingsPageActions` 放进标题区的操作整体停用，页面自己的控件按 `context.writable` 停用。层恢复后警告自动消失、控件与操作恢复。出错位置来自层快照（[`settings.configuration`](configuration.md) 输出 5）；快照没有位置时只打开文件、不定位。当前页面有未保存的改动时，点警告先走输出 22 的确认，确认后切过去，位置在文件读完后用一次；取消则留在原处。
14. **写入结果**：成功不提示；写入结算之前控件显示这次的值。失败发工作台通知（[`workbench.notifications`](../workbench/notifications.md)，警告色调，标题“设置没有保存”，正文写哪一项与原因），控件回到层里的实际值；`unknown-outcome` 的通知标题是“设置可能没有保存”，正文“可能没有保存，以设置文件为准”。数字框与单行输入编辑时只改草稿，失去焦点或回车才写；数字框、JSON 里写的内容解析不了时不写，控件标出错，标题后的出错图标提示“未保存：<原因>”（输出 9 的状态原因，`ui.forms` 输出 15）。字符串列表、对象、对象列表与 JSON 的新值不合 schema 时（例如刚加的一项还没填）同样不写、留在这一行，同一个图标提示第一条原因，合格了再写；改回层里原来的值时不写；层里的值变了、切换标签或换分区时丢掉留下的值（开发者 2026-10-21 定）。其余不合 schema 的值由写入路径以 `invalid-value` 拒绝，同样发通知、回到实际值。 page 分区自己发起的写入失败时，经页面上下文的 `reportWriteFailure(没保存的那一项, {reason, uncertain})` 交给窗口发同样的通知，`uncertain` 为真时标题是“设置可能没有保存”；页面不自己发通知，离开页面后晚到的失败照样通知。
15. **一个页面一个窗口**：`nbook.settings.open` 打开本页的设置窗口，已开着时只聚焦；给了 `section` 跳到这个分区，给了 `layer` 切到这个标签。`section` 不在左栏里时以 `invalid-args` 失败，`layer: "project"` 而窗口没有绑定作品时以 `unavailable` 失败，两种都不打开、不改变窗口。关掉再开回到上次的分区与标签；刷新页面后回到第一个分区、用户标签。
16. **外框**：非模态浮动窗口，没有标题栏：左栏从层标签起，关闭按钮在窗口右上角，窗口的可访问名称是“设置”；按住窗口顶上的空白处（左栏顶边、标题区的空白，按钮与输入控件除外）拖动窗口，移动超过几个像素才开始拖，不到就是一次普通的点击；关闭按钮只在会压到内容时让位。缺省 960×640（不超过页面），可拖动边缘调整大小、下限 600×400，尺寸按客户端记住；切换分区时窗口不变大小；每次打开居中。浏览器窗口变化时：没拖过、没调过大小的窗口保持居中；否则放得下就不动，放不下就推回完整可见，放大后不回原位。页面比 600px 还窄、窗口跟着变窄时，左栏改成顶上两行：标签与搜索框并排，分区横排一行、可以横向滚动，不显示组标题与图标；放不下控件的行把控件换到标题下面。
17. **键盘**：打开时焦点在左栏的当前项；焦点在左栏时上下键切换到上一个、下一个可用分区（Home、End 到首尾），焦点跟着走；`Esc` 关窗口（搜索框里有字时先只清空，输出 21），焦点回到打开窗口之前的位置。
18. **`SettingsRow`**：按传入的设置定义、配置服务与层自己算出并画出：已修改圆点与“恢复默认”（经传入的配置服务以 `update(setting, undefined, {layer})` 删除这一层的键）、用户标签下的“本作品覆盖”提示（输出 11）、本作品标签下的沿用标签“来自用户设置”与“移除本作品的设置”（输出 12）、层 `invalid` 或 `unavailable` 时控件停用（输出 13）、声明不允许当前层时不画控件并说明；标题、说明、`applies` 标注与两种排法同通用列表。行自己的写入没有成功时交给调用方（设置窗口发通知）。页面不重写这些规则。通用列表的每一项也是一个 `SettingsRow`，写入换成用户编辑路径。
19. **`SettingsPageList`**：页面里的一张列表加下一级页面，本组件不做左右分栏；要左右分栏的页面用 `fill` 自己分（输出 3）。没打开项时是一张列表，每项一行：图标、标题与说明、状态文字（按色调着色）、右箭头，改过的项标题后有小圆点；点一行打开它。打开后列表换成这一项的内容（默认插槽），焦点在这一项的内容上（读屏念出这一项的标题），窗口标题区换成“‹ 页面标题”返回（读作“返回 页面标题”）与这一项的标题，返回回到列表、焦点回到这一项。页面级操作（`SettingsPageActions`）在两种状态下都由页面决定放什么。
20. **选项提供者**：窗口按提供者 id 给出选项源（`ui.forms` 输出 11），通用列表与 page 页面（`context.options`）用同一份，在窗口所属入口的一生里是同一个对象：
    - 提供者已交付：它给的值；之后它出错（`source()` 抛错、交出的实现没有 `source()`、值求值时抛错或形状不对：状态不是三态之一，选项的 `value` 不是字符串，`label`、`description` 不是文字）时只有这个源不可用，原因写“无法加载选项：…”，同一次交付里同一个问题记一条诊断（`settings.choices`）。提供者换代时重新调 `source()`。
    - 所属入口已登记未激活：先是加载中；入口声明了 `onSettingsChoices:<id>` 时窗口第一次要这个源就触发它（同输出 4 的核对：只看所属入口是否声明，触发之后只看它自己的入口与交付），交付后变成它的选项；没声明或触发被拒时不可用，原因写“无法加载选项：插件没有声明打开设置时提供选项”，记诊断。正在激活时是加载中。
    - 所属入口受阻、激活失败时不可用并写原因；入口停止、交付撤回后不可用（“无法加载选项：插件 X 已停止”）；配置项引用了没有人提供的 id 时不可用（“无法加载选项：没有选项提供者 X”）。X 现在是插件 id，插件有显示名后换成显示名。
    - 当前值不在选项里时照常显示并标“已不存在”，值保留；值的校验只看 schema（`ui.forms` 输出 12）。
21. **搜索**：左栏上方一个搜索框；焦点在窗口里时 `Mod+F` 聚焦它（拦住浏览器的查找；`Mod` 在 macOS 上是 Command、其它平台是 Ctrl，按物理键判断；输入法组字时、焦点在设置文件的文本框里时、焦点在窗口外时不拦）。不分大小写、按空白分词、每个词都要命中：
    - list 分区与“其它”里的配置项比对标题、说明、键与固定选项名（各语言的写法都比），动态选项的选项名不比；只列当前标签这一层允许的项（同输出 12）。结果按分区与小组分组（组标题写“分区名 › 小组名”，没有小组时只写分区名），每项照常是一个可以改的行（输出 9–14），标题与说明里命中的字标底色。
    - page 分区比对标题、说明、`keywords` 与指向它、由页面画的配置项；只列当前标签下可用的（同输出 8），放在最后的“页面”组里，每条一行，右端“打开 ›”，点了清空搜索、切到这个分区。
    - 有搜索词（去掉空白后非空）时右边换成结果（标题“搜索结果”），左栏照旧但不标当前项；结果数（“N 个设置、M 个页面”）经状态行播报；没有命中时写“没有找到设置”。只有空白的搜索词不算在搜索。换搜索词时结果重建，结构字段留在行里的值随之丢掉（同换分区，输出 14）。
    - 清空搜索（清除按钮，之后焦点回到搜索框；或框里有字时按 `Esc`）回到原分区；选左栏的分区也清空搜索。搜索词不记，关窗口即清。
22. **未保存保护**：page 页面经 `context.dirty(true)` 报有未保存的改动（列表的增删排序也算，页面按“已保存的值与草稿”判断），保存成功后报 `false`。页面报了未保存时，会离开它的动作先弹确认“放弃未保存的更改？”，正文““<分区标题>”有未保存的更改。离开此页面后，这些更改将会丢失。”（“放弃”是危险色，“继续编辑”，焦点默认在“继续编辑”）：切到别的分区、切标签、关窗口（关闭按钮、`Esc`）、`nbook.settings.open` 换了分区或标签、在搜索框输入（搜索词从只有空白变成有字的那一下）。“继续编辑”（或在确认框里按 `Esc`）留在原处，焦点回到触发的位置；“放弃”执行这个动作，页面卸载、草稿丢掉（切标签时页面重建），焦点按动作去：从搜索框起手的回搜索框，切标签的回标签，点层警告打开设置文件的进文本框，其余到左栏的当前项。确认框开着时又来一个这样的动作，等着的换成后来的，不叠第二个确认框。页面卸载后旧上下文的 `dirty` 调用不起作用。拦不住的：页面所属入口停止或交付撤回、窗口所属入口停止、刷新或关闭浏览器页面，这些照常卸载页面，改动丢失。list 分区每项即时写入，不涉及；结构字段留在行里的值不算未保存。
23. **设置文件**：左栏插件组的最后（“其它”之后）固定一项“设置文件”，右边整份编辑当前标签那一层的设置文件，经 [`settings.configuration`](configuration.md) 输出 24 读写。项目层显示文件路径，用户层不显示（状态根不发给浏览器）。
    - 底部是保存栏（`SettingsSaveBar`）：“保存”“放弃更改”一直在，没有改动时停用，有改动时写“有未保存的更改”；视图占满标题区下面的区域（同 `fill`），保存栏钉在底部、不随内容滚走。等宽的多行文本框，高度随窗口伸缩，不自动换行，左边是行号；`Tab` 插入两个空格（选中了一段时不插），第一次 `Esc` 只放开 `Tab`、不关窗口，紧接着的 `Tab` 移走焦点，再按一次 `Esc` 才关窗口；焦点在视图里时 `Mod+S` 保存。文本框下面一行写着这几个键（“插入缩进”“移出编辑区”“保存”）。读到 CRLF 换行的文件时，保存后仍是 CRLF。
    - 保存成功：按钮停用、焦点回到文本框，本窗口随即是新值。`invalid-text`：不写，标题区右侧写“未保存：第 N 行第 M 列：<原因>”、文本框标出错、光标放到出错处、那一行标出错底色，再改文本时标记去掉。`conflict`：写明“重新读取”会丢掉这里的改动、“仍然保存”会盖掉别处的改动，给这两个按钮（“仍然保存”拿当前的修订号再写一次）。
    - 别处改了文件（文本的修订号变了）：没有改动时原地重读（文本框不卸载）；有改动时只提示，同样给“重新读取”“仍然保存”，不覆盖这里的草稿。读取进行中收到的修订号读完再核对；这一层从连不上恢复时重新订阅、重新核对。
    - 读不了（`read-failed`，包括文件不是合法的 UTF-8）时写原因与“重新读取”；这一层 `unavailable` 时文本框只读。层 `invalid` 时照样可以打开、修好、保存。
    - 有改动时算未保存，离开它走输出 22 的确认；换标签就是换一个文件，确认后丢掉草稿、重读。
    - 搜索时它按标题、说明与“settings.json”参与 page 一样的命中（输出 21）。

## 状态与转换

page 分区的交付状态：

| 初始状态 | 事件 | 下一状态 | 页面实例 |
|---|---|---|---|
| `declared` | 句柄 `published` | `available` | 分区显示时加载并创建 |
| `declared` | 入口受阻 / 激活失败 | `entry-blocked` / `entry-failed` | 无 |
| `entry-failed` | 用户点“重试”且恢复、激活成功 | `available` | 分区显示时加载 |
| `available` | 句柄撤回 | `entry-stopped` | 卸载，丢弃已加载的组件定义 |
| `entry-stopped` | 同一分区再次交付 | `available` | 新句柄，重新加载 |

窗口：关闭 →（`nbook.settings.open`，`section` 可以是 `file`）打开，`windowOpen` 为真 →（关闭按钮、`Esc`）关闭，`windowOpen` 为假。页面报了未保存时，会离开它的动作先进入“等确认”（输出 22），确认后执行、取消后回到原状态。

时序与寿命：

- 交付句柄从 `published` 起可用，到撤回为止；撤回之后访问 `implementation()` 抛错，窗口不缓存实现。
- 一次加载从发起到结果回来之间，入口可能停止：撤回先于结果到达时丢弃结果（输出 5）；结果先到、撤回后到时，先挂上的页面随撤回卸载并显示停止原因。
- “重新加载”“重试”在一次进行中时重复点击不发起第二次。
- 用户编辑成功返回时本窗口已是新值（configuration 输出 19）；同一层被别处改动（另一个窗口、外部改文件）时窗口里的值即时变化。
- 设置窗口经工作台的页面浮层挂在页面根上，随页面卸载（导航、刷新）而关闭，`windowOpen` 回到假；每个浏览器页面各一份，互不影响。窗口组件加载失败或渲染出错时只是窗口不显示（工作台记诊断 `workbench.overlays`），命令照常改变 `windowOpen`。
- 窗口的数据来源与用户编辑路径由 `nbook.settings` 的配置核心入口持有：它停止时窗口关闭，进行中的写入照常结算。

## 副作用与数据

- 通用列表只经用户编辑路径（configuration 输出 19）写配置文件；page 分区经自己插件的配置服务写自己声明的项（configuration 输出 11）。
- 窗口尺寸是 `nbook.settings` 的一条 `local` 记录 `settings.window-size`（[`storage.persistence`](../storage/persistence.md)，user 分区，`{width, height}`），同一客户端的各个页面共用，第一次打开窗口时才读；记录读不到或损坏时用缺省尺寸，不阻止打开；保存失败只改本页的显示，不提示。
- 上次的分区与标签、交付状态与已加载的组件定义只在内存，随页面释放。

## 失败与恢复

| 情况 | 结果 | 用户或作者怎么办 |
|---|---|---|
| 分区声明不合规则 | 声明被拒，内核诊断写明原因；分区不出现 | 作者按诊断修正 |
| 配置项指向不存在的分区或小组 | 落到“其它”或分区最前，记一条诊断 | 作者修正 `section`、`group`，或贡献那个分区 |
| page 入口受阻、激活失败、`load()` 失败、渲染出错、撤回 | 输出 4、5 的原位呈现 | 按呈现的动作重试，或刷新页面 |
| 选项提供者不可用、出错 | 这一项停用，标题后的图标提示原因（输出 9、20） | 作者按诊断修正；用户等插件恢复或刷新页面 |
| 写入失败 | 工作台通知，控件回到实际值 | 按通知处理（例如修好文件、改权限） |
| `unknown-outcome` | 提示可能没有保存 | 以设置文件为准 |
| 层 `invalid`、`unavailable` | 标题区右侧的警告，这一层的控件停用（输出 13） | 修好文件；等连接恢复 |
| `nbook.settings.open` 的参数不对 | `invalid-args` 或 `unavailable`，不打开 | 调用方修正参数 |

## 边界与兼容

- 公开接口：贡献点 `settings.sections` 与 `SettingsSectionDeclaration`、`settings.pages` 与 `SettingsPageDeclaration`、命令 id `OPEN_SETTINGS_COMMAND` 与公开键 `SETTINGS_WINDOW_OPEN_KEY`（`nbook/plugins/settings/shared/contracts`）；`SettingsPageImplementation`、`SettingsPageContext`（`nbook/plugins/settings/web/contracts`）；`settingsPage`（`nbook/ui/settings/settings-page`）；`settingsPageEvent` 与激活事件前缀 `onSettingsPage`、贡献点 `settings.choices` 与 `SettingsChoicesDeclaration`、`settingsChoicesEvent` 与前缀 `onSettingsChoices`（`nbook/plugins/settings/shared/contracts`）；`SettingsChoicesImplementation`（`nbook/plugins/settings/web/contracts`）；`SettingsRow`、`SettingsPageList`、`SettingsPageActions`、`SettingsSaveBar`（`nbook/ui/settings/`；`SettingsPageList` 的属性在 2026-10-22 随输出 19 改过一次，当时的使用者只有 Lab 样板）；命令 `nbook.settings.open`；公开键 `nbook.settings/windowOpen`。分区声明与页面上下文只增不改，新增可选字段不影响旧插件；小组 id 是分区的公开合同，改名等于删掉旧小组。
- 用户编辑路径与窗口的数据来源只给 `nbook.settings` 自己（configuration 输出 19），别的插件的页面只能写自己声明的项。
- 信任边界：页面组件跑在工作台的 Vue 应用里，错误边界只覆盖 Vue 调用路径；组件自己发起、没有交给 Vue 的异步错误由所属插件处理。

## 验收与 Smoke

1. Given 工作台页与书架页，When 点各自的齿轮或按 `Ctrl+,`，Then 打开同一个窗口；再触发只聚焦；窗口开着时齿轮画成按下（按钮见入口所在的 Spec）。
2. Given 绑定同一作品的两个页面，When 在用户标签改主题，Then 两个页面即时变化；When 本作品标签单独设明暗，Then 用户标签出现覆盖提示；When 移除本作品的设置，Then 提示消失。
3. Given 改过的项，Then 有已修改标记；When 恢复默认，Then 键从文件里删掉、其余内容不变。
4. Given 用户层文件被改坏，Then 标题区右侧出现警告、控件停用；When 点警告，Then 切到设置文件、光标在出错处；When 改好保存，Then 警告消失、控件恢复。
5. Given 只读的设置文件，When 改一项，Then 发通知、控件回到实际值。
6. When 拖动调整窗口大小后关掉再开、刷新页面，Then 仍是这个尺寸；切换分区时窗口尺寸不变。
7. Given 一个 page 分区，When 切换标签，Then 页面拿到新的层并按层读写；When 页面加载失败，Then 原位显示错误、别的分区照常；When 所属入口停止，Then 原位显示停止原因。
8. Given 不写标题的配置项（内置代码、SDK 辅助函数与手写清单各一条），When 服务端实例登记它们，Then 配置服务的 `declaration` 给出的标题是声明者插件命名空间下的约定键 `settings.<名>.title`；Given 不写标题的字面量选项、分区、小组与 page 分区，When 补全，Then 补出上表的键，写了的标题只补命名空间。

Smoke 入口：`e2e/settings.e2e.ts`（扩展到设置窗口）。

## 实现合同

- **公开入口**：`nbook/plugins/settings/shared/contracts`（贡献点 `SETTINGS_SECTIONS_POINT`、`SETTINGS_SECTION_CATEGORIES` 与 `SettingsSectionDeclaration`；作者写下的形状 `WrittenSettingsSectionDeclaration`、`WrittenSettingsPageDeclaration` 与补全函数 `completeSectionDeclaration`、`completePageDeclaration` 在 `nbook/plugins/settings/shared/sections`，命令 id `OPEN_SETTINGS_COMMAND`，公开键 `SETTINGS_WINDOW_OPEN_KEY`）；`nbook/plugins/settings/web/contracts`（`SettingsPageImplementation`、`SettingsPageContext`）；`nbook/ui/settings/SettingsRow.vue`、`nbook/ui/settings/SettingsPageList.vue`、`nbook/ui/settings/SettingsPageActions.vue`、`nbook/ui/settings/SettingsSaveBar.vue`。窗口模型 `createSettingsWindow`、分区注册表与窗口数据来源是 `nbook.settings` 的内部实现，数据来源经服务只发给 `nbook.settings` 自己的入口。
- **owner 与依赖方向**：`nbook.settings` 的浏览器侧有两个相关入口。配置核心入口持有配置实例、`settings.pages` 的接收者（分区注册表，经宿主能力 `window.plugins` 查入口状态与重试）、`settings.choices` 的接收者（选项提供者注册表，同样查入口状态）与窗口数据来源；窗口入口持有窗口模型，贡献打开命令、公开键、活动栏底部条目（`workbench.activitybar-items`）与页面浮层（`workbench.overlays`），依赖工作台的通知与 Storage（窗口尺寸记录）。工作台依赖配置核心，窗口因此不在核心入口里，免得服务装配的静态环。通用列表经层拥有者的用户编辑写入（[`settings.configuration`](configuration.md) 输出 19）；page 分区的贡献方只引用上面的公开入口，写入走自己插件的配置服务。书架右上角的齿轮由 `nbook.projects` 画，只读公开键、执行命令（[`workbench.bookshelf`](../workbench/bookshelf.md) 输出 1）。
- **关键不变量**：
  - 窗口数据来源（含用户编辑的写入路径）只发给 `nbook.settings` 自己、没有经过代理的入口；层的拥有者对用户编辑再按内核填写的调用方核对一次（`web/sections.test.ts`“设置窗口的数据来源只给 nbook.settings 自己”，`settings.test.ts`“用户编辑”）。
  - page 分区的页面实例与已加载的组件定义归窗口模型，不归组件：交付撤回时同步作废（撤回与再次交付挨在同一轮也换用新句柄），窗口关闭时作废进行中的加载；一次加载的结果只在它的代次仍是最新、实例仍在加载时生效（输出 4、5，`window.test.ts`“page 分区的加载”）。
  - 页面上下文按一次显示给，`layer` 是窗口标签的只读引用：切换标签时页面不重建、上下文不变，离开再回来不重新加载组件定义；显示结束时上下文作废、未保存的标记清掉（输出 6、22，`window.test.ts`“page 分区的加载”“未保存保护”，`SettingsWindow.dom.test.ts`“page 页面的寿命”）。
  - 会离开当前页面的动作都经同一个入口，页面报了未保存时先等确认，确认框开着时只记最后一个动作（输出 22）；点层警告打开设置文件也走这个入口，出错位置等文件读到最新文本后用一次（输出 13，`SettingsWindow.dom.test.ts`“层文件有语法错误”）。
  - 标题区右侧（页面级操作、页面标题的接管、写在标题区的文字）由窗口经 `page-chrome` 提供，每次登记返回撤销函数，只撤自己那一次；页面卸载时它的登记随之撤掉，层不能写时操作整体停用（输出 3、13、19，`SettingsPageActions.dom.test.ts`、`SettingsPageList.dom.test.ts`）。
  - 选项源的映射在注册表的一生里不变，每项是读交付句柄与入口状态的计算值；提供者给的值每次求值都在边界里核对，出错只让这一个源不可用；按需激活在求值之外触发（输出 20，`web/choices.test.ts`）。
  - `SettingsRow` 的已修改、沿用、覆盖提示与停用只由配置服务的 `inspect` 结果与当前标签算出，通用列表与 page 页面共用这一份规则（输出 10–13、18，`SettingsRow.dom.test.ts`）。
  - 通用控件的写入在结算之前按“标签加键”记下这次的值供控件显示，结算后清掉，控件回到层里的实际值；失败另经通知交给用户（输出 14，`window.test.ts`“通用列表的写入”）。

## 证据

- 批准依据：外观与文案的改动是开发者在 w00027 t06 评审中定的（2026-10-22，t06 README“设计决定”第 5–13 条）；外框、标题字号与本作品标签的沿用行是 w00027 t10 评审定的（2026-10-23，t10 README“设计决定”第 1–6 条）；开发者批准的 t80 实施计划（记录在主工作区 master 的 `.agents/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/plan.md`）“关键设计”第 2、4 节；窗口尺寸由开发者改为缺省 960×640（2026-10-12）；每项的混合排法（输出 9）由开发者确认（2026-10-12，t80 README 待定第 11 条）；开发者 2026-10-13 批准晋升为 `implemented`。
- 实现入口：[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/settings/web/plugin.ts)（配置核心入口与窗口入口：分区贡献点、打开命令、公开键、活动栏齿轮与窗口浮层）、[`web/settings-window.ts`](../../../packages/neuro-book/src/plugins/settings/web/settings-window.ts)（窗口模型）、[`web/sections.ts`](../../../packages/neuro-book/src/plugins/settings/web/sections.ts)（分区注册表与交付状态）、[`web/choices.ts`](../../../packages/neuro-book/src/plugins/settings/web/choices.ts)（选项提供者注册表）、[`web/components/SettingsFileView.vue`](../../../packages/neuro-book/src/plugins/settings/web/components/SettingsFileView.vue)（设置文件视图）、[`web/components/SettingsWindow.vue`](../../../packages/neuro-book/src/plugins/settings/web/components/SettingsWindow.vue)、[`src/ui/settings/`](../../../packages/neuro-book/src/ui/settings/)（`SettingsRow`、`SettingsPageList`、`SettingsPageActions`、`SettingsSaveBar`、`settingsPage`，标题区的登记 `page-chrome.ts`，搜索命中的标记 `highlight.ts` 与 `HighlightedText`）
- 合同测试：[`window.test.ts`](../../../packages/neuro-book/src/plugins/settings/window.test.ts)（落位、打开命令、尺寸、按需激活、搜索、未保存保护、page 加载、写入与层的说明、设置文件视图，真实内核与真实设置文件）、[`web/sections.test.ts`](../../../packages/neuro-book/src/plugins/settings/web/sections.test.ts)（分区的登记校验与交付状态）、[`web/choices.test.ts`](../../../packages/neuro-book/src/plugins/settings/web/choices.test.ts)（选项提供者的登记校验、状态、出错边界与按需激活）、[`commands.test.ts`](../../../packages/neuro-book/src/plugins/settings/commands.test.ts)（打开命令的登记、参数与公开键）、组件测试 [`SettingsWindow.dom.test.ts`](../../../packages/neuro-book/src/plugins/settings/web/components/SettingsWindow.dom.test.ts)、[`SettingsRow.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/SettingsRow.dom.test.ts)、[`SettingsPageList.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/SettingsPageList.dom.test.ts)、[`SettingsPageActions.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/SettingsPageActions.dom.test.ts)、[`SettingsSaveBar.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/SettingsSaveBar.dom.test.ts)、[`highlight.test.ts`](../../../packages/neuro-book/src/ui/settings/highlight.test.ts)、[`settings-page.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/settings-page.dom.test.ts)；[`06-settings-page.test.ts`](../../../packages/neuro-book/plugin-sdk/examples/scenarios/06-settings-page.test.ts)（示例插件 [snippets](../../../packages/neuro-book/plugin-sdk/examples/plugins/snippets/) 的 page 分区：声明、交付与撤回、按层写入、越权写入）；约定键（验收 8）：[`convention-keys.test.ts`](../../../packages/neuro-book/src/convention-keys.test.ts)（真实服务端实例与配置服务；各贡献点补出的键与上表逐条对照）
- Smoke：[`settings.e2e.ts`](../../../packages/neuro-book/e2e/settings.e2e.ts)（验收 1–4、6：工作台与书架的齿轮、`Ctrl+,`、`Esc` 后焦点回到打开前的位置，两个页面即时变化，本作品覆盖与移除，恢复默认后的文件，文件改坏与修好，尺寸跨关闭与刷新、每次打开居中；输出 21、23：`Ctrl+F` 搜索并改掉一项、`Esc` 先清空，设置文件视图 `Ctrl+S` 保存后原样落盘、经它修好改坏的文件；输出 20、22：Lab“模型服务”的草稿、保存被拒与确认离开；输出 12、16：沿用的行直接改写进本作品层，窗口顶上、左栏顶上与标题区的空白能拖、输入框上不拖，关闭按钮在几种宽度与 fill 视图里不压内容）；[`bookshelf.e2e.ts`](../../../packages/neuro-book/e2e/bookshelf.e2e.ts)（“作品”分区的目录选择器叠在窗口上）；Lab 场景 `SettingsWindow`、`SettingsRow`、`SettingsPageList`、`SettingsPageActions`（`lab-scenes.e2e.ts` 逐个检查溢出与焦点环）；通用控件的选择、约束与提交时机由 `ui.forms` 的测试覆盖
