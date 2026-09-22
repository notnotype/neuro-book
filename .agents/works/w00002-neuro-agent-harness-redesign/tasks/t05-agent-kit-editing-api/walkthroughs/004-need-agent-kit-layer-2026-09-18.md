# t05 追加范围：是否需要 agent-kit 这一层（OMP 覆盖度取证）

日期：2026-09-18。起因：开发者提问「调研一下，看看是否不需要 agent-kit 这一层了，直接用 omp 来实现 NeuroAgentHarness」。前提变化：开发者已决定「agent-kit 可转向 OMP、目标 Bun、初步阶段允许依赖 OMP 库」。

取证方式：两个只读 scout（`OmpPackages`、`HarnessNeeds`）＋本代理直接核对 hashline / pi-agent-core / pi-utils 源码与实测。全部数字为 2026-09-18 实测。

## 一、OMP 包族（8 包实测，全部 MIT、Bun-only、裸 TS 入口）

| 包 | 形态 | exports | 文件/体积 | 关键能力 |
| --- | --- | --- | --- | --- |
| `pi-agent-core@18.2.5` | 库 | 4 | 81 / 2.12 MB | `Agent` 类、`agentLoop*`、`AgentTool`、`AgentState`、compaction、OTel 遥测、`StreamFn`=pi-ai 的 `streamSimple` |
| `hashline@18.1.5` | 库 | 5 | 47 / 1.47 MB | 完整 hashline 语言 + `Patcher`（preflight/prepare/commit）+ 可插拔 `Filesystem` + `SnapshotStore`（tag 守卫、seenLines）+ tree-sitter 块解析 |
| `pi-coding-agent@18.2.5` | CLI + 库 | ≈116 | 2676 / 47.27 MB | `./tools`（ReadTool/EditTool/WriteTool/BashTool、createTools）、`./session/*` 多后端会话持久化、SDK；`ToolSession` 60+ 字段宿主上下文 |
| `pi-mnemopi@18.2.5` | 库+CLI | 9 | 137 / 1.90 MB | SQLite 记忆（remember/recall/beam/scratchpad），embeddings 走 optional peer |
| `omp-stats@18.2.5` | CLI+库 | 6 | 150 / 2.62 MB | 会话统计/dashboard（硬依赖 react/tailwind/chart.js） |
| `pi-wire@18.2.5` | 纯类型 | 3 | 9 / 1.13 MB（96% 是 NOTICES） | collab 协议类型、`AgentEvent` 19 变体；**零运行时依赖** |
| `snapcompact@18.2.5` | 库 | 3 | 11 / 1.23 MB | 位图帧上下文压缩（原生 PNG 渲染） |
| `pi-tui@18.2.5` | 库 | 11 | 830 / 7.42 MB | 终端 UI；连带 8 个族内包 |
| `pi-natives@18.2.5` | 原生 | — | 6 平台包 | N-API Rust：`countTokens`、tree-sitter、PTY、grep、PDF、音频等；除 pi-wire 外所有包的依赖 |

共同约束：`main` 指向 `./src/index.ts`（无编译产物）、`engines.bun>=1.3.14`、pi-natives 原生依赖、族内高度闭合（无第三方适配层）、hashline 与族内版本错位（18.1.5 vs 18.2.5）。

## 二、与 agent-kit 已交付能力的重叠

| agent-kit | OMP 对应物 | 重叠 | 语义差异（实测） |
| --- | --- | --- | --- |
| `./editing` 的 hashline | `@oh-my-pi/hashline` | **近乎完全重叠** | 它用 tree-sitter 块解析（省略 resolver 时 `PUT N*` 抛错）、内建 fuzzy 边界修复与 tag 路径恢复（`allowTagPathRecovery`）；我们的合同是严格语义（无 fuzzy、不恢复旧锚、TS 自研 resolver、`ambiguous_match`/`unseen_range` 错误族） |
| `./editing` 的 `patch`/`apply_patch` | 无库侧对应（Rust `crates/pi-edit` 内部） | 无 | 产品侧已有 511 行实现 |
| `./resources`（CAS/revision） | hashline `Filesystem` + `SnapshotStore` | **部分重叠** | 其 FS 只有 read/write/delete/move/exists/canonicalPath，**无 CAS**；版本守卫是 store 内 4-hex tag（README 明确只在该 store 内有意义） |
| `./text` 截断 | 无独立包（pi 系 agent-core/pi-utils 有同源 `truncate*`） | 高（历史已判为副本） | 我们这份本就是 pi `truncate.ts` 的精简副本（旧研究 §4 证据） |
| token 计数 | `pi-natives.countTokens(input, encoding?)` | **完全重叠** | 实测 10 种 encoding，与 pi-catalog 的 `ModelTokenizer` 标签一一对应 |
| `./models`（计划中） | `pi-catalog` | 完全重叠 | — |
| `./sse` | 无（pi-wire 只有类型；pi-ai 有 SSE 解析与 auth-gateway HTTP server） | 无 | — |
| 我们刻意不做的 AgentTool/工具 schema | `pi-agent-core`/`pi-coding-agent` 已提供 | — | 若直接用 OMP，这层是白送的 |

