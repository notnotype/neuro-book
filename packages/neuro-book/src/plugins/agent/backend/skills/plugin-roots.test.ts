/**
 * `agent.skills` 的接收者（docs/specs/agent/skills.md 输出 31 与“时序与寿命”）：真实的 Skill 目录与真实的插件包查询（一个手写的
 * 已安装插件）。句柄按接收者合同写：顶层声明、已发布。宿主在运行期补交顶层声明受 runtime.plugins 的已知限制，所以撤回与
 * “查目录期间就撤回”的先后在这里直接按合同调用。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionHandle} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createPluginPackages} from "nbook/plugin-platform/backend/packages";
import type {PluginPackages} from "nbook/plugin-platform/backend/packages";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {SKILLS_POINT} from "../../shared/points";
import type {AgentSkillsDeclaration} from "../../shared/points";
import {SkillCatalog, sourceRoot} from "./catalog";
import {pluginSkillRoots} from "./plugin-roots";

let tmp = "";
const opened: SkillCatalog[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "plugin-skill-roots");
});
afterEach(async () => {
    for (const catalog of opened.splice(0)) await catalog.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 一个装好的插件版本目录，`skills/` 下有一个 Skill；交回本次启动登记的插件包查询。 */
async function packages(name: string): Promise<PluginPackages> {
    const root = join(tmp, name, "acme.docs", "1.0.0");
    await mkdir(join(root, "skills", "pdf"), {recursive: true});
    await writeFile(join(root, "skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: 读 PDF\n---\n\n正文\n");
    return createPluginPackages([{id: "acme.docs", version: "1.0.0", root, digest: "0".repeat(16), manifest: {}}], NEUROBOOK_PROFILE.format);
}

const handle = (id = "acme.docs.skills"): ContributionHandle<AgentSkillsDeclaration> => ({
    capability: SKILLS_POINT,
    id,
    plugin: "acme.docs",
    entry: null,
    generation: 0,
    kind: "plugin",
    declaration: {directory: "skills"},
    published: true,
    implementation: () => {
        throw new Error("顶层声明没有实现");
    },
});

async function open(name: string, wrap: (packages: PluginPackages) => PluginPackages = (inner) => inner) {
    const catalog = await SkillCatalog.open({roots: [sourceRoot("user", join(tmp, name, "user"), false)], clock: systemClock, report: () => undefined});
    opened.push(catalog);
    const reports: string[] = [];
    const receiver = pluginSkillRoots({catalog, packages: wrap(await packages(name)), report: (code) => reports.push(code)});
    return {catalog, receiver, reports};
}

describe("agent.skills 的接收者", () => {
    test("发布时按声明的目录加一个插件根，撤回时拿掉", async () => {
        const {catalog, receiver} = await open("plain");
        const docs = handle();
        receiver.published!(docs, undefined);
        // 查目录是异步的，加根排在目录的重扫队列里。
        await waitUntil("插件的 Skill 出现", () => catalog.item("acme.docs.pdf"));
        expect(catalog.item("acme.docs.pdf")?.entry).toMatchObject({source: "plugin", plugin: {id: "acme.docs", title: null}, status: "ready"});
        await receiver.revoke!(docs, undefined, "scope-closed");
        expect(catalog.item("acme.docs.pdf")).toBeUndefined();
    });

    test("查目录期间就撤回的不加；撤回后再发布，只按最后一次加", async () => {
        let release: (() => void) | null = null;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let calls = 0;
        let answered: Promise<unknown> = Promise.resolve();
        const {catalog, receiver} = await open("race", (inner) => ({
            title: (plugin) => inner.title(plugin),
            file: (plugin, path) => inner.file(plugin, path),
            // 第一次查询挂住，直到撤回之后才交回。
            directory: (plugin, path) => {
                calls += 1;
                const result = calls === 1 ? gate.then(() => inner.directory(plugin, path)) : inner.directory(plugin, path);
                if (calls === 1) answered = result;
                return result;
            },
        }));
        const first = handle();
        receiver.published!(first, undefined);
        await receiver.revoke!(first, undefined, "scope-closed");
        release!();
        // 第一次查询交回之后，让出一轮事件循环（接收者的后续在这一轮里跑完），再等目录排完：它要是加了根，这时已经在目录里。
        expect(await answered).not.toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await catalog.settled();
        expect(catalog.item("acme.docs.pdf")).toBeUndefined();

        const again = handle();
        receiver.published!(again, undefined);
        await waitUntil("再发布后出现", () => catalog.item("acme.docs.pdf"));
        expect(catalog.list().map((entry) => entry.id)).toEqual(["acme.docs.pdf"]);
    });
});
