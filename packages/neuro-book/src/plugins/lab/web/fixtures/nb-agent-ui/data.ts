/**
 * AgentConversationView 的 Lab 数据。全部是可 JSON 化的 ctx，时间戳固定，保证每次渲染一致。
 */
import {createAgentContext} from "@notnotype/nb-agent-ui";
import type {
    AgentConversationContext,
    AssistantMessageView,
    MessageView,
    ToolCallView,
    UserMessageView,
} from "@notnotype/nb-agent-ui";

const T0 = Date.UTC(2026, 8, 28, 9, 0, 0);

function at(seconds: number): number {
    return T0 + seconds * 1000;
}

function user(id: string, seconds: number, text: string, intent: UserMessageView["intent"] = "normal"): UserMessageView {
    return {kind: "user", id, timestamp: at(seconds), intent, blocks: [{kind: "text", text}], contentOmitted: false};
}

function assistant(id: string, seconds: number, patch: Partial<AssistantMessageView>): AssistantMessageView {
    return {
        kind: "assistant", id, timestamp: at(seconds), status: "done", text: "", thinking: "", model: "deepseek-chat",
        toolCalls: [], contentOmitted: false, ...patch,
    };
}

/** 几个文件的样例内容，让展开的读取详情像真的；其余文件用一行占位。 */
const FILE_SAMPLES: Record<string, string> = {
    "chapters/03.md": "# 第三章 雨夜\n\n雨从傍晚开始下。\n林默把最后一块表壳擦干净，抬头看了一眼门外。\n他想起那年冬天。\n那年冬天很冷。\n他想起父亲的手。\n",
    "chapters/05.md": "“他门说，这块表是从河里捞上来的。”\n林默接过表，表盘上全是水汽。\n他已经知道，这不是一块普通的表。\n",
};

function read(id: string, path: string, status: ToolCallView["status"] = "success", offset?: number): ToolCallView {
    const args: ToolCallView["args"] = offset === undefined ? {path} : {path, offset};
    if (status === "running") {
        return {id, name: "read", status, args};
    }
    const text = FILE_SAMPLES[path] ?? `（${path} 的内容）`;
    return {id, name: "read", status, args, result: {text, truncated: FILE_SAMPLES[path] === undefined}};
}

type TaskStep = [id: string, text: string, status: "pending" | "in_progress" | "completed"];

/** 任务清单调用：结果 details 是调用之后的整张清单，与服务端 task-tools 一致。 */
function taskCall(id: string, name: "task_create" | "task_set_status", steps: TaskStep[], args: ToolCallView["args"]): ToolCallView {
    return {
        id, name, status: "success", args,
        result: {
            text: "任务清单已更新。", truncated: false,
            details: {title: "第三章节奏调整", steps: steps.map(([stepId, text, status]) => ({id: stepId, text, status, updatedAt: "2026-09-28T09:00:00Z"})), updatedAt: "2026-09-28T09:00:00Z"},
        },
    };
}

const usage = (input: number, output: number, cacheRead: number, cost: number) => ({input, output, cacheRead, cacheWrite: 0, cost});

/** 第一轮：简单问答，没有过程。 */
const firstTurn: MessageView[] = [
    user("u1", 0, "这本书的主角叫什么？"),
    assistant("a1", 4, {text: "主角叫林默，是一名在旧城区经营修表铺的年轻人。", usage: usage(1800, 40, 0, 0.0021)}),
];

