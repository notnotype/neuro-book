/**
 * 把星瑕样本经世界服务发布到一个临时项目（真实的 `./node` 存储），并按读取位置把结果与原型算出的结果逐项对照
 * （canon.project 场景 1）。不含断言：对照结果交给测试与差异清单。
 */

import {createHash} from "node:crypto";
import {join} from "node:path";

import {buildRegistry, type ReadPosition} from "../../src/index";
import {nodeFiles, WorldService, type ServicePorts} from "../../src/node/index";
import {memoryLock} from "../fixtures/faulty-files";
import {componentDeclarations, IdMap, toRequest, type PrototypeSample} from "./convert";

export interface Difference {
    /** `初值`、`ch1 开头`、`ch2 末尾`……；`待处理` 是写到的位置上的待处理。 */
    readonly where: string;
    /** 原型条目 id 与地址（`entry.name`、`panel.存款`、`appeared`）。 */
    readonly entry: string;
    readonly path: string;
    readonly prototype: unknown;
    readonly canon: unknown;
}

export interface Replayed {
    readonly service: WorldService;
    readonly ids: IdMap;
    /** 回放结束时各章的正文（样本各项写进去以后的样子）。 */
    readonly texts: ReadonlyMap<string, string>;
}

const label = (position: ReadPosition): string => (position.kind === "initial" ? "初值" : `${position.chapter} ${position.edge === "start" ? "开头" : "末尾"}`);

export function ports(root: string, sample: PrototypeSample, texts: Map<string, string>): ServicePorts {
    // 原型的小模型是查表：同样的起点与事件给同样的一句话；表里没有的，原型把事件拼起来。
    const table = new Map(sample.reductions.map((item) => [item.inputs.join("|"), item.text]));
    return {
        files: nodeFiles,
        lock: memoryLock(),
        logDir: join(root, ".nbook", "world", "log"),
        sideDir: join(root, ".nbook", "world"),
        cachePath: join(root, ".nbook", "cache", "reductions.jsonl"),
        chapterText: (chapter) => texts.get(chapter),
        digest: (text) => createHash("sha256").update(text).digest("hex"),
        clock: () => 0,
        now: () => "2026-11-02T00:00:00.000Z",
        reducer: {version: "prototype-table", reduce: async (input) => table.get([input.anchor ?? "未知", ...input.events].join("|")) ?? `${input.anchor ?? "未知"}；之后：${input.events.join("；")}（原型没有接小模型，先把事件拼起来）`},
    };
}

export async function replay(root: string, sample: PrototypeSample): Promise<Replayed> {
    const texts = new Map(sample.chapters.map((chapter) => [chapter.id, chapter.text]));
    const opened = await WorldService.open(ports(root, sample, texts), {chapters: sample.chapters.map((chapter) => chapter.id), registry: buildRegistry(componentDeclarations(sample))});
    if ("code" in opened) throw new Error(opened.code);
    const ids = new IdMap();
    // 章序调整是第 1 次修订；原型的修订从样本的第一项算起。
    const written = new Map<string, string>();
    for (const [index, item] of sample.items.entries()) {
        for (const [chapter, file] of Object.entries(item.files ?? {})) {
            if (file.text === undefined) continue;
            texts.set(chapter, file.text);
            // 宿主改了正文要通知世界服务（canon.project 输出 25），服务按快照里的正文校验原句。
            opened.textChanged(chapter);
        }
        const draft = item.draft as Parameters<typeof toRequest>[0];
        const result = draft.reverts !== undefined
            ? await opened.revert(ids.revision(draft.reverts), false, {requestId: `xingxia-${String(index + 1)}`, by: draft.by, title: draft.title})
            : await opened.publish(toRequest(draft, index, ids, sample, opened.status().version, written));
        if (!result.ok) throw new Error(`样本第 ${String(index + 1)} 项“${item.label}”发布失败：${JSON.stringify(result.failure)}`);
        ids.learn(result.ids, result.revision.id);
    }
    await opened.idle();
    return {service: opened, ids, texts};
}

/** 每个读取位置上每个原型条目的名字、一句话、出场与各字段的值，原型的与世界算出的逐项比；只列不同的。 */
export function differences(sample: PrototypeSample, replayed: Replayed): Difference[] {
    const found: Difference[] = [];
    for (const result of sample.results) {
        const position = result.position as ReadPosition;
        for (const [protoId, expected] of Object.entries(result.entries)) {
            const read = replayed.service.entry(replayed.ids.get(protoId), position, "actual");
            if (typeof read === "string" || read.view === null) {
                found.push({where: label(position), entry: protoId, path: "", prototype: "有", canon: typeof read === "string" ? read : null});
                continue;
            }
            const view = read.view;
            const compare = (path: string, prototype: unknown, canon: unknown) => {
                if (JSON.stringify(prototype) !== JSON.stringify(canon)) found.push({where: label(position), entry: protoId, path, prototype, canon});
            };
            compare("appeared", expected.appeared, view.appeared);
            compare("entry.name", expected.state.name, view.name);
            compare("entry.summary", expected.state.summary, view.summary);
            for (const [ns, block] of Object.entries(expected.state.data)) {
                for (const [field, value] of Object.entries(block.fields)) {
                    const state = view.namespaces[ns]?.fields[field];
                    compare(`${ns}.${field}`, value, state === undefined ? "（没有这个字段）" : state.notReduced === true ? {notReduced: state.value} : (state.value ?? null));
                }
            }
        }
    }
    return found;
}
