---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: runtime.plugin-manifest
owners:
  - runtime
---

# 插件清单、入口与服务依赖

## 目标与非目标

内置插件与第三方插件使用同一份声明式清单。内核只读清单、不执行插件代码，就能完成登记、校验、依赖解析与受阻计算，并据依赖图决定启动激活与关闭的顺序。插件是安装与启停的单位，入口是运行与依赖的单位；依赖指向归某个插件所有的服务，而不是整个插件。

明确不承诺：

- 不定义外部插件从哪里发现、如何安装与升级（[`runtime.plugin-install`](plugin-install.md)）；不定义运行期启用、禁用与引用撤回（[`runtime.plugin-hot-plug`](plugin-hot-plug.md)）；不定义代码如何装载与回收（[`runtime.plugin-code-loading`](plugin-code-loading.md)）。
- 不定义单次激活的事务、贡献接收者五态与普通关闭，它们沿用 [`runtime.plugins`](plugins.md)；服务解析与初始化沿用 [`runtime.services`](services.md)。
- 不定义各贡献点的声明字段与校验规则，它们归定义贡献点的拥有者插件的能力 Spec。
- 不提供可选依赖，不提供同一服务的多个提供者（多个提供者用贡献点）。
- 清单中的运行位置是开放集合，但本能力只支持 `server` 与 `browser` 两种宿主；终端界面等其它位置的宿主不在本能力内。

## 术语与参与者

- **插件**：以 `publisher.name` 标识，是安装、启用、禁用、升级、卸载的单位。内置插件的 id 以 `nbook.` 开头，第三方插件的 id 不得以 `nbook.` 开头。
- **入口**：插件在一个运行位置上的运行单位，有插件内唯一的入口 id。与 `runtime.plugins` 中的入口是同一概念：各自激活、各自失败、各自有代次。
- **运行位置**：入口运行的宿主。`server` 是服务端运行实例，每个进程一个；`browser` 是浏览器运行实例，每个窗口一个。
- **服务**：以 `<插件 id>/<名称>` 标识的导出 API，由该插件恰好一个入口提供。
- **通道服务**：`<插件 id>/channel`，由该插件声明 `"channel": true` 的服务端入口提供，表示“本插件的插件通道可用”。它是唯一允许跨运行位置依赖的服务，并且只能被同一插件的浏览器入口依赖。
- **贡献点**：由拥有者插件在清单中定义、连同声明 schema 的扩展点，例如 `nbook.agent` 定义 `agent.tools`。
- **受阻**：入口因必需依赖不可用而不能激活的推导状态，不是用户设置。
- **插件汇总状态**：由其全部入口的状态汇总出的可用、部分可用、受阻。
- **有效插件集合**：服务端登记成功的全部插件（含其清单），浏览器以它为准。

## 输入与前置条件

清单载体是插件目录中的 `package.json`。与本能力有关的字段：

| 字段 | 含义与约束 |
|---|---|
| `name`、`publisher`、`version` | 组成插件 id `publisher.name`；`version` 为 semver |
| `engines.neurobook` | 兼容的 NeuroBook 版本范围，由 [`runtime.plugin-install`](plugin-install.md) 检查 |
| `entries` | 入口 id 到入口声明的映射；可以为空（只含声明式贡献的插件） |
| `entries.<id>.location` | 运行位置 |
| `entries.<id>.main` | 入口代码文件，相对插件目录，必须位于插件目录内 |
| `entries.<id>.channel` | 可选，`true` 表示本入口实现插件通道合同；只允许 `server` 入口，一个插件最多一个 |
| `entries.<id>.requires` | 必需依赖的服务 id 列表 |
| `entries.<id>.provides` | 本入口提供的服务 id 列表 |
| `entries.<id>.activationEvents` | 激活事件列表 |
| `entries.<id>.contributes` | 需要本入口提供实现的贡献，例如命令、视图、Agent 工具、路由 |
| `contributes` | 只有声明、不需要实现的贡献，例如菜单项、设置项、上下文键、菜单位置 |
| `contributionPoints` | 本插件拥有的贡献点：声明 schema，以及该贡献点的贡献是否需要实现（决定贡献写在入口下还是顶层） |
| `pluginVersions` | 所依赖第三方插件的版本范围；只约束版本，是否必需由各入口的 `requires` 决定 |

