# Release Notes

## 0.8.20-rp - 2026-08-01

本次发布是 RP 分支版的补丁更新，对应用户侧版本标识 `0.8.20.rp`；为了保持安装器和 Release Manifest 的 SemVer 兼容，包版本与 tag 使用 `0.8.20-rp`。

### 主要变化

- 修复未初始化项目打开 RP 侧栏时的报错：侧栏会先检查 RP 世界线初始化状态，企划引导期缺少 `rp/world-engine/` 时正常返回引导页与侧栏数据，不再提前读取角色数据、触发 World Engine 加载。
- 修正地图层级与 World Engine 的对应关系：地图根节点严格对应世界主体、其余层级对应地点主体，并在创建与一致性审计时校验；错误的旧地图节点可撤销后重新提案。
- 修正 Agent 中止行为：停止操作会按父子调用树递归中止所有后台 Agent 调用并等待收敛，界面在确认无活动调用后立即恢复可输入状态。

### 已知验证

- 相关回归与诊断记录见 `docs/tasks/100-rp-mode-v2/README.md` 与 `docs/tasks/02-pi-agent-harness-migration/README.md`。
- 按项目约定，本轮不自动执行浏览器交互验收；建议发布后手动验证 RP 侧栏（未开团项目）、Bootstrap 地图层级与 Agent 中止恢复。

## 0.8.19-rp - 2026-07-31

本次发布是原项目的 RP 分支版，对应用户侧版本标识 `0.8.19.rp`；为了保持安装器和 Release Manifest 的 SemVer 兼容，包版本与 tag 使用 `0.8.19-rp`。

### 主要变化

- RP 模式 v2 进入可公开验证分支：包含开团引导、Bootstrap 六阶段门禁、唯一回合事务、主动事件、规则结算、地图/NPC 生命周期、十阶段 pipeline、关注度/强度、更新窗口与世界切片恢复。
- Agent Profile 配置中心收敛：模型参数与通用运行策略更清晰，Profile 自定义提示词改为可启停、排序、分前置/末尾槽位的条目结构，并支持设置预设与完整提示词预览。
- 发布前已清理默认配置：新安装/新 Workspace 不再预置模型 Provider、默认模型、API Key、Agent Profile 覆盖或额外提示词条目；用户需要在设置中心重新配置 API 与 Agent 偏好。

### 已知验证

- 相关 RP 数据面回归与 Agent Profile 设置专项验证记录见 `docs/tasks/100-rp-mode-v2/README.md` 与 `docs/tasks/113-agent-profile-prompt-settings/README.md`。
- 按项目约定，本轮不自动执行浏览器交互验收；建议发布后手动验证配置中心的模型/API 配置、额外提示词启停与 RP 开团流程。

## Manager 0.1.0-canary.30 - 2026-07-25

本次只发布`@notnotype/neuro-book-manager`，不创建新的NeuroBook应用Release或Windows Portable压缩包。

