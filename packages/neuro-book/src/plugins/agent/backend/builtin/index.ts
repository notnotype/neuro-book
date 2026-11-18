/**
 * `nbook.agent` 自己贡献的内置工具（docs/specs/agent/builtin-tools.md）：同样经 `agent.tools`，没有内部登记表（ADR 0027）。
 * 提供方是接收者所在的入口：入口活着时实现就已发布，不需要写 `onAgentTool` 激活事件。
 *
 * 与应用无关的工具在宿主套件里（`@notnotype/nb-harness/kit/tools`），这里只给它们 NeuroBook 的贡献 id、给模型的名字与说明里的
 * 宿主事实（`texts.ts`），再把资源视图套上布局交给它们；`switch_mode` 属于 Agent 模式，留在 NeuroBook。
 */

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";

import type {Dialects} from "@notnotype/nb-harness/kit/commands";
import {builtinDeclarations, builtinTools as kitTools} from "@notnotype/nb-harness/kit/tools";
import type {KitToolImplementation, SessionEditStores, ShellBackground} from "@notnotype/nb-harness/kit/tools";

import {TOOLS_POINT} from "../../shared/points";
import {switchModeDeclaration, switchModeTool} from "../permissions/modes";
import type {ChangeModeSettings} from "../permissions/modes";
import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";

import {sessionFiles} from "../resources";
import {BUILTIN_TOOL_TEXTS} from "./texts";

// `shell` 带 `async`：转后台由任务中心接（`shell-background.ts`）。
const kit = builtinDeclarations(BUILTIN_TOOL_TEXTS, {shellBackground: true});

const DECLARATIONS: Readonly<Record<string, AgentToolDeclaration>> = {
    "nbook.agent.read": {...kit.read, providerName: "read"},
    "nbook.agent.write": {...kit.write, providerName: "write"},
    // 给模型的名字相同：Profile 只绑一条，同一会话绑了两条按 harness/runtime.md 输出 15 处理。
    "nbook.agent.edit": {...kit.edit, providerName: "edit"},
    "nbook.agent.edit-replace": {...kit.editReplace, providerName: "edit"},
    "nbook.agent.grep": {...kit.grep, providerName: "grep"},
    "nbook.agent.glob": {...kit.glob, providerName: "glob"},
    "nbook.agent.shell": {...kit.shell, providerName: "shell"},
    // 切换模式靠结果归约改状态：从代码里调只生效一半，所以不许（harness/runtime.md 输出 92）。
    "nbook.agent.switch-mode": {...switchModeDeclaration, providerName: "switch_mode", codeCallable: false},
    "nbook.agent.ask": {...kit.ask, providerName: "ask"},
    "nbook.agent.ask-form": {...kit.askForm, providerName: "ask"},
};

export const BUILTIN_TOOL_CONTRIBUTIONS: ReadonlyArray<ContributionDeclaration<AgentToolDeclaration>> = Object.entries(DECLARATIONS).map(([id, declaration]) => ({capability: TOOLS_POINT, id, declaration}));

/** 套件的工具拿到的是资源视图加布局；第三方工具照旧拿资源视图（SDK 合同不变）。 */
function wrap(tool: KitToolImplementation): AgentToolImplementation {
    return {
        ...(tool.effect === undefined ? {} : {effect: tool.effect}),
        ...(tool.subjects === undefined ? {} : {subjects: tool.subjects}),
        create: (context, services) => tool.create(context, {files: sessionFiles(services.resources, context), artifacts: services.artifacts}),
    };
}

/** 每次激活一套：行锚快照跟着入口这一代。审批预览要读同一份快照，由入口建好传进来。 */
export function builtinTools(stores: SessionEditStores, dialects: Dialects, changeModeSettings: ChangeModeSettings, shellBackground: ShellBackground): Readonly<Record<string, AgentToolImplementation>> {
    const tools = kitTools({stores, dialects, shellBackground});
    return {
        "nbook.agent.read": wrap(tools.read),
        "nbook.agent.write": wrap(tools.write),
        "nbook.agent.edit": wrap(tools.edit),
        "nbook.agent.edit-replace": wrap(tools.editReplace),
        "nbook.agent.grep": wrap(tools.grep),
        "nbook.agent.glob": wrap(tools.glob),
        "nbook.agent.shell": wrap(tools.shell),
        "nbook.agent.switch-mode": switchModeTool(changeModeSettings),
        "nbook.agent.ask": wrap(tools.ask),
        "nbook.agent.ask-form": wrap(tools.askForm),
    };
}