激活事件：`onStartup`、`onCommand:<命令 id>`、`onView:<视图 id>`、`onAgentTool:<工具名>`、`onChannel`（插件通道首次被调用，只能写在通道入口上）。与本入口贡献对应的激活事件可以由 SDK 构建预设生成；手写清单与生成的清单同等有效，合同以清单为准。

前置条件：

- 内置插件的清单在产品构建时收集成内置插件表；第三方插件的清单来自已安装且已启用的插件（[`runtime.plugin-install`](plugin-install.md)）。安全模式下不输入第三方清单。
- 登记只读取清单与清单引用文件是否存在，不执行任何插件代码。
- 每个贡献点拥有者的清单与其他清单同批登记，贡献校验不要求拥有者已激活。

## 输出与可观察行为

1. **登记与目录。** 登记完成后，可查询每个插件的清单摘要、每个入口的运行位置、依赖、提供项、贡献声明与当前状态及原因。查询不激活任何入口，不产生业务副作用。
2. **依赖只在同一运行位置解析。** 入口的每个依赖由同一运行位置上提供该服务的入口满足。浏览器入口依赖本插件的通道服务时，由服务端的通道入口满足；这是唯一的跨位置依赖。
3. **受阻按入口计算。** 入口在以下任一情况下受阻，并报告第一个原因与依赖路径：
   - `missing-service`：没有已登记的插件提供该服务（提供方未安装、已禁用，或其提供入口的运行位置本宿主不支持）；
   - `location-mismatch`：服务存在，但由其它运行位置提供，且不是本插件的通道服务；
   - `version-mismatch`：提供方插件的版本不满足本插件 `pluginVersions` 中的范围；
   - `provider-blocked`、`provider-failed`：提供该服务的入口受阻，或激活失败且未恢复；
   - `dependency-cycle`：入口处于依赖环中。
4. **同一插件的其它入口不受牵连。** 一个入口受阻或失败，不影响同一插件中不依赖它的入口。例如编辑器插件未启用时，文生图插件依赖 `nbook.editor/document` 的浏览器入口受阻，服务端入口照常可用，Agent 工具可以调用。
5. **跨位置依赖只是可用性约束。** 浏览器入口依赖本插件通道服务时：服务端的通道入口受阻或失败，该浏览器入口在所有窗口受阻；通道入口只是尚未激活时不算受阻。浏览器入口激活不会激活服务端的通道入口，首次调用或订阅时才按 `onChannel` 激活它。
6. **插件汇总状态。** 全部入口都没有受阻或失败为“可用”；部分入口受阻或失败为“部分可用”；全部入口受阻或失败为“受阻”。没有入口的插件在登记成功后为“可用”。插件管理界面列出每个受阻入口缺少的服务，以及各窗口中浏览器入口的失败（按窗口分开显示）。
7. **激活顺序只由依赖决定。** 启动时激活启动必需插件的入口与声明 `onStartup` 的入口，依赖先于依赖者；其余入口按激活事件懒激活；在同一运行位置内，解析尚未激活的服务会触发其提供入口激活。没有依赖关系的入口之间不保证先后，可能并发。
8. **关闭顺序严格为依赖逆序。** 依赖者先关闭，提供者后关闭。
9. **登记顺序没有语义。** 全部清单登记后再计算依赖图；诊断按插件 id 排序输出，同一输入得到同一结果。
10. **贡献校验按单条贡献进行。** 贡献点由拥有者在 `contributionPoints` 中定义，校验所需的 schema 与“是否需要实现”都来自拥有者，所以校验只在拥有者已登记时进行：
    - 拥有者已登记：按其 schema 校验；不合格的贡献（包括需要实现却写在顶层 `contributes`、不需要实现却写在入口下）只这一条被拒绝，原因可查询，插件的其它部分照常；
    - 拥有者未安装或已禁用：贡献处于“待校验”，不显示、不报错；拥有者登记后再校验，合格的生效，不合格的被拒绝。拥有者已登记但其接收贡献的入口受阻时，贡献照常校验，是否显示由拥有者决定；
    - 没有任何已登记插件定义该贡献点：贡献处于“待校验”，并在插件详情中标注“未知贡献点”，便于发现拼写错误。

    贡献只经贡献点协作，不构成依赖、不触发受阻。

## 状态与转换

入口的推导状态（与 `runtime.plugins` 的激活状态组合使用）：

