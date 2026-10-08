/**
 * 场景 1：服务与依赖（`clock`、`notes` 的服务端入口）。
 *
 * 要说明的事：
 * - 入口按需激活：没人用时只登记；第一次有调用到达 notes 时，内核先激活它的必需依赖 `nbook.storage`，notes 激活时解析
 *   可选依赖 clock，clock 随之激活。
 * - 必需依赖与可选依赖缺失时的不同结果：clock 缺宿主时钟而受阻，只有它不可用；notes 照常工作，只是笔记不带时刻。
 *   可选依赖的原因分两种：clock 装了但用不了是 `provider-rejected`，根本没装是 `missing-provider`。
 * - 入口停止时：`context.signal` 让 clock 立即答复还在等的调用方，`context.scope` 上登记的宿主计时器被释放。
 *
 * 阅读顺序：`plugins/clock/`（`shared/contracts.ts` → `backend/plugin.ts`）→ `plugins/notes/shared/contracts.ts` →
 * `plugins/notes/backend/plugin.ts` → 这里。场地见 `testing/stage.ts`，探针见 `testing/probes.ts`。
 *
 * 行为合同：docs/specs/runtime/services.md（输出第 3–5 条）、docs/specs/runtime/plugins.md（输出第 11、13、14 条）、
 * docs/specs/runtime/plugin-api.md 的“可选功能”、docs/specs/runtime/plugin-channel.md 输出第 5 条。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {clockBackendPlugin} from "../plugins/clock/backend/plugin";
import {clockKey} from "../plugins/clock/shared/contracts";
import {notesBackendPlugin} from "../plugins/notes/backend/plugin";
import {notesContract} from "../plugins/notes/shared/contracts";
import {remoteProbe, serviceProbe} from "../testing/probes";
import {Stage} from "../testing/stage";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 1：服务与依赖");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 每个用例一个场地、一个状态根，互不影响。 */
function newStage(): Stage {
    cases += 1;
    const stage = new Stage(join(tmp, `case-${String(cases)}`));
    stages.push(stage);
    return stage;
}

const entry = (plugin: string) => ({plugin, entry: "server"});

describe("场景 1：服务与依赖", () => {
    it("没有调用时，notes、它的必需依赖 nbook.storage 与可选依赖 clock 都只登记、不激活", async () => {
        const stage = newStage();
        const {app} = await stage.server({plugins: [clockBackendPlugin, notesBackendPlugin]});

        for (const plugin of ["example.notes", "nbook.storage", "example.clock"]) {
            expect(app.plugins.entryState(entry(plugin))?.status).toBe("registered");
        }
    });

    it("第一次调用 notes：内核先激活 nbook.storage，notes 激活时解析并激活 clock；笔记带宿主时钟的时刻", async () => {
        const stage = newStage();
        // 探针站在“调用 notes 的服务端插件”的位置上：它在同一个实例里，同样直接用合同。
        const writer = remoteProbe("example.writer", "server");
        const {app} = await stage.server({plugins: [clockBackendPlugin, notesBackendPlugin, writer.definition]});
        const notes = writer.remote().use(notesContract);

        expect(await notes.add({text: "第一条"})).toEqual({ok: true, value: {text: "第一条", writtenAt: 0, via: null}});
        stage.clock.advance(5 * MINUTE);
        expect(await notes.add({text: "第二条"})).toMatchObject({ok: true, value: {writtenAt: 5 * MINUTE}});

        // 发布顺序就是激活完成的顺序（docs/specs/runtime/plugins.md 输出第 14 条）：必需依赖先于 notes 激活；可选依赖
        // 在 notes 激活期间解析，也早于 notes 发布。
        const published = app.plugins.diagnostics().filter((item) => item.reason === "published").map((item) => item.plugin);
        expect(published.filter((plugin) => ["nbook.storage", "example.clock", "example.notes"].includes(plugin ?? ""))).toEqual(["nbook.storage", "example.clock", "example.notes"]);
    });

    it("宿主没给时钟：clock 按 missing-service 受阻；notes 照常工作，笔记不带时刻，可选依赖的原因是 provider-rejected", async () => {
        const stage = newStage();
        const writer = remoteProbe("example.writer", "server");
        const {app} = await stage.server({plugins: [clockBackendPlugin, notesBackendPlugin, writer.definition], clock: false});

        // 受阻的原因可以查询，查询不触发激活（docs/specs/runtime/plugins.md 输出第 11 条）。
        expect(app.plugins.entryState(entry("example.clock"))).toMatchObject({status: "blocked", blocked: {reason: "missing-service", key: "example/clock"}});
        expect(await writer.remote().use(notesContract).add({text: "没有时钟"})).toEqual({ok: true, value: {text: "没有时钟", writtenAt: null, via: null}});
        // 提供方在、只是用不了：notes 记一条 warn。
        expect(stage.diagnostics("hub").query({event: "example.notes.clock-unavailable"}).records).toMatchObject([{level: "warn", data: {reason: "provider-rejected"}}]);
    });

    it("没装 clock：可选依赖的原因是 missing-provider，这项功能本来就不存在；notes 照常工作", async () => {
        const stage = newStage();
        const writer = remoteProbe("example.writer", "server");
        await stage.server({plugins: [notesBackendPlugin, writer.definition]});

        expect(await writer.remote().use(notesContract).add({text: "没装时钟"})).toMatchObject({ok: true, value: {writtenAt: null}});
        expect(stage.diagnostics("hub").query({event: "example.notes.clock-unavailable"}).records).toMatchObject([{level: "info", data: {reason: "missing-provider"}}]);
    });

    it("clock 停止时：还在等的 until 立即以 stopped 结算（signal），它占用的宿主计时器全部还回（scope）", async () => {
        const stage = newStage();
        const alarm = serviceProbe("example.alarm", "server", [clockKey]);
        await stage.server({plugins: [clockBackendPlugin, alarm.definition]});
        const clock = alarm.get(clockKey);

        const soon = clock.until(stage.clock.now() + MINUTE);
        const later = clock.until(stage.clock.now() + HOUR);
        stage.clock.advance(MINUTE);
        expect(await soon).toEqual({ok: true});
        expect(stage.clock.pending()).toBeGreaterThan(0);

        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
        // 停止已经完成：`later` 若还没结算，race 拿到的是后一个值。
        expect(await Promise.race([later, Promise.resolve("还在等")])).toEqual({ok: false, code: "stopped"});
        expect(stage.clock.pending()).toBe(0);
    });
});
