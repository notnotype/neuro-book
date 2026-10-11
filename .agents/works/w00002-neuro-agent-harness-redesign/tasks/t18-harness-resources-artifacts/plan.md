# t18 实施计划：资源寻址与工具结果溢出

## Context

- **为什么做**：工具结果没有统一预算，插件工具一个坏结果就能撑爆窗口；OMP 的做法（溢出到 artifact、留头尾、按 `artifact://N` 回读）经过实战。回读需要一个方案系统，而 `workspace.resources` 已经定了 `方案://路径` 并把 `local://`、`tmp://`、`docs://` 交给 nb-harness 实现，所以先把内置工具的路径改成资源地址。
- **调研结论**（2026-10-11，OMP 18.4.6 源码）：OMP 把每个方案做成带自述（`backing`、`selectors`、写策略、`artifactStore`）的 `ProtocolHandler`，工具只问路由器；溢出在工具包装器里做，阈值按字节（50 KB，头尾各 20 KB、500 行），存失败照样截；`artifact://` 是 `file` 型只读提供者，文件在会话目录旁 `artifacts/<序号>.<工具>.log`；编辑引擎 18.4.x 经 `resolveUrl` 回调把带方案的头交给宿主解析，18.2.5 只认 `local://`。

## 关键设计

1. **地址**：`parseAddress` 照 `workspace.resources` 的规则（段用 `/`，无空段、`.`、`..`、反斜杠、NUL，首段不是盘符，编码后不超过 4096 字节，根是空路径）；方案名 `[a-z][a-z0-9+.-]*`。地址一律带方案，不带的为 `invalid-address`。
2. **提供者**：目录型就是现有 `FileAccess` 加 `kind: "directory"` 与 `readonly`；虚拟型只有 `stat`、`readText`、`list`。`ResourceAccess.open(scheme, {sessionId})` 按会话取提供者（`local://`、`artifact://` 都是按会话的），登记时给对象或工厂。运行时缺省不替使用方登记任何方案。
3. **read**：目录型照旧，头是 `[scheme://path#tag]`，快照按真实绝对路径登记；虚拟型不给头、`details.editable: false`；说明列出可用方案与各自的 `doc`。
4. **edit**：预检每个头是合法地址、方案存在、目录型、非只读、`locate` 在根内；引擎的 `resolveUrl` 回调给出真实绝对路径（`planWritable: false`）；writer 按本次打开过的目录型提供者的根反查方案，转回相对路径经提供者写；一次 edit 可以跨方案。引擎策略 `cwd`、`homeDir` 不再是根（头全是地址，引擎不会按它们解析）。
5. **artifact**：`ArtifactStore` 在 `session` 模块（内存、JSONL 旁目录 `<root>/<sessionId>.artifacts/<序号>.<工具>.log`，序号打开时扫目录续号，临时文件加改名）；适配层在结果回 OMP 之前按预算截断并保存全文；`artifact://` 提供者只读、按会话。

## 验收映射

| 条目 | 测试 |
|---|---|
| builtin-tools 输入（地址规则） | `src/builtin/resources.test.ts`：逐条非法地址、未知方案、只读方案写拒绝、按会话的提供者 |
| builtin-tools 输出 2、3、6 | `read.test.ts`、`edit.test.ts` 改地址；跨方案一次 edit 两个文件 |
| session 溢出存储 | `src/session/artifacts.test.ts`：内存与 JSONL，序号续号、原子写、工具名清洗 |
| tools 输出 9（预算与溢出） | `adapter.test.ts`：200 KiB 文本经真实 OMP Agent 后日志里的结果在预算内、带链接；存失败照样截 |
| runtime 输入与输出 3 | `runtime` 场景：缺省内存 artifact；`limits.toolResult` 可改 |
| 示例 | 场景 1–5 改地址；新场景 6 溢出与回读；live 加一条回读 |
