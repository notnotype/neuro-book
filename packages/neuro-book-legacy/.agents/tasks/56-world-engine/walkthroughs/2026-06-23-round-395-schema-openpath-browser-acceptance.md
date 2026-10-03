# Round 395 - Schema OpenPath Browser Acceptance

## Summary

本轮按真实作者流只读验收 World Engine schema / calendar 配置文件入口：作者从独立 Preview 或主 IDE Workbench 看到 `world-engine/schema.yaml` / `world-engine/calendar.yaml` 后，能否进入主 IDE 并打开对应 Project Workspace 文件。

验收对象：

- Project：`workspace/ming-ding-zhi-shi-2`
- URL：`http://localhost:3001`
- 浏览器：in-app browser automation

## Scope

- 只读浏览器验收。
- 不创建 Project。
- 不写入 / 编辑 / 删除 slice。
- 不写 Project SQLite。
- 不修改 `simulation/subjects` 六文件。

## Checks

### 主 IDE schema deep link

打开：

```text
http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2&openPath=world-engine%2Fschema.yaml
```

结果：

- 页面加载到 `命定之诗2`。
- 主 IDE 打开 `world-engine/schema.yaml`。
- 正文可见 `subjectTypes:` 与 `character:`。
- URL 被清理为 `http://localhost:3001/?project=workspace/ming-ding-zhi-shi-2`，`openPath` 已移除。
- Workbench 未残留在前景。

### 主 IDE Workbench schema chip

从 schema 文件页面点击顶部 `World` 打开 Workbench 后，左栏 schema chip 显示：

- `world-engine/schema.yaml`
- `title="打开 schema 配置文件"`

点击该 chip 后：

- Workbench 关闭。
- 主 IDE 仍打开 `world-engine/schema.yaml`。
- 正文可见 `subjectTypes:` 与 `character:`。
- URL 无 `openPath`。

### Preview schema / calendar links

打开：

```text
http://localhost:3001/world-engine.preview?project=workspace%2Fming-ding-zhi-shi-2
```

结果：

- 页面显示 `命定之诗2`。
- Schema 区可见 `world-engine/schema.yaml` 与 `world-engine/calendar.yaml`。
- 两个 link 均使用 `_blank` 打开主 IDE deep link：

```text
http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2&openPath=world-engine%2Fschema.yaml
http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2&openPath=world-engine%2Fcalendar.yaml
```

### Preview link targets consumed by main IDE

直接打开 Preview 生成的 schema link：

- 主 IDE 打开 `world-engine/schema.yaml`。
- 正文可见 `subjectTypes:`。
- URL 清理后不包含 `openPath`。

直接打开 Preview 生成的 calendar link：

- 主 IDE 打开 `world-engine/calendar.yaml`。
- 正文可见 `secondsPerMinute`。
- URL 清理后不包含 `openPath`。

说明：最初用 `examples:` 作为 calendar 内容哨兵不匹配当前真实文件；复核真实 `calendar.yaml` 后改用 `secondsPerMinute` 确认通过。

## Verification

- 浏览器只读验收通过。
- 未运行单元测试，本轮无代码变更。
- 临时 Nuxt dev server 已关闭，确认 `port 3001 free`。

## Result

World Engine 的“设置 subject schema / calendar”入口已经形成闭环：

- Preview 可以把作者送到主 IDE 文件。
- 主 IDE Workbench 左栏 schema chip 可以打开同一真相源文件。
- 主 IDE 会消费 `openPath` 并清理 URL，避免刷新或后续路由误重复打开。

这解决的是新 Project 或真实 Project 里作者第一步配置 schema/calendar 时的入口可达性，而不是 schema 编辑器本身。
