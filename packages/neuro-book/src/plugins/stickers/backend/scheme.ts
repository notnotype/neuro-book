/**
 * `stickers://`（docs/specs/agent/stickers.md 输出 13）：根列出全部表情包，挂载点是表情包 id，落在它所在的文件夹（用户与插件的
 * 表情包在不同的目录里，同 `skills://`）。只读：读、列、取真实路径；写入一律拒绝。
 */

import {basename, dirname} from "node:path";

import type {MountedSchemeSpec} from "nbook/plugins/files/shared/contracts";

import type {StickerCatalog} from "./catalog";

const SOURCE_TEXT = {user: "我的", plugin: "插件"} as const;

export function stickersScheme(catalog: Pick<StickerCatalog, "list" | "item">, container: string): MountedSchemeSpec {
    return {
        capabilities: ["read", "list", "realPath"],
        container,
        root: () => {
            const packs = catalog.list();
            const entries = packs.map((pack) => ({
                name: pack.id,
                title: pack.title,
                meta: {
                    source: SOURCE_TEXT[pack.source],
                    stickers: String(pack.stickers.length),
                    status: pack.status === "ok" ? "可用" : "无效",
                    ...(pack.problem === undefined ? {} : {problem: pack.problem.code}),
                    ...(pack.description === undefined ? {} : {description: pack.description}),
                },
            }));
            return {description: entries.length === 0 ? "表情包目录。还没有表情包：用户把表情包文件夹放进 user://stickers/ 后会列在这里。" : "表情包目录，只读。每个表情包的文件在 stickers://<id>/ 下，清单是 stickers.json（name 是写法里的名字，when 是什么时候用）。写法是 :文件夹名/名字:。", entries};
        },
        // 链接的表情包不挂（挂载点不能是链接），无效的照样能看清单。
        mount: (name) => {
            const item = catalog.item(name);
            if (item === undefined || item.entry.problem?.code === "symlink") return null;
            return {create: false, container: dirname(item.directory), directory: basename(item.directory)};
        },
        authorize: (_caller, _mount, operation) => (operation === "write" || operation === "create" ? "permission-denied" : true),
    };
}
