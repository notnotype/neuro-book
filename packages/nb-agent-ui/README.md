# @notnotype/nb-agent-ui

Agent 对话视图。行为合同见 [`ui.agent-conversation-view`](../../docs/specs/ui/agent-conversation-view.md)，包的约定见 [AGENTS.md](AGENTS.md)。

- `@notnotype/nb-agent-ui`：核心，纯 TS。视图合同（`ctx`、`services`、`action`）、注册表、界面文字的引用（`agentRef`），以及宿主注入组件要满足的形状（`ports.ts`）。
- `@notnotype/nb-agent-ui/locales`：本包界面文字的消息目录（命名空间 `nb-agent-ui`，源语言 zh-CN），注入翻译端口的宿主登记它，见“[界面文字](#界面文字)”。
- `@notnotype/nb-agent-ui/vue`：渲染层。宿主挂 `AgentConversationView`，要会话列表时另挂 `AgentSessionList` 或带搜索与过滤的 `AgentSessionPanel`；注册表用内置登记（`builtinContributions` 或四份单独的）加自己的。
- `@notnotype/nb-agent-ui/lab`：只给应用的 Component Lab，单独挂内部零件与算轮次样例；不是宿主接口，形状随时会变。

## 安装

```bash
bun add @notnotype/nb-agent-ui
```

只支持 Bun。包里是 TypeScript 与 `.vue` 源码，不带编译产物，由宿主的 Vite 与 Tailwind v4 编译（[ADR 0028](../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md)、[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。peer 依赖 `vue` 与 `typescript`（编译单文件组件时解析导入的 props 类型要用），Bun 安装时会自动装上；宿主另装 `vite`、`@vitejs/plugin-vue`、`tailwindcss` 与 `@tailwindcss/vite`。许可证 AGPL-3.0-only。

## 宿主接入

1. **依赖**：只进前端构建的宿主放 `devDependencies`；`vue` 是 peer 依赖。
2. **样式**：宿主自己编译 Tailwind，在 nb-ui 之后导入本包的入口，图标类名才会生成：

   ```css
   @import "@notnotype/nb-ui/tailwind.css";
   @import "@notnotype/nb-agent-ui/tailwind.css";
   ```

3. **挂载**：一个最小宿主（跑 harness 的宿主，数据见下一节）：

   ```vue
   <script setup lang="ts">
   import {shallowRef, watchEffect} from "vue";
   import {acceptSubmission, applyComposerAction, createAgentContext, createAgentViewRegistry, type AgentLocale, type AgentViewAction} from "@notnotype/nb-agent-ui";
   import {AgentConversationView, builtinContributions} from "@notnotype/nb-agent-ui/vue";

   const props = defineProps<{locale: AgentLocale; send: (text: string) => void}>();

   // 视图只按整体替换读 ctx，用 shallowRef；宿主声明自己支持的操作，不声明时输入框是只读的。
   const ctx = shallowRef(createAgentContext({interaction: {canSend: true, canStop: true}}));
   const registry = createAgentViewRegistry([...builtinContributions]);   // 再加宿主自己的登记

   function handle(action: AgentViewAction) {
       const composer = applyComposerAction(ctx.value.composer, action);   // 草稿回声、模式、模型、思考档位
       if (composer !== null) {
           ctx.value = {...ctx.value, composer};
           return;
       }
       if (action.type === "composer.submit") {
           props.send(action.text);
           // 只在发送的就是输入框里的草稿时清空草稿、记进输入历史；宿主组件发出的发送不动输入框。
           ctx.value = {...ctx.value, composer: acceptSubmission(ctx.value.composer, action.text)};
       }
       // 其余 action（停止、附件、打开引用……）按宿主支持的处理，不认识的忽略。
   }

   // 运行中每秒更新 now，运行中的用时按它算；空闲时不用打节拍。
   watchEffect((onCleanup) => {
       if (ctx.value.run.status === "idle") return;
       const timer = setInterval(() => (ctx.value = {...ctx.value, now: Date.now()}), 1000);
       onCleanup(() => clearInterval(timer));
   });
   </script>

   <template>
       <AgentConversationView :ctx="ctx" :services="{}" :registry="registry" :locale="props.locale" @action="handle" />
   </template>
   ```

   同一段写法在 `src/vue/entry.dom.test.ts` 里编译并运行，改这里要一起改。

   - `services` 三项都可选：没有 `resolveAttachmentUrl` 时附件显示不可用占位，没有 `resolveTriggerMenu` 时只剩 `/` 命令，没有 `resolveMarkdownAsset` 时回复里的图片只显示说明。`resolveTriggerMenu` 是纯函数，数据到达时换一个新函数，编辑器据此重取菜单。
   - 草稿：编辑器每次改动发 `composer.draftChanged`，宿主只换文字不换版本（`applyComposerAction` 就是这样做的），编辑器认得这是自己的回声；宿主受理发送后给一个新版本的空草稿（`acceptSubmission`），视图据此清空，发送失败时文字不会丢。
   - `renderers` 是宿主的 Markdown 显示、提示词编辑器与已发送文字的显示，形状见核心的 `MarkdownDisplayPortProps`、`PromptEditorPortProps`、`PromptTextViewPortProps`。缺哪个用包内的缺省实现：Markdown 按纯文字显示，输入框是普通文本框，没有标签、附件与粘贴块。真实的组件在 `@notnotype/nb-markdown`（`MarkdownDisplay`、`PromptEditor`、`PromptTextView`），不是 neuro-book 的宿主也直接用它们，宿主接入见那个包的 README；它有一份类型断言对照本包的端口（`packages/nb-markdown/src/prompt/agent-ports.typecheck.ts`）。neuro-book 注入的是 `nbook.markdown` 包装过的同一批组件。`renderers.markdownPreview` 是折叠时那一行的写法（思考、信息条目收起时露出的第一行，去掉 Markdown 标记），形状见 `MarkdownPreviewPort`；缺省的 `markdownPreviewLine` 只认常见写法，宿主有自己的标记语法时给它。
   - 领域工具（不是通用 harness 工具的那些）由宿主自己登记渲染器，例子见 Lab 的 `packages/neuro-book/src/plugins/lab/web/fixtures/nb-agent-ui/domain-tools.ts`。读参数用核心导出的 `argString`、`argArray` 等（容忍流式半截的参数，不抛错）；改文件的工具给 `effects` 与 `diff` 就有改动统计与 diff 详情。两个渲染器不能声明同一个工具名或前缀；要替换内置的某一项，先从内置登记里过滤掉它：`{...builtinToolsContribution, tools: builtinToolsContribution.tools!.filter((tool) => tool.id !== "read")}`。宿主的工具与内置的同名而不需要内置的那些时，不登记 `builtinToolsContribution`。
   - 工具组的短语：`explore` 类渲染器的 `groupPhrase(calls)` 收到组里由它处理的那几次调用，含出错与运行中的（运行中的参数可能是半截）；只想说成功读到的，自己按 `call.status` 过滤。短语按调用写，思维链摘要里的“读了 N 个文件”按不同路径计数，两处口径不同。
   - 结果工具（`outcome: true`）被退回（出错或参数无效）的那几次画成过程里的一行，不画宿主的节点组件；行内文字是渲染器 `summary(call)` 的返回值，出错时也会调用它，在这里写出原因（例如“退回：”加 `call.error` 的第一行）。
   - **附注与条目渲染器**：要跟在某条助手回复后面的信息（例如没核实的出处），宿主写进那条消息的 `annotations`（`{customType, text, details?}`），不另造系统消息；附注不占消息流的位置，不参与分轮、用时与计数。在注册表的 `entries` 里按 `customType` 登记组件（收 `EntryComponentProps`），没有登记或组件出错时显示 `text`。两个条目渲染器不能声明同一个 `customType`。给消息加附注时换成新的消息对象，并按依据缓存（例如按消息 id 加出处列表），打节拍时给同一个对象：视图按消息对象是否相同决定一轮要不要重算。例子见上面那份 `domain-tools.ts` 的 `entries`。

4. **数据**：视图不持有会话数据。消息、运行状态、草稿、附件状态都经 `ctx` 给出，宿主受理用户操作后给出新的 `ctx`（例如发送后给一个新版本的空草稿）。

5. **会话列表**：`AgentSessionList` 不在 `AgentConversationView` 里，宿主把它摆在左栏或下拉里。界面文字与视图一样取（见下一节）；条目、选中与加载状态全由宿主给，用户操作以 `action` 交回（`session.select`、`session.create`、出错时重试发 `sessions.refresh`），可以和视图的 action 交给同一个处理函数。
   - 宿主自己有标题与新建入口时传 `header: false`；`labels` 覆盖包内文字（例如整页叫“对话”）。
   - 列表不持有下拉的开关：宿主收到 `session.select`、`session.create` 后自己关下拉，`sessions.refresh` 不关。
   - 时间按 `now` 与本地日历日写成“14:32”“昨天”“10月18日”。宿主要定期更新 `now`（例如每分钟），否则过了午夜，“今天”的行不会变成“昨天”。

## 界面文字

本包的界面文字在自带的消息目录里（`@notnotype/nb-agent-ui/locales`），组件经 nb-ui 的翻译端口（`@notnotype/nb-ui/text-port`）取。核心拿不到语言，消息、注册表、过程摘要里的文字是引用（`TextRef`）或宿主给的中英两份（`LocaleMap`），显示时才翻译（[`ui/i18n`](../../docs/specs/ui/i18n.md)）。

**宿主注入了翻译端口时**（例如 neuro-book）：宿主要登记本包的目录，组件的语言以端口为准，`AgentConversationView`、`AgentSessionList`、`AgentModelCatalog` 的 `locale` 属性不起作用。

```ts
import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE, NB_AGENT_UI_SOURCE_LOCALE} from "@notnotype/nb-agent-ui/locales";

engine.register(NB_AGENT_UI_NAMESPACE, NB_AGENT_UI_CATALOGS, NB_AGENT_UI_SOURCE_LOCALE);
```

忘了登记时界面上是键名（或宿主的严格模式下报缺键），不会悄悄换成中文。

### 没有宿主时

宿主不注入翻译端口时什么都不用做：

- 三个根组件按自己的 `locale` 属性（缺省 zh-CN）建 nb-ui 的缺省端口（所有已导入共享包登记的目录、nb-ui 的最小实现），并提供给子组件，嵌套的 nb-ui 控件与嵌进来的别的共享包（例如 nb-markdown 的展示器）也用它；`locale` 变了文字跟着变，不用重新挂载。
- 内部零件脱离根组件单独挂载、上面也没有端口时，用缺省端口，语言 zh-CN。单独挂零件又要别的语言，就在外面调用 `provideAgentView({locale})`（`./lab` 入口）或自己注入端口。

缺省端口用的最小实现（nb-ui 的 `createMinimalTranslator`）只认 `{{name}}` 插值与 `_one`、`_other` 这类复数后缀，本包的目录只用到这些。

## 跑 harness 的宿主

`createHarnessTranscript()` 把 nb-harness 的会话日志条目与流式事件合成 `ctx.messages`（实现与两条来源的分工见 `src/harness.ts` 的模块头）：

```ts
const transcript = createHarnessTranscript();
for (const entry of await log.read()) transcript.applyLogEntry(entry);   // 打开会话：先读已有日志
// 运行中：按到达顺序
transcript.applyEvent(agentEvent);      // harness.subscribe 的事件，或 SSE 帧里的 JSON
transcript.applyLogEntry(newEntry);     // 新写进日志的条目
ctx.messages = transcript.messages();
```

- **日志是权威**：运行错误（`run_end`）与费用（`usage`，单价未知为 null）只从日志来。只推事件、不推日志的宿主看不到运行错误与费用。
- **断线重连**：宿主按 `seq` 游标补发日志；适配器忽略重复与更旧的 `seq`。
- **消息对到日志**：`logSeqOf(message)` 给出日志合成的消息来自哪一条日志（正在生成的临时消息为 null），宿主按它切分轮次等，不自己解析消息 id。
- **图片**：harness 只给 base64，适配器把它写成 `data:` 定位符，`services.resolveAttachmentUrl` 原样返回即可。
- **写坏的输入**：跳过并记进 `problems()`，不抛异常。宿主可以把它们写进自己的诊断。
- **投递方式**：harness 没有 steer 与 followup，宿主把 `interaction.canSteer`、`canQueue` 都给 false，运行中能写不能发。
- **运行状态**：以宿主服务端的运行状态为准。`transcript.run()` 只按事件推出（`agent_start` 后运行中，`agent_end` 或日志的 `run_end` 后空闲），页面刷新、断线重连后只补日志时得不到“运行中”，只作没有服务端状态时的退路。