/** 第二轮：14 次工具调用（8 次读取、2 次改文件、1 次搜索、3 次任务清单），夹带系统提醒与 steer。 */
const secondTurn: MessageView[] = [
    user("u2", 30, "把第三章的节奏改紧凑一些，特别是中段的回忆部分。"),
    {kind: "system", id: "p2", timestamp: at(31), source: "prompt", label: "Skill · 节奏调整", text: "调整节奏时：\n\n1. 先通读目标章节和前后章衔接；\n2. 优先合并重复交代，不删情节节点；\n3. 每次改动后在任务清单里更新状态。"},
    assistant("a2", 34, {
        thinking: "先看大纲和第三章全文，再看前后章衔接。",
        text: "我先读一下大纲和第三章。",
        toolCalls: [
            taskCall("t0", "task_create", [["s1", "合并中段回忆", "in_progress"], ["s2", "前移雨夜对话", "pending"], ["s3", "理顺第四章开头", "pending"]], {title: "第三章节奏调整"}),
            read("t1", "outline.md"),
            read("t2", "chapters/03.md"),
        ],
        usage: usage(4200, 60, 1800, 0.0048),
    }),
    assistant("a3", 41, {
        thinking: "回忆段落引用了第二章的细节，需要对照。",
        toolCalls: [read("t3", "chapters/02.md"), read("t4", "chapters/04.md"), read("t5", "characters/lin-mo.md")],
        usage: usage(9100, 80, 4200, 0.0071),
    }),
    {kind: "system", id: "r1", timestamp: at(45), source: "reminder", label: "System Reminder", text: "当前处于普通模式，可以直接修改文件。\n\n- 修改前先读取目标文件的最新内容；\n- 大段删改请先在任务清单里登记；\n- 不要改动 `outline/` 下的大纲文件。"},
    assistant("a4", 48, {
        toolCalls: [
            {id: "t6", name: "web_search", status: "success", args: {query: "机械表 擒纵机构 工作原理"}, result: {text: "……", truncated: true}},
            read("t7", "notes/watch-repair.md"),
        ],
        usage: usage(11800, 70, 9100, 0.0065),
    }),
    user("s1", 52, "保留雨夜那段对话，别删。", "steer"),
    assistant("a5", 55, {
        thinking: "用户要求保留雨夜对话。确认那段的位置。",
        toolCalls: [read("t8", "chapters/03.md"), read("t9", "style-guide.md")],
        usage: usage(13400, 50, 11800, 0.0052),
    }),
    assistant("a6", 63, {
        text: "中段回忆有三处重复交代，我合并成一段，并把雨夜对话前移。",
        toolCalls: [
            {
                id: "t10", name: "edit", status: "success",
                args: {path: "chapters/03.md", edits: [
                    {oldText: "他想起那年冬天。\n那年冬天很冷。\n他想起父亲的手。", newText: "他想起那年冬天，父亲冻裂的手。"},
                    {oldText: "雨还在下。", newText: "雨还在下。\n“你还修表吗？”她问。"},
                ]},
            },
            taskCall("t11", "task_set_status", [["s1", "合并中段回忆", "completed"], ["s2", "前移雨夜对话", "completed"], ["s3", "理顺第四章开头", "in_progress"]], {id: "s2", status: "completed"}),
        ],
        usage: usage(15200, 420, 13400, 0.0112),
    }),
    {kind: "system", id: "r2", timestamp: at(66), source: "reminder", label: "System Reminder", text: "任务清单还有 1 项未完成。"},
    assistant("a7", 70, {
        toolCalls: [{
            id: "t12", name: "edit", status: "success",
            args: {path: "chapters/04.md", edits: [{oldText: "正如上一章所说，", newText: ""}]},
        }, taskCall("t12b", "task_set_status", [["s1", "合并中段回忆", "completed"], ["s2", "前移雨夜对话", "completed"], ["s3", "理顺第四章开头", "completed"]], {id: "s3", status: "completed"})],
        usage: usage(15900, 90, 15200, 0.0044),
    }),
    assistant("a8", 78, {
        text: "第三章已调整：\n\n- 中段三处回忆合并为一段，删去约 400 字重复交代；\n- 雨夜对话保留并前移，衔接更紧；\n- 第四章开头删去一句多余的承接。",
        usage: usage(16300, 180, 15900, 0.0061),
    }),
];

/** 两轮之间发生了上下文压缩。 */
const compaction: MessageView = {
    kind: "system", id: "c1", timestamp: at(90), source: "compaction", label: "上下文已压缩", text: "**较早对话摘要**\n\n- 用户确认主角叫林默，在旧城区经营修表铺；\n- 第三章已调整节奏：中段三处回忆合并为一段，雨夜对话前移；\n- 第四章开头删去一句多余承接。\n\n尚未处理：第五章错别字检查。",
};

