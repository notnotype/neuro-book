# NeuroBook 交付与运维桥梁

::: tip 这一页可以直接交给 AI
本页是写给**协助你部署或排障的 AI Agent** 看的操作手册：命令、判据、失败处理一应俱全，措辞是给机器执行的。

**两种用法**：遇到部署问题时把这一页的链接或全文发给你在用的 AI，让它按这套流程帮你排查；或者你自己当作运维速查表读。日常安装看 [快速开始](/quick-start)，日常运维看 [运行、数据与隐私](/operations)。
:::

本文件面向协助部署或排障的 Agent。当前部署真相源是独立 `@notnotype/neuro-book-manager`，不要再调用已删除的旧部署入口、`local-git` 模式、`Dockerfile.source-runtime` 或旧 Windows Launcher。

## 先收集的信息

开始操作前确认：

1. 操作系统、架构和 Linux libc。
2. 目标 Profile：`windows-portable`、`ghcr`、`product-bun`、`source-dev`、`source-product` 或 `source-docker`。
3. Installation Root 的绝对路径。
4. stable/canary channel、指定版本和端口。
5. 是否已有 `.deploy/installation.json`。
6. Git Profile 是否有 dirty/untracked 文件。
7. Product 或 Docker 服务是否仍在运行。

不要为了继续更新而自动执行 `git restore`、`git stash`、`git reset`、删除未知文件或终止用户进程。

## 核心目录合同

Installation Root 是源码与可替换组件的统一根：

```text
<root>/
├─ Git tracked source
├─ .output/                         # Product
├─ .runtime/
│  ├─ manager/<version>/
│  ├─ bun/<version>/
│  ├─ tools/<name>/<version>/
│  └─ bin/                          # 稳定 wrapper
├─ .deploy/
│  ├─ installation.json
│  ├─ install.lock
│  ├─ staging/
│  ├─ backups/
│  └─ docker-compose.generated.yml
└─ State Root files
```

State Root 默认等于 Installation Root。Windows Portable 的 State Root 是 `<root>/data`，包含 `workspace/`、`config.yaml`、`.env` 和 `logs/`。应用进程通过 `NEURO_BOOK_STATE_ROOT` 解析这些路径；公开 Project Path 仍是 `workspace/<project>`。

Source、Product、Runtime、Tool、Deployment State 和 User State 有独立所有权。更新只能替换目标组件拥有的路径。

## 标准入口

Windows普通用户优先下载完整Release中的`neuro-book-windows-x64.zip`；不要把Source archive或Windows Product overlay当成Portable。Windows高级部署与所有Linux部署统一通过Manager。

