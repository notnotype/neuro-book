---
schema: nbook.task/v2
taskId: t15-harness-builtin-tools
---

# nb-harness 的内置工具（read、edit 与 FileAccess）

## 目标

写 [`harness.builtin-tools`](../../../../../docs/specs/harness/builtin-tools.md)（`planned`）并按它实现 `builtin` 模块：受根约束的文件访问接口 `FileAccess` 与本地实现（子入口 `./builtin/local`）、`read`（标签头与行号、目录、图片、预算）、`edit`（OMP hashline 引擎的装配与经 `FileAccess` 落盘）、按会话分开的快照存储。Work 切片 7。

非目标：项目级参数注入与多根（插件阶段）；编辑协议语义（照 OMP）；文件监视与协作锁；第三方格式。

## 当前状态（2026-10-10）

- Spec 与实施计划 [`plan.md`](plan.md) 已写，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进。
- **实现**（计划 S1，一个提交）：`src/builtin/`（`types.ts`、`stores.ts`、`read.ts`、`edit.ts`、`builtin.ts`、`local/local.ts`）；`package.json` 加 `./builtin`、`./builtin/local` 与 `pi-natives` 依赖；模块表登记。`bun test src/builtin` 7 pass；整包 181 pass、4 skip。真实引擎实验（lab）改写了两处 Spec：标签是内容哈希，另一个会话拿同样的标签、文件没变时引擎照常接受，会话隔离的是“展示过的行”的记录；引擎会自己读 `[path#tag]` 头里的文件并在拒绝时回显内容（根外文件也读），所以头里的路径先经 `FileAccess.resolve`，越界不交给引擎。引擎拒绝时回显的内容也算展示过（OMP 语义），测试据此用新文件验证隔离。Spec 加证据，注册表标“待晋升”。
- **审查（omp，计划与实现合一）**：8 条（阻断 3、重要 4、建议 1），全部成立并已修。第 1 条（阻断：edit 的头部预检只按字面，根内指向根外的符号链接仍交给引擎读并回显）——`FileAccess` 加异步 `locate`（真实路径判越界），头里的路径改经它；第 2 条（阻断：悬空符号链接被 `write` 跟随、在根外建文件）——目标不存在的符号链接按“证明不了在根内”拒绝，edit 的 writer 保留访问层的 `outside-root` 码；第 3 条——构造器用 `statSync` 校验根是已存在的目录，根 `/` 不再被去成空串；第 4 条——越界只看父目录组件 `..`，`..foo` 这样的根内名字合法。Spec 输入与输出 1、6、验收场景 1 同步改，测试补悬空链接、根外链接经 edit、`..foo.txt`、根校验。
- 第 5 条（阻断：引擎会去掉头里路径的前后空白、展开 `~`，预检按原字符串判根内而引擎读到根外）——头里的路径带前后空白、以 `~` 开头、带协议前缀的直接拒绝，不替引擎猜；第 6 条（writer 的异常被原生引擎吞成 `edit-rejected`，已落盘的文件不在结果里）——writer 把失败与已写文件记在 JS 侧的记录里，`apply` 返回后据它构造结果（码照访问层，`details.written` 列出已落盘的文件）；第 7 条（默认来源藏着 `SnapshotStores`，没有回收入口）——`createBuiltinTools` 接收装配方的 `stores`，寿命归装配方，Spec 写明运行时不替来源回收；第 8 条（标签有效性与会话隔离的文字互相矛盾）——术语、失败表、状态一节、`stores.ts` 注释与测试标题统一为“标签是内容哈希，隔离的是展示记录”。审查 60 分钟到点被截停，用原会话续跑 15 分钟补完报告；对待确认项的判断：引擎自己读磁盘“不应按当前前提接受”——已按第 1、5 条把能对齐的解析形式对齐，残余风险（引擎未知的其它寻址形式）记入待确认清单；快照存储按会话分开“保留但要写清寿命”——已按第 7、8 条补。证据 [`evidences/review.txt`](evidences/review.txt)。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“插件的落脚点”（`FileAccess`）与“影响”（内置文件工具受根约束）；开发者 2026-10-10 决定做完内核再做内置读写工具。
- OMP 编辑引擎的实测语义：[`packages/nb-harness/docs/omp-capabilities.md`](../../../../../packages/nb-harness/docs/omp-capabilities.md) 第 3.3 与第 4 节；旧原型的 read/edit 工具与测试（提交 `a82d026b` 之前的 `src/prototype/tools/`）作为行为参照。

## 下一步

omp 审查（计划与实现合一）→ 处理。
