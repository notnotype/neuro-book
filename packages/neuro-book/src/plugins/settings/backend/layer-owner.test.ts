/**
 * 层拥有者（docs/specs/settings/configuration.md 输出 4、5、9–14、18，验收 3、4、5、7）：真实临时目录、真实文件与
 * `fs.watch`、两个真实子进程；合并重读的 50 毫秒用注入的手动时钟，不按时长等待。
 *
 * 只读用例要求以普通用户运行（root 不受文件权限约束）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {defineSetting} from "nbook/shared/settings";
import type {SettingLayer} from "nbook/shared/settings";

import type {LayerSnapshot} from "../shared/layers";
import {createLayerOwner, RELOAD_DELAY_MS} from "./layer-owner";
import type {DeclaredSetting, LayerOwner} from "./layer-owner";

const title = {"zh-CN": "项", "en-US": "Item"};
const theme = defineSetting({plugin: "x.ui", name: "theme", schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]), default: "nbook", title});
const locale = defineSetting({plugin: "x.ui", name: "locale", schema: Type.String(), default: "zh-CN", title, layers: ["user"]});
const size = defineSetting({plugin: "x.ui", name: "size", schema: Type.Number(), default: 12, title});
const declarations = new Map<string, DeclaredSetting>([theme, locale, size].map((setting) => [setting.key, {plugin: "x.ui", declaration: setting.declaration}]));

/** 手动时钟外加一个计数：测试据此知道文件事件已经到了、合并计时已经排上。 */
class TrackingClock implements RuntimeClock {
    readonly manual = new ManualClock();
    scheduled = 0;
    pending = 0;

    now(): number {
        return this.manual.now();
    }

    schedule(callback: () => void, ms: number): () => void {
        this.scheduled += 1;
        this.pending += 1;
        let done = false;
        const settle = (): void => {
            if (done) return;
            done = true;
            this.pending -= 1;
        };
        const cancel = this.manual.schedule(() => {
            settle();
            callback();
        }, ms);
        return () => {
            settle();
            cancel();
        };
    }

    advance(ms: number): void {
        this.manual.advance(ms);
    }
}

let tmp = "";
let sequence = 0;
const owners: LayerOwner[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-settings", "layer-owner");
});

