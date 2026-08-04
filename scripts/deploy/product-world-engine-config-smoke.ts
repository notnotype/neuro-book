#!/usr/bin/env bun
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {WorldCalendarLoader} from "nbook/server/world-engine/calendar";
import {WorldSchemaLoader} from "nbook/server/world-engine/schema-loader";
import {z} from "zod";

/** 在 Product State/Cache 外建立一次性 schema，验证 World Engine 不依赖镜像 node_modules。 */
const runtimePaths = runtimePathsFromEnv();
const root = join(runtimePaths.cacheRoot, `world-engine-config-smoke-${process.pid}`);
try {
    if (typeof z.object !== "function") {
        throw new Error("Product World Engine smoke 缺少 bundled Zod runtime。");
    }
    await rm(root, {recursive: true, force: true});
    await mkdir(join(root, "world-engine", "schema"), {recursive: true});
    await writeFile(join(root, "world-engine", "schema", "index.ts"), [
        'import {z} from "zod";',
        'import {Ref} from "nbook/world-engine/schema";',
        'export default {character: z.object({name: z.string(), mentor: Ref("character").optional()})};',
        "",
    ].join("\n"), "utf8");
    await writeFile(join(root, "world-engine", "calendar.ts"), [
        "export default {",
        "    type: 'simple',",
        "    eraBefore: 'Product',",
        "    eraAfter: 'Product',",
        "    baseUnit: 'second',",
        "    units: [",
        "        {name: 'minute', parent: 'second', ratio: 60},",
        "        {name: 'hour', parent: 'minute', ratio: 60},",
        "        {name: 'day', parent: 'hour', ratio: 24},",
        "    ],",
        "    format: '{eraName}{day} {hour:02}:{minute:02}:{second:02}',",
        "};",
        "",
    ].join("\n"), "utf8");
    const schema = await new WorldSchemaLoader().load(absoluteFsPath(root));
    const character = schema.subjectTypes.character;
    if (!character || character.attrs.name?.type !== "string" || character.attrs.mentor?.type !== "ref(character)") {
        throw new Error("World Engine Product schema smoke 未得到预期 schema projection。");
    }
    const calendar = await new WorldCalendarLoader().load(absoluteFsPath(root));
    const instant = calendar.parse("Product1 00:00:00");
    const formatted = calendar.format(instant);
    if (instant !== 0n || formatted !== "Product1 00:00:00") {
        throw new Error(`World Engine Product calendar smoke 未得到预期 parse/format：${String(instant)} / ${formatted}`);
    }
    console.log(JSON.stringify({ok: true, subjectTypes: Object.keys(schema.subjectTypes).sort(), calendar: formatted}, null, 2));
} finally {
    await rm(root, {recursive: true, force: true});
}