| 当前 | 事件 | 下一状态 |
|---|---|---|
| 未登记 | 所属插件清单校验通过，依赖全部可满足 | 已登记（可激活） |
| 未登记 | 所属插件清单校验通过，某个依赖不可满足 | 受阻（带原因与路径） |
| 未登记 | 运行位置本宿主不支持 | 不支持的运行位置；永不激活，不计为失败 |
| 已登记 | 激活事件或服务解析触发 | 激活中，之后按 `runtime.plugins` 进入可用或失败 |
| 可用、已登记 | 所依赖的服务变为不可用 | 受阻；已激活的先按依赖逆序停止（停止流程见 `runtime.plugin-hot-plug`） |
| 受阻 | 所依赖的服务恢复可用 | 已登记；按激活事件重新激活，代次加一 |
| 失败 | 显式恢复成功 | 已登记或可用（`runtime.plugins` 恢复规则） |

- 状态是运行实例内的推导结果，不写入用户设置。用户状态（已启用、已禁用、未安装）归 [`runtime.plugin-install`](plugin-install.md)。
- 同一有效插件集合与同一组入口结果总是推导出同一组受阻结果；重复计算幂等。
- 有效插件集合变化与入口失败、恢复都会触发重新推导；推导结果变化时按依赖逆序停止、按依赖顺序激活。

## 副作用与数据

- 登记与推导不写任何持久数据，不创建运行资源，不执行插件代码。
- 目录与推导状态是每个运行实例的内存状态。浏览器实例从服务端取得有效插件集合（[`runtime.browser-host`](browser-host.md)），不自行扫描。
- 内置插件表随产品构建生成，不在运行期写入。

## 失败与恢复

- **清单无效时整个插件不登记。** 包括：缺少必需字段或类型错误；id 格式错误；第三方 id 以 `nbook.` 开头；`main` 不存在、是绝对路径或越出插件目录；入口 id 重复；`channel` 出现在非服务端入口或多于一个；`provides` 中的服务 id 不以本插件 id 为前缀、重复，或占用保留名 `channel`；`pluginVersions` 列出内置插件。原因可在插件管理中查询，其它插件不受影响。单条贡献不合格只拒绝该条（见上文第 10 条）。
- **两个插件声明同一服务 id** 不可能发生（服务 id 带插件前缀）；同一插件 id 出现多份清单时全部不登记，并报告每份的来源，与输入顺序无关。
- **启动必需按运行位置判定。** 启动必需内置插件的服务端入口受阻、失败或其清单无效时，服务端启动失败，由 [`runtime.server-host`](server-host.md) 有序退出；它的浏览器入口（例如 `nbook.workbench`）在某个窗口中失败时，只有该窗口显示启动失败页（[`runtime.browser-host`](browser-host.md)），不影响服务端与其它窗口。
- 本版本不认识的激活事件被忽略并记入诊断；不认识的运行位置按“不支持的运行位置”处理，依赖其提供服务的入口以 `missing-service` 受阻。
- 受阻不是错误，不重试、不告警升级；依赖恢复后自动解除。

## 边界与兼容

- **owner**：runtime。清单登记、依赖图与受阻推导是内核机制，不依赖任何产品领域实现；贡献点的领域语义归拥有者插件。
- **与 `runtime.plugins` 的分工**：本能力把清单映射为 `runtime.plugins` 的插件定义：入口的 `requires` 即必需的服务依赖，`provides` 即登记阶段声明的提供项；单次激活的事务、接收者五态与普通关闭不变。现有内置插件定义迁移到本清单格式；现有 Files 的两个插件身份合并为 `nbook.files` 的两个入口。
- **SDK**：作者在代码中声明入口，SDK 构建预设生成清单中的 `entries`，依赖只写一次。SDK 按运行位置提供类型：一个入口只能取得它 `requires` 中服务的类型。
- **版本**：依赖内置插件的服务不写版本，内置插件的公开 API 跟随 SDK，由 `engines.neurobook` 统一约束。
- **安全**：清单是完全信任模型下的声明，不构成权限；校验只保证结构与引用正确。
- **兼容**：清单格式属于公开接口。新增运行位置或激活事件不改变已有字段的含义；旧版本 NeuroBook 遇到新运行位置时按“不支持的运行位置”处理，插件的其它入口照常工作。

## 验收与 Smoke

