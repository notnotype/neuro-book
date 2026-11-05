import type {ObjectRef} from "@notnotype/nb-canon/schema";

/** 拼简报时给出的提示（不登记成内核诊断：它们依赖“要写哪一章”，见 brief.md 输入）。 */
export interface BriefHint {
    readonly code: "nbook.plot.brief.noPresentation" | "nbook.plot.brief.noSceneConditions" | "nbook.plot.brief.payoffWithheld";
    readonly objects?: readonly ObjectRef[];
    readonly range?: {readonly from: string; readonly to: string};
}

/** 简报里的一段：段标题、各项（裁剪按项从后往前），`protect` 的项不裁。 */
export interface BriefItem {
    readonly label: string;
    readonly text: string;
    readonly protect?: boolean;
}

export interface BriefSection {
    readonly key: string;
    readonly title: string;
    readonly items: readonly BriefItem[];
}
