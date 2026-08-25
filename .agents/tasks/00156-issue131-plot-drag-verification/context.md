# 任务上下文

生成时间：2026-08-25T05:00:08Z（Leader，计划批准后快照）

## 基线快照

- 验证 revision：`HEAD=557d721e49aaa494b16df5110fd872145ea7582b`（`origin/master` 同步）。
- 修复来源：`8cd7d7fa`（PR #164 合入）；`27c6c719..557d721e` 仅新增 CI 提交 `#168`，不触及应用代码。
- 主 checkout 未提交改动：`.agents/skills/report/SKILL.md`、`.omp/RULES.md`、`AGENTS.md` 为开发者已有工作，本轮不读改不还原。
- 无分支/worktree：纯验证任务在主 checkout 执行。

## 隔离运行环境

| 参数 | 值 |
| --- | --- |
| 系统临时根 | `C:/Users/NOTNOT~1/AppData/Local/Temp/nbook-i131-OathtPSy` |
| State Root | `<临时根>/state` |
| Cache Root | `<临时根>/cache`（含 vite cacheDir 隔离） |
| 端口 | 3157（占用则顺延 3167/3177） |
| 启动命令 | `bun --cwd packages/neuro-book run dev`，env `PORT/NUXT_PORT/NITRO_PORT=3157` + 双根变量 |
| 鉴权 | dev 模式默认关闭（临时根无 config.yaml），浏览器免登录 |

用户真实 State Root 全程不读写。

## Fixture 计划

1. `POST /api/projects` `{title: "I131 拖拽验证"}` → 取 `project.projectRoot`。
2. `POST /api/projects/open` 打开项目（plot API 要求 active ready project；字段名以 `server/api/projects/project-control-plane.ts` 的 requireProjectRefBody 为准）。
3. `POST /api/projects/plot/threads?…` 创建 1 条 Thread；`POST /api/projects/plot/scenes` 创建场景一/二/三。
4. `GET /api/projects/plot/tree?…` 自检 1 线 3 场。

不使用 seed 脚本（heroes-story 仅产 World Engine 切片）。

## 验收矩阵与终态规则

见 [README.md](README.md)「验收矩阵」。终态规则：三路径全绿 → `completed`；任一路径红态或 TSX Profile 编辑器不可达 → 保持 `blocked`，不得 completed。

## 已知风险

- headless 拖拽依赖 dnd-kit pointer sensor 对合成事件的响应；若合成事件无法触发排序，先核对 handle 定位与事件序列，仍失败时按红态处理并记录证据，不改代码。
- 首次 dev 启动需预热依赖优化，ready 超时适当放宽。