## 三、上游缺口（OMP 没有的）

1. 无编译产物 + Bun-only + pi-natives 原生依赖（依赖闭包重：pi-coding-agent 47 MB 级）。
2. 族内闭合，没有为第三方接入设计的适配层；`ToolSession` 60+ 字段，脱离 CLI 宿主能否实例化未实测。
3. hashline 不随包发布测试（47 文件无 test/），其 tag 算法实现未读、契约稳定性未验证。
4. 没有「把事件流写进 Node ServerResponse」的 SSE writer（web 产品面）。
5. 领域层（NeuroBook 的 profile/审批/事件/会话/领域工具）当然也没有。

## 四、本仓库现状（另一份 scout 实测）

- `packages/neuro-agent-harness` 已存在：private 0.1.0、**零运行时依赖**、`engines node>=22.19.0`、llmlint 是唯一消费者；自带 harness/session/events/capability/approval/compaction/profile/read-tool/sse/tool/workflow 模块（`harness.ts` ≥3086 行）。
- 产品侧另有 387 KB 自研 harness，已直接 import `@earendil-works/pi-agent-core` 的 `AgentEvent` 等 7 处。
- 全仓**零 `@oh-my-pi/*` 依赖**。
- 旧研究 `2026-09-18-upstream-reuse-and-event-domain.md` 已产出：truncate 是副本、`@earendil-works/pi-coding-agent` 的工具带 `*Operations` 注入接缝、OMP 编辑引擎是 Rust+N-API「不可直接复用」，并留下未决问题「kit 是否允许依赖上游」。**当时的两个阻塞（Node 兼容、不得依赖上游）现已被开发者解除。**

## 四之二、`crates/pi-edit` 与 N-API 编辑绑定（实测）

`crates/pi-edit/src`：`engine.rs` 7.5 KB（`ModeEngine`）、`modes/`（`replace.rs` 7.1 KB、`patch.rs` 51.3 KB、`apply_patch.rs` 14.9 KB、`hashline/`、`sloppy/`）、`fuzzy.rs` 46.9 KB、`diff_string.rs` 44.4 KB、`notebook.rs` 19.8 KB（Jupyter）、`path_policy.rs` 20.4 KB、`session.rs` 15.3 KB、`store.rs` 18.1 KB、`stream_json.rs` 18.9 KB、`text.rs` 12.9 KB。

- `lib.rs` 原文：本 crate 是「每个编辑模式的解析、匹配、内存应用、diff 生成，加上一个流式 `Session`（把工具调用参数增量变成渐进预览，并经宿主 `EditWriter` 原子应用）」；架构为 `ArgStream → ArgSnapshot → ModeEngine::preview | stage → StagedFile[] → EditWriter`；并注明「错误文本与它所替代的 TypeScript 实现逐字节一致——模型是按这些文本训练的」。
- `EditMode` 枚举实测五种：`Replace`、`Patch`、`ApplyPatch`、`Hashline`、`Sloppy`（wire 名同名）。
- N-API 暴露（`@oh-my-pi/pi-natives` 的 `native/index.d.ts`）：`class EditSession`（构造 `(store: EditStore, policy: EditPolicy, onPreview?)`；`apply(request, writer: (error, request: EditWriteRequest) => Promise<EditWriteResponse>)`——**写回是宿主回调**）、`class EditStore`、`interface EditPolicy`（含 `vaultRoots`）、辅助 `editInspect(mode, argsJson)`、`editGrammar(mode)`、`editDescription(mode)`、`editDiffString(old, new, path?)`；Rust 侧实现文件 `crates/pi-natives/src/edit.rs`（24 KB）。

结论：**四种模式（外加 sloppy）在 pi-edit 里全部已实现，且可从 Bun/TS 通过 pi-natives 的 `EditSession` 使用，宿主写回走回调**。

## 四之三、严格语义与 hashline 的具体冲突（实测）

