---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: bots.bots
owners:
  - nbook.bots
---

# bot 与预设

## 目标与非目标

给 NeuroBook 一个常驻的 bot：它有名字、头像、人设和自己的目录，和用户在一条主对话里长期聊下去（主对话见 [`main-conversation.md`](main-conversation.md)）。bot 按插件交出的预设建出来，建出来以后是用户数据。

不承诺：

- 第一版只有一个 bot：没有新建、删除、改名 bot 的入口；数据形状按多个 bot 设计。
- 人设与记忆怎样进提示词、`bots://` 方案与写授权、日程，不在这里。
- 预设更新以后不覆盖已经建出来的 bot。

## 术语与参与者

- **bot**：常驻的员工，有身份（名字、头像）、人设、自己的目录与一条主对话。
- **预设**：插件交出的模板，建 bot 时用一次。
- **岗位 Profile**：bot 所用的 Profile，只定义工具与岗位；人设不在 Profile 里。

## 输入与前置条件

- 贡献点 `bots.presets`：插件在清单里声明预设

  ```ts
  interface BotPresetDeclaration {
      id: string;          // 以插件 id 开头，例如 nbook.bots.lyra
      name: string;        // 单行，1–40 个字符
      avatar: string;      // 插件包里的图片文件（png、jpg、webp），不大于 1 MiB
      profile: string;     // Profile 的 key
      persona: string;     // 插件包里的一个 Markdown 文件，不大于 256 KiB
      memorySeed?: string; // 插件包里的一个目录
  }
  ```

  路径相对插件包的根，不能越出它。内置插件的文件在应用包里，第三方插件的在它的插件包目录里。
- 依赖：`nbook.agent`（`agentKey`）、状态根、插件存储。

## 输出与可观察行为

1. 预设按声明校验：字段不合、文件或目录不在、越出插件包、大小超限的预设不登记，写诊断 `bots.preset-invalid`（带插件、预设 id 与原因），别的预设照常。两个插件声明同一个 id 时按贡献点的去重规则只留一个。
2. `nbook.bots` 自带缺省预设 `nbook.bots.lyra`：名字“星璃”，岗位 Profile 是 `nbook.bots.companion`，人设是星璃的人设文件，没有记忆种子。
3. `nbook.bots` 经 `agent.profiles` 交出内置岗位 Profile `nbook.bots.companion`：工具是主创（`nbook.agent.main`）的工具加 `shell`，系统提示词只写岗位（用户身边常驻的助手），不写人设。
4. 首次启动：`nbook.bots` 激活完成之后，在后台检查 bot 记录；一个 bot 都没有时按缺省预设建一个。缺省预设没登记上（输出 1）时写诊断 `bots.default-preset-missing`，不建。建 bot 不需要模型。
5. 建 bot：
   - id 取预设 id 去掉插件前缀的部分（缺省 bot 是 `lyra`），已有同名的 bot 时依次加 `-2`、`-3`；
   - 在 `<状态根>/user/bots/<bot id>/` 下把人设复制成 `persona.md`、头像复制成 `avatar.<原扩展名>`、记忆种子复制进 `memory/`；
   - 最后写 bot 记录。

   记录写下之前出错或进程被杀，下次启动按“没有这个 bot”重来，目录里已有的文件被覆盖；记录写下之后不再复制，bot 目录里的文件归 bot 自己演进。
6. bot 记录：`{id, name, preset, profile, createdAt}`，`profile` 是建时预设的岗位 Profile。主对话的 id 由 bot id 定（[`main-conversation.md`](main-conversation.md) 输出 1），不另存；所用的模型、推理档、审批模式都以主对话的会话设置为准，不在记录里另存。
7. 远程服务 `nbook.bots/bots`，版本 1，服务端提供，调用方 `browser`：
   - `list()` → `[{id, name, main}]`，`main` 是主对话的状态（[`main-conversation.md`](main-conversation.md) 输出 3）；
   - `avatar({botId})` → `{mime, bytes}`；
   - `ensureMain({botId})`、`restoreProfile({botId})`：见 [`main-conversation.md`](main-conversation.md)；
   - 事件 `botsChanged`：`list()` 的结果变了时推一份新的。先订阅后取 `list()`，`onResync` 重取。

   不认识的 `botId` 得 `unknown-bot`。
8. 内置插件显示名表登记 `nbook.bots`（“bot”）。

## 状态与转换

| bot 的状态 | 进入 | 离开 |
|---|---|---|
| 不存在 | 初始；记录写下之前 | 记录写下 |
| 已建 | bot 记录写下 | 第一版没有删除 |

时序与寿命：

- 激活里不读写会话（[`agent/contributions.md`](../agent/contributions.md) 输出 3）；首次建 bot 与主对话的持有都在激活交回之后的后台任务里，`nbook.bots` 停止时这个任务停下、持有放掉，先于 `nbook.agent` 停止。
- 后台任务跑完之前调用远程方法：`list()` 交回已有的记录；`ensureMain` 等这个 bot 建好再做。

## 副作用与数据

- bot 记录在 `nbook.bots` 的插件存储里（应用级，不按作品），记录格式版本 1，不认识的版本不改写。
- bot 目录 `<状态根>/user/bots/<bot id>/`：`persona.md`、`avatar.<扩展名>`、`memory/`。
- 主对话存在 `nbook.agent` 的会话库里（[`agent/sessions.md`](../agent/sessions.md)）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `unknown-bot` | 没有这个 bot | 重新 `list()` |
| `bots.preset-invalid`（诊断） | 预设不合规，没登记 | 插件作者按原因改清单 |
| `bots.default-preset-missing`（诊断） | 缺省预设没登记上，没有建 bot | 查 `nbook.bots` 的安装 |

## 边界与兼容

- 公开接口：贡献点 `bots.presets` 的声明形状、远程服务 `nbook.bots/bots` 版本 1、Profile `nbook.bots.companion`。
- 信任边界：浏览器是用户本人；远程方法不收会话身份。

## 验收与 Smoke

1. 全新的状态根启动：建出 bot `lyra`，目录里有 `persona.md` 与头像；再启动不再建、不覆盖 `persona.md` 的改动。建到一半（文件已复制、记录没写）时进程被杀：下次启动重建同一个 `lyra`，没有 `lyra-2`。
2. 一个第三方插件声明的预设人设文件越出插件包：它不登记、有诊断，缺省 bot 照常建。

Smoke：`packages/neuro-book/src/plugins/bots/` 的插件测试。

## 证据

- 批准依据：[提案：NeuroBook 的 bot](../../proposals/neurobot.md)（2026-11-18 接受）第四节第 3、4、12 小节与 2026-11-19 的决策记录；[w00043 t06](../../../.agents/works/w00043-neurobot/tasks/t06-main-conversation/README.md) 的决定。