afterEach(async () => {
    await Promise.all(owners.splice(0).map((owner) => owner.close()));
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function directory(): Promise<string> {
    sequence += 1;
    const path = join(tmp, `case-${String(sequence)}`);
    await mkdir(path, {recursive: true});
    return path;
}

interface Fixture {
    readonly owner: LayerOwner;
    readonly clock: TrackingClock;
    readonly diagnostics: DiagnosticsStore;
    readonly published: LayerSnapshot[];
    /** 推进时钟直到快照满足条件：每次推进一个合并窗口，让排上的重读执行。 */
    settle<T>(description: string, check: (snapshot: LayerSnapshot) => T): Promise<Exclude<T, false | null | undefined>>;
}

async function start(path: string, layer: SettingLayer = "user"): Promise<Fixture> {
    const clock = new TrackingClock();
    const diagnostics = createDiagnosticsStore({identity: {location: "server", instanceId: `owner-${String(sequence)}`}});
    const owner = createLayerOwner({path, layer, declarations: () => declarations, clock, diagnostics, source: "nbook.settings"});
    owners.push(owner);
    const published: LayerSnapshot[] = [];
    owner.subscribe((snapshot) => published.push(snapshot));
    await owner.ready;
    return {
        owner,
        clock,
        diagnostics,
        published,
        settle: (description, check) => waitUntil(description, () => {
            clock.advance(RELOAD_DELAY_MS);
            return check(owner.snapshot());
        }),
    };
}

function consumer(plugin: string, via: string | null = null): ConsumerIdentity {
    return {instanceId: "test", location: "browser", client: "c", plugin, entry: "browser", generation: 1, via: via === null ? null : {plugin: via, entry: "browser", generation: 1}};
}

const ui = consumer("x.ui");

describe("读取与外部修改", () => {
    it("文件不存在为空层，读配置不创建文件或目录；启动时就有的值在 ready 时已在快照里", async () => {
        const root = await directory();
        const missing = await start(join(root, "nested", "settings.json"));
        expect(missing.owner.snapshot()).toMatchObject({status: "ok", values: {}, problems: []});
        expect(await readdir(root)).toEqual([]);

        await writeFile(join(root, "settings.json"), "{\"x.ui/theme\": \"macos\"}");
        const present = await start(join(root, "settings.json"));
        expect(present.owner.snapshot()).toMatchObject({status: "ok", values: {"x.ui/theme": "macos"}});
    });

    it("编辑器的几种保存：原地覆写、写临时文件再改名替换、删除；都在最后一次事件后重读", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        await writeFile(path, "{}");
        const {settle} = await start(path);

        await writeFile(path, "{\"x.ui/theme\": \"macos\"}");
        await settle("原地覆写生效", (snapshot) => snapshot.values["x.ui/theme"] === "macos");

        await writeFile(join(root, "settings.json.tmp"), "{\"x.ui/theme\": \"nbook\", \"x.ui/size\": 14}");
        await rename(join(root, "settings.json.tmp"), path);
        await settle("改名替换生效", (snapshot) => snapshot.values["x.ui/size"] === 14);
        // 替换之后的再一次原地写入也收得到（监视的是目录，不是被替换掉的旧文件）。
        await writeFile(path, "{\"x.ui/size\": 16}");
        await settle("替换后再写生效", (snapshot) => snapshot.values["x.ui/size"] === 16);

        await unlink(path);
        await settle("删除回到空层", (snapshot) => Object.keys(snapshot.values).length === 0);
    });

    it("合并：最后一次事件后静止 50 毫秒才重读，窗口内的两次写入只发布最终内容", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        await writeFile(path, "{}");
        const {clock, published, owner} = await start(path);
        const before = published.length;

        await writeFile(path, "{\"x.ui/size\": 1}");
        await waitUntil("第一次写入的事件排上重读", () => clock.pending > 0);
        const scheduled = clock.scheduled;
        await writeFile(path, "{\"x.ui/size\": 2}");
        await waitUntil("第二次写入的事件重新计时", () => clock.scheduled > scheduled);
        clock.advance(RELOAD_DELAY_MS - 1);
        expect(clock.pending).toBe(1);
        clock.advance(1);
        await waitUntil("重读完成", () => owner.snapshot().values["x.ui/size"] === 2);
        expect(published.slice(before).map((snapshot) => snapshot.values["x.ui/size"])).toEqual([2]);
    });

    it("先截断再写入：经过一次空内容的重读，最终值正确", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        await writeFile(path, "{\"x.ui/size\": 1}");
        const {clock, owner} = await start(path);

        await writeFile(path, "");
        await waitUntil("截断的事件排上重读", () => clock.pending > 0);
        clock.advance(RELOAD_DELAY_MS);
        await waitUntil("读到空内容", () => owner.snapshot().values["x.ui/size"] === undefined);
        await writeFile(path, "{\"x.ui/size\": 3}");
        await waitUntil("写入的事件排上重读", () => clock.pending > 0);
        clock.advance(RELOAD_DELAY_MS);
        await waitUntil("最终值", () => owner.snapshot().values["x.ui/size"] === 3);
    });

    it("ok → invalid → ok：改坏时保留上一份有效内容、写入为 layer-invalid 且文件不变；改回同样的值后恢复，两次都发布", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        await writeFile(path, "{\"x.ui/theme\": \"macos\"}");
        const {owner, published, settle} = await start(path);
        const before = published.length;

        await writeFile(path, "{\"x.ui/theme\": ");
        const invalid = await settle("层变为无效", (snapshot) => (snapshot.status === "invalid" ? snapshot : false));
        // 不对拥有者持有的快照用带非对称匹配器的 toMatchObject：Bun 1.4.2 会把匹配器写回被比较的对象（冻结的也会）。
        expect(invalid.values).toEqual({"x.ui/theme": "macos"});
        expect(invalid.detail).toContain("第 1 行");
        expect(await owner.write(ui, theme.key, {kind: "set", value: "nbook"})).toMatchObject({ok: false, code: "layer-invalid"});
        expect(await readFile(path, "utf8")).toBe("{\"x.ui/theme\": ");

        await writeFile(path, "{\"x.ui/theme\": \"macos\"}");
        await settle("恢复有效", (snapshot) => snapshot.status === "ok");
        expect(published.slice(before).map((snapshot) => snapshot.status)).toEqual(["invalid", "ok"]);
        expect(published.at(-1)?.values).toEqual({"x.ui/theme": "macos"});
    });

    it("目录一开始不存在、之后被创建；目录被删除后重建再修改：都生效", async () => {
        const root = await directory();
        const folder = join(root, "project", ".nbook");
        const path = join(folder, "settings.json");
        const {settle} = await start(path, "project");

        await mkdir(folder, {recursive: true});
        await writeFile(path, "{\"x.ui/theme\": \"macos\"}");
        await settle("目录创建后生效", (snapshot) => snapshot.values["x.ui/theme"] === "macos");

        await rm(folder, {recursive: true});
        await settle("目录删除后回到空层", (snapshot) => snapshot.values["x.ui/theme"] === undefined);
        await mkdir(folder);
        await writeFile(path, "{\"x.ui/theme\": \"nbook\"}");
        await settle("重建后生效", (snapshot) => snapshot.values["x.ui/theme"] === "nbook");
        await writeFile(path, "{\"x.ui/size\": 20}");
        await settle("重建后的第二次修改也生效", (snapshot) => snapshot.values["x.ui/size"] === 20);

        // 删除与重建落在同一个合并窗口里：路径没变，目录换了一个，旧监视器要换掉。
        await rm(folder, {recursive: true});
        await mkdir(folder);
        await writeFile(path, "{\"x.ui/size\": 30}");
        await settle("同一窗口里删除并重建后生效", (snapshot) => snapshot.values["x.ui/size"] === 30);
        await writeFile(path, "{\"x.ui/size\": 31}");
        await settle("之后的修改也生效", (snapshot) => snapshot.values["x.ui/size"] === 31);
    });

    it("符号链接：改目标生效；链接改指另一个目录里的文件后，改新目标生效；目标删除后重建生效", async () => {
        const root = await directory();
        await mkdir(join(root, "dotfiles-a"));
        await mkdir(join(root, "dotfiles-b"));
        await mkdir(join(root, "state"));
        const targetA = join(root, "dotfiles-a", "settings.json");
        const targetB = join(root, "dotfiles-b", "settings.json");
        const path = join(root, "state", "settings.json");
        await writeFile(targetA, "{\"x.ui/size\": 1}");
        await writeFile(targetB, "{\"x.ui/size\": 2}");
        await symlink(targetA, path);
        const {settle} = await start(path);
        expect((await settle("初始值", (snapshot) => snapshot.values["x.ui/size"]))).toBe(1);

        await writeFile(targetA, "{\"x.ui/size\": 11}");
        await settle("改目标生效", (snapshot) => snapshot.values["x.ui/size"] === 11);

        await symlink(targetB, join(root, "state", "settings.json.new"));
        await rename(join(root, "state", "settings.json.new"), path);
        await settle("改指后读到新目标", (snapshot) => snapshot.values["x.ui/size"] === 2);
        await writeFile(targetB, "{\"x.ui/size\": 22}");
        await settle("改新目标生效", (snapshot) => snapshot.values["x.ui/size"] === 22);

        await unlink(targetB);
        await settle("目标删除后为空层", (snapshot) => snapshot.values["x.ui/size"] === undefined);
        await writeFile(targetB, "{\"x.ui/size\": 33}");
        await settle("目标重建后生效", (snapshot) => snapshot.values["x.ui/size"] === 33);
    });

    it("被丢弃的键记诊断（键与原因，不含值），同一份内容只记一次", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        await writeFile(path, "{\"x.ui/theme\": \"solarized-secret\", \"x.ui/locale\": \"en-US\"}");
        const {owner, diagnostics, clock} = await start(path, "project");
        expect(owner.snapshot().problems).toEqual([{key: "x.ui/locale", reason: "layer-not-allowed"}, {key: "x.ui/theme", reason: "invalid-value"}]);
        // 同样的内容再写一遍：重读后问题相同，不再记。
        await writeFile(path, "{\"x.ui/theme\": \"solarized-secret\", \"x.ui/locale\": \"en-US\"}");
        await waitUntil("事件排上重读", () => clock.pending > 0);
        clock.advance(RELOAD_DELAY_MS);
        await owner.write(ui, size.key, {kind: "set", value: 1});
        const dropped = diagnostics.query({}).records.filter((entry) => entry.event === "settings.layer.dropped");
        expect(dropped).toHaveLength(1);
        expect(JSON.stringify(dropped)).not.toContain("solarized-secret");
    });
});

