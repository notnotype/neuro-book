/**
 * 侧栏“剧情”的剧情线（docs/specs/plot/author-ui.md 输出 1）：种类为“剧情线”的条目，在读取位置上已出场、未删除，按条目树的顺序。
 */

import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import {PLOT_LINE_TYPE} from "../decisions";
import {compareKeys, treeKey} from "./secrets";

export function plotLines(view: CanonReadView, position: ReadPosition, mode: Mode): string[] {
    return view.entries()
        .filter((entry) => {
            if (entry.type !== PLOT_LINE_TYPE || entry.deleted === true) return false;
            const read = view.entry(entry.id, position, mode);
            return read !== null && read !== "chapter-not-found" && !read.deleted && read.appeared;
        })
        .map((entry) => ({id: entry.id, key: treeKey(view, entry.id)}))
        .sort((a, b) => compareKeys(a.key, b.key))
        .map((entry) => entry.id);
}
