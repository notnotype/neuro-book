# nb-history

`@notnotype/nb-history` 为多人和多 Agent 共享的文件工作区提供 append-only 操作日志与内容寻址快照：文件时间线、误删恢复、用户审查收件箱和会话未见变更。

## 快速上手

```ts
import {WorkspaceHistory} from "@notnotype/nb-history";

const history = await WorkspaceHistory.open({
  databasePath: "/path/to/.nbook/history.sqlite",
  resolvePath: (path) => `/path/to/workspace/${path}`,
});
await history.performWrite({kind: "agent", sessionId: "s1"}, "manuscript/ch1.md", "正文…");
const inbox = await history.inbox("u1");
await history.close();
```

模块拥有 SQLite 历史库，但路径策略、监听、UI、提醒和保留策略由宿主注入。历史库包含全文快照，不应进入可分享日志或诊断包。API 和限制见[项目 README](https://github.com/notnotype/neuro-book/blob/master/packages/nb-history/README.md)。
