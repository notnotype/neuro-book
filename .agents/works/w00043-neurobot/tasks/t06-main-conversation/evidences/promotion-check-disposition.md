# t06 晋升前逐句核对的处理（2026-11-19）

核对者是两个 Claude Opus 子代理（开发者 2026-11-19 定：omp 只负责审查，后端的核对用 Claude），同时跑、各核一部分，只读：

- A：[`bots/bots.md` 与 `bots/main-conversation.md`](promotion-check-a-opus.txt)，123 句：守住 78、缺断言 39、部分缺断言 5、字面不符 1（另有 6 条附带的字面不符）、没实现 0。
- B：[`agent/sessions.md` 输出 23–28 与 t06 在两份内核 Spec、平台插件 Spec 里加的句子](promotion-check-b-opus.txt)，87 句：守住 66、缺断言 19（其中 8 句是已知限制或非目标）、没实现 1、字面不符 1。

## 字面不符与没实现

| 来源 | 内容 | 处理 |
|---|---|---|
| A | bots.md：读到记录之前 `list()` 交回空表，Spec 写“交回已有的记录” | 改 Spec：读到之前交回空表，读到、建好之后推 `botsChanged` |
| A | main-conversation.md 输出 3：`failed` 里还有 `header`、`create` 的码 | 改 Spec：码是 `header`、`create`、`hold` 交回的，或 `owner-mismatch` |
| A | 失败表没有 `bots.start-failed`、`bots.builtin-missing`；建 bot 写记录碰到读不懂时报 `record-unreadable` | 两个码补进失败表；`record-unreadable` 的含义写明也包括写记录时碰到的 |
| A | 头像多收 `jpeg`；人设只认 `.md`；头像复制成小写扩展名 | 改 Spec 贴实现 |
| A | `ensureMain` 交回合同外的码时得 `provider-error` | 不改：合同外的码只在 `nbook.agent` 停止期间出现，main-conversation.md 的“时序与寿命”已写停止期间的结果 |
| B | runtime/plugins.md 输出 15：两条前缀合格的贡献重复、另有一条前缀不合时，前缀不合的那条报 `duplicate-contribution` | 改代码：实现审查第 9 条之后删掉的“自己前缀合格才算重复”是必要的，加回去；补用例（三条：两条重复、占用者报前缀，变异抓到） |
| B | harness/session.md 会话头 `owner`：“宿主据此决定……打开到哪里”没有实现 | 这半句改标“（planned，w00043 t15）” |
| B | sessions.md 输出 25 写后代“按会话关系表” | 改成“按会话索引里的 `caller` 链”，与实现一致（关系表没登记的也算得到） |

## 补的用例

- `bots/backend/main.test.ts`：建时得 `session-exists` 回去读会话头；会话头读不懂交回原码、不建；非 `session-busy` 的码不排重试、下一次经 `opening` 再持有；重试之后的打开耗时只算成功那次。
- `bots/backend/presets.test.ts`：头像超过 1 MiB、种子合计超过 4 MiB、种子里有链接；每个不可用的预设断言原因；声明的结构与路径规则（名字单行 1–40 个字符，路径 `../`、`/`、空段、盘符、反斜杠、`./` 都拒）。
- `bots/backend/service.test.ts`（新）：后台任务建好之前到的 `ensureMain` 等它；建出来时推一次变化（变异抓到）。
- `bots/bots.test.ts`：
  - 建 bot 不发模型请求，记录恰好五个字段；重启后重新持有的主对话不是只读；
  - 主对话的 Profile 取自记录，之后那个 Profile 解析不到时后台照样持有、会话只读（main-conversation.md 输出 4）；
  - 凭据读不懂、凭据 bot id 对不上目录名都不登记（变异抓到）；
  - 带记忆种子的预设建出 `memory/`；
  - 第三方插件的预设经平台的插件包查询找文件：合法的不报、越出插件包的链接报 `bots.preset-invalid`、缺省 bot 照常建（变异抓到）。不是走真实安装：用平台的 `createPluginPackages` 指向一个按安装布局摆好的目录，插件经真实登记；
  - 岗位提示词不含人设。
- `nb-harness` `run/interaction.test.ts`：带 `settlePending` 发话只结算同步事项，同时挂着的异步提问不动、之后照常能应答。变异“去掉跳过异步事项那一行”活下来：异步事项没有等待者，认领本来就取不到，那一行只是写明意图；行为由这条用例守住。
- `nb-harness` `kit/sessions/table.test.ts`：宿主打开时抛错得 `open-failed`；表停止之后放掉持有什么都不做。
- `neuro-book` `agent/sessions.test.ts`：子会话没有归属、改写历史不被拒；有归属的前台会话在跑时 `running()` 算它、列表不列它。

## 不补的

- 已知限制与非目标那几句（B 列的 8 句）：写的是不保证的事，不为它们写用例。
- 孙会话不进列表：`ownedTrees` 按 `caller` 链递归，子会话的用例已经走过递归的那一步；造孙会话要改派发深度的设置，收益小。
- A 的第 11 组轻项（在途 `ensureMain` 封住后得 `provider-error`、主对话带没收口运行的重启）：前者 Spec 已写，后者由会话的中断恢复（runtime.md）守着。
