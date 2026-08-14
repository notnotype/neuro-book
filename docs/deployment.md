# 部署方式

NeuroBook 的所有安装形式由独立包 `@notnotype/neuro-book-manager` 管理，公开命令为 `neuro-book`。旧部署入口、`local-git` 和宿主 build + runtime container 的混合模式已删除。

## 推荐顺序

先按这张表选，选完再看下面各 Profile 的细节。

| Profile | 选它当且仅当 | 前置要求 | 本机构建 | 不适合 |
| --- | --- | --- | --- | --- |
| `windows-portable` | Windows 用户，想解压即用 | 无 | 否 | 非 Windows；需要多实例 |
| `ghcr` | Linux/macOS 服务器部署 | Docker 或 Podman + Compose | 否，拉固定 digest 镜像 | 无容器环境；需要改源码 |
| `product-bun` | 不想用容器，机器已有 Bun | Bun | 否，下载预构建 `.output` | 需要改源码 |
| `source-dev` | 开发 NeuroBook 本身 | Git + Bun | dev server | 生产环境 |
| `source-product` | 需要从自己的源码构建生产版 | Git + Bun + **构建内存（建议 2G+）** | **是**，本机跑 Nuxt build | 低配 VPS |
| `source-docker` | 需要从源码构建镜像 | Git + Docker/Podman | **是**，容器内构建 | 低配 VPS；不改源码时没必要 |

选择要点：

