/**
 * 体积预算（brief.md 输出 12）：各段有字数上限（缺省值，等样章量过再定）。一段超出时按项从后往前裁，`protect` 的项不裁；裁掉的在末尾写
 * “已省略：……”。字数按码点数（`[...text].length`），不含段标题。Spec 只给了各段各自的上限、没有总上限，所以“裁的先后按段”暂不起
 * 作用（待确认清单），只按段裁；这一场的秘密里的项都不裁（Spec：最后才裁，且不裁到真相的那一句）。
 */

import type {BriefItem} from "./types";

export const DEFAULT_LIMITS: Readonly<Record<string, number>> = {
    instruction: 600,
    outline: 3000,
    plan: 1500,
    secrets: 1200,
    people: 1500,
    scene: 600,
    address: 400,
    foreshadow: 800,
    decisions: 800,
    reader: 600,
    appearance: 4000,
    previous: 600,
};

export const length = (text: string) => [...text].length;

/** 裁一段：返回留下的项与被裁掉的项的标签。 */
export function trim(items: readonly BriefItem[], limit: number): {readonly kept: BriefItem[]; readonly omitted: string[]} {
    const kept = [...items];
    const omitted: string[] = [];
    const size = () => length(kept.map((item) => item.text).join("\n"));
    while (size() > limit) {
        let index = -1;
        for (let i = kept.length - 1; i >= 0; i -= 1) {
            if (kept[i]!.protect !== true) {
                index = i;
                break;
            }
        }
        if (index === -1) break;
        omitted.push(kept[index]!.label);
        kept.splice(index, 1);
    }
    return {kept, omitted};
}
