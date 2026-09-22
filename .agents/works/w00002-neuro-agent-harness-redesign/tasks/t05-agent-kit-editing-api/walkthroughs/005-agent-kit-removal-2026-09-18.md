# agent-kit 删除执行记录（2026-09-18）

开发者指令：「删掉 agent-kit。全面转向 bun。」（同时确认：SSE 归入 NeuroAgentHarness；传输/订阅复用 OMP）。

## 执行内容

| 项 | 动作 | 证据 |
| --- | --- | --- |
| `packages/agent-kit/` | 整包删除（先归档） | 目录已不存在；归档见下 |
| 根 `package.json` | 移除 workspaces 条目 `"packages/agent-kit"` | 复查 grep 无残留 |
| `scripts/ci/workspace-package-matrix.ts` | 移除 agent-kit 矩阵条目 | 模拟选择复核：`packages/llmlint/src/a.ts` → 选 llmlint；`packages/agent-kit/src/a.ts` → 矩阵中不再出现 agent-kit |
| `.github/workflows/code-baseline.yml` | 移除 1 行路径过滤 | — |
| `.github/workflows/product-platforms.yml` | 移除 2 行路径过滤 | — |
| `.github/workflows/workspace-packages.yml` | 移除 1 行路径过滤 | — |
| `docs/specs/agent-kit/{editing,resources}.md` | 删除（能力合同随实现作废） | — |
| `docs/specs/README.md` | 移除两行注册表条目 | — |
| `bun.lock` | `bun install` 刷新（`3 packages installed / Removed: 1`） | 命令输出 |

## 归档（删除不可逆的缓解）

`packages/agent-kit` 从未提交（无 git 历史），删除即永久丢失。执行前整包复制到
`%TEMP%/nb-agent-kit-archive-2026-09-18`（**55 个文件 / 564 KB**，含 `src/`、`docs/specs/`、测试与 `AGENTS.md`）。
若将来需要把严格语义合同测试用作对 `@oh-my-pi/hashline` 的黑盒对拍，可从该归档取用；不再需要时可直接删除该临时目录。

## 执行中的插曲

首次删除失败（`WinError 32`：目录被占用）。定位到占用者是本会话早前 `vitest run --config packages/agent-kit/...` 遗留的 `node.exe` 进程（PID 42488，命令行含 agent-kit）；终止该进程后目录删除成功。教训：Windows 下删除包目录前先确认没有遗留测试进程持有句柄。

## 门禁

```
bun install                              → 3 packages installed / Removed: 1
bun scripts/ci/workspace-package-matrix.ts（模拟变更）→ 矩阵输出正常，无 agent-kit
bun run docs:check                       → {"failures":[],"checkedFiles":5471}（较删除前 5524 减少）
bun run governance:check                 → 仅两项既有无关失败（w00003 缺 README、根 AGENTS.md 标记）
```

## 未做（需后续任务）

- `packages/neuro-agent-harness` 重新基于 OMP 包族（改 `engines` 为 bun、引入 pi-agent-core/pi-ai/pi-catalog/hashline 等依赖、SSE 收编）尚未开始，属新的实施切片。
- 产品侧（#117）的 `server/models/*`、`server/agent/tools/*` 与 `@earendil-works/pi-ai@0.80.6` 集成是否改挂 OMP 包族，超出本 Task 范围。