/** 第三轮：改稿中途出错。 */
const thirdTurn: MessageView[] = [
    user("u3", 120, "顺便检查一下第五章有没有错别字。"),
    assistant("a9", 124, {
        toolCalls: [
            read("t13", "chapters/05.md", "success", 41),
            {
                id: "t13b", name: "subject_memory_update", status: "success",
                args: {subjectPath: "characters/lin-mo", facts: [{text: "林默能听出表的擒纵声是否异常", source: "chapters/05.md"}]},
                result: {text: "已记录 1 条事实。", truncated: false, details: {added: 1, subjectPath: "characters/lin-mo"}},
            },
        ],
        usage: usage(6200, 40, 0, 0.0031),
    }),
    assistant("a10", 131, {status: "error", error: "模型服务暂时不可用，请稍后重试。"}),
];

/** 第四轮：已完成的简单改动。 */
const fourthTurn: MessageView[] = [
    user("u4", 200, "重试一下。"),
    assistant("a11", 203, {
        toolCalls: [read("t14", "chapters/05.md"), read("t15", "glossary.md")],
        usage: usage(7400, 60, 6200, 0.0036),
    }),
    assistant("a12", 212, {
        toolCalls: [{
            id: "t16", name: "apply_patch", status: "success",
            args: {patch: "*** Begin Patch\n*** Update File: chapters/05.md\n@@\n-他门走进修表铺\n+他们走进修表铺\n-己经很晚了\n+已经很晚了\n*** End Patch"},
        }],
        usage: usage(8100, 120, 7400, 0.0048),
    }),
    assistant("a13", 216, {text: "第五章找到两处错别字，已改正：“他门”→“他们”，“己经”→“已经”。", usage: usage(8300, 60, 8100, 0.0029)}),
];

export const longConversationMessages: MessageView[] = [...firstTurn, ...secondTurn, compaction, ...thirdTurn, ...fourthTurn];

/** 运行中：在长对话后追加一轮正在读文件的 ReAct。 */
export const runningConversationMessages: MessageView[] = [
    ...longConversationMessages,
    user("u5", 300, "再帮我把第六章的开头写得更有悬念。"),
    assistant("a14", 304, {
        // 真实模型的思考摘要常把几段粗体小标题首尾相接写在一起，折叠行只露出第一段的纯文字（Spec 验收 30）。
        thinking: "**读第六章开头****对照第五章结尾**\n\n先读第六章和第五章结尾，看衔接处的悬念断在哪里。",
        toolCalls: [read("t17", "chapters/06.md"), read("t18", "chapters/05.md")],
        usage: usage(9400, 50, 8300, 0.0041),
    }),
    assistant("a15", 309, {
        text: "第六章开头平铺直叙。我先跑一遍悬念诊断。",
        toolCalls: [{
            id: "t20", name: "run_workflow", status: "success", args: {workflowKey: "suspense-check"},
            result: {text: "开头 300 字内没有未解问题；读者第一个疑问出现在第 4 段。", truncated: false},
        }],
        usage: usage(10100, 70, 9400, 0.0046),
    }),
    assistant("a16", 318, {
        toolCalls: [{
            id: "t21", name: "bash", status: "success", args: {command: "wc -m chapters/06.md"},
            result: {text: "4812 chapters/06.md", truncated: false},
        }],
        usage: usage(10500, 40, 10100, 0.0033),
    }),
    assistant("a17", 324, {
        toolCalls: [{
            id: "t22", name: "edit", status: "success",
            args: {path: "chapters/06.md", edits: [{oldText: "清晨，林默照常打开店门。", newText: "门铃在凌晨三点响了。\n林默没有开灯。"}]},
        }],
        usage: usage(11200, 160, 10500, 0.0058),
    }),
    {kind: "system", id: "r3", timestamp: at(326), source: "reminder", label: "System Reminder", text: "修改前请确认没有破坏已有伏笔。"},
    assistant("a18", 328, {
        thinking: "确认伏笔清单。",
        toolCalls: [read("t19", "notes/foreshadowing.md", "running")],
    }),
];

