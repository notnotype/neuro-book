# ADR 0018：Session 身份与浏览器记忆

- 状态：Accepted
- 日期：2026-08-05
- 关联任务：[Task 118](../../.agents/tasks/118-project-catalog-snapshot-path-integration/README.md)
- 关联 Issue：[Issue #26](https://github.com/notnotype/neuro-book/issues/26)

## 背景

`sessionId` 只是一个 State Root 内的数字定位符。用户在同一个浏览器 origin 上先后打开两个 State Root 时，两个实例可能合法地拥有同一个数字 ID；浏览器保存的裸数字无法证明它仍然指向原来的对话。继续把这个数字当作可信身份，会把旧实例的请求误发给新实例，或者把新实例的对话误显示成旧对话。

Session 的 JSONL 文件还需要兼容已经存在的 header。不能为了补身份而复制历史文件、引入备份恢复流程或建立全局实例注册表。

## 决策

1. 每个新 Session 在 header 中生成 UUID 形式的不可变 `sessionIdentity`。
2. 没有身份字段的现有 header 使用 header 元数据的稳定 SHA-256 派生身份；读取时不改写历史 JSONL。请求的数字 ID 必须同时匹配文件名和 header，否则拒绝读取。
3. Agent Session 列表、recovery、关系投影和 SSE 所消费的公开 summary 都携带 `sessionIdentity`。浏览器记忆使用版本化 `{schema: 2, sessionId, sessionIdentity}`；裸数字、损坏 JSON 或缺少 identity 均进入未选择状态。
4. 浏览器记忆只用于启动时尝试恢复，不是 Session 存在性或 owner 证明。权威 recovery 成功提交后才写记忆；`localStorage` 写入失败不回滚已打开的对话，也不删除旧值。
5. 404 的主 Session 缺失只刷新当前 State Root 的列表并执行一次有界恢复；只有数字 ID 与 identity 都匹配时才清理失效记忆。关联 Session 缺失只投影为局部不可用并返回 409，主对话继续可读。
6. 不在本 ADR 建立 State Root 实例身份协议。两个 State Root 恰好复用同一个数字 ID 时，缺少可信 identity 的旧记忆必须进入未选择态，而不是猜测、自动切换或自动创建。

## 原因

UUID 让新文件拥有直接生成的稳定身份，SHA-256 派生值让旧文件可以在不迁移数据的前提下获得同样的比较语义。把 identity 和数字定位符一起保存，能在浏览器记忆与当前实例不一致时 fail closed，同时不需要把绝对路径、State Root 名称或用户正文暴露给客户端。

关联关系与主 Session 的生命周期不同。把缺失关联目标投影成计数而不是让整个 recovery 失败，能保留用户正在看的对话；损坏文件、权限错误和非目标路径的缺失仍然抛出，避免把真实数据错误伪装成“关联对话不可用”。

## 后果

- 旧浏览器记忆不会自动选择一个可能同号但不同身份的对话，用户需要从当前实例的列表选择一次。
- 旧 JSONL 不需要立即重写，identity 计算是读取时的纯投影；新文件从创建起具备显式 UUID。
- 不同 State Root 的同号 Session 仍可能存在，但不会由本地记忆协议推断它们是同一个对话。真正的实例隔离需要后续独立协议。
- 关系面板可能显示“关联对话不可用”的局部提示；主对话和其它错误语义保持不变。

## 未采用方案

- 用数字 `sessionId` 单独作为浏览器记忆：无法区分同 origin 的不同 State Root。
- 把 State Root 路径或实例名称写进 localStorage：路径不是稳定公开身份，也会泄露本地布局。
- 发现同号 Session 后自动选择列表首项、复制历史或恢复备份：会把不确定性变成静默数据串线。
- 为此次修复建立全局 Session 注册表或跨实例锁：复杂度和生命周期都超出当前本地优先应用的实际边界。
