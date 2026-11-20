/**
 * 输入框的纯逻辑：编辑器发出 submit 时该发什么、模式怎么循环、`/` 命令菜单怎么列。
 * 放在组件外是为了单测能逐条覆盖“空闲、运行中 × 回车、Ctrl/⌘+回车 × 命令”这些组合。
 */
import type {AgentTextKey} from "./text";
import type {PromptAttachment, PromptMenu, PromptMenuItem} from "./ports";
import type {AgentViewAction, ComposerModeView, ComposerView, SubmitDelivery} from "./types";
import type {ComposerCommandEntry} from "./registry";

export type ComposerSubmission =
    | {kind: "command"; name: string; argsText: string}
    | {kind: "message"; text: string; delivery: SubmitDelivery}
    | null;

/**
 * 发送时按什么方式投递（docs/specs/ui/agent-conversation-view.md“输入框与待处理区”）。命令先于投递方式判定，运行中
 * 照常执行。运行中回车在允许补充说明时为 steer，否则在允许排队时为 followup；Ctrl/⌘+回车（`mod`）只在允许排队时为
 * followup，不退回 steer。都不允许时返回 null：运行中能写不能发。
 */
export function resolveSubmission(input: {
    text: string;
    mod: boolean;
    running: boolean;
    commands: readonly string[];
    deliveries: {steer: boolean; followup: boolean};
}): ComposerSubmission {
    const text = input.text.trim();
    if (text === "") {
        return null;
    }
    const command = /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(text);
    if (command && input.commands.includes(command[1]!)) {
        return {kind: "command", name: command[1]!, argsText: (command[2] ?? "").trim()};
    }
    if (!input.running) {
        return {kind: "message", text, delivery: "prompt"};
    }
    const {steer, followup} = input.deliveries;
    const delivery: SubmitDelivery | null = input.mod
        ? (followup ? "followup" : null)
        : (steer ? "steer" : followup ? "followup" : null);
    return delivery === null ? null : {kind: "message", text, delivery};
}

/** 下一种模式；当前模式不在列表里时回到第一种。少于两种模式时没有可切换的。 */
export function nextMode(modes: readonly ComposerModeView[], current: string): string | null {
    if (modes.length < 2) {
        return null;
    }
    const index = modes.findIndex((mode) => mode.key === current);
    return modes[(index + 1) % modes.length]!.key;
}

/**
 * `/` 位于正文开头时的菜单：登记的命令按名称过滤，名称以查询开头的排在前面。
 * 说明与参数提示由调用方翻译好传进来（文字引用要翻译端口）。
 */
export function commandMenu(
    commands: ReadonlyArray<Pick<ComposerCommandEntry, "id" | "name"> & {description: string; argsHint: string | null}>,
    query: string,
    labels: {title: string; empty: string},
): PromptMenu {
    const needle = query.toLowerCase();
    const ranked = commands
        .filter((command) => command.name.toLowerCase().includes(needle))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)));
    const items = ranked.map((command): PromptMenuItem => ({
        id: `command:${command.id}`,
        label: `/${command.name}`,
        description: command.argsHint === null ? command.description : `${command.description} · ${command.argsHint}`,
        iconClass: "i-lucide-square-slash",
        insertText: `/${command.name}`,
    }));
    return {title: labels.title, items, emptyText: labels.empty};
}

/** 常见思考档位在本包目录里的键；其他取值原样显示。 */
export const THINKING_LEVEL_KEYS: Readonly<Record<string, AgentTextKey>> = {
    off: "composer.thinking.off",
    minimal: "composer.thinking.minimal",
    low: "composer.thinking.low",
    medium: "composer.thinking.medium",
    high: "composer.thinking.high",
    xhigh: "composer.thinking.xhigh",
    max: "composer.thinking.max",
};

/** 档位多或面板窄时分段里用的缩写（全名放悬停与说明里）。 */
export const THINKING_SHORT_KEYS: Readonly<Record<string, AgentTextKey>> = {
    off: "composer.thinkingShort.off",
    minimal: "composer.thinkingShort.minimal",
    low: "composer.thinkingShort.low",
    medium: "composer.thinkingShort.medium",
    high: "composer.thinkingShort.high",
    xhigh: "composer.thinkingShort.xhigh",
    max: "composer.thinkingShort.max",
};

/**
 * 有附件挡住发送时的原因：编辑器发出过、还没移除的附件里有失败的（优先，用户要先处理），或有还在上传的。没就绪的附件不在
 * 文字里，这时发送附件就丢了。不在 `states` 里的按上传中算：宿主还没登记它的状态。
 */
export function sendBlockedReason(live: ReadonlySet<string>, states: ReadonlyMap<string, PromptAttachment>): "uploading" | "failed" | null {
    const current = [...live].map((localId) => states.get(localId)?.state ?? "uploading");
    if (current.includes("failed")) return "failed";
    return current.includes("uploading") ? "uploading" : null;
}

/**
 * 只改状态、不需要宿主再动手的输入框 action：草稿回声（只换文字不换版本，编辑器认得这是自己的回声）、填入（换文字也换版本，
 * 编辑器才会显示它）、模式、模型与思考档位。其余返回 null，由宿主处理；附件的登记、重试与移除既要改状态又要上传或释放，也不在这里。
 * 宿主要存草稿时（填入的文字也算草稿）在这之外自己存。
 */
export function applyComposerAction(composer: ComposerView, action: AgentViewAction): ComposerView | null {
    switch (action.type) {
        case "composer.draftChanged": return {...composer, draft: {text: action.text, version: composer.draft.version}};
        case "composer.fill": return {...composer, draft: {text: action.text, version: composer.draft.version + 1}};
        case "mode.set": return {...composer, mode: action.mode};
        case "model.set": return {...composer, modelKey: action.modelKey};
        case "thinking.set": return {...composer, thinking: action.level, ...(composer.effort === undefined ? {} : {effort: {...composer.effort, value: action.level, source: "session" as const}})};
        case "thinking.reset": return {...composer, thinking: null, ...(composer.effort?.follow == null ? {} : {effort: {...composer.effort, value: composer.effort.follow.value ?? composer.effort.value, source: composer.effort.follow.source}})};
        default: return null;
    }
}

/** 比较发送的文字与草稿时不计空白差异：命令的参数在 action 里去掉了首尾空白，宿主拼回去的命令与草稿只差在空白上。 */
function sameText(a: string, b: string): boolean {
    const normalize = (text: string) => text.trim().replace(/\s+/gu, " ");
    return normalize(a) === normalize(b);
}

/**
 * 宿主受理了一次发送或命令，`sent` 是实际发送的文字（命令写成 `/名称 参数`）。发送的就是输入框里的草稿时：草稿原文放到
 * 输入历史最前并去重（原文保留用户写的空白），草稿清空并换版本，视图据此清空输入框。不是草稿时（宿主组件里的“追问”之类
 * 发出的）原样返回：用户在输入框里写到一半的字不动，也不记进历史。
 */
export function acceptSubmission(composer: ComposerView, sent: string): ComposerView {
    const draft = composer.draft.text.trim();
    if (draft === "" || !sameText(draft, sent)) return composer;
    return {...composer, recall: [draft, ...composer.recall.filter((item) => item !== draft)], draft: {text: "", version: composer.draft.version + 1}};
}
