/**
 * `SessionFiles` 的合同测试（docs/specs/harness/host-kit.md）：宿主给出一个实现与夹具，这里逐条核对 Spec 的输出与失败码。
 * kit 的本机参考实现与各宿主的实现各跑一遍：kit 自己的测试改用本机实现之后，“替身与真实实现对过契约”靠的就是这份。
 *
 * 测试名里的编号是 host-kit.md 的输出条目。分组与来源（输出 8 的“属于这次调用”）只有宿主看得到，由宿主自己的测试核对。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {renderVirtual} from "../files/index.js";
import type {ArtifactStore, FileResult, SessionFiles} from "../files/index.js";

export interface SessionFilesFixture {
    readonly files: SessionFiles;
    readonly artifacts: ArtifactStore;
    /** 一个可写的空目录的全局地址。 */
    readonly writable: string;
    /** 同一个目录的单数写法；宿主没有单数写法时与 `writable` 相同。 */
    readonly singular: string;
    /** `writable` 的本机路径：测试在里面放链接、直接看磁盘。 */
    readonly writablePath: string;
    /** 会话不许写的一个地址，在支持写的方案里（不支持写的方案得 `unsupported-capability`）。 */
    readonly denied: string;
    /** 宿主有虚拟根时给一个支持写的方案的根（写它得 `permission-denied`）。 */
    readonly virtual?: string;
    /** 宿主有不露出的位置时给一个。 */
    readonly protected?: string;
    close(): Promise<void>;
}

const text = (result: FileResult<{readonly bytes: Uint8Array}>): string => (result.ok ? new TextDecoder().decode(result.value.bytes) : `失败：${result.code}`);
const codeOf = (result: {readonly ok: boolean; readonly code?: string}): string => (result.ok ? "ok" : (result.code ?? ""));
/** 分类只看 `write`：宿主可以多带别的字段。 */
const writeOf = (classified: {readonly write?: string; readonly code?: string}): string => classified.write ?? `失败：${classified.code ?? ""}`;

