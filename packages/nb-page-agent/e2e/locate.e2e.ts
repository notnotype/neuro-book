/** 引用与定位（docs/specs/agent/page-agent.md 输出 4、5）。 */

import {expect, test} from "@playwright/test";

import {locate, openFixture, refOf, snapshotOk} from "./page";

test.describe("引用（输出 4）", () => {
    test("同一元素在同一次页面加载里引用不变；别的前缀得 stale-ref", async ({page}) => {
        await openFixture(page, `<button id="a">甲</button><button id="b">乙</button>`);
        const first = await snapshotOk(page);
        await page.evaluate(() => document.body.insertAdjacentHTML("afterbegin", `<button id="c">丙</button>`));
        const second = await snapshotOk(page);
        expect(refOf(second, "button", "甲")).toBe(refOf(first, "button", "甲"));
        expect(refOf(second, "button", "乙")).toBe(refOf(first, "button", "乙"));
        expect(await locate(page, {ref: refOf(first, "button", "乙")})).toEqual({ok: true, id: "b", warnings: []});
        const foreign = refOf(first, "button", "乙").replace(/^t1\./u, "zz.");
        expect(await locate(page, {ref: foreign})).toMatchObject({ok: false, code: "stale-ref"});
    });

    test("以下标为 key 的列表反序后，旧引用指的元素换了内容：得 stale-ref，details 列出现在的候选", async ({page}) => {
        await openFixture(page, `<button id="r0">甲</button><button id="r1">乙</button>`);
        const before = await snapshotOk(page);
        const oldFirst = refOf(before, "button", "甲");
        // 像按下标复用 DOM 的框架那样：元素不动，只换内容。
        await page.evaluate(() => {
            document.getElementById("r0")!.textContent = "乙";
            document.getElementById("r1")!.textContent = "甲";
        });
        const result = await locate(page, {ref: oldFirst});
        expect(result).toMatchObject({ok: false, code: "stale-ref"});
        if (!result.ok) expect(result.details?.candidates?.map((candidate) => candidate.name)).toEqual(["甲"]);
        const after = await snapshotOk(page);
        expect(refOf(after, "button", "乙")).not.toBe(oldFirst);
        expect(await locate(page, {ref: refOf(after, "button", "甲")})).toMatchObject({ok: true, id: "r1"});
    });

    test("元素换了身份但同一层里稳定名与 key 唯一：不改页面的定位改用它并标 rebound，会改页面的得 stale-ref", async ({page}) => {
        await openFixture(page, `<div id="list"><button id="x1" data-nb-target="demo.row" data-nb-key="alpha">甲</button></div>`);
        const before = await snapshotOk(page);
        const ref = refOf(before, "button", "甲");
        await page.evaluate(() => {
            document.getElementById("list")!.innerHTML = `<button id="x2" data-nb-target="demo.row" data-nb-key="alpha">甲（已改名）</button>`;
        });
        const reading = await locate(page, {ref});
        expect(reading).toMatchObject({ok: true, id: "x2"});
        if (reading.ok) expect(reading.warnings[0]).toMatch(new RegExp(`^rebound: ${ref.replace(".", "\\.")} -> t1\\.\\d+$`, "u"));
        expect(await locate(page, {ref}, {mutating: true})).toMatchObject({ok: false, code: "stale-ref"});
    });

    test("对话框关了又开（新元素）时，原来在对话框里的稳定名仍在同一层，可以重找", async ({page}) => {
        const dialog = `<div id="d" role="dialog" aria-label="设置"><button id="btn" data-nb-target="demo.close">关闭</button></div>`;
        await openFixture(page, dialog);
        const ref = refOf(await snapshotOk(page), "button", "关闭");
        await page.evaluate((html) => {
            document.getElementById("d")!.remove();
            document.body.insertAdjacentHTML("beforeend", html.replace(`id="btn"`, `id="btn2"`));
        }, dialog);
        expect(await locate(page, {ref})).toMatchObject({ok: true, id: "btn2"});
    });
});

