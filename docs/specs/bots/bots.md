---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: bots.bots
owners:
  - nbook.bots
---

# bot 与预设

## 目标与非目标

给 NeuroBook 一个常驻的 bot：它有名字、人设和自己的目录，和用户在一条主对话里长期聊下去（主对话见 [`main-conversation.md`](main-conversation.md)）。bot 按插件交出的预设建出来，建出来以后是用户数据。

不承诺：

- 第一版只有一个 bot：没有新建、删除、改名 bot 的入口，缺省 bot 的 id 固定；数据形状按多个 bot 设计。
- 头像怎样画在界面上（[`view.md`](view.md)）、人设与记忆怎样进提示词、`bots://` 方案与写授权、日程，不在这里。
- 预设更新以后不覆盖已经建出来的 bot。

## 术语与参与者

- **bot**：常驻的员工，有身份（名字、头像）、人设、自己的目录与一条主对话。
- **预设**：插件交出的模板，建 bot 时用一次。
- **岗位 Profile**：bot 所用的 Profile，只定义工具与岗位；人设不在 Profile 里。
- **可用的预设**：声明被平台接受、而且声明的文件都在、都合规的预设。

## 输入与前置条件

- 贡献点 `bots.presets`：插件在清单里声明预设，贡献 id 就是预设 id（以插件 id 开头，例如 `nbook.bots.lyra`）

  ```ts
  interface BotPresetDeclaration {
      name: string;        // 单行，1–40 个字符
      avatar: string;      // 插件包里的图片文件（png、jpg、jpeg、webp），不大于 1 MiB
      profile: string;     // Profile 的 key
      persona: string;     // 插件包里的一个 Markdown 文件（.md），不大于 256 KiB
      memorySeed?: string; // 插件包里的一个目录：至多 200 个普通文件、合计不大于 4 MiB，不含链接
  }
  ```

  路径相对插件包的根，用 `/` 分段，不能有空段、`.`、`..`，不能越出插件包。内置插件的文件在应用包里（源码运行与安装包用同一套查找），第三方插件的在它的插件包目录里。
- 依赖：`nbook.agent`（`agentKey`）、状态根、插件存储。

## 输出与可观察行为

1. 预设的声明照平台的贡献点规则校验（[`runtime/plugins.md`](../runtime/plugins.md)）：结构不合的平台不接受；同一个预设 id 有两份声明时两份都不接受。被接受的声明，`nbook.bots` 在接收时核对文件：不在、越出插件包、不是普通文件、超出大小或数量的，这个预设不可用，写诊断 `bots.preset-invalid`（带插件、预设 id 与原因）；别的预设不受影响。
2. `nbook.bots` 自带缺省预设 `nbook.bots.lyra`：名字“星璃”，岗位 Profile 是 `nbook.bots.companion`，人设是星璃的人设文件，没有记忆种子。
3. `nbook.bots` 经 `agent.profiles` 交出内置岗位 Profile `nbook.bots.companion`：工具与 Agent 模式同主创（`nbook.agent.main`；声明里同样按 id 引用模式扩展 `nbook.agent.modes`，[`agent/contributions.md`](../agent/contributions.md) 输出 26；`shell` 照主创是可选、缺省装上），系统提示词只写岗位（用户身边常驻的助手），不写人设。它标 `hidden`：只给 bot 的主对话用，新建会话时不列出。
4. 启动：`nbook.bots` 自己的缺省预设声明交到接收方之后（这时它交出的岗位 Profile 已交给 `nbook.agent`），在后台读 bot 记录、持有已有的主对话（[`main-conversation.md`](main-conversation.md) 输出 2），这一步不看缺省预设的文件是否可用。一个 bot 都没有时，等缺省预设的文件核对有了结果：可用就建 bot `lyra`，不可用就写诊断 `bots.default-preset-missing`、不建。缺省预设的声明由 `nbook.bots` 自己交出，平台不接受它是发版缺陷。建 bot 不需要模型。
5. 建 bot：
   1. 在 `<状态根>/user/bots/` 下建暂存目录 `.staging-<随机>/`，把人设复制成 `persona.md`、头像复制成 `avatar.<原扩展名，小写>`、记忆种子复制进 `memory/`，最后写创建凭据 `.created.json`（格式版本、bot id 与这次要写的 bot 记录）；
   2. 把暂存目录改名成 `<bot id>/`；
   3. 照凭据写 bot 记录，再读回确认。

   启动时，`<bot id>/` 在、记录不在：凭据读得懂、bot id 对得上，就是上次改名之后没写下记录的那份，照凭据补写记录，不再复制；没有凭据或读不懂的目录不登记、不覆盖，写诊断 `bots.directory-unknown`。`.staging-*` 里有凭据或是空的，是没做完的复制，删掉；别的不动。记录写下之后不再复制，bot 目录里的文件归 bot 自己演进。bot id 是 `[a-z0-9-]`、1–40 个字符。
