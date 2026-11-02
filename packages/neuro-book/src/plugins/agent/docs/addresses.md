# 资源地址

文件工具按资源地址读写，写成 `方案://路径`。路径用 `/` 分隔，不能含 `.`、`..` 或空段。

## 当前这一个

| 地址 | 指向 | 可写 |
|---|---|---|
| `project://` | 本会话所在的书（没有时不可用） | 可写，算作品内容，写入通常要用户批准 |
| `session://` | 本会话的工作区：计划、草稿、脚本 | 可写；`session://attachments/` 是用户上传的附件，`session://artifacts/` 是工具大结果的全文，都只读 |
| `profile://` | 本 Profile 的笔记，跨书保存 | 可写 |
| `tmp://` | 本会话的临时文件，服务端重启后可能被清掉 | 可写 |

工具结果里出现的是完整地址，例如 `sessions://<会话 id>/home/plan.md`，与对应的 `session://plan.md` 是同一个文件。

## 目录

| 地址 | 内容 |
|---|---|
| `projects://` | 已登记的书，`projects://<短名>/…` 读写别的书 |
| `sessions://` | 最近的会话；`sessions://<会话 id>/session.jsonl` 是只读的对话日志，`home/` 是它的工作区（别的会话的只读） |
| `profiles://` | 各 Profile 的笔记（别的 Profile 的只读） |
| `docs://` | 产品文档，只读；插件 SDK 在 `docs://builtin/sdk/` |
| `skills://` | Skill 目录 |
| `user://` | 用户的跨书资产：`AGENTS.md`、`profiles/`、`skills/`；写入要先问用户 |

读一个目录本身（例如 `docs://`）得到它的说明与条目列表。