test.describe("引用：只在同一层里重找（输出 4）", () => {
    test("稳定名与 key 相同的元素只在另一层里有时不重找，得 stale-ref 并把它列为候选", async ({page}) => {
        await openFixture(page, `<button id="base" data-nb-target="demo.save" data-nb-key="k">保存</button>`);
        const ref = refOf(await snapshotOk(page), "button", "保存");
        await page.evaluate(() => {
            document.getElementById("base")!.remove();
            document.body.insertAdjacentHTML("beforeend", `<div role="dialog" aria-label="确认"><button id="other" data-nb-target="demo.save" data-nb-key="k">保存</button></div>`);
        });
        const result = await locate(page, {ref});
        expect(result).toMatchObject({ok: false, code: "stale-ref"});
        if (!result.ok) expect(result.details?.candidates?.map((candidate) => candidate.key)).toEqual(["k"]);
    });
});

test.describe("定位（输出 5）", () => {
    test("稳定名加 key；角色加名字缺省不分大小写、折叠空白的子串匹配，exact 时精确", async ({page}) => {
        await openFixture(page, `
            <button id="t1" data-nb-target="settings.row" data-nb-key="a">A</button>
            <button id="t2" data-nb-target="settings.row" data-nb-key="b">B</button>
            <button id="save">Save   As</button>
            <button id="save2">Save</button>`);
        expect(await locate(page, {target: "settings.row", key: "b"})).toMatchObject({ok: true, id: "t2"});
        expect(await locate(page, {role: "button", name: "save as"})).toMatchObject({ok: true, id: "save"});
        expect(await locate(page, {role: "button", name: "Save", exact: true})).toMatchObject({ok: true, id: "save2"});
    });

    test("命中多个又没给 nth 得 ambiguous，候选带引用；给了 nth 取第几个；没有命中得 not-found", async ({page}) => {
        await openFixture(page, `
            <button id="o1" data-nb-target="settings.row" data-nb-key="a">A</button>
            <button id="o2" data-nb-target="settings.row" data-nb-key="b">B</button>`);
        const many = await locate(page, {target: "settings.row"});
        expect(many).toMatchObject({ok: false, code: "ambiguous"});
        if (!many.ok) {
            const candidates = many.details!.candidates!;
            expect(candidates.map((candidate) => candidate.key)).toEqual(["a", "b"]);
            expect(await locate(page, {ref: candidates[1]!.ref})).toMatchObject({ok: true, id: "o2"});
        }
        expect(await locate(page, {target: "settings.row", nth: 1})).toMatchObject({ok: true, id: "o2"});
        expect(await locate(page, {target: "settings.row", nth: 2})).toMatchObject({ok: false, code: "not-found"});
        expect(await locate(page, {role: "link"})).toMatchObject({ok: false, code: "not-found"});
    });

    test("within 只在那个元素里找；按文字命中包着文字的可交互元素", async ({page}) => {
        await openFixture(page, `
            <section id="left" aria-label="左"><button id="lb"><span>打开</span></button></section>
            <section id="right" aria-label="右"><button id="rb"><span>打开</span></button></section>`);
        expect(await locate(page, {text: "打开"})).toMatchObject({ok: false, code: "ambiguous"});
        expect(await locate(page, {text: "打开", within: {role: "region", name: "右"}})).toMatchObject({ok: true, id: "rb"});
    });

    test("目标本身不可交互时，高亮落到它唯一的可交互后代；有几个就停在目标上；截图与 scope 不落", async ({page}) => {
        await openFixture(page, `
            <div id="row" data-nb-target="settings.row" data-nb-key="k"><span>主题</span><select id="control"><option>浅色</option></select></div>
            <div id="row2" data-nb-target="settings.row" data-nb-key="k2"><select><option>一</option></select><button>恢复</button></div>`);
        expect(await locate(page, {target: "settings.row", key: "k"}, {settle: true})).toMatchObject({ok: true, id: "control"});
        expect(await locate(page, {target: "settings.row", key: "k2"}, {settle: true})).toMatchObject({ok: true, id: "row2"});
        expect(await locate(page, {target: "settings.row", key: "k"})).toMatchObject({ok: true, id: "row"});
    });

    test("隐藏的与 aria-hidden 的副本不参与定位；跳过区域里的控件照样能定位", async ({page}) => {
        await openFixture(page, `
            <button id="real" data-nb-target="demo.save">保存</button>
            <div aria-hidden="true"><button data-nb-target="demo.save">保存</button></div>
            <button style="display:none" data-nb-target="demo.save">保存</button>
            <div data-nb-agent="skip"><button id="inside" data-nb-target="demo.inside">里面</button></div>`);
        expect(await locate(page, {target: "demo.save"})).toMatchObject({ok: true, id: "real"});
        expect(await locate(page, {target: "demo.inside"})).toMatchObject({ok: true, id: "inside"});
    });
});
