---
schema: nbook.task/v2
taskId: t42-files-baseline-research
---

# Files 竖切第 1 片：耗时测量与 VS Code 针对性调研

## 目标与范围

阶段 2 Files 竖切的第 1 片（切片顺序见[整体实施路径](../../implementation-plan.md#阶段-2files-竖切项目文件底座)）。先弄清时间花在哪里、VS Code 怎样做，再动底座与资源管理器。本片不改产品行为。

1. **耗时测量。** 在约 3000 个 Markdown 文件、3–5 层目录、单章 5–30 KB 的合成样本上（放在系统临时目录，不用用户数据），用生产构建分别在本机浏览器与桌面版上测：
   - 打开项目：从进入项目到文件树可操作，拆成服务端列目录与索引构建、frontmatter 解析、请求次数与大小、前端建树与首次渲染；
   - 切换文件：从点击到正文可编辑，拆成请求、服务端读取、传输、前端解析（源码与富文本分开）、编辑器控件与模型创建、界面重渲染；冷开与热切换、单组与多组分开；
   - 每项记录 p50/p95 与波动范围，复现开发者报告的约 0.3 秒切换延迟并给出构成。
   - 测量用现有的 Server-Timing、浏览器性能接口与跟踪工具，不在产品代码里加测试专用分支。
2. **VS Code 针对性调研。** 沿用既有调研固定的 VS Code 提交（[调研目录](../../../../../packages/neuro-book/docs/research/vscode/README.md)），用源码核实：文件系统提供者的能力声明与 `FileService` 的分派；资源管理器按需解析子目录与刷新；长列表虚拟化；文件监视的实现与范围；打开与切换编辑器路径上的延迟处理。结论按调研目录的证据标签写成新章节。
3. **结论。** 根据测量与调研，给出第 2–4 片的优先级与具体改法建议，并核对[性能标准](../../../../../docs/specs/workbench/files-explorer.md#打开与切换)是否可达；不可达的项提出修改建议，交开发者决定。

依据：[项目文件底座与 Files 竖切](../../../../../packages/neuro-book/docs/proposals/project-file-foundation.md)（`accepted`）的方案第 5、6 节与“VS Code 参照”；[`workbench.files-explorer`](../../../../../docs/specs/workbench/files-explorer.md) 的性能标准与验收场景 12。行为合同未变。

## 当前状态

2026-10-02 开放，尚未开始。执行方式（主 Agent 自做或交 omp 写测量脚本）开工时确定。

## 下一步

开发者同意后开始；完成后按结论开第 2 片（资源层底座）。