6. bot 记录：`{id, name, preset, profile, createdAt}`，`profile` 是建时预设的岗位 Profile。主对话的 id 由 bot id 定（[`main-conversation.md`](main-conversation.md) 输出 1），不另存；所用的模型、推理档、审批模式都以主对话的会话设置为准，不在记录里另存。记录读不懂（损坏、版本不认识）时不当成没有 bot：不建新的，写诊断 `bots.record-unreadable`。
7. 远程服务 `nbook.bots/bots`，版本 2（planned：版本 2 的 `list()` 项多了必有的 `last`，版本 1 的客户端读不了；之前是版本 1），服务端提供，调用方 `browser`：
   - `list()` → `[{id, name, main, unread, latestSeq, seenSeq, last}]`，`main` 是主对话的持有状态（[`main-conversation.md`](main-conversation.md) 输出 3），`unread`、`latestSeq`、`seenSeq` 见同一份的输出 7；
   - `last` 是最后一条计数消息的摘要 `{text, at}`：持有之后在线收到计数消息就换；补数时“看到”之后那段里有计数消息取最后一条，那段是空的就从日志尾部往前找（（planned）至多 200 条，找不到、没有持有时为 null）。（planned）不存记录。摘要：只取文字块，表情写法换成“[表情]”，转义的表情写法（`\:lyra/开心:`）去掉反斜杠、照字面留着，空白折叠成一个空格，按码点取前 80 个、超了加“…”；没有文字时有图片写“[图片]”，否则写“[消息]”；（planned）Markdown 标记原样留着（已知限制）；
   - `ensureMain({botId})`：见 [`main-conversation.md`](main-conversation.md) 输出 1；
   - 事件 `botsChanged`：`list()` 的结果变了时推一份新的。先订阅后取 `list()`，`onResync` 重取。

   不认识的 `botId` 得 `unknown-bot`。
8. 内置插件显示名表登记 `nbook.bots`（“bot”）。
9. **头像。** `GET /api/nbook.bots/avatar/<bot id>`：只给 bot 记录里有的 bot；在 bot 目录里按 `avatar.png`、`.jpg`、`.jpeg`、`.webp` 找，逐段核对、不跟链接；类型按文件开头的字节判定，判不出的、超过 1 MiB 的都得 404。安全头同表情包的取图路由（`Content-Security-Policy: sandbox`、`nosniff`），别的网页来的请求得 403；`cache-control: no-cache` 加 ETag，同一个 ETag 回 304。

## 状态与转换

| bot 的状态 | 进入 | 离开 |
|---|---|---|
| 不存在 | 初始；记录写下之前 | 记录写下 |
| 已建 | bot 记录写下 | 第一版没有删除 |

时序与寿命：

