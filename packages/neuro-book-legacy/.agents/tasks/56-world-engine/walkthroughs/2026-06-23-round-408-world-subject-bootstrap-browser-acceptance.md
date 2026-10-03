# Round 408: World Subject Bootstrap Browser Acceptance

## 背景

Round 407 已实现 `world` subject 显式创建入口，并禁用未实例化 subject type 的 schema shortcut。本轮按用户允许的真实浏览器验收，验证新 Project 作者流里：

1. schema 声明 `world` type 但 Project 缺少 `world` subject。
2. 同步主体系统后，`world` bootstrap 入口仍可见。
3. 作者显式创建 `world` subject。
4. 继续写入 `world.events` slice。

## 临时 Project

```text
title: world-engine-round-408-world-bootstrap-1782184737643
projectPath: workspace/world-engine-round-408-world-bootstrap-1782184737643
```

通过应用 API 写入 fixture：

- `world-engine/schema.yaml`
- `world-engine/calendar.yaml`
- `simulation/subjects/player/subject.md`
- `simulation/subjects/player/soul.md`
- `simulation/subjects/player/mind.md`
- `simulation/subjects/player/state.md`
- `simulation/subjects/player/events.jsonl`
- `simulation/subjects/player/memory.jsonl`

schema 只声明 `world` 与 `character`，其中 `world.events` 存在，但初始没有 `world` subject。

## 浏览器验收结果

使用系统 Chrome 作为 Playwright executable，打开：

```text
http://127.0.0.1:3001/?project=workspace%2Fworld-engine-round-408-world-bootstrap-1782184737643
```

验收通过：

- 打开主 IDE，点击顶部 `World` 后，Workbench 显示 `subject-system-sync-panel` 和 `world-subject-bootstrap-panel`。
- 在没有 `world` subject 时，左栏出现 `创建 world subject` 入口。
- 点击 `同步主体系统` 后：
  - 出现成功提示：`已接入 1 个主体系统 subject。`
  - `world-subject-bootstrap-panel` 仍然可见。
- 点击 `创建 world subject` 后：
  - 出现成功提示：`已创建 world subject。`
  - `world-subject-bootstrap-panel` 隐藏。
  - API 确认 subjects 包含：
    - `player:character`
    - `world:world`
- 打开 `新建 Slice`，通过 UI 写入：

```json
[
  {
    "subjectId": "world",
    "attr": "events",
    "op": "listAppend",
    "value": "验收主角听见世界钟声第一次响起。"
  }
]
```

- UI 返回 `已写入 slice`。
- `POST /api/projects/world-engine/state/query` 查询 `world.events` 返回该事件，`issues=0`。

这验证 Round 407 的修复解决了 Round 406 暴露的 `subject 不存在：world` 首步卡点。

## 清理

- 第一次删除临时 Project 时出现 Windows `EBUSY`：

```text
EBUSY: resource busy or locked, unlink ...
```

- 等句柄释放后重试 `DELETE /api/projects/item?projectPath=...` 成功：

```text
delete status 200
exists=False
```

- dev server 已关闭。
- `port 3001` 已确认空闲。

## 实际偏差

- Playwright 包自带 Chromium 未安装，首次启动浏览器失败；本轮改用系统 Chrome：
  - `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `waitUntil: "networkidle"` 会被外部 Statsig 请求拖住；本轮改为 `domcontentloaded`，并在 Playwright route 中拦截非本地请求。
- 中途有两次脚本断言误判：
  - `创建 验收主角` 同时出现在 slice card 与 Inspector，Playwright strict mode 报多匹配。
  - State Query 返回字段是 `subjectId`，脚本曾误按 `id` 判断。
  - 两次误判的临时 Project 都已通过应用删除 API 清理。

## 后续

- `world` bootstrap 这条作者流可从 TODO 移出。
- Project delete 在 Windows 上仍可能短暂遇到 `EBUSY`，但重试成功；后续如果频繁出现，应继续定位是否还有 Project 级句柄释放延迟。