| 维度 | agent-kit 合同 | `@oh-my-pi/hashline` 实测行为 |
| --- | --- | --- |
| 陈旧 tag | 一律 `stale_snapshot` 硬失败，要求重读 | `recovery.ts`：先尝试「证明每个锚行仍映射到当前文件中一段未变、连续的区域」，成功即在新内容上重放编辑；失败才 `MismatchError`。**Recovery 不可配置**（`patcher.ts` 中 `new Recovery(...)` 无条件构造），只有 `enforceSeenLines` 一个严格性开关 |
| 未展示行 | `unseen_range` 硬失败 | 默认 `enforceSeenLines: true`，但错误里会**揭示**最多 40 行（每行 ≤512 字符）并把揭示的前缀并入 `seenLines`，让模型能"半读也推进" |
| 匹配容错 | 精确 + 唯一；0 命中 `no_match`、多命中 `ambiguous_match` | 有边界修复与漂移告警（`syntax.ts` 用 tree-sitter 作语义过滤；`HEADTAIL_DRIFT_WARNING`、`writeDriftWarning`），另有 `fuzzy.rs` 47 KB（pi-edit 侧） |
| 块解析 | 内置默认 resolver，失败返回 `unsupported_language`/`block_not_found` | `blockResolver` 可选；省略时 `PUT N*:` 在 apply 阶段**抛错** |
| 写回并发 | 显式 CAS（`compareAndSet(expectedRevision, text)`）+ preflight 精确比对 + 四态结果与逆序补偿 | 只有 `Filesystem.writeText`；版本守卫 = `SnapshotStore` 内 4-hex tag（README 明确只在该 store 内有意义）；`fileHash` 对**实际落盘内容**取哈希 |
| 路径恢复 | 不恢复旧锚 | `Filesystem.allowTagPathRecovery` + `pathRecoveredFromTagMessage`：MV 后旧 tag 中的路径可被认回 |
| 错误形态 | `Result` 值 + 稳定 `code` | 异常（`MismatchError`）+ `warnings[]` 字符串数组 |

我们独有、上游没有：`patch`（unified diff）与 `apply_patch`（Codex）两种模式的**库层**实现（pi-edit 有 Rust 实现，但没有与 hashline 等价的独立 TS 库）、`replaceAll` 语义、显式 CAS 提交组件。

## 四之四、pi-edit 的发布形态与安装代价（scout + 本代理实测）

- `crates/pi-edit/Cargo.toml`：`version.workspace`（18.2.5）、**无 `[lib] crate-type`（默认 rlib）**、不依赖 napi —— 即 **pi-edit 不单独发布**，唯一二进制出口是 `crates/pi-natives`（`crate-type=["cdylib"]`，依赖 pi-edit + napi/napi-derive）→ 预编译为各平台 npm 包。
- 加载器实测（`@oh-my-pi/pi-natives/native/loader-state.js`）：平台包解析、**AVX2 modern/baseline 两个变体**、版本 sentinel、平台白名单。
- 各包 npm 实测（`registry.npmjs.org/<pkg>/latest` 的 `dist.unpackedSize`/`fileCount`，2026-09-18）：

| 包 | unpacked | 文件数 |
| --- | --- | --- |
| `pi-natives`（加载器） | 1.2 MB | 19 |
| **`pi-natives-win32-x64`** | **172.2 MB** | 5 |
| **`pi-natives-linux-x64`** | **346.5 MB** | 6 |
| `pi-natives-darwin-arm64` | 158.2 MB | 5 |
| `pi-utils` | 2.9 MB | 330 |
| `pi-agent-core` | 2.0 MB | 81 |
| `pi-catalog` | 13.9 MB | 361 |
| `hashline` | 1.4 MB | 47 |
| `pi-ai`（OMP） | 7.1 MB | 571 |
| `pi-wire` | 1.1 MB | 9 |

**关键推论**：`pi-catalog` → `pi-utils` → `pi-natives`，`pi-ai`(OMP) 也直接依赖 `pi-natives`。因此**只要引入 OMP 的模型层或目录层，就会在安装时带上平台原生包（win32-x64 172 MB / linux-x64 346 MB，CI 亦然）**；8 个包里只有 `pi-wire` 真正零依赖。

- 修正此前转述：`pi-coding-agent` 的 `ToolSession` 接口**约 110 个成员，必填仅 `cwd`/`hasUI`/`getSessionFile`/`getSessionSpawns`/`settings`**；`CreateAgentSessionOptions` 约 150 个可选字段。其「28 个内建工具 + 3 个隐藏工具 + SessionManager/多后端持久化 + 系统提示词/扩展/生态集成」在 `pi-agent-core + hashline + pi-ai + pi-catalog` 基线中**均不存在**；但 edit 工具本身可以只靠 `pi-natives` 以更薄的方式重建（自写 AgentTool 接线 + 审批 + 写回管线）。

## 五、待开发者决策

1. 路线：①删掉 agent-kit、harness 直接建在 OMP 上；②agent-kit 收缩为「OMP 门面 + 上游没有的严格语义件」；③维持现状。
2. 若 ①/②：agent-kit 已交付实现（`./editing` ~2500 行 + 143 测试 + 两份规范、`./resources`、`./text`、`./sse`）如何处置。
3. 严格语义（无 fuzzy、不恢复旧锚、显式 CAS）是否维持——这决定 hashline 的开关组合与产品行为。

## 六、未验证项

- `pi-natives` 的 `.node` 二进制分发方式；hashline 的 tag 算法实现；`pi-coding-agent` 工具脱离 CLI 宿主的可实例化性；`pi-agent-core` 是否有独立 attachment 公共 API；各包 LICENSE 原文（只读两份同哈希）；OMP 包在非 Bun 运行时的行为。
