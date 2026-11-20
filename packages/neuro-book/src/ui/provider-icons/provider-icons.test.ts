/**
 * 服务商图标表（`files.ts`、`urls.ts`）与角色图标表：登记的文件都存在；多色图（`image`）里没有 `currentColor` 与黑色填充
 * （作 `<img>` 时它们解析成黑色、暗色下看不见）；两张表的文件名一致；角色图标的 class 都是图标集里的写法。
 */

import {describe, expect, test} from "bun:test";
import {existsSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";

import {PROVIDER_ICON_FILES} from "./files";
import {BUILTIN_ROLE_ICONS, DEFAULT_ROLE_ICON, roleIconClass, ROLE_ICONS} from "../role-icons";

const icons = join(dirname(createRequire(import.meta.url).resolve("@lobehub/icons-static-svg/package.json")), "icons");
const entries = Object.entries(PROVIDER_ICON_FILES);

describe("服务商图标表", () => {
    test("登记的文件都在图标包里", () => {
        expect(entries.filter(([, entry]) => !existsSync(join(icons, entry.file))).map(([id]) => id)).toEqual([]);
    });

    test("多色图里没有 currentColor 与黑色填充；单色图才用 mask", () => {
        const offenders = entries
            .filter(([, entry]) => entry.kind === "image")
            .filter(([, entry]) => {
                const svg = readFileSync(join(icons, entry.file), "utf8");
                return svg.includes("currentColor") || /fill="#000(?:000)?"/iu.test(svg);
            })
            .map(([id, entry]) => `${id}: ${entry.file}`);
        expect(offenders).toEqual([]);
    });

    test("地址表与登记表的文件名一致", () => {
        const source = readFileSync(join(import.meta.dir, "urls.ts"), "utf8");
        const imported = [...source.matchAll(/icons\/([\w-]+\.svg)\?url/gu)].map((match) => match[1]!);
        expect(imported.sort()).toEqual([...new Set(entries.map(([, entry]) => entry.file))].sort());
    });
});

describe("角色图标表", () => {
    test("内置角色都有默认图标；不认识的键与没写键的自建角色用通用图标", () => {
        for (const id of ["tiny", "fast", "main", "deep", "compaction"]) {
            expect(BUILTIN_ROLE_ICONS[id]).toBeDefined();
            expect(roleIconClass(id, null)).toBe(ROLE_ICONS[BUILTIN_ROLE_ICONS[id]!]!);
        }
        expect(roleIconClass("main", "bolt")).toBe(ROLE_ICONS.bolt!);
        expect(roleIconClass("custom-1", null)).toBe(DEFAULT_ROLE_ICON);
        expect(roleIconClass("custom-1", "no-such-key")).toBe(DEFAULT_ROLE_ICON);
    });

    test("class 都是 lucide 的图标写法", () => {
        expect(Object.values(ROLE_ICONS).filter((name) => !/^i-lucide-[a-z0-9-]+$/u.test(name))).toEqual([]);
    });
});
