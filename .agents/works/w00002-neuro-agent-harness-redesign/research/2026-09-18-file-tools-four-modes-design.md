# `/file-tools` 支持四种编辑模式的设计（2026-09-18）

> 决策输入（开发者 2026-09-18）：① 共享 domain 采用「信封＋游标＋seam」；② `./file-tools` 走方案 A —— **早期依赖 `@earendil-works/pi-coding-agent`**，后续若有扩展需求再去掉该依赖；③ SSE 自研已定，本轮重点是文件编辑。
> 目标（结果导向）：**语义上支持 OMP 的四种编辑模式** —— `replace` / `patch` / `apply_patch` / `hashline`，并说清 `/file-tools` 需要哪些工具、要提供哪些东西。

## 1. 四模式协议要点（证据：OMP 源码/prompt 原文）

| 模式 | 输入形态 | 定位机制 | OMP 证据 |
| --- | --- | --- | --- |
| `replace` | `{path, old_string, new_string, replace_all?}` | 精确字符串（唯一性由调用方保证） | `edit/schemas.ts` 的 `replaceEditSchema` |
| `patch` | `{path, edits: Entry[]}`；`Entry = {op:"update"\|"create"\|"delete", diff?, rename?}` | **锚定 hunk**：`@@`（裸头，靠上下文唯一）或 `@@ $ANCHOR`（逐字拷贝的函数签名/类声明/唯一字面量）；body 行 ` `\|`+`\|`-` | `crates/pi-edit/prompts/patch.md`（全文已读） |
| `apply_patch` | `{input: string}`，Codex 段格式 | `*** Begin/End Patch` + `*** Add/Update/Delete File:` + 可选 `*** Move to:` + `@@` hunk（默认 3 行上下文）+ `*** End of File` | `crates/pi-edit/prompts/apply_patch.md`（语法 EBNF 已读）；与本产品 `apply-patch.ts` 同格式 |
| `hashline` | `{input: string}`：`[PATH#TAG]` 段 + 操作行 | **行锚 + 内容快照 tag**：`PUT N.=M:` / `PUT N*:`（块）/ `PUT <N` / `PUT >N` / `PUT >$` / `CUT` / `REM` / `MV`；命名寄存器 `@name` | `omp://tools/edit.md`（全文已读） |

四模式均为「一个 `edit` 工具 + 按模式切换 schema/parser」，`apply_patch` 不是独立工具（OMP 用 `EditTool.customWireName` 暴露）；模式选择优先级：模型专属变体 → 环境变量 → `edit.mode` 设置 → 默认。

## 2. 能力需求矩阵

| 能力 | replace | patch | apply_patch | hashline |
| --- | --- | --- | --- | --- |
| 解析器 | 无（结构直用） | hunk + 锚串解析 | Codex 段/hunk 解析（含 Move/EOF 标记） | 段头 + 操作行 + 寄存器语法 |
| 定位 | 文本匹配（要求唯一） | 锚串/上下文匹配（要求唯一，多匹配报错） | 上下文匹配（3 行窗口） | **行号 + tag 校验** |
| 内容快照/陈旧检测 | 可选 | 可选（"No match found"≈陈旧） | 可选 | **必需**（tag + seen 范围 + 恢复） |
| 多文件/多文件段 | 单文件多 edit | 单文件（`rename` 可改名） | 多文件段 + Move/Add/Delete | 多段 + `MV`/`REM` |
| 批量原子性 | 预检后一次写 | 预检后一次写 | **all-or-nothing + 逆序回滚** | 同 patch；多段按段序 |
| 前置读要求 | 弱 | 强（要求先读、逐字拷贝锚） | 强 | **强**（tag 必须来自 read/grep/edit 结果） |
| 摘要/预览 | diff | diff | diff | diff + 块解析/警告 |
| 依赖语法解析 | 无 | 无 | 无 | 块锚 `N*` 需要（可降级为显式行号） |

## 3. `/file-tools` 要提供的工具（AgentTool 级）

