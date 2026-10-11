---
schema: nbook.task/v2
taskId: t18-harness-resources-artifacts
---

# nb-harness 第二轮优化（二）：资源寻址与工具结果溢出

## 目标

t16 推迟的“通用工具结果预算”，按开发者 2026-10-11 的决定照 OMP 的做法做（全文存 artifact、上下文留头尾、模型按 `artifact://N` 回读），并先补齐资源寻址：内置工具的路径改为 [`workspace.resources`](../../../../../docs/specs/workspace/resources.md) 的 `方案://路径`。

| 提交 | 内容 | Spec |
|---|---|---|
| 1 | OMP `@oh-my-pi/*` 18.2.5 → 18.4.6：编辑引擎多了 `resolveUrl` 回调，带方案的头由宿主解析；`EditPolicy` 字段相应调整 | 无行为变化 |
| 2 | 资源寻址：`ResourceAccess`（按方案取提供者，提供者可按会话构造）、目录型与虚拟型提供者、地址解析；`read` 的 `path` 与 `edit` 的头一律是完整地址；这轮方案 `project://`、`local://`、`tmp://`、`docs://`（根都由使用方给） | [`harness.builtin-tools`](../../../../../docs/specs/harness/builtin-tools.md) 术语、输入、输出 1–9；`workspace.resources` 首批方案表 |
| 3 | artifact 存储（`session` 模块，内存与 JSONL 实现）、适配层溢出（文本超 50 KiB 存 artifact，留头 20 KiB 尾 20 KiB、各 500 行，加回读提示）、`artifact://` 只读虚拟提供者、运行时接线 | [`harness.session`](../../../../../docs/specs/harness/session.md)、[`harness.tools`](../../../../../docs/specs/harness/tools.md) 输出 9、[`harness.runtime`](../../../../../docs/specs/harness/runtime.md) 输入与输出 3、builtin-tools 输出 9 |
| 4 | omp 审查处理（14 条） | builtin-tools 输出 1、2、6、9、失败表；tools 输出 9；session 输出 24；runtime 输入 |

非目标：`projects://`、`user://`、`chapter://`；bash、glob、grep；写入来源与变更事件（插件阶段的 `nbook.files`）。

## 当前状态（2026-10-11）

- 计划见 [`plan.md`](plan.md)。
- 提交 1 `7411128f`（OMP 升级；凭据层改用 `credentials`/`oauth` 子接口，差异记在 [`docs/omp-capabilities.md`](../../../../../packages/nb-harness/docs/omp-capabilities.md) 第 8 节）、提交 2 `a9bb0fc1`（资源寻址；用实际引擎验证了跨方案 edit 与回显里的地址）、提交 3 `649feb61`（artifact 存储、适配层溢出、`artifact://` 提供者、示例场景 6 与 live 回读场景）。
- **实现审查（omp，范围 `dcd71750..649feb61`，90 分钟内自行收尾）**：14 条（重要 10、建议 4），证据 [`evidences/impl-review.txt`](evidences/impl-review.txt)。全部成立并已改（提交 4，与 t17 的审查处理同一个提交）：
  1. 预检与引擎读盘之间的符号链接替换窗口（重要，安全）——`locate` 改为给出真实路径，`edit` 经 `resolveUrl` 交给引擎的、`read` 登记快照用的都是它：核对之后链接被换到根外，引擎读的仍是核对过的文件；目录一级被换成链接的窗口关不掉（引擎读盘在 Rust 侧），记入待确认清单；
  2. 根互相嵌套时内层文件路由给外层提供者（重要）——`ownerOf` 先认头里打开过的路径，别的路径按真实根最长的提供者算；用内层提供者记录写入的测试锁定；
  3. `createSessionDirectories` 的清洗允许 `..` 越出根、不同 id 碰撞（重要，安全）——改为无碰撞编码（保留 `[A-Za-z0-9-]`，其余 `_<码点十六进制>_`）；
  4. JSONL artifact 序号不是跨实例安全的（重要）——布局改为 `<序号>/<工具名>.log`，序号靠独占创建目录认领，撞上重扫跳过；两个实例并发保存的测试；
  5. 负数预算未校验（重要）——`assertToolResultBudget`：四个字段非负整数，`createRuntime` 装配时与 `spillToolResult` 入口各查一次；
  6. 极小预算截掉错误结果的 `<code>: ` 前缀（重要）——错误结果只对 `message` 算预算，前缀原样加回；
  7. `cutBytes` 逐码点重新编码的平方级耗时（重要，安全）——改成按码点一次走完累加 UTF-8 长度，一百万个汉字毫秒级；
  8. `read` 用非 fatal 解码接受无效 UTF-8 并登记快照（重要）——`fatal: true`，解码失败为 `binary`；
  9. 内存 ArtifactStore 不校验会话 id（建议）——与 JSONL 同样返回 `invalid-session-id`，共用同一组合同断言；
  10. JSONL `list` 读全文只为取字节数（建议）——改用 `stat`；
  11. `artifact://` 的 `stat` 与 `readText` 各读一遍全文（重要）——`stat` 取读取接口 `list` 的大小，全文只在读文本时读一次；按范围读取未做（存储接口没有范围读，`read` 的分页在内存里做；需要时再加）；
  12. `createResourceAccess.open` 读到对象继承属性（重要）——登记表改为 `Map`，`constructor` 这类名字为 `undefined`；
  13. 审批后信号上的监听器不摘（建议）——`abortedOn` 带 `release`，赛跑结束即摘；用 `getEventListeners` 断言为 0；
  14. 缺省预算的测试以导出常量当期望值（建议）——按字面数字核对缺省值、50 KiB 边界、500 行与 20 KiB 的头尾边界。
- 与 t17 审查处理一起的验证：`bun test` 210 pass、6 skip（1625 断言）；`typecheck`；`docs:check`、`governance:check` 无失败；真实模型 `bun run test:llm` 6 pass（模型按提示回读 artifact 第 2000 行的那条，第一次因测试里的旧文件路径失败，改路径后 live 文件 3 条重跑通过）。
- 计划里的“命令行手测一次溢出与回读”没有做：场景 6 与 live 场景已覆盖同一路径。

## 依据

- 开发者 2026-10-11 在计划里确认：照 OMP 的溢出做法；先补协议；方案集 `project`、`local`、`tmp`、`docs`、`artifact`；地址一律带方案；升级到 18.4.6。
- Spec 已 `implemented`，原地改条目。

## 下一步

无（本轮完成）。候选：`ArtifactStore` 的范围读取；`local://` 按 `workspace.resources` 接到状态根（插件阶段）。
