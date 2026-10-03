# Round 415: 默认模板 Workbench 删除兜底后浏览器复验

## 背景

Round 414 把 Project 删除从“等待物理目录同步删除”改成“用户视角立即删除 + 物理清理后台化”。本轮不继续抠后端边界，改为从作者真实路径复验：这个删除语义调整是否影响新建 Project 后进入主 IDE World Engine Workbench、同步主体、创建 `world`、写入 slice 和删除临时 Project。

## 执行

- 启动 dev server：`bun run dev -- --port 3001`。
- 通过书架 UI 新建临时 Project：`World Engine Round 415 1782205668675`。
- 进入主 IDE 顶栏 `World`，打开真实 Workbench。
- 确认默认模板已加载：左栏显示 `world-engine/schema.yaml` / `world-engine/calendar.yaml`，schema 有 5 个类型，内置 `player` 位于 `主体系统待接入`。
- 点击 `创建 world subject`，创建 `world:world`。
- 点击 `同步主体系统`，把模板内置 `player:character` 注册为 World Engine subject。
- 打开 `新建 Slice`，保持默认 `player.events listAppend`，写入：
  - time：`复兴纪元1年 1月1日 00:00:01`
  - title：`Round 415 玩家发现第一条线索`
  - summary：`玩家在复兴纪元第一天记录了一条用于验收的事件。`
  - value：`Round 415 验收：玩家角色记录第一条世界事件`
- 回到书架，通过 UI 删除临时 Project。

## 结果

- Workbench 路径通过：新 Project 不手写 schema 也可直接进入 World Engine。
- `world` subject 显式创建通过；没有自动创建，也没有写 `simulation/subjects`。
- `player` 同步通过；同步后同一个 init slice 含 `world` 与 `player` 两个 subject 的初始化变更，符合“同 instant 单 slice / 合并”契约。
- 写入 slice 成功：
  - timeline 从 `全部 1 / init 1` 变为 `全部 2 / init 1 / event 1`。
  - 新 event slice 显示 `files 1` 主体文件建议。
  - Inspector 显示 `1 proposals`，并生成 `events.jsonl draft`。
  - State Snapshot 中 `player.events` 变为 `1 item`，值为本轮写入文本。
- 删除临时 Project 成功：
  - 书架和 `/api/projects` 均不再显示该 Project。
  - 顶栏自动回到 `World Tools Test`。
  - 物理目录仍存在，但包含 `.nbook/deleted-project.json`。
  - dev server 日志显示 Windows `Move-Item` 被 `project.sqlite` 句柄挡住后，按 Round 414 设计改为 marker 删除并后台清理。

## 观察

- 书架新建 Project 后，顶栏已经切到新 Project，但当时 URL query 仍停在旧 `projectPath`。本轮手动规范到 `?project=workspace/world-engine-round-415-1782205668675` 后继续验收。它没有阻断 World Engine 主线，但后续应确认刷新页面 / 分享链接是否会回到旧 Project。
- 浏览器环境出现一次外部 Statsig 网络超时日志，和本地 World Engine 行为无关。

## 与计划出入

- 原计划只做一条窄 Workbench 作者流；实际额外覆盖了 Project UI 删除路径，并真实触发 deleted marker 兜底。
- 本轮没有重复执行 slice 删除 / 编辑 / `写入并继续下一步`，这些已由 Round 413 覆盖；本轮重点是 Round 414 删除语义调整后的新 Project 主路径回归。
- 本轮没有改业务代码，也没有新增测试；验证方式是用户已授权的真实浏览器验收。

## 清理

- 临时 Project 已从用户可见列表删除。
- 目录残留为预期 marker 形态，交给后台清理语义处理。