/** Lab 的 ctx：在包的 `createAgentContext` 上加一套长对话的数据；`patch` 的顶层字段整个替换。 */
export function conversationContext(patch: Partial<AgentConversationContext> = {}): AgentConversationContext {
    return {
        ...createAgentContext({
            session: {
                id: "session-1", title: "第三章节奏调整", summary: "调整第三章节奏，合并回忆段落，并修正第五章错别字。",
                profileName: "写作助手", profileIcon: "i-lucide-feather", archived: false, summaryState: "idle",
            },
            interaction: {
                canSend: true, canSteer: true, canQueue: true, canAnswer: true, canMutateHistory: true, canStop: true,
                canRegisterAttachments: true, canChangeRuntime: true, canArchive: true,
            },
            messages: longConversationMessages,
            branches: {a13: {index: 2, total: 2}},
            composer: {
                models: [
                    {key: "deepseek-chat", label: "DeepSeek Chat", supportsImages: false},
                    {key: "claude-sonnet", label: "Claude Sonnet", supportsImages: true},
                ],
                modelKey: "claude-sonnet", thinkingLevels: ["off", "low", "medium", "high"], thinking: "low",
                modes: [
                    {key: "normal", label: "普通", icon: "i-lucide-pencil-line"},
                    {key: "discuss", label: "讨论", icon: "i-lucide-messages-square"},
                    {key: "plan", label: "规划", icon: "i-lucide-clipboard-list"},
                ],
                mode: "normal",
                recall: ["把第三章的节奏改紧凑一些，特别是中段的回忆部分。", "这本书的主角叫什么？"],
            },
            usage: {
                contextTokens: 16300, contextLimit: 128000, totalTokens: 162400, cacheRead: 101200,
                cacheHitRate: 0.62, cost: 0.0659,
            },
            now: at(216),
        }),
        ...patch,
    };
}

export const runningConversationNow = at(333);

/** 历史分页：先只有第三轮的后半与第四轮，第一组开头不完整；更早的内容由夹具按页从长对话里补。 */
export const pagedConversationMessages: MessageView[] = longConversationMessages.slice(longConversationMessages.findIndex((message) => message.id === "a9"));

/** 附件样例的地址；夹具的 resolveAttachmentUrl 按 locator 查，查不到就是“不可用”。 */
export const labAttachmentUrls: Record<string, string> = {
    "lab:sketch": `data:image/svg+xml;utf8,${encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><rect width='120' height='120' fill='#e9e1d3'/>"
        + "<circle cx='38' cy='44' r='16' fill='#b8674a'/><circle cx='84' cy='70' r='20' fill='#4f6f8f'/>"
        + "<path d='M52 50 L66 62' stroke='#5b4b3a' stroke-width='4'/></svg>",
    )}`,
    // 写明宽高，原图预览按它的原始尺寸显示、放不下时等比缩小。
    "session://attachments/人物关系草图.png": `data:image/svg+xml;utf8,${encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800' viewBox='0 0 1200 800'><rect width='1200' height='800' fill='#ece4d6'/>"
        + "<circle cx='380' cy='360' r='130' fill='#b8674a'/><circle cx='820' cy='460' r='160' fill='#4f6f8f'/>"
        + "<path d='M500 400 L670 440' stroke='#5b4b3a' stroke-width='14' stroke-dasharray='28 18'/>"
        + "<rect x='60' y='60' width='240' height='44' rx='10' fill='#fffaf0' stroke='#cbbca3'/></svg>",
    )}`,
};

