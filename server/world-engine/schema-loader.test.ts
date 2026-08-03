import {mkdtemp, rm, mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach, describe, expect, test} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {WorldSchemaLoader} from "nbook/server/world-engine/schema-loader";

describe("WorldSchemaLoader", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    test("从单文件 Zod schema 生成运行时 projection", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-world-schema-loader-"));
        roots.push(root);
        const schemaRoot = join(root, "world-engine", "schema");
        await mkdir(schemaRoot, {recursive: true});
        await writeFile(join(schemaRoot, "index.ts"), [
            'import {z} from "zod";',
            'import {Ref} from "nbook/world-engine/schema";',
            "const Character = z.object({name: z.string(), mentor: Ref('character').optional()});",
            "export default {character: Character};",
            "",
        ].join("\n"), "utf8");

        const schema = await new WorldSchemaLoader().load(absoluteFsPath(root));
        expect(schema.subjectTypes.character.attrs.name).toMatchObject({kind: "scalar", type: "string"});
        expect(schema.subjectTypes.character.attrs.mentor).toMatchObject({kind: "scalar", type: "ref(character)"});
    });

    test("缺少 schema/index.ts 时返回空 schema，不再读取 YAML", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-world-schema-empty-"));
        roots.push(root);
        await mkdir(join(root, "world-engine"), {recursive: true});
        await writeFile(join(root, "world-engine", "schema.yaml"), "subjectTypes: {}\n", "utf8");

        await expect(new WorldSchemaLoader().load(absoluteFsPath(root))).rejects.toThrow("schema.yaml");
    });
});
