---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-13
superseded-by: null
---

# ADR 0051：桌面版用 Electrobun 壳托管随包的 Bun 与服务端，状态根与 `nbook` 共用，打产品版本标签由 CI 验证后全自动发布

- 日期：2026-11-13
- 决策者：开发者（2026-11-13 在 w00046 t01 里的几轮决定，接受提案时确认）
- 关联工作：[w00046 t01](../../.agents/works/w00046-desktop-release/tasks/t01-distribution-proposal/README.md)；提案 [桌面发行](../proposals/desktop-distribution.md)
- 部分取代：[ADR 0033](0033-app-delivered-as-built-npm-package.md) 决定 6 里“桌面壳在 Electrobun、Tauri、Electron 里实测后选”这一句；0033 的其余决定不变，状态根缺省、一个状态根一个实例、npm 应用包与 `nbook` 都照旧。

## 背景

ADR 0033 让新应用以构建产物的 npm 包发布，用户要先装 Bun、在终端里运行 `nbook`；目录包与桌面壳留给另一份提案。不用命令行的写作者在这一步就被挡住，Windows 上尤其如此。发布也靠开发者在本机手工跑 `release:publish`。

t01 在 Windows 上实测：新应用的服务端能跑（`smoke:server` 十过九，只有 Windows 没有的 SIGTERM 不过），Agent 的命令工具跑在 pi-natives 内嵌的 shell 里、不需要 Git Bash；Electrobun 原型能构建、安装、起服务端、开窗口、经标准输入有序停止、卸载，安装包约 86 MB；GitHub 的 Windows runner 能无人值守地构建与冒烟。两轮设计审查之后提案定稿。

## 决策

1. **桌面壳用 Electrobun，候选 Electron。** 开发者直接选定，不再按 ADR 0033 决定 6 在三者之间逐一实测；Electron 只在遇到 Electrobun 解决不了的阻断时启用。随包 Bun 的版本由 Electrobun 版本决定，Hutch 与 Electrobun 的版本固定，升级单独提交。
2. **壳只管窗口与服务端的寿命。** 壳用随包的 Bun 拉起应用包里的托管入口 `server/main.js --stop-stdin`，从实例认领的应答取地址；同一状态根上只有一个桌面壳，连接已有实例的判定与 `nbook start` 相同；关窗先经页面的关闭前询问，最后一个窗口关闭、服务端归自己时经标准输入有序停止。产品逻辑都在服务端与页面里。
3. **桌面载荷由发布到 npm 的同一个应用包组装**，不另外构建；桌面包与应用包同一个产品版本。
4. **状态根沿用 ADR 0033 的缺省，与 `nbook` 共用**，不放进 Electrobun 管理、卸载时可能被删的目录；便携版的状态根在程序目录里，由 CI 写入的标记识别。
5. **先做 Windows**：无界面的 setup 安装包（按用户安装）与便携 zip；不做代码签名。
6. **自动更新只靠 HTTPS，只升不降，下次启动时换上。** 更新源是 GitHub Releases；壳在下载前核对版本号，不接受更低的版本；出问题发递增版本的修复版。
7. **打产品版本标签 `v<产品版本>` 全自动发布。** CI 在标签提交上先跑与合入相同的验证，再构建、冒烟一批产物，用这同一批产物发 npm（npm CLI 走 trusted publishing）与 GitHub Release（先草稿，核对后公开）；重跑复用原产物，不往回拨任何“最新”。九个源码包保留各自的版本与“没发过才发”的规则（ADR 0029 不变）。

## 备选方案

- **按 ADR 0033 决定 6 三选一实测**：开发者看重 Electrobun 的体积与自带的安装、更新、CI 示例，直接选定；对照数据只有旧应用 2026-08 的同类实测（Electron 便携包 230 MB 以上，Tauri 与 Electrobun 相近）。
- **目录包加系统浏览器的独立窗口（Edge `--app`）**：没有安装程序与更新器，便携天然成立；但窗口行为、关闭前询问、单实例与自动更新都不由我们控制。开发者已选定桌面壳，没有另做比较。
- **状态根放进 Electrobun 的应用数据目录**：卸载时能一并删除，但“应用和数据”这个选项会连作品登记与设置一起删，且与 `nbook` 不通。
- **自签更新清单**（不买证书，应用里写死公钥验签）：开发者接受只靠 HTTPS，不做。
- **关窗时换上更新**：Electrobun 2.0.6 换完文件必定重新打开应用，关窗时换会让应用自己重开；改为下次启动时换。
- **本机手工发布作为唯一入口**：保留为备用，主入口改为打标签。

## 后果

- 写作者不需要装 Bun 与命令行；代价是每个产品版本多一份约 86 MB 的桌面包，WebView2 的版本随用户机器变化。
- 应用包新增托管入口；`--stop-stdin` 与实例认领的应答成为桌面壳依赖的合同；页面与壳之间新增关闭前询问的约定，编辑器与浏览器宿主的 Spec 随之修改。
- 发布的信任边界是 GitHub 账号与 HTTPS：能改 Release 的人能给已装用户推更新。SmartScreen 会对未签名的 setup 显示“未知发布者”。
- `release:publish` 增加 CI 入口（核对标签提交、用 npm CLI 发布），11 个包都要在 npm 上配置信任发布工作流；`repository-workflow.md` 的发布一节随之改写。
- 以后换壳时服务端合同不变，但已装用户的安装目录、WebView2 数据与更新通道要迁移；Electrobun 的应用标识、发布频道与更新源地址发出去以后就不能随意改。