已有 Bun：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr
```

Canary 使用 `@canary`。没有 Bun 时，Stage 0 会把固定 Bun 放入用户 cache 并校验 SHA256，再调用同一个 Manager。Stage 0 不应把临时 Bun 写入目标 Installation Root。

```powershell
irm https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh
```

完整Release同时附带`install.ps1`、`install.cmd`和`install.sh`并纳入`SHA256SUMS`。Linux Stage 0仅支持x64 glibc，并要求`curl`、`unzip`和`sha256sum`。

不要生成或建议`bunx run @notnotype/neuro-book-manager`。`bunx run`会把包名当作本地脚本或路径，无法启动Manager。stable和正确npm `latest`建立前，所有canary操作显式使用`@canary`。

Release只有在正式`release-manifest.json`公开后才算装配完成。候选资产只存在于Actions artifact期间不可安装；构建中、验证失败或取消的Release应由Resolver安全跳过。

安装后的稳定入口：

```powershell
.\.runtime\bin\neuro-book.cmd status --json
```

```bash
./.runtime/bin/neuro-book status --json
```

面向真人可以省略子命令：Manager会离线检测当前目录，在受管实例、损坏Manifest、未接管Git checkout、Portable State和普通目录之间切换菜单。Agent和CI应继续显式使用`install`、`adopt`、`instances inspect/discover/import`和`--yes`。Import的`--yes`只接受运行状态warning，不能绕过checksum、wrapper或Operation blocker。

## Profile 语义

### windows-portable

- Release zip 解压目录就是 Installation Root，没有 `app/` 子 Product Root。
- 根目录包含完整 Source、`.output`、`.runtime`、`.deploy` 和启动脚本。
- `.runtime` 内置 Bun、rg、PortableGit/bash 和版本化 Manager。
- `data/` 是唯一需要跨重新解压保留的用户状态目录。
- `Start/Update/Create Admin` 只是 Manager 的平台前端，不维护第二套更新协议。
- CMD 与 PowerShell Launcher 都只调用绑定自身 Installation Root 的 `.runtime\\bin\\neuro-book.cmd`，Launcher 本身不包含 `--root`；稳定 wrapper 负责注入绑定 root。Start/Update/Create Admin 只传递 `start`、`update`、`admin create` 并透传 Manager 退出码；不要向 Launcher 增加 migration、更新或 Runtime 切换逻辑。

### ghcr

- 宿主机不 clone NeuroBook 源码。
- `.deploy/docker-compose.generated.yml` 引用 Release Manifest 中的 `image@sha256:digest`。
- 镜像 `/app` 包含完整源码和 `.output`。
- Runtime/Tool provider 是 `container`。
- State Root 的 Workspace Root、Boot Config 和日志通过 volume 持久化。

### product-bun

- 下载同版本 Source archive 与当前平台 Product overlay。
- Product 的 `sourceRevision` 必须与 Release Source revision 一致。
- 根源码不要求安装依赖；运行入口只依赖 `.output` 的 vendor/runtime。
- Bun 可以是 `system`，也可以由 Stage 0/Manager 安装为 `managed`。

### source-dev / source-product

- Source provider 是 Git。
- 物化流程使用 `git init`、`remote add`、`fetch`、`switch`，支持已有 checkout。
- `source-dev` 安装依赖后运行 dev server。
- `source-product` 在 `.deploy/staging` 构建并原子切换根 `.output`。
- dirty、未知文件和非 fast-forward 必须停止并报告。

### source-docker

- Git 源码是 build context。
- 完整 Dockerfile 在容器内安装依赖、构建 Nuxt 并生成 runner。
- 不存在宿主 Bun build + runtime container 挂载 `.output` 的旧混合流程。

## 状态与诊断

优先收集：

```bash
neuro-book status --json
neuro-book doctor --json
neuro-book runtime list
neuro-book tools list
```

然后读取 `.deploy/installation.json`。关注：

- `profile`、`managerVersion`、`appVersion`、`channel`、`sourceRevision`。
- `stateRoot` 是否与 Profile 一致。
- Source/Product revision 是否匹配。
- 每个组件的 provider、version、platform、path、checksum。
- managed 组件的官方 `sourceUrl`、`license` 和 `redistribution`。

解释doctor时区分“安装完整性”和“服务状态”：服务正常停止只应出现warning并保持`healthy=true`；运行中的服务若镜像、端口、HTTP或版本不匹配才是fail。Docker Profile还要比较Compose配置镜像、容器实际镜像和Manifest固定digest/revision tag。不要为了让doctor变绿而手工改Manifest或放宽检查。

`installation.json` 是严格 schema，不要手工加入任意字段。如果状态与文件系统不一致，先报告，不要直接伪造 manifest。

## 更新流程

默认更新当前 Profile 的应用组件，不更新 Manager 自身：

```bash
neuro-book update
neuro-book runtime update bun
neuro-book tools update rg
```

更新应满足：

1. 获取 `.deploy/install.lock`。
2. 下载或 build 到 `.deploy/staging/<operation>`。
3. 校验 SHA256、Release Manifest、platform、version 和 source revision。
4. 检查 Git dirty、运行状态和 Windows 文件占用。
5. 备份本次组件拥有的路径。
6. 原子切换。
7. 执行 migration 和最小健康检查。
8. 最后写入 `installation.json`。
9. 失败时恢复旧 Source/Product。

Manager 或 Bun 正在运行时不得覆盖当前文件。它们使用版本目录；稳定 wrapper 在下一次进程启动时切换目标。

## Runtime 与工具

```bash
neuro-book runtime install bun --version <version>
neuro-book runtime update bun
neuro-book tools install rg
neuro-book tools install git
neuro-book tools update
neuro-book tools path rg
```

- Windows/Linux x64 支持 managed Bun 和 rg。
- Windows x64 支持 managed PortableGit，Git 与真正的 `bash.exe` 来自同一受审计发行包。
- Linux/macOS Git 与 bash 使用 system/package manager。
- Python v1 只检测并给安装建议，不托管下载。
- Manager 只改变子进程 PATH，不改变系统 PATH。

版本目录视为不可变。已经存在的相同版本应复用并刷新 wrapper，不应先删除当前可用版本再联网下载。

## 管理员与鉴权

```bash
neuro-book admin create admin
```

Windows Portable 可运行根 `Create Admin.cmd`。Boot Config 位于 State Root `config.yaml`；Product Env 位于 State Root `.env`。不要把密码写入命令、日志、安装 manifest 或文档。

## Docker 排障

生成文件是 `.deploy/docker-compose.generated.yml`。常用只读检查：

```bash
docker compose --env-file .env -f .deploy/docker-compose.generated.yml config
docker compose --env-file .env -f .deploy/docker-compose.generated.yml ps
docker compose --env-file .env -f .deploy/docker-compose.generated.yml logs --tail 200 app
```

Windows Portable 的 `.env` 在 `data/`；Docker Profile 默认在 Installation Root。GHCR 应看到 digest 固定镜像；Source Docker 应看到根 Dockerfile build context，而不是已删除的 source runtime Dockerfile。

## Git 排障

允许的只读检查：

```bash
git status --short --branch
git remote -v
git rev-parse HEAD
git rev-parse origin/master
git merge-base HEAD origin/master
```

如果 worktree dirty、HEAD 不能 fast-forward、remote 不正确或目标目录含未知文件，停止并让用户决定。不要自动修复用户 Git 状态。

## Release 合同

应用 Release 必须同时提供：

```text
release-manifest.json
SHA256SUMS
neuro-book-source.zip
neuro-book-product-windows-x64.zip
neuro-book-product-linux-x64-glibc.tar.gz
neuro-book-windows-x64.zip
ghcr.io/notnotype/neuro-book:<tag>
```

Source archive 只含 Git tracked 文件；Product overlay 只含 `.output` 与组件 metadata；Windows Portable 是 Source + Windows Product + managed Runtime/Tool + Manager。Release Manifest 的 `minManagerVersion` 必须已发布到 npm 对应 channel。

Manager 使用独立 `manager-v*` tag。stable 发布 npm `latest`，先行版发布 `canary`。不要假设 Manager、应用、GHCR tag 或 Bun 版本相同。

## 验收边界

推荐顺序：CLI status/doctor、migration、HTTP smoke、数据路径检查、更新保留检查。不要自动启动浏览器；CLI/HTTP smoke 通过后，建议用户手动验证首次启动、登录、项目数据保留和更新提示。