| 工具 | 职责 | 四模式相关性 | 来源 |
| --- | --- | --- | --- |
| `read` | 读取；**在 hashline 模式下**产出 `[path#TAG]` 头 + `N:content` 行前缀，并把 shown 行范围写入快照存储 | 全部模式的前置（patch/apply_patch/hashline 的 prompt 都要求"先读"） | 包装 pi `createReadToolDefinition`（pi 的输出是**纯文本、无行号无 tag**，证据见 §5） |
| `write` | 整文件创建/覆盖；hashline 下写后返回新 tag | `create` 语义的载体 | 包装 pi `createWriteToolDefinition` |
| `edit` | **唯一编辑入口**，按 `mode` 切换 schema 与 parser：`replace` / `patch` / `apply_patch` / `hashline` | 四模式载体 | `replace` 委托 pi `createEditToolDefinition`；其余自研（见 §4.3） |
| `grep`（建议同时提供） | 搜索；OMP 中 grep 结果同样可以铸造 tag | hashline 便利性 | 包装 pi `createGrepToolDefinition`（tag 铸造为可选增强） |
| `glob` / `ls`（可选） | 文件枚举 | 与编辑无关 | pi 直用 |

**要点**：四模式 ≠ 四个工具。对外仍是 `read` / `write` / `edit` 三个工具（+ 可选检索工具），四模式全部由 `edit` 的 schema 与内部 parser 承载。

## 4. `/file-tools` 要提供的"东西"（非工具的成员）

### 4.1 编辑内核（流水线）

- `EditSession`：打开一个或多个文件 → 依序执行操作 → 暂存结果 → 一次性提交；失败逆序回滚（产品 `applyCodexPatch` 已有该模式，可直接迁移）。
- 单文件内多操作共享「首次读取的原始内容」语义（与产品 `edit` 的 preflight 一致：所有 `oldText` 都相对原文匹配，不允许增量）。

### 4.2 基础设施

| 成员 | 作用 | 来源 |
| --- | --- | --- |
| `snapshot-store` | path → 最近若干版本 {tag（规范化内容哈希，4 hex）、shown 行范围、全文}；供 read/grep 铸造、edit 校验与陈旧恢复；容量上限（OMP：256 路径 × 4 版本，文件 > 4 MiB 不快照） | **自研**（~150 行 + 测试） |
| `operations` | 文件/写回接缝：`ReadOperations{readFile,access,detectImageMimeType?}`、`WriteOperations{writeFile,mkdir}`、`EditOperations{readFile,writeFile,access}`，**结构化对齐 pi**，另加我们的 `EditWriter`（stage→commit） | 类型对齐 pi；默认本地实现由宿主注入 |
| `mutation-queue` | 同一路径串行化（防止 read-modify-write 竞争） | pi `withFileMutationQueue` |
| `path-policy` | cwd/边界/只读/授权回调 | 宿主注入（产品里是 `authorizeFileOperation`） |
| `diff` | `generateUnifiedPatch` / `generateDiffString` / `firstChangedLine` | pi 提供（产品 `file-tool-utils.ts` 已有简化版） |
| `mode` | `resolveEditMode()`（模型变体 → 环境变量 → 设置 → 默认）+ 每模式 prompt 资产 | 自研 + 参照 OMP prompt（MIT，可改编并注明来源） |
| 附加 seam（产品化） | 授权审批、写历史记账、附件（图片）、输出/大结果（artifact）、诊断 | 宿主注入，kit 只定义接口 |

### 4.3 四个模式的实现

| 模式 | 实现 | 工作量估计 |
| --- | --- | --- |
| `replace` | 委托 pi `createEditToolDefinition`（oldText/newText + 唯一性 + 重叠检查）；若将来去依赖，自研成本低（产品 `file-tools.ts` 已有等价实现） | 0（复用） |
| `patch` | 自研：`@@ [ANCHOR]` hunk 解析、锚/上下文唯一性定位、`op: create/update/delete`、`rename`；错误分类（Found multiple matches / No match found / 语法错） | ~250 行 + 测试 |
| `apply_patch` | 迁移产品 `apply-patch.ts`（511 行）：`parseCodexPatch` / `extractPatchTargetPaths` / all-or-nothing 应用 / 逆序回滚 / `*** Move to:` 授权算作目标 | 迁移 + 补测试（产品现有 2.2 KB 测试偏薄） |
| `hashline` | 自研：段头 + `PUT/CUT/REM/MV` 解析、tag 校验、shown 范围外拒绝、陈旧恢复、寄存器；**块锚 `N*` 需语法解析（第一版可不做）** | ~400–600 行 + 快照存储 + 测试 |

## 5. 已核实的复用面与缺口（pi 0.80.6）

