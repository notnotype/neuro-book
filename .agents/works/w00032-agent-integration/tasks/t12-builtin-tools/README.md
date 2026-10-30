---
schema: nbook.task/v2
taskId: t12-builtin-tools
status: planned
updated: 2026-10-28
---

# 基础工具与外部命令行依赖

## 目标与范围

定第一批内置工具清单与语义（读写、搜索、bash、网页、待办、提问），bash 与记账和只读模式的关系，以及 rg、git、uv 等外部命令行的依赖策略。

来源：需求 10、15（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 第一批清单：现有 read、edit，加 write、grep、glob、bash、网页搜索与读取、待办、提问；以 omp 为基础、参考 Claude Code。
- 工具经资源地址读写（t08）。
- bash 会绕过 nb-history 记账与只读模式，怎样处理。
- 外部命令行（rg、git、gh、python、uv、jq 等）：安装时装、首次用到时检测还是随应用带；Windows。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 2、5 节
- [`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)
- [文件工具四种模式的调研](../../../w00002-neuro-agent-harness-redesign/research/2026-09-18-file-tools-four-modes-design.md)

## 前置

t04、t06、t08。

## 决定（开发者 2026-10-28）

事实见[外部参照](../../../../../docs/research/agent-runtime-references.md)“shell 工具、执行时限与后台任务”一节：`pi-natives` 自带原生 `grep`、`glob` 与内嵌的 brush shell。

开发者已定：

- 网页工具（`web_fetch`、`web_search`）不进 Agent 插件，单独做成插件；网页搜索先不做，另开 Work。
- shell 工具叫 `shell`（`builtin.shell`），同 omp。

- shell 的洞（绕过只读模式、nb-history 记不上账、绕过地址读写规则、读到密钥、被诱导往外发数据、进程失控）第一版都不补：nb-history 记不上账不补；其余几条是以后专门做安全时再考虑的事，第一版的挡板只靠只读命令白名单与 auto 模式的审批模型判断。读到密钥可以用正则拦住大部分，但各家 code agent 目前都没处理，我们也一样，以后再说。进程失控随“后台任务”讨论。
- 外部命令行的策略按 2026-10-28 会话里的表记下，本 Work 不做，发布时再做：离不开的只有 Bun 与 `pi-natives`（grep、glob、shell 都在里面），随包带；uv、git、gh、jq、python、rg 只检测、不擅自安装；目录包与桌面壳里 uv 在第一次有 Skill 需要时经用户同意下载到 `<状态根>/tools/` 并校验哈希；服务端启动时检测一次并缓存，命令不存在时再检测；系统提示词列出本机可用的命令，设置里有“外部工具”一页，Skill 声明需要的命令、缺了标不可用。

- eval（CodeAct）另开 [t21](../t21-eval-codeact/README.md) 搁置；后台任务、Agent Hub、Monitor 与 Agent 后台调用统一放进 [t22](../t22-background-work/README.md) 搁置。第一批 shell 只有前台：执行时限照 omp，缺省 300 秒、模型可设 1 到 3600 秒、不允许不限，输出过长截断、全文进 `session://artifacts/`（2026-10-28 会话里的推荐，开发者未单独否决，实施时可再调）。
- 第一批工具：`read`、`write`、`edit`（master 的五种模式，缺省 hashline，中文长段落用哪种在 t18 按模型评测）、`grep`、`glob`（都用 `pi-natives`）、`shell`（`pi-natives` 内嵌的 brush shell，工作目录 `session://`（2026-10-30 t14 改为：有主项目时 `project://`，没有时 `session://`；另加 `async` 转后台，见 [t14](../t14-multi-agent/README.md)），命令里能对应真实目录的地址替换成绝对路径，虚拟地址报错，提供 `$NBOOK_PROJECT`、`$NBOOK_SESSION`）、`todo`；`ask`、`switch_mode` 见 t06，子代理见 t14。不进第一批：ast_grep、lsp、eval、github、checkpoint/rewind、apply_patch。内置工具经资源地址读写（t08）；说明用中文，失败在 `details` 给 `code`，`pi-natives` 原生 edit 的英文错误原样（ADR 0034）。

## 当前状态

讨论完成（2026-10-28）。计划与实施切片在本 Work 的讨论全部完成后另定。

## 下一步

实施时按 implementation-planning 写 `plan.md`；先确认 `pi-natives` 的 brush shell 在升级后的 OMP 与 Windows 上可用。
