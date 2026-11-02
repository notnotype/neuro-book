/**
 * 点击输入框或已发送消息里的标签时该做什么。输入框与消息显示共用这一处，两边的点击结果才一致。
 */
import type {PromptToken} from "./ports";
import type {AgentViewAction} from "./types";

export type PromptTokenOutcome =
    | {kind: "action"; action: AgentViewAction}
    /** 图片由对话视图打开原图预览，是纯界面行为，不交给宿主。 */
    | {kind: "preview"; image: {locator: string; name: string}}
    | null;

/** 选区按 `路径#L起-L止` 交给宿主打开；起止相同只写一行，没有行号时只有路径。 */
function selectionTarget(token: Extract<PromptToken, {kind: "selection"}>): string {
    if (token.startLine === null) {
        return token.path;
    }
    const end = token.endLine ?? token.startLine;
    return end === token.startLine ? `${token.path}#L${token.startLine}` : `${token.path}#L${token.startLine}-L${end}`;
}

/** 会话附件的地址前缀（docs/specs/agent/resources.md）。 */
const ATTACHMENTS = "session://attachments/";

/**
 * `imageLabel` 给出“图片 #N”这样的显示名；目标是会话附件 `session://attachments/名称` 时名称也写进预览标题。
 * 还没上传完的附件没有目标，点击不做任何事。
 */
export function promptTokenOutcome(token: PromptToken, imageLabel: (number: number) => string): PromptTokenOutcome {
    switch (token.kind) {
        case "reference":
            return {kind: "action", action: {type: "reference.open", target: token.target}};
        case "selection":
            return {kind: "action", action: {type: "reference.open", target: selectionTarget(token)}};
        case "skill":
            return {kind: "action", action: {type: "skill.open", name: token.name}};
        case "file":
            return token.target === null ? null : {kind: "action", action: {type: "attachment.open", target: token.target}};
        case "image": {
            if (token.target === null) {
                return null;
            }
            const label = imageLabel(token.number);
            const name = token.target.startsWith(ATTACHMENTS) ? token.target.slice(ATTACHMENTS.length) : "";
            return {kind: "preview", image: {locator: token.target, name: name === "" ? label : `${label} · ${name}`}};
        }
        // 命令在发送时执行；位置标记只用于和粘贴块联动。
        case "command":
        case "paste":
            return null;
    }
}
