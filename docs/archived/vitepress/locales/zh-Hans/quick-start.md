# 快速开始

这页只保留最快路径。更完整的部署取舍见 [部署方式](/deployment)。

## 方式一：Windows 解压即用（普通用户）

Windows 用户优先用这个。不需要理解 Docker、终端或服务部署。

**第 1 步：下载**

打开 [GitHub Releases 页面](https://github.com/notnotype/neuro-book/releases)，在**完整 Release** 的 Assets 里找到文件名准确为 `neuro-book-windows-x64.zip` 的压缩包下载。

不要下载名字里带 Source 或 Product overlay 的包，那些是给开发者的。

**第 2 步：解压**

解压到一个新建的空目录，例如 `D:\NeuroBook`。不要解压到桌面或系统盘根目录。

**第 3 步：启动**

双击目录里的 `Start Neuro Book.cmd`。会弹出一个黑色命令行窗口——**这是正常的，不要关掉它**，它就是服务本身，关掉软件就停了。

**第 4 步：打开界面**

在浏览器地址栏输入：

```
http://localhost:3000
```

首次启动会自动初始化 `data/` 目录（你的作品、配置和日志都在这里面）。Windows 解压版**默认不需要密码**，直接就能用。

![NeuroBook 主界面](/images/主页.png)

**第 5 步：配置 AI 模型**

这一步不做的话 AI 功能全部不可用，见下方 [配置 AI 模型](#配置-ai-模型)。

::: tip 更新
不要用新版 zip 直接覆盖旧目录，会丢配置。用解压目录里的 `Update Neuro Book.cmd` 更新，`data/` 里的内容会保留。
:::

::: tip 需要密码保护
如果这台机器别人也能碰，双击 `Create Admin.cmd`，按提示输入用户名和密码即可开启登录。
:::

## 方式二：NeuroBook Manager（服务器 / 多实例）

服务器优先用 GHCR 容器；已装 Bun 的机器也可以选 Product Bun 或 Source Profile。

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr
```

Canary 阶段固定用 `@canary`；稳定版发布前不要改成 `@latest`。也不要写成 `bunx run @notnotype/...`，那样会把包名当本地脚本解析，Manager 不会启动。

不带参数会进交互向导。管道执行或自动化环境没有 TTY，必须显式传参：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --dir /opt/neuro-book --port 3000 --yes
```

安装完成后进入 Installation Root 启动：

```bash
.runtime/bin/neuro-book start
```

默认监听 3000 端口。更新、状态和诊断用 `neuro-book update` / `status` / `doctor`。**怎么停止服务、怎么开机自启、怎么配反代**，见 [运行、数据与隐私](/operations)。

**服务器 Profile 默认开启登录鉴权**，安装后创建管理员：

```bash
neuro-book admin create
```

::: warning 鉴权默认值按 Profile 不同
Windows Portable **默认关闭**密码保护，其余 Profile（GHCR、Product Bun、Source 系列）**默认开启**。可以用 `--auth enabled|disabled` 显式指定。
:::

## 配置 AI 模型

NeuroBook 自己不提供 AI 能力，它调用你配置的**模型 Provider**——也就是提供大模型 API 的服务商。你需要在服务商那里申请一个 API Key，填进 NeuroBook。

启动后进入**设置页 → 模型**，按下面的顺序完成配置：先选择 Provider，再填写 API Base 和接口格式，随后填写 API Key，最后确认模型条目。每一步都有独立标注图：

1. 选择 Provider：![选择 Provider](/images/tutorial-api-config-step-01-provider.png)
2. 填写 API Base 与接口格式：![填写 API Base 与接口格式](/images/tutorial-api-config-step-02-endpoint.png)
3. 填写 API Key：![填写 API Key](/images/tutorial-api-config-step-03-api-key.png)
4. 确认模型条目：![确认模型条目](/images/tutorial-api-config-step-04-model.png)

教程图片只展示脱敏占位；不要把真实 API Key 发到聊天、截图或仓库中。同一个设置页里还能给不同 Agent 单独指定模型（例如让写正文的 writer 用更强的模型，让摘要用便宜的）。

关于费用：**NeuroBook 本身免费开源**，花钱的是模型调用，费用由你选的服务商计价、直接结算给服务商。NeuroBook 会把每次调用的 token 按输入 / 输出 / 缓存创建 / 缓存命中分项计量，并换算成美元和人民币显示，所以「写这一章花了多少钱」是能查到确切数字的。

关于隐私：你发给 Agent 的内容（包括正文和设定）会按需发送给**你自己配置的那个 Provider**，不经过 NeuroBook 的任何服务器。完整的数据流向、本地敏感文件位置和分享前要注意什么，见 [运行、数据与隐私](/operations)。

长期配置保存在 Global Config：

```text
<State Root>/workspace/.nbook/config.json
```

State Root 默认等于安装目录；Windows 解压版是安装目录下的 `data/`，所以实际路径是 `data\workspace\.nbook\config.json`。这个文件属于本机运行状态，不进 Git。

## 常见下一步

- 应用跑起来了，想开始第一本书：读 [从第一本书到前三章](/tutorials/)。
- 想了解 Windows、Docker、Product Bun 和 Source Profile 的差异：读 [部署方式](/deployment)。
- 想知道数据存在哪、怎么备份、怎么停服务：读 [运行、数据与隐私](/operations)。
- 想让 AI 协助部署或排障：把 [交付与运维桥梁](/operator-bridge) 发给它。