**pi `read` 实测形态**（`dist/core/tools/read.js` 全文已读）：输出**纯文本**——`offset/limit` 选行 → `truncateHead` → 末尾追加 `[Showing lines X-Y of N. Use offset=…]` 提示；**无行号前缀、无 tag、不记录 shown 范围**。→ hashline 所需的锚定显示**必须由我们包装或自实现**（不能靠配置打开）。

**pi 提供**：`create{Read,Write,Edit,Bash,Grep,Ls,Find}ToolDefinition` + `createCodingTools`；`*Operations` 注入接缝；`withFileMutationQueue`；`generateUnifiedPatch` / `generateDiffString`；`truncate*` / `formatSize` / `DEFAULT_MAX_*`；`AgentTool` 类型（`pi-agent-core`）。
**pi 不提供**：`patch`（锚定 hunk）、`apply_patch`（Codex 段）、`hashline`（tag/快照/恢复）、锚定 read 显示、快照存储。

**依赖事实**：`@earendil-works/pi-coding-agent@0.80.6`（与仓库现有 pi-agent-core/pi-ai 0.80.6 同版）unpacked ≈12.5 MB，依赖 pi-tui/pi-ai/pi-agent-core/typebox/diff/highlight.js/photon(wasm) 等；`edit.d.ts` 直接 import pi-tui 类型 → 会带入 TUI 包。**去依赖路径**：kit 自己的工具接缝与 pi 的 `*Operations` 结构一致，届时把三处 pi 调用（read/write/replace-edit 定义）替换为自研实现即可，消费者无感。

## 6. 实施顺序（建议）

1. 建 `./file-tools` 骨架：`operations`（接缝类型 + 本地默认实现）、`diff`（用 pi）、`mutation-queue`（用 pi）、`snapshot-store`。
2. `read` / `write` 包装（含 tag 铸造与 shown 范围记录）→ 让 `replace` 模式先跑通（pi edit + 我们的 details/prompt）。
3. `patch` 模式（锚定 hunk）→ TDD：fixture 覆盖唯一/多匹配/无匹配/rename/create/delete。
4. `apply_patch` 模式（迁移产品实现）→ 补齐多 hunk、Move、EOF 标记、回滚的测试。
5. `hashline` 模式（先支持显式行号操作 `PUT N.=M:` / `PUT <N` / `PUT >N` / `PUT >$` / `CUT` / `REM` / `MV` + tag 校验/恢复；块锚与寄存器列为第二阶段）。
6. `edit` 工具多模式装配 + `resolveEditMode` + 各模式 prompt 资产；smoke（每包一条）+ 真实 LLM 冒烟（可选：用 DeepSeek 在临时目录跑一次 `patch` 往返）。

## 7. 开放问题（需要开发者决策）

1. **四模式是否本轮全做**？`replace` + `apply_patch` 可在一两个切片内完成；`patch`（中等）与 `hashline`（重，需快照存储与恢复）明显更大。
2. **wire 格式**：`replace` 沿用 pi 的 `{path, edits:[{oldText,newText}]}`（产品同款），还是改成 OMP 的 `{path, old_string, new_string, replace_all?}`？（后者能直接复用 OMP 的模型先验与 prompt；前者与现有产品 prompt/测试一致。）
3. **hashline 范围**：第一版是否包含块锚 `N*`（需语法解析，如 tree-sitter）与命名寄存器（`CUT @name` / `PUT @name`）？
4. **是否保留 OMP 第 5 模式 `sloppy`**（宽松容错解析，6089 B prompt）——建议不保留。
5. **tag 算法**：4 hex 由「规范化内容」派生（OMP 做法：行尾/Unicode 规范化后哈希），且需在 read/grep/write/edit 全链一致；是否需要与 OMP 完全兼容（跨工具互通）还是自行定义。
6. **grep 是否也铸造 tag**（OMP 是；影响检索工具的包装量）。

## 8. 风险

- **hashline 的陈旧恢复**是四种模式里唯一的"算法级"难点（OMP 用 Rust + 独立快照链证明唯一安全结果）；第一版可先做「tag 不匹配即拒绝 + 提示重读」，恢复算法后置。
- 包装 pi `read` 的输出会有版本漂移风险（pi 改提示文案）；建议包装层只依赖 `details`/结构化字段，不解析提示文本。
- 依赖体积：pi-coding-agent 会引入 TUI/wasm 等传递依赖（私有包，仅开发期安装）；若 CI 对依赖体积敏感需评估。
