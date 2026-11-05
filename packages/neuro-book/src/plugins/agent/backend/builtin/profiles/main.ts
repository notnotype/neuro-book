/**
 * 主创（docs/specs/agent/builtin-profiles.md 输出 1–5）。提示词是第一轮，会按实际创作继续改：改文字只动下面的常量，并升 `version`
 * （docs/standards/prompts.md）；结构测试只锁节名与工具，不锁措辞。
 */

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {If, Tag, ToolName} from "@notnotype/nb-harness/prompt";
import type {AgentExtensionImplementation, AgentProfileDeclaration, AgentProfileImplementation} from "../../../shared/points";

import {MAIN_PROFILE} from "../../../shared/contracts";

const NAME = "写作助手";
const DESCRIPTION = "和作者一起写长篇小说：构思、设定、大纲、正文、修改、检查前后一致。";
const SHELL = "nbook.agent.shell";
const ASK = "nbook.agent.ask-form";
const ASK_FIXED = "nbook.agent.ask";

const TOOLS = {
    required: ["nbook.agent.read", "nbook.agent.write", "nbook.agent.grep", "nbook.agent.glob"],
    // 都可选：用户能用工具绑定换另一种 `edit`，或者去掉 `shell`。用 replace：中文一段就是一行，hashline 要整段重写，输出 token 约是
    // replace 的三倍（w00032 t18 的实验）。
    optional: ["nbook.agent.edit-replace", SHELL, ASK],
};

export const MAIN_DECLARATION: AgentProfileDeclaration = {name: NAME, description: DESCRIPTION, tools: TOOLS, icon: "i-lucide-feather"};

const ROLE = `你是 NeuroBook 的写作助手，和作者一起写长篇小说：构思、设定、大纲、正文、修改、检查前后一致。
书的文件在 project:// 下。没有打开书时可以讨论，产物放 session://。`;

const WORK = `- 先弄清作者要什么结果再动手。范围不清且猜错代价大时问一句，否则按最合理的理解做，并说明假设。
- 动笔前读相关的设定和前文，不凭记忆写人物、时间线和已发生的事。
- 作者要的是文件里的结果：写进书里，不要只贴在回复里。
- 改已有内容时只改要求的部分，不顺手重写。
- 中间产物放 session://，不落进书里。
- 做完用几句话说结果：改了哪些文件，还有什么没做或拿不准。不复述正文。`;

const WRITING = `- 用这本书已有的语言和文风；还没有定下时先看已有正文，或者问作者。
- 重大的剧情走向由作者定：有几种走法时给出选择和推荐。
- 发现设定或前文互相矛盾时指出来，不悄悄改一边。`;

const ADDRESSES = "文件工具按地址读写，写成 方案://路径。说明在 docs://agent/addresses.md，用到不熟悉的方案时再读。";

/** 两条 `ask` 共用：用工具绑定换成固定 schema 的，这句也对。 */
const ASK_NOTE = "要作者拍板、又有几个明确的选项时（走向、视角、取舍），用提问工具问，比写在回复里等他回答更好。能自己决定的不要问，一次只问要紧的。";

const SHELL_NOTE = "的工作目录是 project://（没有打开书时是 session://）。脚本和中间文件写全地址放 tmp:// 或 session://，不落在书里。";

export function mainProfile(rules: AgentExtensionImplementation): AgentProfileImplementation {
    return defineProfile({
        id: MAIN_PROFILE,
        version: "2",
        name: NAME,
        description: DESCRIPTION,
        tools: TOOLS,
        extensions: [rules],
        system: [
            Tag({name: "role", children: ROLE}),
            Tag({name: "work", children: WORK}),
            Tag({name: "writing", children: WRITING}),
            Tag({name: "addresses", children: ADDRESSES}),
            If({tool: SHELL, children: Tag({name: "shell", children: [ToolName({id: SHELL}), SHELL_NOTE]})}),
            If({tool: ASK, children: Tag({name: "ask", children: ASK_NOTE})}),
            If({tool: ASK_FIXED, children: Tag({name: "ask", children: ASK_NOTE})}),
        ],
    });
}