/** 消息状态：图片与附件、只公开了预览的正文、投递状态未知。 */
export const messageStateMessages: MessageView[] = [
    {
        kind: "user", id: "m1", timestamp: at(0), intent: "normal", contentOmitted: false,
        blocks: [
            {kind: "text", text: "这是我画的人物关系草图，另附一份设定笔记，帮我看看关系是否清楚。"},
            {kind: "attachment", locator: "lab:sketch", name: "关系草图.png", mimeType: "image/png", bytes: 48213},
            {kind: "attachment", locator: "lab:expired", name: "旧草图.png", mimeType: "image/png", bytes: 30110},
            {kind: "attachment", locator: "lab:notes", name: "人物设定-林默与苏晚-第二版.pdf", mimeType: "application/pdf", bytes: 1284000},
        ],
    },
    assistant("m2", 6, {text: "关系基本清楚。林默与苏晚之间缺一条“互相隐瞒”的线，建议在第五章补上。", usage: usage(5200, 60, 0, 0.0034)}),
    {
        kind: "user", id: "m3", timestamp: at(60), intent: "normal", contentOmitted: true,
        blocks: [{kind: "text", text: "下面是第六章的全文，请逐段检查人称是否统一：\n\n门铃在凌晨三点响了。林默没有开灯……"}],
    },
    assistant("m4", 70, {text: "人称统一，只有第 12 段把“他”写成了“她”。", usage: usage(9800, 40, 5200, 0.0041)}),
    // 按输入框的文字写法发出的消息：引用、选区、技能是标签，图片与文件进附件条，粘贴块折叠。
    user("m6", 90, [
        "先读 [第三章 雨夜](chapter://c3) 和 [[manuscript/ch03.md#L12-L40]]，再用 $reviewer 对照草图 ![image #1](session://attachments/人物关系草图.png) ![image #2](session://attachments/旧草图.png) 与 [file #1 · 采访记录.pdf](lab:notes)。",
        "<paste id=\"2\">",
        "function tick(clock) {",
        "    clock.seconds += 1;",
        "    if (clock.seconds === 60) {",
        "        clock.seconds = 0;",
        "        clock.minutes += 1;",
        "    }",
        "    return clock;",
        "}",
        "</paste>",
        "上面是钟表铺的走时逻辑，第三章里的报时要和它对得上。",
    ].join("\n")),
    assistant("m7", 100, {text: "对得上：第十二下钟声落在分钟进位那一刻。草图里座钟的位置和第三章描写一致。", usage: usage(7400, 52, 5200, 0.0036)}),
    {...user("m5", 120, "把第七章的标题改成《回声》。"), delivery: "unknown"},
];

/** 流式生成中：补充说明还在发送，回复正在输出。 */
export const streamingMessages: MessageView[] = [
    user("v1", 0, "列出第六章的三个悬念点。"),
    assistant("v2", 3, {thinking: "先读第六章。", toolCalls: [read("v3", "chapters/06.md")], usage: usage(6100, 30, 0, 0.0028)}),
    {...user("v4", 8, "只要和修表铺有关的。", "steer"), delivery: "pending"},
    assistant("v5", 9, {status: "streaming", text: "和修表铺有关的悬念点：\n\n1. 凌晨三点的门铃\n2. 表盘里的水汽"}),
];

export const streamingNow = at(14);

/**
 * nb-story 的问答：查书、交答案被退回一次、改了再交成功，之后上下文压缩。交成功的那次是这一轮的结果（宿主把 `answer`
 * 登记为结果节点），整轮收起后仍露出；参数形状见 docs/specs/story/qa.md 输出 7。
 */
export const answerMessages: MessageView[] = [
    user("w1", 0, "第三章里谁知道钟声的秘密？"),
    assistant("w2", 2, {thinking: "先读第三章。", toolCalls: [read("w3", "chapters/03.md")], usage: usage(5200, 40, 0, 0.0024)}),
    assistant("w4", 6, {toolCalls: [{id: "w5", name: "answer", status: "error", args: {conclusion: "林默", conclusionType: "明说", evidence: []}, error: "evidence 不能为空：每个“知道”都要指得出段落"}], usage: usage(6800, 60, 5200, 0.0012)}),
    assistant("w6", 9, {toolCalls: [{id: "w7", name: "answer", status: "success", args: {conclusion: "林默知道：他在第十二下钟声时认出了父亲的表。", conclusionType: "明说", evidence: ["3.4", "3.6"]}, result: {text: "已交卷", truncated: false}}], usage: usage(7100, 90, 6800, 0.0015)}),
    {kind: "system", id: "w8", timestamp: at(12), source: "compaction", label: "上下文已压缩", text: "保留了问题与答案。"},
];

/**
 * nb-story 的文字回复与“没核实的出处”：宿主从问答记录读出没核实的出处，给这一轮最终回复加一条附注（Spec“术语”的附注），
 * 由它登记的条目渲染器画在回复气泡里。第二轮的附注没有登记渲染器，显示为默认的淡色一行。
 */
