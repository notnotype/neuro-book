---
schema: nbook.task/v2
taskId: t01-design
status: active
updated: 2026-11-19
---

# 设计：引擎、浏览器配置与登录态、对外操作的确认、域名范围

## 目标与范围

按 Work README 的“要讨论的问题”出设计。先调研并实测（开发者 2026-11-19：模型的 browser use 能力提升很大，这次要勤于实践），再与开发者讨论，之后写计划。

合同：只做设计，行为合同未变。

## 当前状态

2026-11-19 开工，调研与第一轮实测完成，开发者当天定了决定 1 到 4：[调研与实测](../../research/2026-11-19-browser-agents-survey.md)。

- 克隆到 `.local/github/`：browser-use、browser-harness、Agent-Reach、reader、bilibili-cli、opencli、page-agent（浅克隆，只读）。
- 实验脚本在 [`experiments/`](experiments/)：假作家后台（`author-backend/`，提交与提示注入的请求记进日志）、browser-use 与 omp 的运行脚本、注入与快照探针 `inject-probe.ts`、任务说明 `tasks/`。原始输出在本地 `.local/agent/works/w00034-browser-use/tasks/t01-design/`（`runs/`、`logs/`、`probe*/`），browser-use 装在同目录的 `venv/`。
- 实测结论摘要见调研的“结论先行”；开发者问的“opencli 为什么打开浏览器”在调研的同名一节。
- 没做：opencli 的扩展没在本机装起来跑（这台机器没有图形界面）；Gemini 经 `.env` 的中转超时，改经 omp 的渠道只跑了发布任务一次；没有绕过起点的反爬检测（权限分类器拦下，设计上也不做反检测伪装）。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-19 | 对外操作的审批从简：不区分读与写，浏览器的操作一律按执行档审批（与 eval、shell 同档），不做按站点的档位、网络层拦截或站点脚本里单独审批的“提交” |
| 2 | 2026-11-19 | computer use（截图加坐标）另开 [w00051](../../../w00051-computer-use/README.md)，本 Work 不做 |
| 3 | 2026-11-19 | 能力划分：`web_search`、`web_fetch` 单独一个插件，另开 [w00052](../../../w00052-web-tools/README.md)；本 Work 做通用的 browser use，并且应用要能导入并管理本机的登录信息；操作 NeuroBook 与当引导者是 [w00033](../../../w00033-page-agent/README.md)，与本 Work 的能力有重合，但不是一个东西 |
| 4 | 2026-11-19 | 登录态的方向：开发者看好 Agent-Reach 的做法（专用浏览器在后台运行、不弹窗；第一次用某个网站时从用户的 Chrome 复制这个站的登录，原浏览器不变，不读密码库；建议换小号）。它的实际做法与前提见调研“Agent-Reach 怎样复制登录”一节 |

## 下一步

还要开发者定（推荐见调研“对设计的含义”与下面）：

- 引擎用薄的 CDP 客户端、给模型薄接口（`browser.state()`、`browser.click({ref})`、`browser.evaluate()`、`browser.cdp()` 这一级），编号用 `backendNodeId`：开发者还没表态。
- 导入登录怎样读到用户 Chrome 里的 Cookie：Agent-Reach 要求用户的 Chrome 装着 OpenCLI 的扩展；Windows 上 Chrome 127 起磁盘上的 Cookie 库别的程序解不开（调研“直接读磁盘上的 Cookie 库行不通”）。候选：经 CDP 连用户的 Chrome（144 以上的远程调试开关，导入时点一次“允许”）、自己做扩展。推荐第一版用前者，只在导入的那一刻连。
- 后台无头会被风控拦（实测起点、Reddit），Agent-Reach 靠反检测的 CloakBrowser，我们不做反检测伪装。推荐缺省在后台跑，遇到验证页、要登录或用户想看时切成有界面的窗口交给用户；带着导入的登录在后台能不能过起点这类检测，要在开发者的机器上用真实登录实测。
- 管理：列出已导入的站点与账号、刷新、删除、指定来源配置；几个来源都有登录时让用户选。

定了再按 implementation-planning 写计划。w00033 的快照核心与这里共用；NeuroBook 自己的界面用 `v-nb-target` 指令登记的稳定名作引用（w00032 t16 决定 7、8、10），外部网页没有这种名字，用 `backendNodeId`。
