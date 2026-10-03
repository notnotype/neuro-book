# Round 409: Project Delete EBUSY Retry Window

## 背景

Round 408 浏览器验收的业务链路已经通过，但清理临时 Project 时观察到一次 Windows `EBUSY`：

```text
EBUSY: resource busy or locked, unlink ...
```

等待片刻后重试同一个 `DELETE /api/projects/item?projectPath=...` 成功，目录不存在。这说明 Round 404 的 Project 级 client 释放方向是对的，但 `fs.rm()` 当前重试窗口偏短，Windows 文件句柄释放稍慢时仍可能把删除体验暴露成 500。

## 实现

调整 `deleteProjectWorkspace()` 删除 Project 根目录时的 `fs.rm()` retry 参数：

- `maxRetries: 5 -> 20`
- `retryDelay: 100 -> 500`

这不改变删除语义，也不新增静默吞错；如果长窗口后仍失败，API 仍会暴露真实错误。

## 验证

```bash
bunx vitest run server/workspace-files/project-workspace-delete.test.ts
```

结果：

```text
1 file passed
3 tests passed
```

该测试覆盖删除前关闭 plot Prisma、World Engine Prisma、Agent SQL client 和 workspace watcher，以及删除后归档 Agent session 的主路径。

## 与计划出入

- 本轮原本从作者流审查开始，最后选择修清理体验里的真实 Windows 抖动。
- 没有重新做浏览器验收；Round 408 已证明 `world` bootstrap 业务路径可用，本轮只调整删除重试窗口。

## 后续

- 如果后续仍出现 Project delete `EBUSY`，应继续定位是否还有新的 Project 级句柄未接入 `deleteProjectWorkspace()` 的释放序列，而不是继续无限扩大 retry。