export const unverifiedReplyMessages: MessageView[] = [
    user("x1", 0, "她们俩第一次一起行动是哪一章？"),
    assistant("x2", 2, {thinking: "先读第 37 章。", toolCalls: [read("x3", "chapters/37.md"), read("x4", "chapters/38.md")], usage: usage(5400, 40, 0, 0.0021)}),
    {
        ...assistant("x5", 8, {text: "第一次以搭档身份一起行动是在第 37 章：两人在天台碰头，一起给风信子设了陷阱（37.73—37.114）。第 41 章的联手（41.20）规模更大，但那已经是第二次了。", usage: usage(6900, 120, 5400, 0.0019)}),
        annotations: [{customType: "nb-story.unverified-refs", text: "没核实的出处：41.20", details: {refs: ["41.20"]}}],
    },
    user("x6", 20, "那第 41 章是谁先提议的？"),
    {
        ...assistant("x7", 24, {text: "原文没有写明是谁先提议的。", usage: usage(7200, 30, 6900, 0.0011)}),
        annotations: [{customType: "nb-story.reading-position", text: "这一轮按读到 41.30 的位置回答"}],
    },
];

/** 单独挂载一轮时用的几组消息。 */
export const turnSamples = {
    simple: firstTurn,
    longReact: secondTurn,
    error: thirdTurn,
    patched: fourthTurn,
};

function findCall(messages: readonly MessageView[], id: string): ToolCallView {
    for (const message of messages) {
        const call = message.kind === "assistant" ? message.toolCalls.find((item) => item.id === id) : undefined;
        if (call !== undefined) {
            return call;
        }
    }
    throw new Error(`fixture 里没有工具调用 ${id}`);
}

/** 任务清单节点的样例调用；更新样例要配合含上一版清单的 ctx。 */
export const taskCallSamples = {
    created: findCall(secondTurn, "t0"),
    updated: findCall(secondTurn, "t11"),
    running: {id: "t-run", name: "task_set_status", status: "running", args: {id: "s3", status: "completed"}} satisfies ToolCallView,
};

/** 工具详情的样例调用：常用工具各一个，外加没有适配的工具与出错的调用。 */
export const toolCallSamples = {
    read: read("d1", "chapters/03.md"),
    readOffset: read("d2", "chapters/05.md", "success", 41),
    readRunning: read("d3", "notes/foreshadowing.md", "running"),
    edit: {
        id: "d4", name: "edit", status: "success",
        args: {path: "chapters/03.md", edits: [
            {oldText: "他想起那年冬天。\n那年冬天很冷。\n他想起父亲的手。", newText: "他想起那年冬天，父亲冻裂的手。"},
            {oldText: "雨还在下。", newText: "雨还在下。\n“你还修表吗？”她问。"},
        ]},
        result: {text: "已替换 2 处。", truncated: false},
    },
    write: {
        id: "d5", name: "write", status: "success",
        args: {path: "notes/rhythm.md", content: "# 节奏笔记\n\n- 第三章中段只保留一次回忆。\n- 雨夜对话放在章末。\n"},
        result: {text: "已写入。", truncated: false},
    },
    patch: {
        id: "d6", name: "apply_patch", status: "success",
        args: {patch: "*** Begin Patch\n*** Update File: chapters/04.md\n@@ 开头\n-正如上一章所说，\n 雨停了。\n+天亮了。\n*** End Patch"},
        result: {text: "Done.", truncated: false},
    },
    bash: {
        id: "d7", name: "bash", status: "success", args: {command: "wc -m chapters/*.md"},
        result: {text: "  3120 chapters/03.md\n  2984 chapters/04.md\n  4812 chapters/06.md\n 10916 total", truncated: false},
    },
    unadapted: {
        id: "d8", name: "subject_memory_update", status: "success",
        args: {subjectPath: "characters/lin-mo", facts: [{text: "林默能听出表的擒纵声是否异常", source: "chapters/05.md"}]},
        result: {text: "已记录 1 条事实。", truncated: false, details: {added: 1, subjectPath: "characters/lin-mo"}},
    },
    error: {
        id: "d9", name: "read", status: "error", args: {path: "chapters/99.md"},
        error: "文件不存在：chapters/99.md",
    },
} satisfies Record<string, ToolCallView>;
