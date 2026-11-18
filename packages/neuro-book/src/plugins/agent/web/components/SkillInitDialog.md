---
标签: [state:inject, env:portal]
---

# SkillInitDialog

初始化一个 Skill 之前的确认框（[`agent/skills.md`](../../../../../../../docs/specs/agent/skills.md) 输出 27）：在 `$` 菜单里选了未初始化的 Skill、或在 Skill 页点“初始化”时打开。它只画确认、读取中、正在安装、失败几种状态，取计划与安装由宿主做（`skill-init.ts`），结果经属性交进来。

## 布局

`Dialog` 的小号，标题“初始化 名字”。正文三块，位置与大小在各状态之间固定（[UI 规范](../../../../../../nb-ui/docs/ui-development-spec.md)“几何、排版与动效”第 4 条），状态之间只换里面的文字、图标与按钮：

1. 一行状态：确认时写要装几个包、要联网；读取中写正在读取；安装中前面转圈、写“正在安装…”；失败用危险色写“初始化没有成功”。放不下时截断。
2. 中间一块（吃掉剩下的高度，内容多了在里面滚动）：确认、读取中、安装中列出直接依赖，一行一个，等宽字；失败后是安装输出的最后几行。没有直接依赖时写“没有直接依赖”。
3. 两行说明（小字）：确认时写安装脚本不会运行；没有 `bun.lock` 时改用警告色写会按最新版本解析依赖、生成锁文件；安装中写关掉也会在后台继续装；失败写原因与怎么办（危险色）。

页脚：确认与读取中是“先不初始化”“初始化”（读取中“初始化”不可用）；安装中只有“在后台继续装”；失败是“关闭”“重试”。390 宽下对话框随视口收窄，三块的高度不变。

## 交互

- “初始化”“重试”发出 `confirm`，宿主开始安装。
- “先不初始化”“在后台继续装”“关闭”、关闭按钮与 Escape 都发出 `update:open(false)`：安装中关掉，安装照常进行，进度与结果在后台任务里（输出 29）。
- 打开时焦点落在正文里一个不可见的落点上，不落在“初始化”上：回车不会一下就开始联网安装。

文字选择：命令输出可选（见 nb-ui 开发规范的“文字能否选中”）。

## 数据

```ts
import type {SkillInitPlan} from "../../shared/skills";

type SkillInitPhase = "loading" | "confirm" | "installing" | "failed";

type SkillInitFailure = {
    /** busy：别处正在装；interrupted：被取消或中断；install-failed：安装失败；unavailable：这个 Skill 现在不能初始化 */
    code: "install-failed" | "busy" | "interrupted" | "unavailable";
    /** 安装输出的最后几行；没有时为空串 */
    output: string;
};

type SkillInitDialogProps = {
    open: boolean;               // 受控
    name: string;                // Skill 的名字，写进标题
    phase: SkillInitPhase;
    plan: SkillInitPlan | null;  // 读取中与读不到计划时为 null
    failure: SkillInitFailure | null; // phase 为 failed 时有
};

type SkillInitDialogEmits = {
    (e: "update:open", value: boolean): void;
    (e: "confirm"): void;
};
```

没有插槽、`expose`，属性不透传。

## 隐藏通道理由

- `state:inject`：文字经 Agent 插件的翻译端口取（`useAgentPageText`），与插件其它界面一样。
- `env:portal`：`Dialog` 传送到 `body`。

## 不支持

- 安装中的实时输出：中间一块在安装中仍列直接依赖，失败后才换成输出（skills.md 输出 27）。
- 取消安装：在后台任务里取消。