- **只有 `source-*` 会在你的机器上构建**，`ghcr` / `product-bun` / `windows-portable` 都是下载现成产物。低配机器不要选 source-product / source-docker。
- **`ghcr` 是服务器首选**。除非你要改源码、跑在非官方架构上、或者内网访问不了 GHCR，否则不需要 `source-docker`。
- **迁移**：所有 Profile 的数据都在 State Root 里，换 Profile 或换机器就是搬这个目录，见 [运行、数据与隐私](/operations#你的数据在哪)。
- **停止服务和开机自启**不由 Manager 负责，部署前先看 [运行与停止](/operations#服务运行与停止)。

各 Profile 的组件来源：

| Profile | Source | Product | Runtime / Tool |
| --- | --- | --- | --- |
| `windows-portable` | Release 源码 | Windows `.output` | 托管 Bun、rg、PortableGit/bash |
| `ghcr` | 镜像 `/app` | 镜像 `.output` | container |
| `product-bun` | Release 源码 | 平台 `.output` | system Bun/Tool |
| `source-dev` | Git | 无 | system Bun/Tool |
| `source-product` | Git | 本机 staging build | system Bun/Tool |
| `source-docker` | Git build context | 容器内 build | container |

正式平台为Windows x64、Linux x64/AArch64 glibc和macOS x64/ARM64。Windows ARM64、Linux musl和其他架构明确拒绝，不会回退到x64资产。

## 用户入口

- Windows普通用户从完整GitHub Release下载准确文件名`neuro-book-windows-x64.zip`，解压后运行`Start Neuro Book.cmd`。Source archive与Product overlay不是可直接启动的Portable。
- Windows高级用户通过Manager部署多实例、Docker、Product Bun或Source Profile；没有Bun时使用PowerShell Stage 0。
- Linux/macOS所有本机、服务器和开发部署统一从Manager进入；有Docker/Podman时默认推荐`ghcr`，没有容器engine时选择`product-bun`或对应Source Profile。

## Stage 0

机器已经安装 Bun 时，可以直接运行：

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

不传参数会进入 Clack 安装向导，逐步解释并选择 Profile、Installation Root、实例名称、更新通道、端口和鉴权。CI 或自动化部署使用显式命令：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --yes
```

Canary Manager 使用 `@canary`。没有 Bun 时，使用仓库提供的平台 Stage 0：

不要使用`bunx run @notnotype/neuro-book-manager`；该命令会让Bun把包名按本地脚本或路径解析，Manager不会启动。稳定Manager和正确npm `latest`建立前，公开文档继续使用`@canary`。

```powershell
irm https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh
```

POSIX Stage 0支持Linux x64/AArch64 glibc和macOS x64/ARM64，并依赖`curl`与`unzip`。Linux使用`sha256sum`并验证glibc，macOS使用系统`shasum -a 256`。无参数管道执行会尝试从`/dev/tty`恢复Manager交互输入；没有TTY时在下载前失败，自动化应使用：

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh -s -- --profile ghcr --yes
```

Stage 0把固定版本Bun下载到用户cache，解压后再次校验executable SHA256、版本和执行位，清理临时目录后才调用Manager `@canary`；它不会先向Installation Root写`.runtime`。Windows Stage 0使用原生OS架构，Windows ARM64在下载前拒绝；缓存与首次解压使用同一executable checksum/version门禁。

每个完成装配的应用Release也独立发布`install.ps1`、`install.cmd`和`install.sh`，三者进入同一`SHA256SUMS`。raw GitHub命令适合快速安装；Release资产适合先审计脚本内容与校验值，再进行联网引导。它们不是离线应用安装包。

Manager只安装已经发布正式`release-manifest.json`的完整GitHub Release。候选资产在Actions内完成校验后才公开Manifest；仍在构建、验证失败或已取消的Release会被Resolver跳过。

## Installation Root 与 State Root

```text
neuro-book/
├─ Git tracked source
├─ .output/
├─ .runtime/
│  ├─ manager/<version>/
│  ├─ bun/<version>/
│  ├─ tools/<name>/<version>/
│  └─ bin/
├─ .deploy/
│  ├─ installation.json
│  ├─ install.lock
│  ├─ staging/
│  ├─ backups/
│  └─ docker-compose.generated.yml
├─ workspace/
├─ config.yaml
└─ .env
```

`NEURO_BOOK_STATE_ROOT` 决定用户状态物理根。未设置时等于 Installation Root；Windows Portable 设置为 `<root>/data`，因此物理文件位于 `data/workspace`、`data/config.yaml`、`data/.env` 和 `data/logs`。公开 Project Path 始终保持 `workspace/<project>`。

Release 更新只替换组件拥有的路径，不覆盖 State Root。

`neuro-book update`按当前Profile执行原子应用更新，不接受`--component`拆分Source/Product；同版本且Manager checksum一致时直接返回“已是最新版本”。Runtime与Tool分别使用`neuro-book runtime update bun`、`neuro-book tools update <rg|git>`。候选CI或审计可用`--release-manifest <本地路径或HTTPS URL>`，它与`--version`互斥，仍会校验channel、revision、平台、资产文件名和checksum。

## 常用命令

```text
neuro-book                              # 交互式安装向导
neuro-book manage                       # 多实例 TUI
neuro-book install --profile <profile> [--dir <path>] [--version <version> | --release-manifest <path-or-url>]
    [--channel <stable|canary>] [--port <port>]
    [--auth <enabled|disabled>] [--yes] [--dry-run [--json]]

neuro-book instances list [--json]
neuro-book instances add <path> [--name <name>] [--default]
neuro-book instances import <path> [--name <name>] [--default]
neuro-book instances inspect [path] [--json]
neuro-book instances discover [--root <path>...] [--json]
neuro-book instances roots list|add|remove
neuro-book adopt [path] --profile <source-dev|source-product|source-docker>
neuro-book instances forget <name-or-id>
neuro-book instances default <name-or-id>
neuro-book instances config

neuro-book update [--version <version> | --release-manifest <path-or-url>] [--dry-run]
neuro-book start
neuro-book status [--json]
neuro-book doctor [--json]
neuro-book uninstall --yes [--delete-data] [--json]

neuro-book runtime list
neuro-book runtime install bun [--version <version>]
neuro-book runtime update bun

neuro-book tools list
neuro-book tools install <rg|git>
neuro-book tools update [rg|git]
neuro-book tools path <rg|git>
neuro-book admin create [username]
```

`update/start/status/doctor/runtime/tools/admin/uninstall` 支持全局 `--root <path>` 或 `--instance <name-or-id>`。未显式指定时，Manager 优先使用当前目录所属实例；目录外执行时使用用户配置中的默认实例。

全局参数必须位于子命令前，例如`neuro-book --root <path> update`。应用或Runtime目标版本位于子命令后，例如`neuro-book install --version <app-version>`或`neuro-book runtime install bun --version <bun-version>`；裸`neuro-book --version`只输出Manager自身版本。

## 用户级 Manager 配置

Manager 配置默认位于 `~/.neuro-book-manager/config.json`。它只保存：

- 安装向导偏好，例如 channel 和上次安装目录。
- 已注册实例的名称、绝对 Installation Root 和默认实例。

配置不复制应用版本、组件 checksum、Runtime 或 Product 状态；这些信息仍只存在于实例的 `.deploy/installation.json`。配置可保存有限`discoveryRoots`，默认最多向下扫描3层并跳过依赖、构建和Manager目录，不递归整个磁盘。配置损坏或删除不会破坏实例，重新执行 `neuro-book instances import <path>` 即可恢复索引。

无参数入口会按当前目录切换管理、损坏实例处理、接管和部署菜单；非TTY只输出离线检测结果与下一步命令，不产生文件。Candidate Discovery不执行Bun/Docker等环境子进程，其他Git仓库不会进入候选。`instances import`校验Manifest、组件checksum、wrapper、Product、State Root和Operation，但服务或容器停机只产生warning。`adopt`只接受干净且remote/branch/upstream合法的NeuroBook Git checkout；三个Source Profile均先在系统临时目录的短路径detached worktree准备，避免Windows长路径并保证主checkout在提交前不变。

`status`是轻量运行状态，不重算所有大文件checksum；`doctor`才执行完整离线完整性和服务检查。正常停机的原生服务或容器返回warning但保持`healthy=true`，并给出`start`下一步。Docker/Compose缺失、Compose与Manifest镜像不一致、运行中容器实际镜像错误、HTTP不可达或版本错误均为fail。`start`在Docker `up -d`后等待版本接口，不把Compose退出码0当作应用已经可用。

`neuro-book manage` 的 blessed TUI 支持多实例查看、状态、诊断、启动、事务更新、注册、设为默认和忘记记录。安装、启动和更新等长操作会退出 TUI 后在正常终端中继续，避免子进程输出破坏界面。

安装完成后优先使用 Installation Root 下的稳定 wrapper：Windows 为 `.runtime\bin\neuro-book.cmd`，POSIX 为 `.runtime/bin/neuro-book`。Manager 只修改自己启动的子进程 PATH，不修改系统 PATH。

Install Preflight是Clack、`install --yes`与`install --dry-run --json`的共同门禁。一次报告包含原生/进程架构、Profile支持、Git、Docker/Podman、Compose、端口、Installation Root身份、Release完整性和组件来源；blocker禁止执行，warning在交互入口确认后继续。Manager拒绝Rosetta、Windows x64模拟和其他原生/进程架构不一致环境，不会把跨架构安装解释为update或repair。

Managed Bun、ripgrep和PortableGit的版本目录是不可变组件。统一Managed Asset Repository只复用当前有效Manifest能够证明archive/source URL、全部checksum、执行位和真实版本的目录；Fresh Install不会读取既有文件的当前checksum并重新认证。验证失败时整版本重建，所有受管资产完成后才刷新稳定wrapper。

## Windows Portable

从 GitHub Release 下载 `neuro-book-windows-x64.zip`，解压到新目录后**双击 `Start Neuro Book.cmd`** 启动。

如果要在 PowerShell 里启动，文件名含空格，必须用调用运算符加引号，否则 PowerShell 会把 `.\Start` 当成命令：

```powershell
& '.\Start Neuro Book.cmd'
```

包内已经包含源码、Windows Product、Bun、rg、PortableGit/bash 和 Manager。`Start Neuro Book.cmd`、`Update Neuro Book.cmd` 和 `Create Admin.cmd` 都只调用绑定自身 Installation Root 的 `.runtime\\bin\\neuro-book.cmd`；这些 Launcher 本身不包含 `--root`，由稳定 wrapper 注入绑定 root。Start 传递 `start`，Update 传递 `update`，Create Admin 传递 `admin create`，三者都透传 Manager 退出码。更新保留整个 `data/`。

旧版 `app/data/runtime/launcher` Portable 不承诺原地覆盖升级。首次迁移请重新解压新包，再把旧 `data/` 复制到新 Installation Root。

## GHCR

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile ghcr --dir /opt/neuro-book --port 3000 --yes
cd /opt/neuro-book
.runtime/bin/neuro-book start
```

Manager不clone宿主源码；它根据Release Manifest生成Compose，镜像使用`ref@sha256:digest`，并挂载State Root的Workspace Root、Boot Config和日志。首次安装验证Docker/Podman CLI、Compose和engine info后持久化选择；后续启动、更新、回滚、中断恢复、doctor和create-admin只使用该engine。create-admin直接使用`docker compose`与`podman compose`共同支持的`compose exec`，不依赖provider特有的`ps --status`。镜像`/app`内含完整源码和`.output`。

## Product Bun

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile product-bun --dir "$HOME/neuro-book" --yes
cd "$HOME/neuro-book"
.runtime/bin/neuro-book start
```

Manager 下载同一 Release 的 Source archive 和当前平台 Product overlay，并校验二者 `sourceRevision` 相同。运行只依赖 `.output` 中的 Product runtime，不依赖根 `node_modules`；根源码用于审计、Agent 协作和后续重建。

## Source Profile

开发运行：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-dev --dir "$HOME/neuro-book" --yes
```

本机生产构建：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-product --dir "$HOME/neuro-book" --yes
```

Manager 使用 `git init/fetch/switch` 物化仓库，支持空目录、只含 `.runtime/.deploy/data` 的目录和已有 checkout。dirty worktree、未知文件、非 fast-forward 都会停止；不会自动 restore、stash 或 reset。

`source-product` 先把 Nuxt build 写入 `.deploy/staging/<operation>/.output`，校验完成后才切换根 `.output`。构建失败时旧 Product 保持可运行。

## Source Docker

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-docker --dir /opt/neuro-book --yes
cd /opt/neuro-book
.runtime/bin/neuro-book start
```

Git 源码是 Docker build context。完整多阶段 Dockerfile 在容器内执行 `bun install --frozen-lockfile` 和 Nuxt build；宿主机不再先 build `.output` 再挂入 runtime 容器。

## 更新与回滚边界

更新顺序为：安装锁、staging 下载/build、checksum/manifest/platform 校验、运行状态检查、组件备份、切换、migration/最小检查、最后提交 `installation.json`。Release Source 与 Product 更新失败会恢复旧组件。

Manager v1 不接管 systemd、pm2 或通用后台进程。原生 Product 正在运行或 Windows 文件被占用时，更新会停止并要求用户先退出服务。Runtime 和 Manager 使用版本目录，wrapper 在下一次启动时指向新版本。

## Release 资产

每个应用 Release 包含：

```text
release-manifest.json
SHA256SUMS
neuro-book-source.zip
neuro-book-product-windows-x64.zip
neuro-book-product-linux-x64-glibc.tar.gz
neuro-book-product-linux-aarch64-glibc.tar.gz
neuro-book-product-darwin-x64.tar.gz
neuro-book-product-darwin-aarch64.tar.gz
neuro-book-windows-x64.zip
ghcr.io/notnotype/neuro-book:<tag>
```

Release Manifest v5记录统一build ID、应用版本、Git revision、channel、最低Manager版本、五平台资产URL/SHA256、Windows Portable资产、GHCR digest与Application State迁移声明。五个平台必须完整且唯一，Source、Product、Portable和Installation必须属于同一build ID；Product打包命令还会拒绝把当前宿主`.output`交叉标记为其他平台。Resolver先读取稳定envelope并提示升级Manager，再严格解析平台payload。Installation Manifest v5与Operation Journal v5是硬切协议，旧Installation不自动迁移。

官方release CLI先验证本地Manager与npm同版本公开bundle，再创建只读身份明确的Draft Candidate。workflow只从输入的release ID与revision构建；Source、五平台Product、Portable、公开下载、原生依赖、浏览器、Docker、rootless Podman与Windows数据复用全部通过后才公开Release，随后由独立job激活同一GHCR digest的版本别名。Candidate失败只保留Draft和候选OCI引用，不产生公开Release或正式OCI tag。

### v3/v4实例迁移到v5

- 先停止实例并备份完整 State Root。Windows Portable 必须备份完整 `data/`；Windows Portable 或 Installed Windows 的 `uninstall --json` 可能先返回 `scheduled`，必须等待外置 Host 的最终回执。
- 在新的 Installation Root 重新安装相同 Profile，只复用 State Root；不要复制旧 `.deploy`、`.runtime`、`.output`、generated Compose 或 wrapper。
- Portable曾使用绝对`DATABASE_URL`临时修复登录时，迁移后恢复`file:./workspace/.nbook/neuro-book.sqlite`。
- 旧`.deploy/installation.json`和未完成Operation不能复制到新安装。先在旧位置完成或人工核对Product、Git、Compose和SQLite状态，再只复用完整State Root。
- 旧Agent Session包含完整Pi Model且无法证明Provider Config ID时，按[0.8.9 的迁移说明](./changelog/v0.8#session-model-refs)使用逐entry mapping维护命令。

## 验收建议

Release/PR workflow会对原生Product执行Manager、Stage 0、native package、HTTP与浏览器smoke。最终Release索引还必须等待公开Linux x64 Docker、Linux ARM64 Docker、Linux x64 rootless Podman、Windows Portable数据复用和Windows自卸载门禁；GHCR链覆盖migration、管理员、登录、restart、doctor与Operation恢复。仍建议人工验证首次启动、登录、创建项目、更新提示和更新后数据保留。

::: warning 当前已知未验证 / 已知问题
- **Apple Silicon 上的 Docker Desktop 与 rootless Podman 部署尚未实机验证**。
- rootless Podman 环境下 `podman-compose stop` 会连带删除容器。
- Manager 只安装已发布完整索引的 Release，你实际装到的版本可能低于最新版本号，用 `neuro-book status` 确认。
:::