describe("写入", () => {
    it("只改这一个键，其余内容保留；写入结果带回写后的快照；监视带回的同一内容不再发布", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        const original = "﻿{\r\n\t// 我的设置\r\n\t\"x.ui/theme\": \"nbook\",\r\n\t\"other.plugin/thing\": true\r\n}\r\n";
        await writeFile(path, original);
        const {owner, clock, published} = await start(path);
        const before = published.length;

        const result = await owner.write(ui, theme.key, {kind: "set", value: "macos"});
        expect(result).toMatchObject({ok: true, snapshot: {status: "ok", values: {"x.ui/theme": "macos"}}});
        expect(await readFile(path, "utf8")).toBe(original.replace("\"nbook\"", "\"macos\""));

        // 自己写入的事件到达并重读（同一内容，不发布），再以一次外部修改作屏障数发布次数。
        await waitUntil("自己写入的事件排上重读", () => clock.pending > 0);
        clock.advance(RELOAD_DELAY_MS);
        await writeFile(path, "{\"x.ui/theme\": \"macos\", \"x.ui/size\": 9}");
        await waitUntil("外部修改的事件排上重读", () => clock.pending > 0);
        clock.advance(RELOAD_DELAY_MS);
        await waitUntil("外部修改生效", () => owner.snapshot().values["x.ui/size"] === 9);
        expect(published.slice(before).map((snapshot) => snapshot.values)).toEqual([{"x.ui/theme": "macos"}, {"x.ui/theme": "macos", "x.ui/size": 9}]);
    });

    it("文件或目录不存在时首次写入才创建；删除不存在的键无副作用；权限位沿用原文件", async () => {
        const root = await directory();
        const path = join(root, ".nbook", "settings.json");
        const {owner} = await start(path, "project");
        expect(await owner.write(ui, theme.key, {kind: "delete"})).toMatchObject({ok: true});
        expect(await readdir(root)).toEqual([".nbook"]);
        expect(await owner.write(ui, theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: true});
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({"x.ui/theme": "macos"});

        await chmod(path, 0o600);
        expect(await owner.write(ui, size.key, {kind: "set", value: 3})).toMatchObject({ok: true});
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await readdir(join(root, ".nbook"))).toEqual(["settings.json"]);
    });

    it("符号链接：写入替换最终目标、链接保持不变；链接悬空时 write-failed，链接不动", async () => {
        const root = await directory();
        await mkdir(join(root, "dotfiles"));
        const target = join(root, "dotfiles", "settings.json");
        const path = join(root, "settings.json");
        await writeFile(target, "{}");
        await symlink(target, path);
        const {owner} = await start(path);
        expect(await owner.write(ui, theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: true});
        expect((await lstat(path)).isSymbolicLink()).toBe(true);
        expect(JSON.parse(await readFile(target, "utf8"))).toEqual({"x.ui/theme": "macos"});

        await unlink(target);
        const dangling = await owner.write(ui, theme.key, {kind: "set", value: "nbook"});
        expect(dangling).toMatchObject({ok: false, code: "write-failed", detail: expect.stringContaining("目标不存在")});
        expect(await readlink(path)).toBe(target);
    });

    it("只读文件与只读目录各为 write-failed，文件与快照不变", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        await writeFile(path, "{\"x.ui/theme\": \"nbook\"}");
        const {owner} = await start(path);
        const before = owner.snapshot();

        await chmod(path, 0o444);
        expect(await owner.write(ui, theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: false, code: "write-failed", detail: expect.stringContaining("只读")});
        expect(await readFile(path, "utf8")).toBe("{\"x.ui/theme\": \"nbook\"}");
        expect(owner.snapshot()).toBe(before);

        await chmod(path, 0o644);
        await chmod(root, 0o555);
        try {
            expect(await owner.write(ui, theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: false, code: "write-failed"});
            expect(await readFile(path, "utf8")).toBe("{\"x.ui/theme\": \"nbook\"}");
            expect(owner.snapshot()).toBe(before);
        } finally {
            await chmod(root, 0o755);
        }
    });

    it("授权：未声明、不是声明者（含经代理）、值不合 schema 或不是 JSON、层不允许；审计不记值", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        const {owner, diagnostics} = await start(path, "project");
        expect(await owner.write(ui, "x.ui/nothing", {kind: "set", value: 1})).toMatchObject({ok: false, code: "undeclared"});
        expect(await owner.write(consumer("x.other"), theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: false, code: "denied"});
        expect(await owner.write(consumer("x.other", "x.ui"), theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: false, code: "denied"});
        expect(await owner.write(ui, theme.key, {kind: "set", value: "solarized"})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await owner.write(ui, size.key, {kind: "set", value: Number.NaN})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await owner.write(ui, locale.key, {kind: "set", value: "en-US"})).toMatchObject({ok: false, code: "layer-not-allowed"});
        expect(await owner.write(consumer("x.ui", "nbook.settings"), theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: true});
        await expect(readdir(root)).resolves.toEqual(["settings.json"]);

        const audit = diagnostics.query({}).records.filter((entry) => entry.event === "settings.write");
        expect(audit.map((entry) => (entry.data as {code: string}).code)).toEqual(["undeclared", "denied", "denied", "invalid-value", "invalid-value", "layer-not-allowed", "ok"]);
        expect(audit.at(-1)?.data).toEqual({key: theme.key, layer: "project", plugin: "x.ui", via: "nbook.settings", code: "ok"});
        expect(JSON.stringify(audit)).not.toContain("solarized");
    });

    it("两个拥有者（两个真实进程）同时写同一个文件的不同键：所有键都保留", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        const script = join(import.meta.dir, "testing", "concurrent-writer.ts");
        const count = 15;
        const processes = ["a", "b"].map((prefix) => Bun.spawn([process.execPath, script, path, prefix, String(count)], {stdout: "pipe", stderr: "pipe"}));
        try {
            const outputs = await Promise.all(processes.map(async (child) => ({code: await child.exited, stdout: await new Response(child.stdout).text(), stderr: await new Response(child.stderr).text()})));
            for (const output of outputs) expect(output, output.stderr).toMatchObject({code: 0, stdout: "done\n"});
        } finally {
            for (const child of processes) if (child.exitCode === null) child.kill("SIGKILL");
        }
        const written = JSON.parse(await readFile(path, "utf8")) as Record<string, number>;
        expect(Object.keys(written).sort()).toEqual([...["a", "b"].flatMap((prefix) => Array.from({length: count}, (_unused, index) => `x.race/${prefix}${String(index)}`))].sort());
        expect(await readdir(root)).toEqual(["settings.json"]);
    }, 30_000);

    it("停止：之后的写入为 unavailable，不再发布；不留临时文件与锁", async () => {
        const root = await directory();
        const path = join(root, "settings.json");
        const {owner, published, clock} = await start(path);
        const pending = owner.write(ui, theme.key, {kind: "set", value: "macos"});
        await owner.close();
        expect(await pending).toMatchObject({ok: true});
        expect(await owner.write(ui, size.key, {kind: "set", value: 3})).toMatchObject({ok: false, code: "unavailable"});
        const count = published.length;
        await writeFile(path, "{\"x.ui/size\": 7}");
        clock.advance(RELOAD_DELAY_MS);
        expect(published.length).toBe(count);
        expect(await readdir(root)).toEqual(["settings.json"]);
    });
});