- 激活里不读写会话（[`agent/contributions.md`](../agent/contributions.md) 输出 3）。后台任务从 `nbook.bots` 自己的预设接收方收到缺省预设的声明时开始：这时它交出的岗位 Profile 已交给 `nbook.agent`、能解析，调 `agentKey` 不等自己的激活。
- 预设的文件核对是异步的：撤回之后才查完的结果作废，不把撤回了的预设记成可用，也不盖掉同一个 id 后来发布的那份。
- `nbook.bots` 的停止信号一到，后台任务不再开始新的工作、不再排重试；在途的建 bot 与持有做完一步后停下，迟到交回的持有立即放掉。服务端停止时 `nbook.agent` 同时开始停止、照它的规则关闭会话，不等 `nbook.bots` 放掉持有（[`agent/sessions.md`](../agent/sessions.md) 输出 14、24）。
- 后台任务读到记录之前，`list()` 交回空表，读到、建好之后推 `botsChanged`；这之前到的 `ensureMain` 等它，读完、建完再查 bot。

## 副作用与数据

- bot 记录在 `nbook.bots` 的插件存储里（应用级，不按作品），记录格式版本 1，不认识的版本不改写。
- bot 目录 `<状态根>/user/bots/<bot id>/`：`persona.md`、`avatar.<扩展名>`、`memory/`；暂存目录 `<状态根>/user/bots/.staging-<随机>/`。
- 主对话存在 `nbook.agent` 的会话库里（[`agent/sessions.md`](../agent/sessions.md)）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `unknown-bot` | 没有这个 bot | 重新 `list()` |
| `bots.preset-invalid`（诊断） | 预设的文件不合，不可用 | 插件作者按原因改 |
| `bots.default-preset-missing`（诊断） | 缺省预设不可用，没有建 bot | 查 `nbook.bots` 的安装 |
| `bots.record-unreadable`（诊断） | bot 记录读不懂（读到的、或建 bot 写记录时碰到的） | 查状态根；不自动重建 |
| `bots.directory-unknown`（诊断） | bot 目录在、记录不在，又没有读得懂的创建凭据 | 查状态根；不自动登记 |
| `bots.create-failed`（诊断） | 建 bot 没做成：`<bot id>/` 已经在了（不覆盖），或记录没写下 | 查状态根；下次启动再试 |
| `bots.record-failed`（诊断） | 插件存储读写失败（区别于读不懂） | 查存储；下次启动再试 |
| `bots.start-failed`（诊断） | 后台任务出了意外的错（例如复制预设文件时读写出错） | 按诊断里的原因查；下次启动再试 |
| `bots.builtin-missing`（诊断） | 应用的安装里没有 `nbook.bots` 的内置资源目录，缺省预设随之不可用 | 查安装 |

## 边界与兼容

- 公开接口：贡献点 `bots.presets` 的声明形状、远程服务 `nbook.bots/bots` 版本 2（planned，见输出 7）、Profile `nbook.bots.companion`。
- 信任边界：浏览器是用户本人；远程方法不收会话身份。

## 验收与 Smoke

1. 全新的状态根启动：建出 bot `lyra`，目录里有 `persona.md` 与头像，`list()` 里它的主对话是 `none`；再启动不再建、不覆盖 `persona.md` 的改动。改名之后、写记录之前进程被杀：下次启动照凭据补写记录，不再复制，没有第二个 bot；同一处放一个没有凭据的 `lyra/` 目录时不登记、有诊断。缺省预设的头像不在了：已有的 bot 照常持有主对话。安装包形态（解出的应用包）里同样建得出来。
2. 经真实的插件安装装一个第三方插件，带一个合法的预设和一个人设文件越出插件包的预设：合法的可用，越界的有诊断，缺省 bot 照常建。

Smoke：`packages/neuro-book/src/plugins/bots/` 的插件测试。

## 实现合同

