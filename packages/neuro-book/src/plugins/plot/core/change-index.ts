/**
 * 一份只读视图上变更的索引（目标检查与写作指示检查共用）：按章分组、按条目分组。一次读待处理里的几个诊断都要“某个条目被哪些变更
 * 改过”“某一章有哪些变更”，各自用 `view.changes({...})` 筛要把全部变更扫一遍（每个目标、每一章一遍）；建一次、查表，输入一变就是
 * 新的视图对象，索引随它释放（缓存见 `view-cache.ts`）。
 */

import type {CanonReadView, StoryChange} from "@notnotype/nb-canon/schema";

import {perViewCache} from "./view-cache";

export interface ChangeIndex {
    /** 生效（不是已撤销）、安放在章里的变更，按章。含计划和已写，不含分叉。 */
    readonly byChapter: ReadonlyMap<string, readonly StoryChange[]>;
    /** 在这一章讲述（`told` 的 `chapter`）的变更：补叙章的内容安放在别处、讲述在本章。 */
    readonly byTold: ReadonlyMap<string, readonly StoryChange[]>;
    /** 补丁改了这个条目的 `goal` 命名空间的变更。 */
    readonly goalTouches: ReadonlyMap<string, readonly StoryChange[]>;
    /** 涉及这个条目的变更（`involves` 或补丁地址里有它）。 */
    readonly involving: ReadonlyMap<string, readonly StoryChange[]>;
}

const indexes = perViewCache<ChangeIndex>();

export function changeIndex(view: CanonReadView): ChangeIndex {
    return indexes(view, "", () => {
        const byChapter = new Map<string, StoryChange[]>();
        const byTold = new Map<string, StoryChange[]>();
        const goalTouches = new Map<string, StoryChange[]>();
        const involving = new Map<string, StoryChange[]>();
        const add = (map: Map<string, StoryChange[]>, key: string, change: StoryChange) => {
            const list = map.get(key);
            if (list === undefined) map.set(key, [change]);
            else if (list.at(-1) !== change) list.push(change);
        };
        for (const change of view.changes()) {
            if (change.status !== "active" || change.nature === "fork") continue;
            if (change.at.kind === "chapter") add(byChapter, change.at.chapter, change);
            for (const telling of change.told) if (telling.chapter !== undefined) add(byTold, telling.chapter, change);
            for (const id of change.involves) add(involving, id, change);
            for (const patch of change.patches) {
                add(involving, patch.at.entry, change);
                if (patch.at.path.startsWith("goal.")) add(goalTouches, patch.at.entry, change);
            }
        }
        return {byChapter, byTold, goalTouches, involving};
    });
}