1. **按入口依赖。** Given 文生图插件有服务端入口 `generator`（依赖 `nbook.models/image-generation`、`nbook.assets/writer`，`channel: true`）与浏览器入口 `editor-ui`（依赖 `nbook.editor/document` 与本插件通道服务）；When 两端都登记；Then 服务端不因缺少 `nbook.editor` 判定受阻，浏览器不因缺少 `nbook.models` 判定受阻，两个入口都为已登记，插件为可用。
2. **一端受阻。** Given 编辑器插件未启用；Then `editor-ui` 受阻，原因 `missing-service: nbook.editor/document`；`generator` 可用，Agent 工具可调用；插件汇总为部分可用。
3. **通道依赖。** Given `generator` 依赖的 `nbook.models` 未启用；Then `generator` 受阻，`editor-ui` 以 `provider-blocked` 受阻，插件汇总为受阻；启用 `nbook.models` 后两者都回到已登记。
4. **可选联动。** Given 插件 B 的 `main` 入口不依赖 TTS，`tts` 入口依赖 B 自己的文本服务与 `example.tts/speak`；When TTS 未安装；Then 只有 `tts` 入口受阻，B 汇总为部分可用，`main` 的能力正常。
5. **只有浏览器入口的插件** 无需任何服务端入口即可登记并激活。
6. **位置不匹配。** 浏览器入口依赖另一插件的服务端服务时，该入口以 `location-mismatch` 受阻，插件其它入口不受影响。
7. **依赖环。** 两个入口互相依赖时二者以 `dependency-cycle` 受阻，诊断给出环路径；其它入口不受影响。
8. **版本范围。** `pluginVersions` 不接受已安装的提供方版本时，依赖它的入口以 `version-mismatch` 受阻。
9. **清单无效。** 第三方 id 以 `nbook.` 开头、`channel` 写在浏览器入口、`pluginVersions` 列出内置插件，各自使整个插件不登记，原因可查询，其它插件照常。
10. **贡献待校验。** 向未启用的拥有者提交的贡献不显示、不报错；拥有者启用后，合格的贡献出现，不合格的一条被拒绝且原因可查，插件其它部分照常。向不存在的贡献点提交的贡献标注“未知贡献点”。
11. **顺序。** 启动时依赖先于依赖者激活；关闭时依赖者先于提供者关闭；打乱清单登记顺序，推导结果与诊断顺序不变。
12. **启动必需插件受阻** 时服务端启动失败并以启动失败退出码退出；`nbook.workbench` 的浏览器入口在一个窗口中失败时，只有该窗口显示启动失败页。
13. **未知运行位置。** 清单含 `location: "tui"` 的入口时，该入口标为不支持的运行位置，插件其它入口正常。
14. **重复 id。** 两份 `example.a` 清单同时出现时两者都不登记，调换输入顺序结果相同。
15. **通道入口不被提前激活。** `editor-ui` 因视图可见而激活后，服务端 `generator` 仍未激活；首次调用通道时才激活。

Smoke：以合同测试覆盖场景 1–15 的推导结果；在真实服务端与 Chromium 上用一个示例插件（两端入口，其中浏览器入口依赖一个可关闭的内置服务）核对场景 1、2、5 的可见结果。

## 证据

- 批准目标：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P1、P2、P3、P11（2026-09-30 `accepted`；“插件、入口、服务”三层同日由开发者确认）；[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 第 2 条。
- 调研依据：[VS Code 依赖调研](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/deps-vscode/REPORT.md)、[DeepSeek Harness 依赖调研](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/deps-dsh/REPORT.md)。
- Spec 编写：[w00017 t28](../../../.agents/works/w00017-application-runtime-architecture/tasks/t28-platform-planned-specs/README.md)。
- 实现进展：第 2、3（除 `version-mismatch`）、4、6、7、8、9 条已在内核对代码定义的插件实现，行为写入 [`runtime.plugins`](plugins.md) 输出第 11–14 条与 [`runtime.application`](application.md)，见 [w00017 t32](../../../.agents/works/w00017-application-runtime-architecture/tasks/t32-kernel-entry-dependencies/README.md)。第 10 条（按单条贡献校验）已对代码定义的插件实现，校验由贡献点的 `validate` 函数给出，行为写入 [`runtime.plugins`](plugins.md) 输出第 15–18 条，见 [w00017 t33](../../../.agents/works/w00017-application-runtime-architecture/tasks/t33-owner-contribution-points/README.md)。清单文件与声明 schema、插件通道（第 5 条）、版本范围与不支持的运行位置仍未实现，本 Spec 保持 `planned`。