- **公开入口**：`nbook/plugins/bots/shared/contracts`（贡献点 `presetsPoint` 与 `BotPresetDeclaration`、远程合同 `botsContract` 与 `BotItem`、`COMPANION_PROFILE`、`mainSessionId`）。
- **owner 与依赖方向**：`nbook.bots` 的服务端入口（`backend/plugin.ts`）持有预设表、bot 记录与创建流程、主对话的持有与远程服务；经 `agentKey` 用 `nbook.agent`，经插件存储记 bot 记录，经平台的插件包查询找第三方预设的文件；`nbook.agent` 不依赖 `nbook.bots`，会话头的 `owner` 只是它给归属插件留的一个字段（[`agent/sessions.md`](../agent/sessions.md) 输出 23）。
- **关键不变量**：
  - 激活里不读写会话：后台任务从自己的缺省预设声明交到接收方时开始，建 bot 与核对文件都在它里面（输出 4，`bots.test.ts`、`backend/service.test.ts`）。
  - 建 bot 先在暂存目录里做完全部复制、写下创建凭据，再改名成 `<bot id>/`，最后写记录并读回；任何一步之后被杀，下次启动都能补完或不登记，不留两份（输出 5，`bots.test.ts`“bot 输出 5”）。
  - 预设的文件核对按代次：撤回之后才查完的结果作废，不复活、也不盖掉同一个 id 后来发布的那份（输出 1，`backend/presets.test.ts`）。
  - 记录读不懂（损坏、版本不认识、bot id 不合规则）时整份当读不懂：不建新的、不登记、不改写原数据（输出 6，`bots.test.ts`）。
  - 停止信号一到就封住：不开始新的工作、不排重试，迟到交回的持有立即放掉（“时序与寿命”，`backend/main.test.ts`）。

## 证据

- 批准依据：[提案：NeuroBook 的 bot](../../proposals/neurobot.md)（2026-11-18 接受）第四节第 3、4、12 小节与 2026-11-19 的决策记录；[w00043 t06](../../../.agents/works/w00043-neurobot/tasks/t06-main-conversation/README.md) 的决定与设计审查的处理；开发者 2026-11-20 批准晋升为 `implemented`，逐句核对后晋升（[核对处理](../../../.agents/works/w00043-neurobot/tasks/t06-main-conversation/evidences/promotion-check-disposition.md)）；头像路由（输出 9）仍是 `planned`。
- 实现入口：[`backend/plugin.ts`](../../../packages/neuro-book/src/plugins/bots/backend/plugin.ts)（服务端入口、远程服务）、[`backend/bots.ts`](../../../packages/neuro-book/src/plugins/bots/backend/bots.ts)（启动与 bot 列表）、[`backend/create.ts`](../../../packages/neuro-book/src/plugins/bots/backend/create.ts)（建 bot 与创建凭据）、[`backend/presets.ts`](../../../packages/neuro-book/src/plugins/bots/backend/presets.ts)（预设的文件核对）、[`backend/store.ts`](../../../packages/neuro-book/src/plugins/bots/backend/store.ts)（bot 记录）、[`backend/profile.ts`](../../../packages/neuro-book/src/plugins/bots/backend/profile.ts)（岗位 Profile）、[`shared/contracts.ts`](../../../packages/neuro-book/src/plugins/bots/shared/contracts.ts)
- 合同测试：[`bots.test.ts`](../../../packages/neuro-book/src/plugins/bots/bots.test.ts)（真实内核与 `nbook.agent`，输出 1–7 与验收 1、2）、[`backend/presets.test.ts`](../../../packages/neuro-book/src/plugins/bots/backend/presets.test.ts)（输出 1）、[`backend/service.test.ts`](../../../packages/neuro-book/src/plugins/bots/backend/service.test.ts)（输出 4、时序与寿命）、[`backend/main.test.ts`](../../../packages/neuro-book/src/plugins/bots/backend/main.test.ts)（停止的先后）
- Smoke：[`bots.test.ts`](../../../packages/neuro-book/src/plugins/bots/bots.test.ts)（真实内核、真实 `nbook.agent`、本机假端点）