Manager发布workflow [`30152514456`](https://github.com/notnotype/neuro-book/actions/runs/30152514456)已通过；npm精确版本与`canary` dist-tag均为`0.1.0-canary.30`，`gitHead`为`e37069af1c629bba14c2b0600abc1133b9e65203`。全新Bun缓存中的真实`bunx`已验证版本和`start --help`参数。

### Windows Portable临时启动参数

- `start`新增`--no-health-check`。它跳过`/api/app/version`启动探测、120秒超时终止和自动打开浏览器，但仍执行中断Operation恢复、数据库与Attachment迁移、State Root检查和前台Product生命周期管理。
- 参数只允许用于`windows-portable`；其他Profile会在启动迁移前拒绝，默认`start`行为保持不变。
- 已解压`0.8.19` Portable的用户可在Portable根目录运行以下命令，随后手动打开`http://127.0.0.1:3000`：

```cmd
.runtime\bin\bun.cmd x --bun @notnotype/neuro-book-manager@0.1.0-canary.30 --root "%CD%" start --no-health-check
```

- 该命令临时运行公开Manager `.30`，不会替换压缩包内置的`.29`。后续重新双击原`Start Neuro Book.cmd`仍会使用内置Manager和默认健康检查。

## 0.8.19-canary - 2026-07-20

本次patch统一Docker与Podman的不可变镜像身份比较。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.29`或更高版本。

公开prerelease：[`v0.8.19-canary.20260720.112718Z.1b4c9685`](https://github.com/notnotype/neuro-book/releases/tag/v0.8.19-canary.20260720.112718Z.1b4c9685)。Release workflow [`29738619452`](https://github.com/notnotype/neuro-book/actions/runs/29738619452)全绿并发布最终`release-manifest.json`与`SHA256SUMS`。

### 修复

- GHCR镜像同时携带repository和`sha256` digest时，doctor以二者作为不可变身份；tag只作为可读别名。Docker返回的`repository:tag@digest`与Podman规范化后的`repository@digest`会被识别为同一镜像。
- repository不同或digest不同仍保持degraded；Source Docker等不携带digest的本地镜像继续逐字比较，不放宽revision image合同。
- Compose配置镜像和实际运行镜像都使用同一不可变身份规则，HTTP精确版本、容器状态和Manifest digest检查继续保留。

### 迁移指南

- 已自行运行`0.8.18`候选的Podman用户不需要修改Compose、State Root或数据库。使用Manager `.29`重新安装或启动即可。
- 不要通过改tag或镜像名称绕过校验：repository与digest必须同时匹配Manifest；只有同repository、同digest时允许provider省略tag。
- `0.8.18`已越过Podman Compose命令兼容性，失败仅来自Podman显示同一digest时省略tag；其最终索引未发布。
- 本版本已通过五平台Product、Windows/Linux候选、Windows完整`0.8.6 data/`复用、Docker x64/ARM64、rootless Podman、管理员登录、stop/restart和Operation恢复。公开Manifest固定Manager `.29`与GHCR digest，`SHA256SUMS`覆盖其余11个公开资产。
- 原生OCI并行构建实测amd64 8.0分钟、ARM64 7.2分钟、manifest merge 0.2分钟；Windows Product/Portable为9.3分钟，完整workflow为27.4分钟。旧QEMU容器job约47分钟，当前Product已成为首阶段关键路径。

## 0.8.18-canary - 2026-07-20

本次patch完成rootless Podman 1.0.6的容器查询合同收口。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.28`或更高版本。

### 修复

- Container Engine Adapter集中读取唯一app容器ID：Docker使用`compose ps --all --quiet app`；Podman使用其原生支持的`compose ps --quiet`，provider内部负责查询停止容器和按Compose project过滤。
- 两条路径都要求0或1个12–64位十六进制ID；多容器和非法输出fail closed。Podman停止仍调用原生`podman stop --time 10`，不会触发`podman-compose stop`的连带删除。
- generated Compose schema现在明确只允许唯一`app` service，与此前“只接受一个配置镜像”的运行时合同一致；不靠service名称参数补偿宽松配置。
- 公开GHCR验证脚本使用同一Podman `ps --quiet`能力面，并继续验证停止后容器仍存在、doctor为warning、重新启动和Operation恢复。

### 迁移指南

- 已自行运行`0.8.17`候选的Podman用户不需要迁移State Root、数据库或Compose。使用Manager `.28`重新安装或启动即可。
- generated Compose是Manager受管文件；若手工加入额外service，doctor会拒绝该实例。需要额外服务时应使用独立Compose项目，不要修改NeuroBook生成文件。
- `0.8.17`已通过双架构Docker、五平台Product、Windows/Linux候选和公开payload；Podman在运行态查询容器ID时失败，最终索引未发布。完整Release以本版本workflow结果为准。

## 0.8.17-canary - 2026-07-20

本次patch修复rootless Podman运行态doctor依赖`podman-compose 1.0.6`不支持的`config --images`扩展。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.27`或更高版本。

### 修复

- Container Engine Adapter从Manager生成的`.deploy/docker-compose.generated.yml`读取固定app镜像，并复用既有严格Compose schema；容器引擎只负责查询真实容器ID、镜像和状态。
- Docker与Podman不再依赖provider特有的`compose config --images`输出。Podman仍不读取Docker专属Health字段，应用健康继续由容器状态与HTTP精确版本共同判断。
- `0.8.16`原生amd64/ARM64 OCI构建均约7分钟完成，多架构manifest merge约20秒；旧QEMU构建约47分钟。Windows Portable因此成为候选组装关键路径，OCI不再拖后。

### 迁移指南

- 已自行运行`0.8.16`候选的Podman用户不需要迁移数据库、State Root或Compose。等待完整索引后，使用Manager `.27`重新安装或启动同一实例。
- 不要手工修改generated Compose来规避doctor；Manager会从该文件验证固定镜像，并继续检查实际容器镜像与Release digest一致。
- `0.8.16`的五平台Product、原生双架构OCI、manifest merge、Windows/Linux候选和公开payload已通过；rootless Podman失败使最终索引未发布，完整Release以本版本workflow结果为准。

## 0.8.16-canary - 2026-07-20

本次patch修复rootless Podman运行态doctor读取Docker专属Health字段而失败的问题，并缩短多架构GHCR构建对Product Release的阻塞时间。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.26`或更高版本。

### 修复与优化

- Container Engine Adapter只在Docker容器上读取`.State.Health`；Podman继续读取镜像、运行状态和退出码，并由既有HTTP版本探针判断应用健康，不放宽doctor的健康定义。
- 公开GHCR脚本在运行态doctor失败时输出service状态和全部fail checks，后续平台差异不再只留下无上下文的退出码。
- OCI的amd64与ARM64镜像改由`ubuntu-latest`和`ubuntu-24.04-arm`原生runner并行构建，按架构digest推送后再由轻量job合并多架构manifest；五平台Product构建继续独立并行。
- 上一轮单个x64 job中，ARM64 QEMU `nuxt:build`约耗时30分47秒，amd64约2分51秒，缓存导出约8分8秒。新结构先消除QEMU主瓶颈，不在本次重写Dockerfile或改变Product/OCI字节来源。

### 迁移指南

- 已自行运行`0.8.15`候选的Docker或Podman用户不需要迁移数据库、State Root、Installation Manifest或Compose；使用新Manager重新执行安装或启动即可。
- Podman实例不要手工移动Workspace Root或SQLite，也不要通过放宽doctor绕过运行态检查。容器、Compose和State Root仍由当前Installation Manifest管理。
- `0.8.15`的Windows完整`data/`复用、Docker x64/ARM64和五平台Product门禁已经通过，但rootless Podman失败使最终`release-manifest.json`与`SHA256SUMS`未发布；完整Release仍以本版本workflow最终结果为准。

## 0.8.15-canary - 2026-07-20

本次patch修复rootless Podman使用`podman-compose 1.0.6`停止应用时意外删除容器的问题。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.25`或更高版本。

### 修复

- Container Engine Adapter在Docker上继续使用`compose stop app`；Podman则通过Compose解析唯一app容器ID，再调用原生`podman stop --time 10`。停止后的容器会保留，doctor、restart和Operation恢复可读取同一真实状态。
- Podman容器ID必须是唯一的12–64位十六进制ID；空结果按“尚未创建”处理，多容器或非法输出fail closed，避免停止错误目标。
- 公开GHCR链使用同一Podman停止语义，继续覆盖停止态doctor、重启、登录和planned Operation恢复。

### 迁移指南

- `0.8.14`的Docker x64/ARM64公开GHCR链已经通过，证明Product SIGTERM转发生效；rootless Podman因旧provider的stop即rm行为失败，最终索引仍未发布。
- 已运行`0.8.14` Podman候选的用户不需要迁移State Root。若容器已被旧stop删除，后续`neuro-book start`会按固定Manifest与Compose重新创建；不要删除Workspace Root或SQLite。
- 本次不修改数据库、State Root、Installation Manifest或Compose schema。

## 0.8.14-canary - 2026-07-20

本次patch修复Product容器在Docker/Podman中无法于默认10秒停止窗口内响应SIGTERM的问题。继续使用已公开的`@notnotype/neuro-book-manager@0.1.0-canary.24`。

公开prerelease：[`v0.8.14-canary.20260720.061150Z.63b609be`](https://github.com/notnotype/neuro-book/releases/tag/v0.8.14-canary.20260720.061150Z.63b609be)。Release workflow [`29720984170`](https://github.com/notnotype/neuro-book/actions/runs/29720984170)在瞬时ARM64依赖tarball解压失败后原地重跑成功；Docker x64/ARM64 GHCR链通过，rootless Podman暴露`podman-compose 1.0.6 stop`会删除容器，最终索引未发布。

### 修复

- Product启动器现在把容器PID 1收到的SIGINT/SIGTERM转发给真正的Nitro子进程，并在子进程退出后正常结束；Docker/Podman不再等满10秒后以SIGKILL强制停止。
- Release preflight新增真实父子进程信号回归，在五平台Product和多架构OCI构建前验证Nitro子进程确实收到SIGTERM且launcher在5秒内退出。
- rootless Podman runner在预检时也明确固定`podman-compose` provider，避免“安装了podman-compose，但预检实际调用Docker Compose plugin”的假阳性。

### 迁移指南

- `0.8.13`仍未发布最终Manifest和SHA256SUMS，不要把其payload资产当作完整Release安装。Windows完整`data/`复用连续两轮通过，用户数据迁移方式不变。
- 已自行运行`0.8.13` GHCR候选的用户可执行`docker compose down`或`podman compose down`停止并删除候选容器，再等待本版本完整索引；State Root volume中的用户数据不应删除。
- 本次不修改数据库、State Root、Installation Manifest或Compose schema，不需要数据迁移。

## 0.8.13-canary - 2026-07-20

本次patch修复`0.8.12`公开容器用户链暴露的Docker停机诊断与rootless Podman Compose provider问题。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.24`或更高版本。

公开prerelease：[`v0.8.13-canary.20260720.041424Z.eb589ffc`](https://github.com/notnotype/neuro-book/releases/tag/v0.8.13-canary.20260720.041424Z.eb589ffc)。Release workflow [`29716399007`](https://github.com/notnotype/neuro-book/actions/runs/29716399007)通过五平台Product、双架构OCI、候选资产、公开payload和Windows完整`data/`复用，但三条GHCR链暴露Product启动器未转发SIGTERM，最终索引未发布。

### 修复

- Docker与Podman容器被Manager或`compose stop`发送`SIGTERM`后，doctor会把退出码143识别为正常停止并给出`service.application` warning；退出码1等异常退出仍保持fail。
- Podman的所有Compose操作固定使用`podman-compose` provider，避免GitHub runner或用户宿主同时安装Docker Compose plugin时，`podman compose`静默委托给Docker plugin并连接错误daemon。
- 公开GHCR验证脚本在停机doctor不符合合同时输出service状态和全部fail checks，后续失败不再只留下无上下文的退出码1。

### 迁移指南

- `0.8.12`已通过Windows Portable完整`data/`复用门禁，但三条GHCR链失败且未发布最终`release-manifest.json`与`SHA256SUMS`，不要把其payload资产当作完整Release安装。
- Windows `0.8.6`用户继续使用“新目录解压 + 复用完整`data/`”方式迁移；不要复制旧`.deploy`、`.runtime`、`.output`或wrapper。
- Podman用户需要安装可执行的`podman-compose`。Manager会明确固定该provider，不再根据宿主上偶然存在的Docker插件改变Compose实现。
- 本次不修改State Root、SQLite、Installation Manifest或用户数据，不需要数据库迁移。

## 0.8.12-canary - 2026-07-20

本次patch修复`0.8.11`候选资产验证中的Product Agent State Root smoke配置漂移。继续使用已经公开的`@notnotype/neuro-book-manager@0.1.0-canary.23`。

### 修复

- Product Agent smoke不再用缺少本地Provider身份的旧Faux Pi Model创建Session；它会通过正式Config Service写入最小Provider Config和Model，并让runtime model携带同一个`providerConfigId`。
- 移动完整State Root后不再重复创建Provider配置，而是复用随State Root迁移的Global Config，验证旧Session能从durable `{providerConfigId, modelId}`恢复。
- Release preflight新增真实Product Agent State Root smoke，在五平台Product和多架构OCI fan-out前覆盖五文件工具、外部Project Attachment、State Root移动和旧Session恢复。

### 迁移指南

- `0.8.11`没有发布最终Manifest或完整资产索引，不要安装其候选资产；`0.8.6`用户继续等待本版本完成公开门禁。
- 本次只修复发布smoke和候选门禁，不修改用户Session、Provider Config、数据库或Installation Manifest，不需要数据迁移。
- 用户不应为绕过错误手工给历史Session补Provider名称；真实旧Session仍必须通过Task 104的显式映射维护流程处理无法证明的模型身份。

## 0.8.11-canary - 2026-07-20

本次patch修复`0.8.10`新增原生平台Manager门禁后暴露的两个子进程测试问题。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.23`或更高版本。

公开prerelease：[`v0.8.11-canary.20260719.161808Z.afed53ec`](https://github.com/notnotype/neuro-book/releases/tag/v0.8.11-canary.20260719.161808Z.afed53ec)。Release workflow [`29694596325`](https://github.com/notnotype/neuro-book/actions/runs/29694596325)完成五平台Product和多架构OCI构建，但Linux/Windows候选验证被过期Product Agent smoke阻断，没有公开最终索引。

### 修复

- Manager子进程输出捕获改为等待`close`事件，确保stdout/stderr完全关闭后再返回。macOS短命令`bun --version`不再因`exit`早于最后一段stdout而偶发得到空版本。
- Manager测试的真实Git、PowerShell和子进程集成用例统一使用20秒预算，避免共享runner负载把正常冷启动误判为5秒挂死；Release job自身的45/60分钟上限保持不变。
- 新增短命令stdout完整性回归，并连续两次运行完整Manager suite验证进程与Git用例不再出现5秒随机失败。

### 迁移指南

- `0.8.10`没有形成最终Release索引，不要安装其不完整资产；已经使用`0.8.6`的用户继续等待本版本完整资产。
- 本次不改变数据库、Workspace Root、Installation Manifest或用户配置。Windows Portable迁移仍是备份完整`data/`，将其带到新解压的Installation Root，不复制旧`.runtime/.deploy/.output`。
- 不要通过删除平台测试、跳过版本检查或放宽进程错误处理规避该问题。

## 0.8.10-canary - 2026-07-19

本次patch修复`0.8.9`候选Windows Portable在组装内置Bun时失败的问题，并收口Release Actions的前置门禁、重复测试和旧canary资源占用。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.22`或更高版本。

公开prerelease：[`v0.8.10-canary.20260719.153805Z.13c85b2c`](https://github.com/notnotype/neuro-book/releases/tag/v0.8.10-canary.20260719.153805Z.13c85b2c)。Release workflow [`29693247437`](https://github.com/notnotype/neuro-book/actions/runs/29693247437)在Windows/macOS x64原生Manager门禁失败后取消，没有形成最终Release索引。

### 修复与改进

- Windows Portable现在正确识别Bun官方ZIP中的目录条目（例如`bun-windows-x64/`）。目录身份会在Archive Extraction Adapter中规范化，严格Installation Root路径校验本身没有放宽，路径穿越仍会被拒绝。
- Release workflow新增统一preflight，在昂贵的五平台Product与多架构OCI构建前完成公开Manager provenance、Stage 0、Manager和Release资产合同测试。
- Windows Product使用绑定OS、架构、精确Bun版本和lockfile的依赖缓存；缓存命中后仍执行`bun install --frozen-lockfile`校验，避免损坏缓存被当成可信安装。
- Manager全量领域测试只在Linux preflight执行一次；macOS x64和Windows继续保留各自真实Stage 0/Manager Adapter门禁，ARM64同OS job不重复运行同一套领域测试。
- 新canary发布会自动取消仍在运行的旧canary Release workflow；stable按tag隔离，不会被其他发布取消。

### 迁移指南

- `0.8.9`的Release workflow在Windows Portable组装阶段失败，没有形成完整最终索引，不要下载或安装其不完整资产。
- 已使用`0.8.6`的用户无需迁移数据库、Workspace Root或Installation Manifest；等待`0.8.10`完整资产公开后，通过NeuroBook Manager执行正常更新或重新下载新的Windows Portable。
- 不要手工修改`.runtime`、放宽路径校验或把Bun ZIP内容复制到旧Portable。Portable用户继续备份完整`data/`；重新解压时只把该`data/`带到新Installation Root。
- `0.8.6`期间为SQLite登录问题临时改成绝对`DATABASE_URL`的用户，升级后应恢复为`DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite`，以保留Portable移动能力。

### 验证边界

- Archive Extraction Adapter回归覆盖合法空目录、普通文件与`../`路径穿越；真实Bun `1.3.14` Windows ZIP已完成受管物化并得到可执行路径。
- Manager完整测试为29个文件通过、1个按平台跳过，143项通过、2项跳过；Release资产与checksum合同通过。
- Manager `0.1.0-canary.22`已由npm Trusted Publisher公开，workflow [`29693189437`](https://github.com/notnotype/neuro-book/actions/runs/29693189437)全绿；npm精确版本、`canary` dist-tag与真实`bunx --bun`均返回`.22`，历史`latest`保持`.4`。
- 多架构公开Product、GHCR、Windows完整`data/`复用与最终索引仍以本版本Release workflow结果为准；本轮不自动执行人工浏览器验收。

## 0.8.9-canary - 2026-07-19

本次patch收口`0.8.6`之后发现的Portable数据库、Manager更新事务、Provider身份、Agent文件授权与公开事件安全问题。该版本需要`@notnotype/neuro-book-manager@0.1.0-canary.21`或更高版本。

公开prerelease：[`v0.8.9-canary.20260719.144929Z.399cb2f9`](https://github.com/notnotype/neuro-book/releases/tag/v0.8.9-canary.20260719.144929Z.399cb2f9)。Release workflow [`29691602413`](https://github.com/notnotype/neuro-book/actions/runs/29691602413)已启动；按发布约定未等待Actions，最终资产与公开Manifest仍以workflow结果为准。`0.8.7`与`0.8.8`均保留为零资产审计prerelease，不应下载或安装。

### 更新说明

- Windows Portable登录不再受启动cwd影响。App SQLite的逻辑URL、Prisma连接URL、Manager备份路径和Docker容器URL统一从State Root解析；配置文件继续保存可移动的相对URL。
- Manager更新事务升级为Operation Journal v3 Effect Ledger。SQLite checkpoint、Git、Product、Compose、wrapper、Manifest和受管资产都在物理动作前记录planned intent，完成后记录applied结果。
- Bun、ripgrep和PortableGit使用不可变资产代次。下载、解压、checksum、执行位和真实版本全部在staging验证；失败不会删除当前Runtime或wrapper。
- Windows Portable直接嵌入npm Trusted Publisher公开的精确Manager bundle，不再在Windows重新构建并假设Bun bundle可跨操作系统字节复现。Release预检使用npm `gitHead`确认当前Manager源码、共享Runtime和lockfile没有漂移。
- wrapper旧状态与恢复路径会在切换前持久化，备份通过临时目录原子提交。进程在备份或写wrapper期间中断时，不再误删当前可用wrapper。
- Source Docker镜像使用Operation唯一代次。回滚只删除本次事务创建的镜像，成功提交后只退役previous Manifest明确证明的旧镜像。
- `update --dry-run`和正式update共用同一个Release/Git目标Resolver，并输出将进入的Effect Ledger计划。同版本更新保持零Operation、零backup、零staging。
- Installation Manifest硬切v4，Release Manifest硬切v3；容器Profile固定记录Docker或Podman engine，原生Product完整覆盖Windows x64、Linux x64/ARM64 glibc和macOS x64/ARM64。
- Provider Config ID、Base URL和proxy组成不可隐式迁移的连接身份，身份变化返回400且不会发送网络请求。Provider默认Model API只影响发现和新模型补全，可在原连接上修改并继续使用saved凭据，不会改写已有模型。
- Agent Session只持久化`providerConfigId + modelId`。失效引用只阻断对应Session，不会回退默认模型或把Pi Provider名称猜成本地Provider ID。
- read/write/edit/apply_patch与Subject Memory共用Authorized File Operation，统一Project open gate、跨Project地址和symlink/junction containment。Bash仍是受信任完整Shell，只验证当前Project与cwd。
- Public Tool Call ID在live、durable history、HTTP、SSE、queue、replay和client patch入口统一限制为非空且不超过512 UTF-8 bytes，非法身份fail closed。
- Attachment读取继续按Session Entry和Project身份授权；blob固定写入全局Workspace Root的`.nbook/agent/attachments`，不从物理路径反推Project。

### 迁移指南

#### 从0.8.6 Windows Portable迁移

1. 完全停止NeuroBook，并备份旧Portable的完整`data/`目录。
2. 解压新的`neuro-book-windows-x64.zip`到新的Installation Root。
3. 用旧实例的完整`data/`替换新实例默认`data/`。不要复制旧`.deploy`、`.runtime`、`.output`或根目录wrapper。
4. 如果曾按0.8.6临时指南使用绝对数据库URL，把新实例`data/.env`恢复为：
   ```text
   DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite
   ```
5. 运行`Start Neuro Book.cmd`，确认登录、项目和Agent Session可用后，再删除旧Installation Root。

不要创建Portable根`workspace/`、junction或SQLite副本。若根`workspace/`已经存在，先分别备份并人工比较它与`data/workspace/`；Manager只诊断和警告，不会自动合并用户数据。

#### Manifest v3实例

Manifest v3不会由v4 Manager原地升级。请使用相同Profile重新安装到新的Installation Root，只复用正式State Root：

- Windows Portable复用完整`data/`。
- Product Bun和Source Profile复用原State Root或明确配置的外部State Root。
- GHCR重新安装后重新挂载原State Root。
- 不复制旧`.deploy`、`.runtime`、`.output`、generated Compose或wrapper。

如果发现未完成的Operation Journal v1/v2，v3 Manager会拒绝自动恢复。请先备份Installation Root和State Root，人工核对Manifest、Product、Git HEAD、Compose和SQLite，再处理旧Journal；不要直接删除Journal后继续update。

#### 旧Agent Session模型引用

无法证明Provider Config身份的旧完整Pi Model不会被自动猜测。先准备逐entry映射文件：

```json
{
    "mappings": [
        {
            "sessionId": 241,
            "entryId": "model-change-entry-id",
            "providerConfigId": "my-provider",
            "modelId": "my-model"
        }
    ]
}
```

先执行只读检查，再应用迁移：

```text
bun scripts/maintenance/migrate-session-model-refs.ts --workspace-root <Workspace Root> --mapping <mapping.json> --dry-run
bun scripts/maintenance/migrate-session-model-refs.ts --workspace-root <Workspace Root> --mapping <mapping.json>
```

命令会验证Global Config中的Provider和Model、拒绝缺失或未使用的mapping，并清理历史`.redaction.tmp/.bak`敏感副本。迁移前仍建议备份完整State Root。

#### Provider配置

- 修改Base URL或proxy时，请clone为新的Provider Config ID，再显式迁移Global/Project引用。Provider默认Model API可直接修改；已有模型的最终API仍需在各自模型设置中调整。
- `saved`只使用身份完全匹配的已保存Secret；`provided`只使用请求Secret；`cleared`强制空Secret。
- 删除Provider前必须先处理Global和所有managed Project引用。系统不会自动清空引用或改用默认模型。

### 验证与已知边界

- Manager全量：28个文件通过、1个按平台跳过；141项通过、2项跳过。Manager typecheck和5文件约0.38 MiB pack审计通过。
- Manager `0.1.0-canary.21`已由npm Trusted Publisher公开，workflow `29690567507`全绿；npm精确版本和全新Bun cache中的`bunx --bun ...@0.1.0-canary.21 --version`均返回`.21`。`.20`发布在npm publish前被Linux测试夹具阻断，不是可安装版本。
- `0.8.7` prerelease只创建了审计Release，workflow `29690944232`在任何资产构建前失败。原因是`actions/checkout`的单提交浅克隆没有npm `gitHead`对象；预检现显式按SHA取回该提交后再比较构建输入。修复版本改为`0.8.8`。
- `0.8.8` workflow `29691194281`的Manager provenance与Source门禁通过，但四个POSIX Product job被同一个过期测试阻断：测试未传显式自动化参数，却期待先报告缺少`curl`。生产Stage 0按既定合同先拒绝“无TTY且无参数”，行为正确。
- 缺少`curl`测试现显式传`--profile product-bun --yes`，因此会越过非TTY入口门禁并验证依赖检查仍发生在缓存/临时目录创建前。`0.8.8`剩余构建已取消，修复版本推进为`0.8.9`。
- `0.8.9` prerelease已创建并推送。workflow `29691602413`在Windows Portable组装内置Bun时失败：上游ZIP的合法目录条目`bun-windows-x64/`被错误送入严格文件路径校验。其余仍运行的兄弟job已人工取消；该Release没有形成完整最终索引。
- Provider、Session、公开事件、文件授权、Attachment和HTTP组合：20个文件、190项通过；Harness黑盒/State Root/Payload 30项与Trace/File Change 20项通过。
- 根typecheck、Nuxt client/SSR/Nitro、Product runtime后处理和`git diff --check`通过。
- Linux ARM64 glibc、macOS x64与macOS ARM64原生Product平台门禁已有集成证据；本次发布仍需由公开Release workflow生成并验证最终资产。
- 未自动执行人工浏览器验收。Apple Silicon Docker Desktop/rootless Podman实机链继续作为Task 105待办，不标记为已验证。

## 0.8.6-canary - 2026-07-17

本次patch修复GHCR与Source Docker安装、更新时的一次性维护命令被Product镜像ENTRYPOINT截获的问题。`0.8.5`公开Product Bun首次安装、Attachment迁移、State Root和HTTP均已通过，但GHCR安装在容器内规划Attachment迁移时错误启动了长期Web服务，导致Manager一直等待命令结束。

> 已知问题（Windows Portable）：鉴权启用后，Product会把逻辑相对`DATABASE_URL`直接交给Prisma，登录接口可能从进程cwd解析到错误数据库并返回500。`0.8.6`的Update还可能因Manager使用不完整SQLite flags而报告`bad parameter or other API misuse`。源码已修复，后续版本发布前会加入真实鉴权登录门禁；当前版本请按下方临时指南处理，不要创建根`workspace/`或junction。

### 更新说明

- Manager执行容器内migration等一次性命令时，显式使用`docker compose run --entrypoint <command>`覆盖Product正式ENTRYPOINT。
- 命令首项作为容器ENTRYPOINT，其余参数保持独立argv边界；不再依赖镜像脚本猜测调用意图。
- Product正式ENTRYPOINT继续只负责Prisma migration、system assets预检和长期服务启动，不加入维护命令兼容分支。
- 空的一次性命令现在立即拒绝，不会创建无意义容器。

### 迁移指南

- GHCR与Source Docker用户必须使用Manager `0.1.0-canary.19`或更高版本安装/更新`0.8.6`。
- 不要手工修改镜像ENTRYPOINT、绕过Operation Journal运行migration，或把长期服务容器当作一次性维护容器。
- Product Bun和Windows Portable不受该入口问题影响；继续保留完整State Root即可。

#### Windows Portable 0.8.6临时登录恢复

1. 停止NeuroBook，并备份完整`data/`。
2. 打开`data/.env`，把`DATABASE_URL`临时改为现有数据库的绝对URL，例如`file:C:/NeuroBook/data/workspace/.nbook/neuro-book.sqlite`。
3. 重启后验证登录。不要移动SQLite，不要创建Portable根`workspace/`，也不要建立junction。
4. 当前`0.8.6`已是最新应用版本时无需运行Update；等待后续同时包含Manager更新修复和Product数据库路径修复的版本。

后续版本会继续在配置中保存可迁移的逻辑相对URL，并只在运行时按当前State Root生成绝对连接URL；Portable移动目录后无需永久保存旧盘符路径。

### 验证与已知边界

- SSH Arch使用公开`0.8.5`完成Product Bun空目录安装、healthy doctor、Attachment`dry-run → apply → rollback`、分离State Root五工具/移动恢复、无根`node_modules`启动和HTTP精确版本验证。
- 同一Arch环境公开GHCR空目录安装稳定复现：one-off容器实际Config.Cmd为migration命令，但镜像ENTRYPOINT启动Product并持续监听；停止容器后Operation完整回滚，未残留Manifest、wrapper、容器或Compose网络。
- 新增Docker命令边界回归并先红后绿；Manager完整18 files / 65 tests、typecheck与5文件约0.35 MiB pack审计通过。
- Manager `0.1.0-canary.19` workflow `29582201585`已全绿并公开到npm；应用`0.8.6` workflow `29582562773`完成Windows/Linux Product、Portable、GHCR、公开payload复验和最终索引，Release共9个资产。
- SSH Arch从空目录使用公开Manager `.19`安装公开GHCR成功：Operation为`committed / success`，doctor healthy，Attachment迁移与同根State Root Agent smoke通过，停止后由Manager重新启动并返回精确HTTP版本；固定digest与Manifest一致，`/app/.agent`不存在，State Root数据保留。
- 本轮隔离HOME、Installation Root、容器、网络和镜像引用已清理。未执行人工浏览器操作；自动Release browser smoke已通过。

## 0.8.5-canary - 2026-07-17

本次patch修复全新Product Bun安装在首次数据迁移阶段失败的问题。`0.8.4`的Windows/Linux Product、Portable、GHCR和公开资产校验均已通过，但公开Manager从空State Root安装Product Bun时，会因为尚未存在Agent数据目录而中止并回滚。

### 更新说明

- Attachment迁移的dry-run现在把“没有任何Agent session”视为合法空计划，不再要求`workspace/.nbook/agent`预先存在。
- 空计划仍保持严格零写入：不会为了权限探针创建Agent目录、migration lock、manifest或Attachment Store。
- 只要存在session，原有的写权限、旧图片解码、Attachment引用和checksum完整性检查仍全部执行。
- Manager事务合同不变：没有旧图片时不创建Attachment migration operation；安装失败仍只保留已提交的`rolled-back`审计journal，不残留Product、Manifest、State Root文件或wrapper。

### 迁移指南

- 新安装请使用`0.8.5`或更高版本；不要选择`0.8.4`进行空目录Product Bun安装。
- 已有`0.8.4`实例如果已经成功安装且存在Agent State Root，无需手工创建目录或运行迁移脚本，继续通过Manager更新即可。
- Windows Portable仍迁移完整`data/`；其他Profile保留完整State Root。不要手工创建假的session目录来绕过检查。

### 验证与已知边界

- `0.8.4` workflow `29576999784`已完成Windows/Linux Product、Portable、GHCR、Stage 0、真实启动、State Root、shadow workspace、公开payload与digest复验，最终公开9个资产。
- SSH Arch使用公开Manager `.18`与`0.8.4`执行空目录Product Bun安装，稳定复现`access workspace/.nbook/agent`的`ENOENT`；失败事务正确回滚，安装根仅保留`outcome=rolled-back`的operation journal。
- 新增空Workspace Root零写入回归，Attachment migration完整suite为22/22；Manager迁移/Operation聚焦为3 files / 19 tests，根typecheck通过。
- `0.8.5`公开Product Bun与GHCR安装链仍需Release workflow及发布后Arch复验；未自动执行人工浏览器操作。

## 0.8.4-canary - 2026-07-17

本次patch修复`0.8.3`候选Product在正式启动预检中错误报告内置Profile过期的问题。该问题会同时阻断Linux Product Bun和Windows Portable，`0.8.3`因此没有公开应用资产。

### 更新说明

- Product内置Profile与Variable现在统一从`.output/server`自包含运行时编译。`nbook/*`源码、第三方包和tsconfig不再绑定构建checkout的根`node_modules`或Source archive。
- Product freshness诊断会指出第一个失配依赖路径，不再只显示Profile文件名。
- Nitro后处理同时重编Profile与Variable artifact，并使用与运行时一致的逻辑manifest root。
- `nuxt:build`结束和Product归档开始前都会执行同一个只读合同：所有依赖必须位于`.output/server`，manifest root、源码、artifact、类型文件与依赖checksum必须全部新鲜。

### 迁移指南

- 不需要迁移用户数据或Installation Manifest。使用NeuroBook Manager更新到本版本对应的完整Release即可。
- 不要手工删除`.compiled/manifest.json`、关闭dependency freshness或在运行时重编内置Profile；这些操作会破坏Product与源码revision的一致性。
- `0.8.3` Release保持失败审计记录且没有完整资产，Manager会继续跳过。请使用`0.8.4`或更高版本。

### 验证与已知边界

- 本机完成全新`nuxt:build`；14个Profile共34,961条依赖、Variable依赖均为`.output/server`内路径，构建期与归档前只读合同通过。
- 从Source ZIP与Windows Product ZIP组装无根`node_modules`的隔离Product后，system assets预检报告14个Profile、0个stale，并完成Agent State Root移动smoke。
- SSH Arch完成同源Linux`nuxt:build`与Product tar归档；移除根`node_modules`和聚焦测试生成的ignored日志目录后，system assets预检为0 stale，Agent State Root移动smoke通过且Application Root未生成影子`workspace/`。
- `0.8.3`候选中的Attachment migration、Linux Agent State Root、Windows Portable Agent State Root与shadow workspace步骤曾通过，但最终Release因两端正式启动预检失败而保持零资产。公开Linux、Portable与GHCR仍以新canary workflow结果为准；未自动执行人工浏览器操作。

## 0.8.3-canary - 2026-07-17

本次patch修复GHCR与Source Docker在普通宿主UID/GID下启动失败的问题，并把Product内置Agent编译资产收口为真正的只读运行合同。

### 更新说明

- Manager生成的Docker Compose现在同时挂载State Root `.env`、`config.yaml`、`workspace/`和`logs/`，容器不再尝试写镜像内的`/app/.env`。
- Profile、Variable、预览、后台worker和user-assets同步的临时目录不再写`process.cwd()/.agent`，而是位于对应Agent root同级的`.staging/`。系统assets留在Application Root，用户运行产物自然落到State Root。
- Product启动只校验内置Profile/Variable artifact；全部新鲜时不会创建staging、获取发布锁或重写manifest。源码、依赖或manifest不匹配时明确要求重建/重装Product，不再尝试修改只读镜像。
- runtime artifact动态导入缓存必须由调用方显式指定物理根。系统Profile加载缓存位于`workspace/.nbook/agent/.staging/`，类型系统不再允许从cwd或只读artifact位置猜测缓存目录。
- Docker镜像在最终Product tsconfig写入后重新编译system assets，保证发布manifest的源码、依赖路径与最终运行镜像一致。

### 迁移指南

- GHCR与Source Docker实例应使用NeuroBook Manager canary更新；不要手工给`/app`执行`chmod`、不要改为root容器，也不要把`.env`烘焙进镜像。
- 旧Compose若缺少`.env:/app/.env`挂载，请重新运行Manager更新生成Compose，不要只手工修改容器内文件。
- Product Bun与Windows Portable保留完整State Root即可。Windows Portable继续迁移完整`data/`；其他Profile保留`workspace/`、`config.yaml`、`.env`和`logs/`。
- 若启动报告内置Profile或Variable artifact过期，说明Source/Product组合不一致；应重新安装对应Release，不要删除manifest或放宽checksum/freshness校验。

### 验证与已知边界

- 本机根typecheck、Manager typecheck/pack、Variable完整20项、只读system-assets与runtime import聚焦回归通过。
- SSH Arch使用普通UID/GID构建并启动当前源码Docker Product；SQLite migration、HTTP版本、14个Profile catalog、Agent五工具、Config/Profile/Variable、外部Project图片与Attachment均通过，镜像`/app/.agent`保持不存在。
- 本轮仍需由新canary Release workflow验证公开GHCR、Linux Product Bun和Windows Portable；未自动执行人工浏览器操作。

## 0.8.2-canary - 2026-07-17

本次patch集中修复Agent图片持久化、Portable/自定义State Root文件定位和发布迁移事务。用户图片不再以内联base64长期留在Session中，Agent文件工具也不再把逻辑`workspace`误当成Installation Root下的物理目录。

### 更新说明

- 用户图片和`read(image)`结果写入Workspace Root `.nbook/agent/attachments/`的content-addressed Store；Session、队列、trace和公开事件只保存轻量引用，Provider调用时才按可见上下文加载图片。
- 文件路径统一经过`RuntimePaths -> WorkspaceRootRef/ProjectPath -> File Scope -> Resolved File Address`。Windows Portable与自定义State Root的read/write/edit/apply_patch/bash、Plan Mode和子Agent均命中真实State Root，跨Project读取保留正确的Project归属。
- Manager Install、Update和Start把Attachment硬切纳入Operation Journal。迁移、Product、SQLite或容器健康失败时，会先恢复Session格式，再恢复Product、数据库与Compose。
- Manager `0.1.0-canary.16`已公开。共享Runtime拥有独立clean-checkout typecheck边界，不再因本机`.nuxt`缓存存在而掩盖发布故障。

### 迁移指南

- Windows Portable请安装新的完整zip，并把旧实例的完整`data/`复制到新目录；不要复制根`workspace/`、旧`.output`、`.runtime`或`.deploy`。首次启动由Manager事务迁移历史图片Session。
- Product Bun、Source Product、Source Docker和GHCR实例先停止服务，再使用Manager `.16`执行更新。不要单独手工运行Attachment migration脚本。
- 如果`doctor`报告`state.shadow-workspace`，分别备份根`workspace/`与真实State Root下的`workspace/`并人工比较；Manager不会自动合并、移动或删除用户数据。
- 更新失败后保留`.deploy/operations/`与日志用于恢复和诊断，不要手工覆盖Product或Session文件。

### 验证与已知边界

- 本地Windows隔离Product与SSH Arch原生Product/Source Docker已通过Attachment迁移逐字节回滚、Agent五工具、外部Project图片、State Root移动、Config/Profile/Variable、SQLite与HTTP；完整Harness/black-box为187/187，Manager为18 files / 63 tests。
- Manager `.16` workflow `29556688067`全绿，npm `canary`和公开精确bunx均已验证。应用公开Product Bun、GHCR、Windows Portable与浏览器图片展示仍需本次Release workflow及人工验收确认。
- 前一`0.8.1` Release因Product预检在Nuxt prepare之前运行Vitest而保持零资产。新Release门禁使用自包含的`test:agent-state-root`，会在clean checkout先生成Nuxt类型，再执行Task 109路径测试。
- Manager `.16`发现顶层`--version`会截获子命令目标版本。下一Manager `.17`固定参数位置：全局`--root/--instance`写在子命令前，应用或Runtime`--version`写在子命令后；真实npm tarball已加入路由回归。

## 0.8.0-canary - 2026-07-15

本次 minor 版本重构 Agent Chat Flow 的公开数据与恢复协议，让长会话的首屏、向上翻页、实时流式响应和工具卡都具备明确的网络与内存边界；同时收紧模型配置写入合同，避免无效 Provider、模型引用或默认值进入运行时。

### Agent 长会话改为有界恢复与历史分页

- Session 查询统一为 recovery、history 和 System Prompt 三种严格视图。普通恢复只返回会话外壳、轻量树和最近一页历史，不再携带完整 raw entries、Provider messages 或预先构建的 System Prompt。
- Chat Flow 支持 opaque cursor 向上分页，默认按 30 个显示组、约 256 KiB 组织页面；Assistant 与所属工具结果不会在分页边界被拆开，加载旧页时保持当前视口锚点。
- System Prompt 改为独立按需面板。Session Tree 删除 raw 正文详情，但继续保留结构搜索、折叠、ID 复制和分支切换。
- retry、编辑、删除和切换分支等操作统一触发同一个 recovery single-flight；旧 session、旧 revision 和迟到响应不会覆盖当前页面。长文本 optimistic 消息也能按公开 preview 与真实字节数准确收敛。

### 实时事件与 SSE 内存边界

- Agent runtime event 改为不可变、delta-first 的公开 DTO，不再反复发送累计完整消息、工具参数、patch、diff 或图片 base64。
- write、edit、apply_patch、read、bash 等工具卡只公开路径、短预览、原始字节数和 omitted 状态；未知工具也经过统一的有界投影，未来新增工具默认受同一安全边界保护。
- EventHub replay 同时限制事件数量与序列化字节数，慢订阅者队列也有独立上限。Agent SSE 使用等待 Node `drain` 的专用 writer，客户端停止读取时不再把大量事件转移到无界 HTTP response buffer。
- pending approval、steer/follow-up queue 和 Agent 表单也改用公开有界合同；完整内部 payload 继续只保留在服务端真相层。图片正文不会进入 SSE、recovery/history DTO 或 JSONL，持久层只保存轻量 Attachment 引用。
- 修复运行结束与图片follow-up并发入队的竞态。Attachment仍在保存时，terminal状态会等待同一session admission临界区，确保follow-up要么完整落盘并自动开启下一轮，要么在运行结束后明确拒绝，不会留下无人消费的队列。
- Manual compact现在纳入Harness统一后台任务生命周期；服务关闭会等待compaction、follow-up drain与summarizer结束后再释放Session、Profile和Attachment资源，避免关闭过程中仍访问已删除的State Root。

### Agent 图片改为持久化 Attachment 引用

- 用户图片和`read(image)`结果会先写入Workspace Root `.nbook/agent/attachments/`的content-addressed Store；JSONL、RunFrame、queue、公开事件和trace只保存轻量引用，不再长期持有base64。
- Provider调用前才按当前可见上下文临时加载图片；非视觉模型使用统一marker且不读取blob。缺失、损坏或MIME不一致会在Provider请求前明确失败。
- Chat Flow通过session、entry和content index约束的授权接口加载图片，支持ETag/304、失败单图重试和纯图片消息；错误响应不缓存。
- 当前开发Workspace中的既有图片session已完成一次性硬切迁移，runtime不保留旧双格式分支。Manager的Install、Update与Start现在都通过Operation Journal执行迁移：健康失败或崩溃恢复会先停止新容器/进程并撤销session格式，再恢复Product、SQLite和Compose；缺脚本、错误runId或`applied -> not_started`均fail closed。

### 模型配置合同与设置体验

- Provider Config 成为模型 runtime 的唯一配置真相源。Global Config 保存前会严格校验 Provider、模型、重复 ID、默认模型和 Profile 引用；不涉及 models 的独立配置保存不会被已有坏模型配置阻断。
- 设置页统一使用完整模型草稿与实时校验，支持紧凑问题提示和只修正草稿、不自动保存的一键修复。健康检查、模型发现、session 选择和实际 runtime 共用同一模型身份合同。
- Config Service 测试已迁入隔离 State Root，测试失败或中断不再移动真实 `workspace/.nbook/config.json`。

### 验证与已知边界

- Agent 公共投影、EventHub、SSE、队列、Chat Flow、分页与前端状态聚焦组合均已通过；最终 queue/public boundary 组合为 15 files / 297 tests，分页相关组合为 8 files / 71 tests，Harness/black-box 最终回归通过。
- `bun run typecheck` 与 `bun run nuxt:build` 已通过；模型草稿、模型写入校验、runtime/auth、DTO 与 Global Config 聚焦测试通过。
- 真实 paused socket、10 MiB write/patch/unknown tool 与图片 base64 fixture 已覆盖公开事件、replay、subscriber queue 和 response buffer 上限。
- 未自动执行浏览器验收、Docker 构建或本轮真实 Provider 验证。建议发布后重点手动检查长 session 向上翻页、invalid cursor 恢复、短列表滚动锚点、工具预览省略提示，以及模型设置的一键修复和批量检测。

### Agent Workspace Root与Portable数据路径

- Agent session继续保存`workspace`或`workspace/.nbook`逻辑引用，但每次运行会按当前State Root解析真实文件系统根。Windows Portable中的read/write/edit/apply_patch/bash、Plan Mode、World Engine临时文件、Subject Memory/RAG与文件历史现在统一落到`data/workspace/`，不会再因进程cwd错误创建根`workspace/`。
- 未定义的任意相对workspace override会被拒绝；用户明确指定的外部绝对Project Workspace仍受支持。完整移动`data/`后，旧session会在新Installation Root自动解析到新的物理位置，不写入旧盘符或旧安装绝对路径。
- Manager新增`state.shadow-workspace`诊断。若Portable根`workspace/`与`data/workspace/`是两个真实目录，doctor失败、status提示人工比较、start醒目警告但继续运行；Manager不会自动处理用户数据，同目标junction/symlink不误报。
- Agent Session列表会隔离路径或metadata损坏的单文件；相同问题集合只告警一次，避免每次列表刷新重复淹没日志。历史测试产生的235个无用户消息Session已带SHA256清单可逆归档，真实Repository issue归零。Harness在运行时要求显式Repository或RuntimePaths，Bun也默认忽略Product/Output/staging目录，测试和临时runtime不能再静默写入真实State Root。
- 文件路径现在统一遵循`RuntimePaths -> WorkspaceRootRef/ProjectPath -> File Scope -> Resolved File Address`。Agent不再拥有独立路径语法，Workspace API、History、World Engine/Plot、Profile/Skill、Session与bash核心均由入口显式传入root，不从cwd反推领域身份。
- 本地Windows隔离Product与SSH Arch原生Product已在无根`node_modules`、分离State Root和外部Project条件下通过Agent五工具、Attachment migration/rollback、Config/Profile/Variable、SQLite migration与HTTP；Arch Source Docker在容器内构建，并在正式`/app`同根布局通过同一Agent/Attachment与HTTP版本门禁。最终源码重新构建的Windows隔离Product再次通过迁移逐字节回滚、State Root移动和HTTP 200，并确认Product runtime不再包含测试源码或依赖测试helper；完整Harness/black-box为187/187。公开Release、Windows Portable、Product Bun和GHCR仍需新canary发布后验证。

迁移时请保留完整State Root。Windows Portable用户只复制完整`data/`到新解压目录，不要复制旧根`workspace/`；如果doctor报告`state.shadow-workspace`，先分别备份并人工比较两个目录，再决定保留内容。

## 0.7.10-canary - 2026-07-13

本版本继续收口NeuroBook Manager的部署事务与发布门禁，重点避免Docker更新失败后留下新容器、已迁移数据库或不可安装的半成品Release。

### 更新说明

- GHCR与Source Docker更新现在会在切换前停止旧容器并备份SQLite/WAL状态；新容器启动、迁移或HTTP健康检查失败时，统一恢复旧数据库、旧Compose和旧镜像并重新启动旧实例。
- Fresh Docker安装失败会清理本次创建的Compose、容器和Source Docker本地镜像；进程中断后也由同一Operation Journal恢复，不再依赖当前命令的临时catch逻辑。
- Windows Release门禁直接从Portable目录外执行真实`Start Neuro Book.cmd`，由Manager完成migration和前台启动，再用Chromium验证首页挂载。
- Release先公开Source、Product、Portable和Stage 0 Payload，从公开下载地址重新校验大小、SHA256与GHCR digest；只有全部通过后才最后上传`release-manifest.json`与`SHA256SUMS`。Manager不会看到验证未完成的Release。

### 迁移指南

- Windows Portable用户请把旧目录中的完整`data/`复制到0.7.10的新解压目录，不要复制旧`.output`、`.runtime`或`.deploy`，然后运行`Start Neuro Book.cmd`。
- 已由Manifest v3管理的Product Bun、GHCR和Source Docker实例直接运行`neuro-book update`。Docker更新前请确保State Root所在磁盘有足够空间保存SQLite备份。
- 仍在0.7.8的用户必须重新解压新Portable；不要在0.7.8目录内覆盖更新。

## 0.7.9-canary - 2026-07-13

本版本是 Windows Portable 0.7.8 的紧急修复版，解决启动窗口直接关闭和服务启动后首页白屏的两个独立问题。

### 更新说明

- 修复生产构建中富文本与工作台 Vendor Chunk 相互引用的问题。新 Product 由 Vite/Rollup 按真实依赖图分包，首页不再因 `Cannot access ... before initialization` 而白屏。
- 修复 Windows `Start Neuro Book.cmd`、`Update Neuro Book.cmd`和`Create Admin.cmd`的Root参数。脚本会去掉目录末尾反斜杠，命令失败时保留窗口并显示退出码。
- 显式`NEURO_BOOK_STATE_ROOT`现在始终高于cwd和目录名推断。即使Portable解压在名为`workspace`的上级目录中，Project Workspace也会正确使用`data/workspace`。
- Release候选现在会在Windows Portable和Linux Product Bun中启动真实Product，使用Chromium验证Vue首页挂载、静态资源、浏览器异常和应用版本，不再只依赖HTTP版本接口判断发布健康。

### 迁移指南

#### Windows Portable

0.7.8 Portable不应继续使用。请下载0.7.9的`neuro-book-windows-x64.zip`并解压到新目录：

1. 完全退出旧NeuroBook，并备份旧目录中的`data/`。
2. 将完整`data/`复制到新Portable根目录，覆盖新包中的空状态目录。
3. 不要复制旧`.output`、`.runtime`、`.deploy`、`app/`或`app/workspace` junction。
4. 在新目录运行`Start Neuro Book.cmd`；需要检查时运行：
   ```powershell
   .\.runtime\bin\neuro-book.cmd --root . doctor
   ```

Workspace、配置、SQLite和日志会继续从`data/`读取。创建管理员后，Portable会把`data/config.yaml`中的鉴权开关设为启用，重启后生效。

#### 已有NeuroBook Git checkout

先确保Git工作区干净，并确认`origin`指向受支持的NeuroBook仓库。Manager不会自动stash、restore或reset用户改动。

```bash
cd <neuro-book-root>
bunx --bun @notnotype/neuro-book-manager@canary adopt . --profile source-dev
```

将`source-dev`替换为`source-product`或`source-docker`即可选择对应部署方式。历史无metadata的`.output`不会被信任：Source Dev会保留但不纳入Manifest，Source Product会在事务中重新构建并仅在健康检查通过后切换。

如果目录已经包含有效的Manifest v3，只需导入用户级实例索引：

```bash
bunx --bun @notnotype/neuro-book-manager@canary instances import <installation-root>
```

Manifest v1/v2不提供兼容迁移，必须重新安装或对Git checkout执行`adopt`。

#### Product Bun、GHCR与旧Docker部署

不要手工混合不同版本的Source和`.output`，也不要把旧Compose状态直接写入新Manifest。推荐使用Manager在新Installation Root重新安装对应Profile，然后迁移State Root中的用户状态：

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

- Product Bun选择`product-bun`，Manager会下载同一Release Manifest中的Source和平台Product。
- 预构建容器选择`ghcr`，宿主机不需要源码checkout。
- 需要从源码在容器内构建时选择`source-docker`。

迁移前备份`workspace/`、`config.yaml`和`.env`。Windows Portable迁移完整`data/`；其他Profile迁移对应State Root。不要复制旧`.runtime`、`.deploy`或来源不明的`.output`。

#### 更新后检查

在Installation Root执行：

```bash
bunx --bun @notnotype/neuro-book-manager@canary update
bunx --bun @notnotype/neuro-book-manager@canary doctor
```

如果Manager提示版本过低，按提示重新运行最新`@canary`命令。`doctor`通过后再启动实例；原生Product更新前必须先停止正在运行的服务。

## 0.7.2-canary - 2026-07-11

这次 patch 集中收口 Agent Profile 的通用运行设置、自动摘要、Workspace 语义和发布产物一致性，同时修复 Markdown 编辑器的若干边界问题，并降低 llmlint 自动改写风险。

1. Agent 通用运行策略统一
Summarizer、Compaction 和单文件 diff 上限现在由 Harness 统一解析。设置支持 Global 通用默认、Global Profile 覆盖、Project 通用默认和 Project Profile 覆盖；Profile 源码只通过 `runtimeDefaults` 提供更低优先级的出厂策略。复杂策略按字段继承，trigger 与 keep-recent 等判别联合整体替换。手动 `/summarize` 和 compact 即使自动开关关闭也会使用最终策略强制执行；summarizer system session 不递归摘要并默认关闭 Compaction。

设置审查轮进一步修复了仅修改通用 runtime defaults 时无法保存的问题。空白字段明确表示继承，非法非空输入会在对应字段下报错而不会静默删除覆盖；界面会标明继承值来自 Harness、Profile、Global 或 Project 的哪一层。Profile 源码默认值与 Config 保存值现共用同一严格 schema。

2. Profile Workbench 公开表面进一步简化
`FileChangeNotice` 节点只保留 `mode`，单文件 diff 预算不再经过 Profile settings 或 turn plan，而是在 Harness 物化 notice 时注入最终 runtime 值。Variable 系统的运行时能力、`ctx.vars`、definition artifact 和全局工具仍然保留，但 `Variable` / `VariableSchema` TSX helper、`builtin.variable` Profile 绑定和 Workbench 变量插入暂时下线，减少 Profile 作者面对的重复入口。

发布前同时修复了 Profile settings fallback 的优先级回归：直接调用 Profile prepare 时，用户设置现在稳定覆盖表单默认值；`leader.assets` 的“最高优先级置顶提示词”不会再被空默认值覆盖。运行策略已经与 `settingsForm` 完全分层，不再需要 diff 保留键或 prepare fallback 补值。

3. Agent 文件提醒和 Workspace 语义更准确
文件变更 notice 改为英文 Git 风格状态，能区分 added、modified、deleted、renamed、restored 和 reverted，并继续保留 hunk、diff 统计、安全阻断、预算与 at-least-once 游标语义。敏感路径即使超出前四个 diff detail，也只显示不可点击路径与 file change inbox 指引，不会通过通用 footer 建议 Agent 主动读取。Reminder 状态分离“已观察值”和“实际注入轮次”，空 linked agents 不再产生空提醒，清空后重新关联同一 Agent 仍能再次通知。文档与提示词明确：Current Project Workspace 只是默认焦点，不是访问边界；普通 Agent cwd 始终是 Workspace Root。

4. Markdown 方言和模式切换更稳
`StructuredTextEditor` 在 rich/source 模式切换前同步结算两个编辑器的防抖输入，修复 300ms 窗口内切换可能丢失末尾输入的问题。Markdown 方言扩展组改为真实编辑器与测试共用的单一来源；HTML fallback 使用真实配对闭合判据，规范化规则与 tokenizer 保持同构；Inline AI 引用高亮的全文文本映射改为每轮只构建一次，避免随引用数量重复扫描全文。

5. Portable Profile artifacts 发布校验加强
`profile status` 发现 `compile_stale` 时会返回非零退出码。Product staging 会按 manifest 当前引用清理隔离副本中的历史 Profile artifacts，并同时校验 artifact / type artifact 是否存在、是否携带构建机绝对路径；Windows Portable 使用同一套 manifest 归一化规则，兼容数组与按 Profile key 索引的序列化形态。

6. 鉴权配置迁移到 Boot Config
`auth.enabled` 从可热更新的 Global Config 移到启动期 `config.yaml`。服务器部署默认开启、Windows Portable 默认关闭；创建管理员后会更新 Boot Config，并在重启后生效。管理员 API 统一使用同一守卫，鉴权关闭时本地放行；非法 Boot Config 会明确失败，不再静默伪装成默认值。

7. llmlint 自动修复权限更保守
默认规则集只保留 3 条无需语境判断的机械规则为 `fixability:auto`，不默认启用 candidate，其余规则均为 manual。规则带有 `action.replace` 只表示存在替换模板，不再隐含允许自动应用；最终是否可自动或候选修复，统一以配置合并后的 `fixability` 为准。

8. Profile 设置合并与旧 artifact 升级修复
Profile 直接 prepare 的默认设置遵循“表单默认值 < 调用方设置”，通用文件 diff 预算只补缺失项，不再覆盖用户已有设置。Profile 核心 helper 的语义变化会通过 compilerVersion 7 强制旧 bundle 失效重编，避免状态显示 loaded 但实际仍执行旧设置合并逻辑。

本轮发布前执行全仓类型检查，并覆盖 Profile / Harness / Config、Markdown 方言、Portable manifest、llmlint 与相关契约测试。浏览器验收未自动执行，建议重点手动检查普通 Profile 的自动摘要开关、StructuredTextEditor 快速切换模式，以及 Profile Workbench 精简后的编辑流程。

## 0.7.1-canary - 2026-07-10

这次 patch 是 0.7.0 canary 的验收与契约同步版，不新增业务代码，主要补齐 Agent 文件变更收件箱的最终验证结果和公开行为说明。

1. 文件历史操作的并发边界正式确认
Inbox 与每个变更组都以 revision 作为版本前置条件。读取 diff、接受、回退和接受全部时如果页面持有的是旧版本，服务端统一返回 412 并要求刷新，不会对已经变化的文件版本继续读取或执行操作。

2. 旧请求不会污染新项目或新版本
Composer 与完整 History Dialog 的 diff 请求按 `projectPath + path + revision + mode` 隔离。切换项目、刷新 Inbox 或卸载组件时会取消旧请求；延迟返回的旧项目、旧 revision 响应不会覆盖当前界面。

3. 敏感文件与 Agent 提示词预算说明补齐
敏感路径黑名单明确覆盖 `.ssh`、`.aws`、`.azure`、`.kube`、`.docker`、`.gnupg`、所有 `.env` 变体、常见凭据文件及私钥格式，并在读取 snapshot 正文前阻断。Agent 文件变更提醒最多展开 4 个文件详情、逐项列出 50 个文件，inline diff 总额最多 8192 字符，最终 notice 不超过 12,288 字符；Profile 只能收紧单文件预算，不能放宽系统上限。

4. 删除文件与大批量变更行为明确
已删除文件不会生成指向当前路径的无效链接；小型删除可展示 removed diff，超限时引导用户到文件变更收件箱审查或还原。文件超过逐项上限时会给出准确遗漏数量，并在成功交付后推进全部已见变更的游标，避免大批量改动反复提醒。

5. 浏览器终验完成
已在真实 Project 中验证收件箱默认收起、展开动画、滚动行为、同名子目录文件打开、Agent 模式自动展开 Studio、小型 diff、`.envrc` 正文阻断、旧响应隔离，以及 accept / revert / accept-all 的 412 刷新行为；验收产生的临时文件已清理并恢复原 Inbox 基线。

本轮发布前重新运行全仓类型检查和完整 Vitest。全套并发运行中，计时敏感的 Profile / Harness / Workspace Files 套件在负载下出现固定超时；所有受影响文件随后串行复跑并全部通过（5 files / 316 tests），未发现稳定业务失败。浏览器验收沿用 Task 102 已完成的真实终验记录，不重复自动启动浏览器。

## 0.7.0-canary - 2026-07-10

这次 minor canary 重点改善长篇写作时的编辑性能、Agent 文件变更审查和 Plot 规划体验，同时完成许可证迁移与一批运行时安全收口。

1. Markdown Studio 长文输入更流畅
富文本与源码编辑器统一使用防抖更新协议，输入过程中不再每次按键都触发多轮全文序列化、扫描和隐藏编辑器同步。切换文件、保存、磁盘同步和外部工具改写前会先结算待提交输入，并抑制自己保存产生的 watcher 回声，降低长章节卡顿和文本被旧磁盘内容覆盖的风险。

2. Markdown 方言能力扩展
评论统一为 `<comment>`，同时支持行内评论和跨段落评论块；新增 `<ruby>` 注音、`<bilingual>` 双语对照和显式 `<html>` 交互块。未知 HTML 默认只保留源码，不直接执行；显式 HTML 块需要用户点击后才在 sandbox iframe 中渲染。空文档、残缺标签和混合 Markdown 的 round-trip 也增加了回归保护。

3. Agent 文件变更收件箱
Agent 输入区上方新增默认收起的文件变更卡片，可查看 Project Workspace 相对路径、小型安全 diff，并执行单文件接受或接受全部；完整 Monaco 审查 Dialog 继续保留。`.env`、凭据、私钥、证书和 `.ssh` 等敏感路径在服务端读取正文前就会被阻断，大型或二进制变更只返回统计与文件引用。

4. Profile 提示词顺序与变更感知收口
Provider 消息顺序固定为 `History → ModelContext → AppendingSet → CurrentUserInput`，真实用户输入不再被 Writer 或 Inline Editor 重复复制。文件变更提醒改由 Profile DSL 的 `<FileChangeNotice />` 显式声明：Leader 使用完整模式、Writer 使用精简模式、Inline Editor 默认关闭；只有提醒成功进入模型后才推进游标，失败会在后续回合重试。

5. Plot 规划工作台更完整
剧本工作台收敛为线程规划、承诺账本和决策记录三个真实页面。承诺可查看铺垫/升级/兑现时间线并执行兑现、放弃、重开；决策可记录候选方案、风险、拍板理由和失效原因。Scene / Thread 编辑补齐结果类型、节奏职责与 MICE 类型，引用候选改接 Project Workspace 真实内容节点，相关刷新和错误展示也做了修正。

6. Project 生命周期与操作历史继续硬化
Project 数据面入口进一步统一要求显式打开项目，RAG、Profile Home、配置和相关 worker 路径补齐生命周期守卫。Workspace History 的安全 diff、收件箱查询、接受/回退和 Agent notice 共用同一套服务端策略，减少不同入口各自解释历史数据造成的偏差。

7. 许可证迁移到 AGPLv3
NeuroBook 与内置 llmlint snapshot 的许可证统一为 `AGPL-3.0-only`，README、manifest 和官网文案同步更新。第三方写作参考、本地文风素材和旧致谢文件不再进入 Git 或 Product source snapshot；用户用 NeuroBook 创作的独立作品不会仅因使用本软件而自动适用 AGPL。

8. llmlint 与交互细节更新
内置 llmlint snapshot 同步规则注册和修复能力更新；Profile Template、Plot 编辑器、文件历史、API 错误消息与中英文文案也完成了一轮一致性修整。

本轮自动化验证覆盖 Markdown 方言与空文档回归、Workspace History、Agent tools、Profile DSL / prompt 顺序、Plot 服务和全仓类型检查；各任务记录中的聚焦套件均已通过。浏览器交互未自动执行，发布后建议重点手动验收长章节连续输入、Markdown 新方言、Agent 收件箱小 diff / 敏感文件阻断、Profile 提示词行为，以及 Plot 承诺和决策工作台。

## 0.5.7-canary - 2026-07-06

这次 canary 主要是写作工作台体验、Plot/Writer 架构、Agent 可观测性和主题系统的一轮大更新。

1. Agent 请求可观测性
新增 Pi 请求 trace 记录与查看器。Agent 主 turn、sidecar、compaction 的 provider 请求会记录模型、usage、耗时、TTFT、规范化 context 和原生 payload；IDE 顶栏新增 Trace 入口，可按最近请求、session 或 system scope 查看详情。Trace 默认不进入可分享日志包，避免泄露 prompt 与正文。

2. Plot 升级为两棵树
Plot 从 Scene-only 进一步升级为承载树和因果树：Story -> Act -> Chapter -> Prose，以及 Story -> Phase -> Thread -> Scene。Scene 通过 `chapterId` 与 Chapter 交汇，ChapterBrief 成为 `StoryChapter` 的一等字段组，用于保存章节目标、POV、信息控制、节奏、开头收尾和禁写事项。

3. Writer brief 更结构化
writer 的章节 brief 改为基于 StoryChapter / Scene / World Engine 上下文编译，支持 autonomous 模式下的 Plot 只读工具和 ChapterBrief 信息控制。原 Task 80 ChapterOverride 已被 ChapterBrief 吸收并归档。

4. Plot 前端工作台迁移
Plot 面板从 manuscript 文件树派生章节，迁移为使用 StoryChapter 实体。新增章节编辑、ChapterBrief 表单、章节管理条、新建卷对话框和 Prose 关联视图。新 UI 还未做浏览器验收。

5. 主题系统 v2.1 与自定义主题
主题变量收口到 36 个 v2.1 token，8 套内置主题保留，World Engine / Agent / Markdown / diff / settings 等入口同步改用语义变量。设置页新增自定义主题编辑器，支持实时预览、核心调色、全变量编辑、重新生成、JSON 导入导出和取色器。浏览器全流程验证仍待执行。

6. Workshop 平台推进
`nb-workshop` sibling 仓完成 Phase 1 后端、Web 前端和友好上传流程：浏览、详情、发布、个人页、admin、邀请码、评论/点赞/收藏/举报、zip manifest 校验与在线编辑打包均已记录到 Task 88。NeuroBook 客户端安装闭环仍是后续 Phase 2。

7. Agent 模式系统准备
新增 normal / discuss / plan 三模式设计与相关前后端改造基础，目标是把“只读讨论”“只读计划”“正常执行”明确分开，并让只读模式下的写操作走用户审批。该系统仍以 Task 90 的后续实现和验证为准。

8. 其他体验与文档
Markdown Studio、Agent 气泡、Profile Template Editor、设置页、低代码表单、World Engine Workbench、参考文档和主题规范都有一轮 UI 与契约同步。

本轮验证主要来自各任务记录：Task 86 后端/reader/view-model/guard 单测与真实 provider smoke，Task 87 backend plot/profile/API 测试和 typecheck，Task 88 sibling 仓 typecheck/test/build，Task 89 聚焦主题测试与 OpenAPI 生成。部分前端新 UI 尚未浏览器验证，release 后建议重点手动验收 Trace 查看器、Plot ChapterBrief 编辑器、自定义主题编辑器和 Workshop 客户端后续接入路径。

## 0.5.6-canary - 2026-07-03

这次修复 GHCR 部署和管理员创建链路，重点是让安装器、镜像版本和 Product Runtime 合同重新对齐。

1. GHCR 部署可以选择 release 版本
当时的旧 GHCR 部署入口会在交互模式列出 stable / canary / alpha / beta / rc 版本，并保留 release tag 原始大小写。非交互模式默认使用当前安装器版本对应的镜像 tag，不再让 canary 安装器默认拉旧的 `latest`。`latest` 只代表最新 stable。

2. 管理员脚本不再误走宿主机源码
文档和部署 README 会按 local-git、ghcr、source Docker 分别给出管理员创建命令。ghcr 使用容器内 `.output/server/scripts/cli/create-admin.ts`，依赖镜像内 Nitro vendor 和打包好的 `nbook` runtime package。

3. Prisma Client 缺失时行为更清楚
local-git / source 源码运行时如果缺少 `server/generated/prisma/client.ts`，CLI 会先自动执行 Prisma generate。Product / GHCR 运行时不会在运行机生成 Prisma Client，而是检查 `.output/server/node_modules/nbook/server/generated/prisma/client.ts`，缺失时直接提示拉取匹配镜像或重新构建。

4. 构建门禁补齐 Product 运行文件
Nuxt/Nitro 后处理和 Product staging 都会检查管理员脚本、`has-users`、Prisma preflight、SQLite migration、Prisma schema/config 和打包后的 Prisma Client，避免镜像发布后才发现运行文件缺失。

5. 源码管理员命令缺依赖时提示更明确
local-git / source 管理员脚本在自动补 Prisma Client 前会先确认本地 Nuxt CLI 是否存在；即使 `.nuxt/tsconfig.json` 残留，只要源码依赖没有安装，也会直接提示先 `bun install --frozen-lockfile`，并提醒 ghcr 用户改用容器内 Product 脚本。`nuxt:prepare` 失败和 Prisma generate 失败也会分开报告，不再误导为同一个错误。

6. World Engine 配置加载不再依赖项目目录临时模块
`calendar.ts` 与 `schema/index.ts` 仍保持单文件 TypeScript 配置入口，但转译后的 `.mjs` 现在会进入统一 runtime artifact cache 后再导入。Project Workspace 下的 `.world-engine-*.mjs` 只作为短暂中转文件，避免 Product / Agent 环境在加载时误把被清理的临时文件当成根因。

本轮已验证管理员脚本最小复现、源码缺 Nuxt CLI 提示、残留 `.nuxt` 但缺依赖提示、GHCR dry-run、GHCR tag dry-run、World Engine 用户配置 smoke、Product runtime smoke、`bun run nuxt:build` 和 `bun run product:stage`。Docker smoke 因当前本机没有 `docker` 命令未执行。

## 0.5.3-canary - 2026-07-01

这次 patch 继续修产品运行时加载和 llmlint 工程结构，适合在 0.5.2 canary 基础上验证。

1. Product / Nitro 动态 artifact 加载更稳
新增服务端内部 `importRuntimeArtifact()`，让运行时生成的 `.mjs` 文件通过原生动态 import 加载，避免 Product/Nitro bundle 接管 `import(variable)` 后无法解析运行时文件路径。World Engine schema/calendar、profile compiled artifact 和 variable definition artifact 都改走同一入口。

2. World Engine 配置加载继续收口
`calendar.ts` / `schema/index.ts` 仍先转译为 hash `.mjs`，再通过新的 runtime artifact import 加载。这样既保留 TypeScript 配置入口，也避免产品包里动态生成模块被打包器解析路径误伤。

3. llmlint 切到 sibling 独立开发仓
llmlint 真相源改为 sibling `../llmlint` 仓库；NeuroBook 内的 `assets/workspace/.nbook/agent/skills/llmlint/` 现在只是 `../llmlint/skill` 的 runtime snapshot。新增同步脚本把 skill 镜像回 NeuroBook，并清理旧嵌套 `.git`、`node_modules`、`evals` 和 `.gitignore`。

4. user-assets 同步更干净
真实用户 runtime 副本会硬切清理 llmlint 旧开发资产，避免把仓库元数据、依赖目录或评测语料同步进用户 workspace。

5. llmlint 评测指标口径修复
eval harness 的文档负担分数改用去重 span / 千字，AI 检测器 AUC 和模型排名不再被同一句多规则重复命中放大；报告也补上人类侧 Agent 桶误杀率。

6. llmlint 规则与测试去 scratch 化
curated import 测试改用最小 fixture，不再依赖旧临时规则样本目录；规则文档也把历史 scratch 路径改成稳定描述。内置规则文件同步了本轮从 sibling 仓镜像回来的最新 snapshot。

验证记录来自对应任务：runtime artifact import 覆盖了 helper 单测、World Engine、profile、variable definition、Nuxt build、product stage 和 staged Product smoke；llmlint sibling 仓迁移记录了独立仓测试、同步脚本、user-assets 清理和 runtime 副本检查；eval harness 记录了 fixture 与真实小样本指标重跑。本次发布不等待 GitHub Actions release workflow。

## 0.5.2-canary - 2026-07-01

这次 patch 主要修产品运行时兼容性和 llmlint 文档口径，适合继续在 0.5.1 canary 基础上验证。

1. World Engine 配置加载更稳
`calendar.ts` 与 `schema/index.ts` 仍保持 TypeScript 入口，但运行时会先转译成内容 hash `.mjs` 再导入，不再依赖宿主环境能直接动态导入 `.ts` 文件。Product runtime 也会带上 `nbook/world-engine/schema` helper，避免产品包里解析 schema helper 失败。

2. 临时模块清理更完整
World Engine loader 会清理旧 `.world-engine-*.ts` 与新 `.world-engine-*.mjs` 临时文件，减少异常中断后残留文件影响后续加载的可能。

3. Agent 结构化提问面板更宽松
Agent pending user input 的结构化问题区域高度上调，选项和说明较多时不容易显得拥挤。

4. llmlint 安装与运行说明更准确
llmlint 文档改为推荐通过 `skills` CLI 安装，并明确运行时是 Bun 原生或 Node + `tsx`；裸 Node 直接运行 TypeScript 源码不是支持路径。`fix` 命令、`fixability:auto` 和自动修复说明也同步到当前实现。

5. llmlint 发布模型说明收口
文档澄清 `assets/workspace/.nbook/agent/skills/llmlint` 既是 NeuroBook vendored runtime snapshot，也是 llmlint 独立发布仓的就地嵌套 git 工作区；早期 `.agent/workspace/llmlint` 只是废弃 scratch 克隆。

6. llmlint eval harness 跑出首轮真实 lift
评测生成侧已经能用真实模型从 brief 生成 render，并跑出第一张 AI vs 人类文本判别报告。小样本显示 ROC-AUC 1.000，deepseek-v4-flash 在当前样本上比 mimo 更接近人类文本；该结果只作为 M3 扩量前的方向性验证。

验证记录来自对应任务：World Engine loader 增加了 TS-only schema、`nbook/world-engine/schema` helper 和临时模块清理测试；llmlint 文档收口记录了 Bun、Node+tsx、裸 Node 三态验证，以及 skill/assets 双拷贝一致性检查；eval harness 记录了模型 smoke、brief/render 生成和首轮 lift 报告。本次发布不等待 GitHub Actions release workflow。

## 0.5.1-canary - 2026-06-30

这次 patch 主要是性能和工具体验打磨，适合在 0.5.0 canary 的基础上继续验证。

1. 项目列表速度优化
`/api/projects` 增加了 5 秒短缓存和分层统计缓存。Novel IDE 主入口不再发会绕过缓存的 include-only 查询，项目列表热请求可以直接命中缓存；接口也加了 `Server-Timing` 分段，方便之后继续定位慢点。

2. 项目列表后台预热
服务启动后会后台渐进预热 Project manifest、Agent session count 和单项目统计缓存，不阻塞服务启动，也不会把第一个真实请求绑进全量预热。

3. llmlint 命令行更像一个真正的稿件工具
`llmlint check/fix` 支持 tinyglobby glob 输入，例如 `manuscript/**/*.md` 和 `!drafts/**`；输出在终端下会有颜色，在 JSON、管道或 Agent 抓取时保持纯文本。

4. llmlint 依赖自包含
llmlint skill 目录声明并安装自己的运行依赖，部署副本也能直接解析 `tinyglobby` / `picocolors`，减少产品环境里“根依赖碰巧存在”的隐患。

5. llmlint 评测体系进入第一阶段
评测 harness 的消费侧和数据获取文档已落地：支持 reference / brief / rendition / plot group 这套语料合同，后续可以用 AI vs 人类配对 lift、检测器 AUC 和模型“最像人类”排名来治理规则质量。

6. 文档与发布纪律
`AGENTS.md` 已补充发布流程：发布前读 tasks、更新 `RELEASE.md`，canary 发布命令统一带 `--no-watch`，创建 GitHub Release 后不再等待 GitHub Actions。

验证记录来自对应任务：Task 83 记录了 5 files / 19 tests passed 与 typecheck passed；Task 77 记录了 llmlint CLI、glob、颜色、自包含依赖和 user-assets 同步验证；Task 82 记录了 M1 consumer/acquisition 的 fixture 自检与 reference 输入策略。本次发布不等待 GitHub Actions release workflow。

## 0.5.0-canary - 2026-06-30

这次更新是"写作模式"第一版的收尾，把剧情系统、世界设定、AI 助手、AI 痕迹检测工具这几块核心功能做稳定了。

1. 剧情系统大幅简化
以前写剧情要进一个单独的界面，现在直接在正常写作界面里就能写。剧情结构也砍简单了——只保留"场景（Scene）"这一个概念，原来那套"故事线 /
剧情节拍"废弃了。每个场景靠"什么时间、在哪、有谁出场"跟世界设定挂钩。

2. 场景能联动世界设定了
写场景时能直接查到对应的世界设定和角色当时的状态。剧情工作台加了新功能：编辑场景与设定的关联、选角色/地点、看上下文。AI
也能拿到"这一章该怎么写"的简报。

3. AI 助手的配置更可靠
配置编译后的存储方式改了，保证绝不会用到过期或编译失败的旧配置。设置页能看到编译状态，而且这套机制不再拖慢编辑器。

4. AI 助手的工具交互更顺
"AI 向你提问"的功能独立成了专门的问答机制。读文件、改文件、审批、计划模式这些操作在中断后能更好地恢复，还加了行号定位和预检查。

5. llmlint（AI 痕迹检测工具）增强
- 检测规则从目录里自动加载，新增了整篇稿件级别的检测
- 命令行能扫多文件/整个目录，能自动修掉零宽字符、重复标点这类"一看就是 AI 写的"机械痕迹
- 搭好了单独发布到 GitHub 的骨架（独立命令行工具 + Agent Skill）
- 设计完了一套评测方法：拿 AI 写的和人写的对比，看检测器能不能区分、哪个模型写得"最像人"

6. AI 助手的 MCP 配置方案
第一版架构设计定了，关键点是 MCP 配置不会拖慢编译。

7. 文档同步
相关文档都更新到了最新状态。