/** 用 `setup` 交回的夹具跑一遍合同；`name` 出现在 describe 里，分清是哪个实现。 */
export function sessionFilesContract(name: string, setup: () => Promise<SessionFilesFixture>): void {
    describe(`SessionFiles 合同：${name}`, () => {
        let fixture: SessionFilesFixture;
        let counter = 0;
        /** 每个用例一个子目录，互不影响。 */
        const fresh = async (): Promise<{readonly global: string; readonly singular: string; readonly path: string}> => {
            counter += 1;
            const segment = `case-${String(counter)}`;
            await mkdir(join(fixture.writablePath, segment));
            return {global: `${fixture.writable}/${segment}`, singular: `${fixture.singular}/${segment}`, path: join(fixture.writablePath, segment)};
        };

        beforeAll(async () => {
            fixture = await setup();
        });
        afterAll(async () => {
            await fixture.close();
        });

        it("输出 1：单数地址改写成全局地址，全局地址原样通过，改写是幂等的；不合法的地址为 invalid-address", async () => {
            const {files} = fixture;
            const expanded = files.expand(`${fixture.singular}/a.md`);
            expect(expanded).toEqual({ok: true, address: `${fixture.writable}/a.md`});
            expect(files.expand(`${fixture.writable}/a.md`)).toEqual({ok: true, address: `${fixture.writable}/a.md`});
            if (expanded.ok) expect(files.expand(expanded.address)).toEqual(expanded);
            expect(codeOf(files.expand("not an address"))).toBe("invalid-address");
            expect(codeOf(files.expand(`${fixture.writable}/../x`))).toBe("invalid-address");
        });

        it("输出 2：改写失败时，每个方法与绑定调用的读写都交回改写的失败", async () => {
            const bad = `${fixture.writable}/../x`;
            const call = fixture.files.call({callId: "call-bad", signal: new AbortController().signal});
            expect(writeOf(fixture.files.classify(bad))).toBe("失败：invalid-address");
            expect([
                codeOf(await fixture.files.readPath(bad)),
                codeOf(await fixture.files.read(bad)),
                codeOf(await fixture.files.write(bad, "x", {expect: "any"})),
                codeOf(await fixture.files.list(bad)),
                codeOf(await call.read(bad)),
                codeOf(await call.write(bad, "x", {expect: "any"})),
            ]).toEqual(Array(6).fill("invalid-address"));
        });

        it("输出 6：字节内容原样写入，不经文字编码", async () => {
            const dir = await fresh();
            const bytes = new Uint8Array([0xff, 0x00, 0x80, 0x0a]);
            expect((await fixture.files.write(`${dir.global}/a.bin`, bytes, {expect: "absent"})).ok).toBe(true);
            const read = await fixture.files.read(`${dir.global}/a.bin`);
            expect(read.ok && [...read.value.bytes]).toEqual([...bytes]);
            expect([...(await readFile(join(dir.path, "a.bin")))]).toEqual([...bytes]);
        });

        it("输出 2、6：经单数地址写、经全局地址读到同样的字节；字符串按 UTF-8 编码；写交回的基线就是读到的基线", async () => {
            const dir = await fresh();
            const written = await fixture.files.write(`${dir.singular}/a.md`, "第一章\n", {expect: "absent"});
            if (!written.ok) throw new Error(written.code);
            const read = await fixture.files.read(`${dir.global}/a.md`);
            expect(text(read)).toBe("第一章\n");
            expect(read.ok && read.value.baseline).toEqual(written.value.baseline);
            expect(await readFile(join(dir.path, "a.md"), "utf8")).toBe("第一章\n");
        });

        it("输出 6：expect 为旧基线得 conflict，absent 对已存在的得 conflict，都不写；any 覆盖", async () => {
            const dir = await fresh();
            const address = `${dir.global}/a.md`;
            const first = await fixture.files.write(address, "一", {expect: "absent"});
            if (!first.ok) throw new Error(first.code);
            const second = await fixture.files.write(address, "二", {expect: first.value.baseline});
            expect(second.ok).toBe(true);
            expect(codeOf(await fixture.files.write(address, "三", {expect: first.value.baseline}))).toBe("conflict");
            expect(codeOf(await fixture.files.write(address, "三", {expect: "absent"}))).toBe("conflict");
            expect(text(await fixture.files.read(address))).toBe("二");
            expect((await fixture.files.write(address, "四", {expect: "any"})).ok).toBe(true);
            expect(text(await fixture.files.read(address))).toBe("四");
        });

        it("输出 6：父目录不存在时，createParents 为真先建好，否则失败；路上有一段是文件为 not-a-directory", async () => {
            const dir = await fresh();
            expect((await fixture.files.write(`${dir.global}/x/y/a.md`, "甲", {expect: "absent"})).ok).toBe(false);
            expect((await fixture.files.write(`${dir.global}/x/y/a.md`, "甲", {expect: "absent", createParents: true})).ok).toBe(true);
            expect(text(await fixture.files.read(`${dir.global}/x/y/a.md`))).toBe("甲");
            await writeFile(join(dir.path, "file"), "x");
            expect(codeOf(await fixture.files.write(`${dir.global}/file/under.md`, "乙", {expect: "absent", createParents: true}))).toBe("not-a-directory");
        });

        it("输出 6、8：signal 在提交之前已触发为 cancelled，目标保持原样；绑定调用的 signal 同样合进写", async () => {
            const dir = await fresh();
            const address = `${dir.global}/a.md`;
            expect((await fixture.files.write(address, "原样", {expect: "absent"})).ok).toBe(true);
            const aborted = AbortSignal.abort();
            expect(codeOf(await fixture.files.write(address, "改了", {expect: "any", signal: aborted}))).toBe("cancelled");
            const call = fixture.files.call({callId: "call-1", signal: aborted});
            expect(codeOf(await call.write(address, "改了", {expect: "any"}))).toBe("cancelled");
            expect(text(await fixture.files.read(address))).toBe("原样");
            const live = fixture.files.call({callId: "call-2", signal: new AbortController().signal}, {title: "测试"});
            expect((await live.write(address, "经调用写", {expect: "any"})).ok).toBe(true);
            expect(text(await live.read(address))).toBe("经调用写");
        });

        it("输出 3、6：不许写的地址分类为 denied，写为 permission-denied；可写目录里的分类为 allowed", async () => {
            const dir = await fresh();
            expect(writeOf(fixture.files.classify(fixture.denied))).toBe("denied");
            expect(codeOf(await fixture.files.write(fixture.denied, "不该写进去", {expect: "any"}))).toBe("permission-denied");
            expect(writeOf(fixture.files.classify(`${dir.singular}/a.md`))).toBe("allowed");
        });

        it("输出 4：readPath 交回本机路径与种类；没有登记的方案为 unknown-scheme（只写方案名也一样）；不存在为 not-found", async () => {
            const dir = await fresh();
            await writeFile(join(dir.path, "a.md"), "甲");
            const file = await fixture.files.readPath(`${dir.global}/a.md`);
            expect(file.ok && file.value.kind).toBe("file");
            expect(file.ok && (await readFile(file.value.path, "utf8"))).toBe("甲");
            const directory = await fixture.files.readPath(dir.singular);
            expect(directory.ok && directory.value.kind).toBe("directory");
            expect(codeOf(await fixture.files.readPath("no-such-scheme://a"))).toBe("unknown-scheme");
            expect(codeOf(await fixture.files.readPath("no-such-scheme://"))).toBe("unknown-scheme");
            expect(codeOf(await fixture.files.readPath(`${dir.global}/missing.md`))).toBe("not-found");
        });

        it("输出 5、7：读不存在为 not-found、读目录为 not-a-file；列出目录交回一层目录项，列出文件为 not-a-directory", async () => {
            const dir = await fresh();
            await mkdir(join(dir.path, "sub"));
            await writeFile(join(dir.path, "a.md"), "甲");
            expect(codeOf(await fixture.files.read(`${dir.global}/missing.md`))).toBe("not-found");
            expect(codeOf(await fixture.files.read(`${dir.global}/sub`))).toBe("not-a-file");
            const listed = await fixture.files.list(dir.global);
            if (!listed.ok || listed.value.kind === "virtual") throw new Error(`列出失败：${JSON.stringify(listed)}`);
            expect(listed.value.entries.map((entry) => [entry.name, entry.kind]).sort()).toEqual([["a.md", "file"], ["sub", "directory"]]);
            expect(codeOf(await fixture.files.list(`${dir.global}/a.md`))).toBe("not-a-directory");
        });

        it("输出 4、5、6：经符号链接落到根外的读、取本机路径与写都为 outside-root，根外的文件不变", async () => {
            const dir = await fresh();
            const outside = await mkdtemp(join(tmpdir(), "kit-files-outside-"));
            try {
                await writeFile(join(outside, "secret.md"), "根外");
                await symlink(join(outside, "secret.md"), join(dir.path, "link.md"));
                expect(codeOf(await fixture.files.read(`${dir.global}/link.md`))).toBe("outside-root");
                expect(codeOf(await fixture.files.readPath(`${dir.global}/link.md`))).toBe("outside-root");
                expect(codeOf(await fixture.files.write(`${dir.global}/link.md`, "改了", {expect: "any"}))).toBe("outside-root");
                expect(await readFile(join(outside, "secret.md"), "utf8")).toBe("根外");
            } finally {
                await rm(outside, {recursive: true, force: true});
            }
        });

        it("输出 9：失败经结果交回、不抛错，detail 不带本机绝对路径", async () => {
            const dir = await fresh();
            const failures = [
                await fixture.files.read(`${dir.global}/missing.md`),
                await fixture.files.readPath(`${dir.global}/missing.md`),
                await fixture.files.list(`${dir.global}/missing`),
                await fixture.files.write(fixture.denied, "x", {expect: "any"}),
            ];
            for (const failure of failures) {
                expect(failure.ok).toBe(false);
                if (!failure.ok) expect(failure.detail).not.toContain(fixture.writablePath);
            }
        });

        it("输出 11：宿主写全文：label 不是单段为 invalid-address；写完交回地址、会话读得到、写不了；写入函数抛错时交回失败", async () => {
            for (const label of ["", "a/b", ".."]) expect(codeOf(await fixture.artifacts.save(label, async () => undefined))).toBe("invalid-address");
            const saved = await fixture.artifacts.save("shell", async (sink) => {
                await sink.write(new TextEncoder().encode("全文"));
                await sink.write(new TextEncoder().encode("第二段"));
            });
            if (!saved.ok) throw new Error(saved.code);
            expect(text(await fixture.files.read(saved.value.address))).toBe("全文第二段");
            expect(writeOf(fixture.files.classify(saved.value.address))).toBe("denied");
            expect(codeOf(await fixture.files.write(saved.value.address, "改了", {expect: "any"}))).toBe("permission-denied");
            const thrown = await fixture.artifacts.save("broken", async (sink) => {
                await sink.write(new TextEncoder().encode("半截"));
                throw new Error("写到一半出错");
            });
            expect(thrown.ok).toBe(false);
            // 全文都落在同一个目录：失败的那份不留文件（含写了一半的临时文件）。
            const folder = saved.value.address.slice(0, saved.value.address.lastIndexOf("/"));
            const listed = await fixture.files.list(folder);
            if (!listed.ok || listed.value.kind === "virtual") throw new Error(`列出全文目录失败：${JSON.stringify(listed)}`);
            expect(listed.value.entries.map((entry) => entry.name)).toEqual([saved.value.address.slice(folder.length + 1)]);
        });

        it("输出 4、5、7：虚拟根列出说明与带全局地址的条目，读根得到同一份内容的文字，取本机路径为 unsupported-capability，写为 permission-denied", async () => {
            if (fixture.virtual === undefined) return;
            const listed = await fixture.files.list(fixture.virtual);
            if (!listed.ok || listed.value.kind !== "virtual") throw new Error(`虚拟根列出失败：${JSON.stringify(listed)}`);
            for (const entry of listed.value.entries) expect(entry.address).toMatch(/^[a-z][a-z0-9+.-]*:\/\//u);
            expect(text(await fixture.files.read(fixture.virtual))).toBe(renderVirtual(listed.value));
            expect(codeOf(await fixture.files.readPath(fixture.virtual))).toBe("unsupported-capability");
            expect(codeOf(await fixture.files.write(fixture.virtual, "x", {expect: "any"}))).toBe("permission-denied");
        });

        it("输出 6、失败码：不露出的位置读与写都为 protected-path", async () => {
            if (fixture.protected === undefined) return;
            expect(codeOf(await fixture.files.read(fixture.protected))).toBe("protected-path");
            expect(codeOf(await fixture.files.write(fixture.protected, "x", {expect: "any"}))).toBe("protected-path");
        });
    });
}
