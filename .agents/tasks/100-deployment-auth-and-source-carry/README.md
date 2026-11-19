# 100 - 部署鉴权引导与源码携带

## 用户需求

1. Windows Product Portable 默认关闭密码保护，引导用户主动创建密码。
2. 当时的旧GitHub包部署入口引导用户选择是否开启鉴权；该入口现已由Manager取代。
3. 在 ssh 测试主机上验证 Docker 部署方式的可行性（已有部署：`/home/<user>/composes/neuro-book`）。
4. 所有部署方式携带完整源码（不 install）；后续小问题可以让 Agent 在部署机上安装依赖并重新构建。

## 变更

### 1. Windows Portable 密码保护默认关闭

- `scripts/deploy/windows-portable/launcher/launcher.mjs`
  - 独立 Boot Config 纯函数模块初始生成 `auth.enabled: false`，并随 Launcher 一起打包。
  - `ensureAdminUser()`：鉴权关闭时不再强制创建管理员，改为提示"运行 Create Admin.cmd 可开启密码保护"；鉴权开启且无用户时仍强制创建（避免锁死）。
  - `createAdmin()`（Create Admin 命令）：创建成功后自动把 `auth.enabled` 翻回 `true`。
  - `readAuthEnabled()` / `writeAuthEnabled()` 严格解析 Boot Config；损坏 YAML 或非法字段直接报错，不再伪装成默认开启继续执行。
- 已有 portable 安装（config 里 `enabled: true`）行为不变。

### 2. 旧部署CLI鉴权引导

- 当时的旧部署脚本：新增 `--auth <enabled|disabled>`（env `NEURO_BOOK_AUTH`）；部署完成后按选择输出"创建管理员命令"或"如何再开启"提示。该脚本现已删除。
- `scripts/deploy/shared.mjs`：
  - `readConfig()` 交互询问「密码保护（全站登录）」，initialValue 读取部署目录已有 Boot Config；非交互默认开启。
  - `config.authExplicit`（交互确认或 `--auth` 传参）为真时，redeploy 会更新已有 `config.yaml` 的 `auth.enabled`，其余字段不动；非显式选择保持原值。
  - `adminCommand()` 导出供部署入口复用。
- `scripts/deploy/config-render.mjs`：Boot Config 鉴权读取/更新收敛为纯函数；Global Config 渲染结果不再包含 auth。

### 3. 测试主机 Docker 部署验证

- 现有 source 模式部署：容器 `neuro-book-app-1` 运行 10 天，HTTP 302 正常，版本 v0.4.2-canary（落后本地 v0.5.7 约 20 个 canary）。
- 全新ghcr部署端到端验证通过：测试主机上使用当时的旧部署CLI选择`v0.5.7-canary...`和端口3002，clone → 写部署文件 → pull镜像 → 容器启动 → migration/profiles正常。验证后已清理（compose down + 删目录 + 删镜像）。
- **发现并修复 bug**：`docker-compose.yml` 端口映射 `${NUXT_PORT:-3000}:3000`，但容器内按 Boot Config 监听 `NUXT_PORT`；非 3000 端口部署宿主机完全不通。修复为 `${NUXT_PORT:-3000}:${NUXT_PORT:-3000}`，已在测试主机部署上实测生效。
- 阻塞项：现有部署的 `.output` 为 root 属主，`scripts/deploy/deploy.mjs` 同步更新需要 sudo；测试主机的 sudo 密码环境变量在本地与远端均未找到，本次未更新旧部署。

### 4. 部署产物携带源码

- `scripts/deploy/product-runtime.mjs`：`product:stage` 新增 `stageSourceSnapshot()`，把 `git ls-files` 快照复制到 `product/source/`（本次 2300 文件，约 39MB）；worktree 中已删除但未 `git rm` 的 index 条目按 worktree 实际内容跳过并告警。
- Windows portable zip 经 `app/` 自动携带 `app/source/`（zip 实测 2300 文件，总包 326MB）；Product Bun 同样受益。
- `Dockerfile` runner 阶段补齐 `world-engine/`、`plugins/`、`datasets/`、`uno.config.ts`、`vitest.config.ts` 和 4 个 `.d.ts` shim——此前镜像缺这些文件，无法在容器内重新构建（已在 v0.5.7 镜像中实测确认缺失）。
- local-git / source 模式本身是完整 checkout，无需改动。

## 文档同步

- `docs/deployment.md`：发布模型 source/ 说明、Portable 首启流程、目录边界、GHCR 源码携带、管理员与鉴权章节重写。
- `README.md` / `README.en.md`：快速开始段落。
- `scripts/deploy/windows-portable/launcher/README-Windows.md`：默认免密说明 + `app/source/` 边界。

## 验证结果

- 旧部署CLI dry-run：默认开启鉴权 + 管理员提示；`--auth disabled`输出关闭提示；`--auth bogus`报错。该入口现已删除。
- `bun run product:stage` 全流程通过（含 tsx/sqlite-vec vendor 断言）。
- `bun run package:windows-portable --skip-git-check` 打包通过，zip 内含 `app/source/`（含 `package.json`、`app/` 前端源码）。
- 测试主机 ghcr 全新部署 + 端口修复实测通过。

### Boot Config 鉴权迁移收口

- 管理员 API 统一调用 `requireAdminAccess()`，避免新路由遗漏“鉴权关闭时本地放行”的契约。
- 管理员测试改为显式 mock Boot Config，不再依赖开发机 `config.yaml` 或 `NODE_ENV`。
- 普通部署和 Portable 分别使用所在运行边界内的 Boot Config 纯函数；更新 auth 保留其余字段，值不变时不重写，非法配置明确失败。
- 配置中心 Boot Config 页面显示当前进程实际鉴权状态，并把 YAML 标成只读示例；仍不提供热更新或写入 API。
- README、Portable README 和部署文档统一补充“创建管理员后重启生效”。
- 聚焦验证：管理员守卫、部署/Portable Boot Config、设置 UI 契约等 7 个测试文件 36 个用例通过；`server/config/config-service.test.ts` 隔离运行 39 个用例通过；`bun run typecheck` 与四个部署/Launcher 模块的 Node 语法检查通过。
- 组合并跑时 `config-service.test.ts` 仍可能触发既有 Windows Project SQLite `SQLITE_BUSY/EBUSY` 文件占用；隔离重跑全绿，未修改业务代码或增加重试掩盖该基线问题。

## 后续 TODO

- 等测试主机的 sudo 密码环境变量可用后同步测试主机旧部署到最新版（`bun run deploy`，需 sudo）。
- ghcr 容器以 root 运行，会把 root 属主文件写进宿主机 `workspace/`；宿主机普通用户删不掉，可考虑 ghcr compose override 也加 `user: "${HOST_UID}:${HOST_GID}"`。
