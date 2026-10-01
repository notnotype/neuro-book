import {execFile} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {inflateRawSync} from "node:zlib";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {describe, expect, it} from "vitest";
import {productRuntimeCompatibilityPlugin} from "#scripts/build/product-bundle-plugins";

import {
    bundleProductJavaScript,
    productBundleOutputText,
} from "#scripts/build/product-reproducible-bundle";

describe("Product reproducible bundle", () => {
    it("相同 ESM graph 产生逐字节一致的链接与压缩输出", async () => {
        const options = {
            stdin: {
                contents: [
                    "const deliberatelyLongIdentifier = 40;",
                    "const anotherLongIdentifier = 2;",
                    "export const answer = deliberatelyLongIdentifier + anotherLongIdentifier;",
                    "",
                ].join("\n"),
                sourcefile: "fixture.mjs",
            },
            write: false,
        } as const;

        const [left, right] = await Promise.all([
            bundleProductJavaScript(options),
            bundleProductJavaScript(options),
        ]);
        const leftSource = productBundleOutputText(left, "fixture A");
        const rightSource = productBundleOutputText(right, "fixture B");

        expect(leftSource).toBe(rightSource);
        expect(leftSource).toContain("export");
    });

    it("纯类型投影产生显式空 ESM，不退化成0字节文件", async () => {
        const result = await bundleProductJavaScript({
            stdin: {contents: "export {};\n", sourcefile: "contracts.mjs"},
            write: false,
        });

        expect(productBundleOutputText(result, "contracts")).toBe("export{};\n");
    });

    it("执行真实 Product bundle 时缓冲区与分块流的 ZIP 内容和 CRC 正确", async () => {
        const root = await mkdtemp(testHostPath("product-archive-crc-"));
        try {
            const entry = join(root, "archive.mjs");
            await bundleProductJavaScript({
                stdin: {
                    contents: [
                        'import {Readable} from "node:stream";',
                        'import {ZipFile} from "yazl";',
                        'const payload = Buffer.from("123456789");',
                        "const zip = new ZipFile();",
                        'zip.addBuffer(payload, "buffer.txt");',
                        'zip.addReadStream(Readable.from([payload.subarray(0, 4), payload.subarray(4)]), "stream.txt");',
                        "zip.outputStream.pipe(process.stdout);",
                        "zip.end();",
                    ].join("\n"),
                    resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
                    sourcefile: "archive-probe.mjs",
                },
                outfile: entry,
                plugins: [productRuntimeCompatibilityPlugin()],
            });
            const {stdout} = await promisify(execFile)("bun", [entry], {
                cwd: root,
                env: {...process.env, NODE_PATH: ""},
                encoding: "buffer",
                timeout: 10_000,
                windowsHide: true,
            });
            const endOffset = stdout.length - 22;
            expect(stdout.readUInt32LE(endOffset)).toBe(0x06054b50);
            expect(stdout.readUInt16LE(endOffset + 10)).toBe(2);
            let centralOffset = stdout.readUInt32LE(endOffset + 16);
            for (const name of ["buffer.txt", "stream.txt"]) {
                expect(stdout.readUInt32LE(centralOffset)).toBe(0x02014b50);
                expect(stdout.readUInt32LE(centralOffset + 16)).toBe(0xcbf43926);
                expect(stdout.readUInt32LE(centralOffset + 24)).toBe(9);
                const nameBytes = stdout.readUInt16LE(centralOffset + 28);
                expect(stdout.subarray(centralOffset + 46, centralOffset + 46 + nameBytes).toString()).toBe(name);
                const localOffset = stdout.readUInt32LE(centralOffset + 42);
                expect(stdout.readUInt32LE(localOffset)).toBe(0x04034b50);
                const dataOffset = localOffset + 30 + stdout.readUInt16LE(localOffset + 26)
                    + stdout.readUInt16LE(localOffset + 28);
                const compressedSize = stdout.readUInt32LE(centralOffset + 20);
                expect(inflateRawSync(stdout.subarray(dataOffset, dataOffset + compressedSize)).toString()).toBe("123456789");
                centralOffset += 46 + nameBytes + stdout.readUInt16LE(centralOffset + 30)
                    + stdout.readUInt16LE(centralOffset + 32);
            }
            expect(centralOffset).toBe(endOffset);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    }, 20_000);

    it("执行真实 Product bundle 时 json-bigint 保留 BigNumber 类型与大整数精度", async () => {
        const root = await mkdtemp(testHostPath("product-bigint-interop-"));
        try {
            const entry = join(root, "bigint.mjs");
            await bundleProductJavaScript({
                stdin: {
                    contents: [
                        'import JSONbig from "json-bigint";',
                        'import BigNumber from "bignumber.js";',
                        'const parsed = JSONbig.parse(\'{"value":9007199254740993123456789}\');',
                        "console.log(JSON.stringify({",
                        "    isBigNumber: BigNumber.isBigNumber(parsed.value),",
                        "    value: parsed.value.toFixed(),",
                        "}));",
                    ].join("\n"),
                    resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
                    sourcefile: "bigint-probe.mjs",
                },
                outfile: entry,
                plugins: [productRuntimeCompatibilityPlugin()],
            });
            const {stdout} = await promisify(execFile)("bun", [entry], {
                cwd: root,
                env: {...process.env, NODE_PATH: ""},
                timeout: 10_000,
                windowsHide: true,
            });
            expect(JSON.parse(stdout)).toEqual({
                isBigNumber: true,
                value: "9007199254740993123456789",
            });
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    }, 20_000);
});
