/**
 * 说明框上的文字（docs/specs/agent/page-agent.md 输出 10 的“随界面语言”）：每次高亮开始时按窗口当前的界面语言取。形状同核心包的
 * `GuideText`（核心包主入口带 DOM 类型，这个文件在后端类型检查的范围里，不引它）。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";

export interface GuideTextValues {
    readonly progress: (step: number, total: number) => string;
    readonly next: string;
    readonly done: string;
    readonly back: string;
    readonly skip: string;
    readonly ask: string;
    readonly askPlaceholder: string;
    readonly askSubmit: string;
    readonly askClose: string;
}

const TEXT = {
    progress: {"zh-CN": "第 {step} 步，共 {total} 步", "en-US": "Step {step} of {total}"},
    next: {"zh-CN": "下一步", "en-US": "Next"},
    done: {"zh-CN": "完成", "en-US": "Done"},
    back: {"zh-CN": "上一步", "en-US": "Back"},
    skip: {"zh-CN": "跳过引导", "en-US": "Skip tour"},
    ask: {"zh-CN": "提问", "en-US": "Ask"},
    askPlaceholder: {"zh-CN": "问 Agent…", "en-US": "Ask the agent…"},
    askSubmit: {"zh-CN": "发送", "en-US": "Send"},
    askClose: {"zh-CN": "不问了", "en-US": "Never mind"},
} as const;

export function guideText(port: TextPort): GuideTextValues {
    const progress = port.t(TEXT.progress);
    return {
        progress: (step, total) => progress.replace("{step}", String(step)).replace("{total}", String(total)),
        next: port.t(TEXT.next),
        done: port.t(TEXT.done),
        back: port.t(TEXT.back),
        skip: port.t(TEXT.skip),
        ask: port.t(TEXT.ask),
        askPlaceholder: port.t(TEXT.askPlaceholder),
        askSubmit: port.t(TEXT.askSubmit),
        askClose: port.t(TEXT.askClose),
    };
}
