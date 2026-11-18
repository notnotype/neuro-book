/**
 * 回执页、变更详情页与还原的对话框要写出别的条目的名字与字段的显示名（docs/specs/canon/author-ui.md 输出 20 到 22）：每个
 * 用到的条目读一次 `entry`（缺省位置、实际模式，同条目树写的名字），世界变了跟着重读。界面上不出现条目 id 与字段路径，读不到
 * 的写“一个条目”、字段名退到路径的最后一段。
 */

import {computed} from "vue";

import type {FieldDeclaration, ReadPosition} from "@notnotype/nb-canon";

import type {CanonBoundText} from "./positions";
import {useWorldReads} from "./use-reads";
import type {CanonWorld} from "./world";

/** 一页里最多为这么多个对象（条目、剧情变更、修订）另读名字；更多的写“一个条目”这类。一次修订改几百个对象时不为它们发几百个读取。 */
export const NAMED_ENTRIES_MAX = 50;

export interface EntryHeads {
    /** 条目在缺省位置上的名字；还没读到或读不到时为 undefined。 */
    name(id: string): string | undefined;
    /**
     * 一个地址的显示名：`<命名空间>.<字段>` 起头的用字段声明（没有声明时是字段名）；条目自己的名字、简介、别名（`entry.name`
     * 这类）与主文字的块（`text[块]`）用固定的词。地址的写法见 canon.model 的“地址”。
     */
    label(path: string, entry: string): string;
    /** “星瑕的存款”这样的一句：条目名加字段显示名。 */
    address(at: {readonly entry: string; readonly path: string}): string;
}

/** 路径的命名空间与字段（`panel.存款`、`character.技能[x].等级` 都取前两段）。 */
export function namespaceField(path: string): {readonly namespace: string; readonly field: string} {
    const split = path.indexOf(".");
    if (split < 0) return {namespace: "", field: path};
    const rest = path.slice(split + 1);
    const end = rest.search(/[.[]/u);
    return {namespace: path.slice(0, split), field: end < 0 ? rest : rest.slice(0, end)};
}

export function useEntryHeads(world: CanonWorld, ids: () => readonly string[], position: () => ReadPosition | null, text: CanonBoundText): EntryHeads {
    const inputs = computed(() => {
        const at = position();
        const result = new Map<string, {id: string; position: ReadPosition; mode: "actual"}>();
        if (at === null) return result;
        for (const id of ids()) {
            if (result.size >= NAMED_ENTRIES_MAX) break;
            result.set(id, {id, position: at, mode: "actual"});
        }
        return result;
    });
    const reads = useWorldReads(world, "entry", () => inputs.value);
    const read = (id: string) => reads.value.get(id)?.data;
    const declaration = (entry: string, path: string): FieldDeclaration | undefined => {
        const {namespace, field} = namespaceField(path);
        return read(entry)?.declarations?.[namespace]?.find((item) => item.id === field);
    };
    const heads: EntryHeads = {
        name: (id) => read(id)?.view?.name ?? undefined,
        label: (path, entry) => {
            if (path.startsWith("text[") || path === "text") return text("receipt.fields.text");
            if (path === "entry.name") return text("receipt.fields.name");
            if (path === "entry.summary") return text("receipt.fields.summary");
            if (path.startsWith("entry.aliases")) return text("receipt.fields.aliases");
            return declaration(entry, path)?.label ?? namespaceField(path).field;
        },
        address: (at) => text("names.address", {entry: heads.name(at.entry) ?? text("names.someEntry"), label: heads.label(at.path, at.entry)}),
    };
    return heads;
}
