/**
 * 作者界面的组件测试里往真实世界写数据的几个小工具：发布一次、一个带人物与面板的条目、一条给存款加减的剧情变更。写入都经真实
 * 的世界客户端（`publish`），id 用临时 id，世界换成正式 id 后从返回的 `ids` 取。
 */

import type {Entry, StoryChangeDraft, WriteRequest} from "@notnotype/nb-canon";

import type {CanonClient} from "../shared/contracts";

let sequence = 0;
/** 测试里各处用的序号：临时 id、请求 id、顺序与排序键。 */
export const nextId = (): string => String(++sequence);
export const currentSequence = (): number => sequence;

/**
 * 发布一次；条目直接给，别的对象给写入项。返回临时 id 到正式 id 的对照、这次修订的 id 与发布后的版本。缺省是作者的一次编辑，
 * `request` 换写入者、种类或所在的章。
 */
export async function publishWith(canon: CanonClient, given: ReadonlyArray<Entry | WriteRequest["puts"][number]>, title = "写入", request: Partial<Pick<WriteRequest, "by" | "what" | "chapter">> = {}): Promise<{readonly ids: Record<string, string>; readonly revision: string; readonly version: number}> {
    const puts = given.map((item) => ("init" in item ? {ref: {kind: "entry" as const, id: item.id}, after: item} : item));
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(JSON.stringify(status.failure));
    const result = await canon.publish({requestId: `req-${nextId()}`, by: {kind: "author"}, what: "edit", title, baseVersion: status.value.version, puts, ...request});
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return {ids: {...result.value.ids}, revision: result.value.revision, version: result.value.version};
}

export async function publish(canon: CanonClient, given: ReadonlyArray<Entry | WriteRequest["puts"][number]>): Promise<Record<string, string>> {
    return (await publishWith(canon, given)).ids;
}

/** 一个人物条目：性格“黑发”、存款 `money` 元（面板上条目自己声明的字段），主文字引用存款。 */
export function person(name: string, extra: Partial<Entry> = {}, money = 1000): Entry {
    return {
        id: `tmp:${nextId()}`, type: "nbook.canon.person", parent: null, folder: "人物", order: sequence,
        init: {
            name, aliases: [], summary: `${name}的简介`, text: [{id: "b1", source: "她有 <V of=\"panel.存款\" /> 元。"}],
            data: {
                character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {性格: "黑发", 身份: null, 现在的状态: null}},
                panel: {type: "nbook.canon.panel", version: 1, enabled: true, fields: {存款: money}, declared: [{id: "存款", label: "存款", kind: "number", unit: "元"}]},
            },
        },
        ...extra,
    };
}

/** 一条安放在某章、给存款加减 `delta` 的剧情变更。 */
export function change(entry: string, chapter: string, text: string, delta: number, basis?: StoryChangeDraft["patches"][number]["basis"]): WriteRequest["puts"][number] {
    const id = `tmp:${nextId()}`;
    const after: StoryChangeDraft = {
        id, kind: "written", text, at: {kind: "chapter", chapter, key: sequence}, told: [], involves: [entry], lines: [], links: [], status: "active", by: {kind: "author"},
        patches: [{op: "add", at: {entry, path: "panel.存款"}, value: delta, ...(basis === undefined ? {} : {basis})}],
    };
    return {ref: {kind: "change", id}, after};
}

/** 一个核对点：第 `chapter` 章安放处，正文写存款是 `value`（出处是作者的笔记，不在正文里找原句）。 */
export function check(entry: string, chapter: string, value: number, quote = `余额 ${String(value)}`): WriteRequest["puts"][number] {
    const id = `tmp:${nextId()}`;
    return {ref: {kind: "check", id}, after: {id, at: {entry, path: "panel.存款"}, value, told: {source: "note", quote}, place: {kind: "chapter", chapter, key: sequence}}};
}
