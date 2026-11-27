/** 文字快照的规则（docs/specs/agent/page-agent.md 输出 3、6、12），在真实 Chrome 里排版与命中检查。 */

import {expect, test} from "@playwright/test";

import {openFixture, snapshotOk} from "./page";

test.describe("快照：列什么、怎么写（输出 3）", () => {
    test("列看得见的可交互元素与带名字的容器，按层级缩进；没有名字的容器、隐藏与 aria-hidden、inert 的不列", async ({page}) => {
        await openFixture(page, `
            <section aria-label="工具">
              <button id="save">保存</button>
              <a href="#x">帮助</a>
              <div><button>无名容器里的按钮</button></div>
            </section>
            <button style="display:none">藏起来的</button>
            <div aria-hidden="true"><button>装饰</button></div>
            <div inert><button>不可交互区</button></div>
            <button style="visibility:hidden">看不见的</button>`);
        const result = await snapshotOk(page);
        const body = result.text.split("\n").slice(2);
        expect(body).toEqual([
            `- region "工具" [${result.elements[0]!.ref}]`,
            `  - button "保存" [${result.elements[1]!.ref}]`,
            `  - link "帮助" [${result.elements[2]!.ref}]`,
            `  - button "无名容器里的按钮" [${result.elements[3]!.ref}]`,
        ]);
        expect(result.elements.map((element) => element.ref.startsWith("t1."))).toEqual([true, true, true, true]);
        expect(result.truncated).toBe(false);
    });

    test("表头写窗口与层；状态、稳定名、值写在方括号里，密码框不写值", async ({page}) => {
        await openFixture(page, `
            <label>标题 <input id="title" value="雾港"></label>
            <label>口令 <input type="password" value="secret-value"></label>
            <label><input type="checkbox" checked> 自动保存</label>
            <button disabled>导出</button>
            <button data-nb-target="settings.row" data-nb-key="nbook.workbench/theme" aria-expanded="false">主题</button>`);
        const result = await snapshotOk(page);
        const [windowLine, layersLine] = result.text.split("\n");
        expect(windowLine).toMatch(/^window t1 "夹具" \S+ {2}1280x800/u);
        expect(layersLine).toBe("layers: base");
        expect(result.text).toContain(`- textbox "标题" [${result.elements[0]!.ref} value="雾港"]`);
        expect(result.text).not.toContain("secret-value");
        expect(result.elements[1]).toMatchObject({role: "textbox", name: "口令"});
        expect(result.elements[1]!.value).toBeUndefined();
        expect(result.elements[2]).toMatchObject({role: "checkbox", name: "自动保存", states: ["checked"]});
        expect(result.elements[3]!.states).toContain("disabled");
        expect(result.text).toContain(`- button "主题" [${result.elements[4]!.ref} collapsed target=settings.row key=nbook.workbench/theme]`);
        expect(result.elements[4]).toMatchObject({target: "settings.row", key: "nbook.workbench/theme", layer: "base"});
    });

    test("名字先截断再按 JSON 转义：换行、引号与双向控制字符都转义", async ({page}) => {
        await openFixture(page, `<button id="b"></button>`);
        await page.evaluate(() => {
            const rlo = String.fromCharCode(0x202e);
            document.getElementById("b")!.setAttribute("aria-label", `第一行"引号"${rlo}反转\n第二行${"长".repeat(150)}`);
        });
        const result = await snapshotOk(page);
        const line = result.text.split("\n")[2]!;
        expect(line).toContain(String.raw`"第一行\"引号\"\u202e反转 第二行`);
        expect(line).not.toContain(String.fromCharCode(0x202e));
        expect(line).toContain("长…\"");
        expect([...result.elements[0]!.name].length).toBe(101);
    });
});

test.describe("快照：看得见（输出 3）", () => {
    test("被完全盖住的不列；不透明度很低的仍列出并标 faint；引擎自己的节点不算遮挡", async ({page}) => {
        await openFixture(page, `
            <button id="under" style="position:absolute;left:10px;top:10px;width:120px;height:40px">被盖住</button>
            <div style="position:absolute;left:0;top:0;width:200px;height:80px;background:#fff"></div>
            <button style="position:absolute;left:10px;top:120px;opacity:0">悬停才出现</button>
            <button style="position:absolute;left:10px;top:200px;width:120px;height:40px">描边下面</button>
            <div data-nb-page-agent="outline" style="position:absolute;left:0;top:190px;width:200px;height:60px;background:rgba(0,0,0,.1)"></div>`);
        const result = await snapshotOk(page);
        expect(result.elements.map((element) => element.name)).toEqual(["悬停才出现", "描边下面"]);
        expect(result.elements[0]!.states).toEqual(["faint"]);
    });

    test("滚出滚动容器的标 offscreen（含落在视口之外的）；被不滚动的 overflow 裁掉的不列", async ({page}) => {
        await openFixture(page, `
            <div style="height:100px;overflow:auto"><div style="height:400px"></div><button>底下的</button></div>
            <div style="height:20px;overflow:hidden"><div style="height:40px"></div><button>裁掉的</button></div>
            <div style="height:600px;overflow:auto"><div style="height:2000px"></div><button>视口外的</button></div>`);
        const result = await snapshotOk(page);
        expect(result.elements.map((element) => [element.name, element.states])).toEqual([["底下的", ["offscreen"]], ["视口外的", ["offscreen"]]]);
    });

    test("open shadow root 里的元素照样列出", async ({page}) => {
        await openFixture(page, `<div id="host"></div>`);
        await page.evaluate(() => {
            const shadow = document.getElementById("host")!.attachShadow({mode: "open"});
            shadow.innerHTML = `<nav aria-label="内部导航"><button>影子里的按钮</button></nav>`;
        });
        const result = await snapshotOk(page);
        expect(result.text.split("\n").slice(2)).toEqual([
            `- navigation "内部导航" [${result.elements[0]!.ref}]`,
            `  - button "影子里的按钮" [${result.elements[1]!.ref}]`,
        ]);
    });
});

test.describe("快照：层（输出 3）", () => {
    test("对话框各成一层，表头按先后写出；盖住整个底层时底层只写名字", async ({page}) => {
        await openFixture(page, `
            <button>底层按钮</button>
            <div style="position:fixed;inset:0;background:rgba(0,0,0,.3)">
              <div role="dialog" aria-label="设置" style="position:absolute;left:100px;top:100px;width:300px;height:200px;background:#fff">
                <button>关闭</button>
              </div>
            </div>`);
        const result = await snapshotOk(page);
        expect(result.text.split("\n")[1]).toBe(`layers: base (covered) > dialog "设置"`);
        const dialog = result.elements.find((element) => element.role === "dialog")!;
        expect(result.elements.map((element) => element.name)).toEqual(["设置", "关闭"]);
        expect(result.elements[1]!.layer).toBe(dialog.ref);
    });

    test("弹出的列表框与菜单成一层：挂在 body 下的定位外壳、被展开的触发器指着的、自己是 absolute 的；常驻的与应用里贴边侧栏里的不另成一层", async ({page}) => {
        await openFixture(page, `
            <div id="app" style="position:fixed;inset:0;overflow:auto">
              <div role="listbox" aria-label="常驻"><div role="option" aria-selected="true">甲</div></div>
              <aside style="position:fixed;left:0;top:200px;width:160px"><ul role="menu" aria-label="侧栏"><li role="menuitem">侧栏项</li></ul></aside>
              <button aria-expanded="true" aria-controls="pop">展开</button>
              <div role="listbox" id="pop" aria-label="受控"><div role="option">丙</div></div>
            </div>
            <div style="position:absolute;left:300px;top:40px;width:160px;background:#fff">
              <ul role="listbox" aria-label="挂在 body 下"><li role="option">乙</li></ul>
            </div>`);
        const result = await snapshotOk(page);
        expect(result.text.split("\n")[1]).toBe(`layers: base > listbox "受控" > listbox "挂在 body 下"`);
        const layerOf = (name: string) => result.elements.find((element) => element.name === name)!.layer;
        expect(layerOf("甲")).toBe("base");
        expect(layerOf("侧栏项")).toBe("base");
        expect(layerOf("丙")).toBe(result.elements.find((element) => element.name === "受控")!.ref);
        expect(layerOf("乙")).toBe(result.elements.find((element) => element.name === "挂在 body 下")!.ref);
    });

    test("aria-modal、alertdialog 与打开的 popover 里的列表框各成一层；scope 落在弹层里时表头写那一层", async ({page}) => {
        await openFixture(page, `
            <div aria-modal="true" aria-label="模态" style="position:fixed;left:0;top:0;width:200px;height:100px;background:#fff"><button>模态里</button></div>
            <div role="alertdialog" aria-label="警告" style="position:fixed;left:300px;top:0;width:200px;height:100px;background:#fff">
              <nav aria-label="警告里的导航"><button>知道了</button></nav>
            </div>
            <div popover="manual" id="p" style="margin:0;left:600px;top:0"><div role="listbox" aria-label="弹出"><div role="option">选项</div></div></div>`);
        await page.evaluate(() => (document.getElementById("p") as HTMLElement & {showPopover(): void}).showPopover());
        const result = await snapshotOk(page);
        expect(result.text.split("\n")[1]).toBe(`layers: base > div "模态" > alertdialog "警告" > listbox "弹出"`);
        const nav = result.elements.find((element) => element.name === "警告里的导航")!.ref;
        const scoped = await snapshotOk(page, {scope: {ref: nav}});
        expect(scoped.text.split("\n")[2]).toBe(`layers: alertdialog "警告"`);
    });
});

test.describe("快照：裁剪与命中检查（输出 3）", () => {
    test("行内元素上的 overflow 不裁剪；absolute 的元素不受包含块之外的祖先裁剪；fixed 的不受祖先裁剪", async ({page}) => {
        await openFixture(page, `
            <p>文字 <span style="overflow:hidden"><button>行内裁剪里</button></span> <span style="overflow:auto"><button>行内滚动里</button></span></p>
            <div style="position:relative;height:60px">
              <div style="overflow:hidden;height:20px"><div style="position:absolute;top:30px;left:0"><button>逃出裁剪</button></div></div>
            </div>
            <div style="overflow:hidden;height:10px"><div style="position:fixed;left:400px;top:300px"><button>固定的</button></div></div>
            <div style="position:relative;overflow:hidden;height:10px"><div style="height:20px"></div><div style="position:absolute;top:30px"><button>包含块里裁掉</button></div></div>`);
        const result = await snapshotOk(page);
        expect(result.elements.map((element) => [element.name, element.states])).toEqual([
            ["行内裁剪里", []], ["行内滚动里", []], ["逃出裁剪", []], ["固定的", []],
        ]);
    });

    test("祖先的不透明度累乘，低的标 faint；嵌套滚动里滚出外层的标 offscreen；落在滚动内容起点左上方的不列", async ({page}) => {
        await openFixture(page, `
            <div style="opacity:0.3"><div style="opacity:0.3"><button>很淡</button></div></div>
            <div style="height:100px;overflow:auto"><div style="height:400px;overflow:auto"><div style="height:300px"></div><button>内层底下</button></div></div>
            <a href="#main" style="position:absolute;left:-9999px">跳到正文</a>`);
        const result = await snapshotOk(page);
        expect(result.elements.map((element) => [element.name, element.states])).toEqual([["很淡", ["faint"]], ["内层底下", ["offscreen"]]]);
    });

    test("被祖先的伪元素蒙层盖住的不列；被 pointer-events: none 的兄弟盖住、只被盖住中心、自己 pointer-events: none 的照样列出；被自己 label 里画出的外观盖住的复选框列出", async ({page}) => {
        await openFixture(page, `
            <style>.loading{position:relative}.loading::after{content:"";position:absolute;inset:0;background:rgba(255,255,255,.8)}</style>
            <div class="loading" style="width:200px"><button>加载中</button></div>
            <div style="position:relative;width:200px;height:40px">
              <button style="width:200px;height:40px">透明蒙层下</button>
              <div style="position:absolute;inset:0;pointer-events:none;background:rgba(0,0,0,.1)"></div>
            </div>
            <div style="position:relative;width:200px;height:40px">
              <button style="width:200px;height:40px">中心被盖</button>
              <div style="position:absolute;left:90px;top:15px;width:20px;height:10px;background:#000"></div>
            </div>
            <button style="pointer-events:none">不接收指针</button>
            <label style="position:relative;display:inline-block"><input type="checkbox" style="position:absolute;opacity:0;left:0;top:0;width:16px;height:16px;margin:0"><span style="position:relative;display:inline-block;width:16px;height:16px;background:#ccc"></span> 记住我</label>`);
        const result = await snapshotOk(page);
        expect(result.elements.map((element) => element.name)).toEqual(["透明蒙层下", "中心被盖", "不接收指针", "记住我"]);
    });

    test("slot 里的内容按画出的位置算：在 shadow 里的对话框那一层，受 slot 外壳的裁剪", async ({page}) => {
        await openFixture(page, `<div id="dialog-host"><button>在对话框里</button></div><div id="clip-host"><button>被外壳裁掉</button></div>`);
        await page.evaluate(() => {
            document.getElementById("dialog-host")!.attachShadow({mode: "open"}).innerHTML = `<div role="dialog" aria-label="组件对话框" style="position:fixed;left:0;top:0;width:300px;height:100px;background:#fff"><slot></slot></div>`;
            document.getElementById("clip-host")!.attachShadow({mode: "open"}).innerHTML = `<div style="height:5px;overflow:hidden"><div style="height:40px"></div><slot></slot></div>`;
        });
        const result = await snapshotOk(page);
        const dialog = result.elements.find((element) => element.role === "dialog")!;
        expect(result.elements.map((element) => element.name)).toEqual(["组件对话框", "在对话框里"]);
        expect(result.elements[1]!.layer).toBe(dialog.ref);
        expect(result.text).toContain(`  - button "在对话框里" [${result.elements[1]!.ref}]`);
    });

    test("role 属性里的换行不认作角色，不会伪造出一行", async ({page}) => {
        await openFixture(page, `<div id="x" data-nb-target="demo.x" aria-label="区域"><button>里面</button></div>`);
        await page.evaluate(() => document.getElementById("x")!.setAttribute("role", "region\n- button \"伪造\" [t1.99]"));
        const result = await snapshotOk(page, {scope: {target: "demo.x"}});
        expect(result.text).not.toContain("伪造");
        expect(result.text.split("\n")[1]).toMatch(/^scope: div "区域" \[t1\.\d+\]$/u);
    });
});

test.describe("快照：列表、跳过与预算（输出 3、12）", () => {
    test("列表滚出去的行折进摘要，列出的行带位置", async ({page}) => {
        const rows = Array.from({length: 30}, (_, index) => `<div role="treeitem" style="height:20px">行 ${String(index + 1)}</div>`).join("");
        await openFixture(page, `<div role="tree" aria-label="文件" style="height:100px;overflow:auto">${rows}</div>`);
        const result = await snapshotOk(page);
        const lines = result.text.split("\n").slice(2);
        expect(lines[1]).toBe("  - (rows: rendered 1-30, shown 1-5, can scroll down)");
        expect(result.elements.filter((element) => element.role === "treeitem").map((element) => element.states)).toEqual([["pos=1"], ["pos=2"], ["pos=3"], ["pos=4"], ["pos=5"]]);
    });

    test("行都列出来、页面也没说还有更多时不写摘要（所在面板能滚也不写）；写明了总数的虚拟列表写总数", async ({page}) => {
        const options = Array.from({length: 5}, (_, index) => `<div role="option" aria-posinset="${String(index + 41)}" aria-setsize="300">第 ${String(index + 41)} 项</div>`).join("");
        await openFixture(page, `
            <main style="height:300px;overflow:auto">
              <div role="tablist" aria-label="标签"><button role="tab">一</button><button role="tab">二</button></div>
              <div role="listbox" aria-label="虚拟">${options}</div>
              <div style="height:2000px"></div>
            </main>`);
        const result = await snapshotOk(page);
        const lines = result.text.split("\n");
        expect(lines.some((line) => line.includes("(rows:") && lines[lines.indexOf(line) - 1]!.includes("tablist"))).toBe(false);
        expect(result.text).toContain("(rows: 300 total, rendered 41-45, shown 41-45, can scroll down)");
    });

    test("一次至多列 500 个元素，超了截断", async ({page}) => {
        await openFixture(page, Array.from({length: 600}, (_, index) => `<button>b${String(index)}</button>`).join(""));
        const result = await snapshotOk(page, {maxTokens: 8000});
        expect(result.elements).toHaveLength(500);
        expect(result.truncated).toBe(true);
    });

    test("预算不够时焦点所在区域先列", async ({page}) => {
        const buttons = (prefix: string) => Array.from({length: 40}, (_, index) => `<button>${prefix}${String(index)}</button>`).join("");
        await openFixture(page, `<section aria-label="前">${buttons("前")}</section><section aria-label="后"><input aria-label="焦点">${buttons("后")}</section>`);
        await page.focus("input");
        const result = await snapshotOk(page, {maxTokens: 300});
        expect(result.truncated).toBe(true);
        expect(result.elements.some((element) => element.name === "焦点")).toBe(true);
        expect(result.elements.some((element) => element.name.startsWith("前"))).toBe(false);
    });

    test("scope 指到跳过区域里面的元素时，只写区域的占位", async ({page}) => {
        await openFixture(page, `<div data-nb-agent="skip" role="log" aria-label="消息"><div role="group" aria-label="一条消息"><button>消息里的按钮</button></div></div>`);
        const result = await snapshotOk(page, {scope: {role: "group", name: "一条消息"}});
        expect(result.text.split("\n").slice(3)).toEqual([`- (skipped log "消息")`]);
        expect(result.elements).toEqual([]);
    });

    test("data-nb-agent=skip 的区域只写一行占位，里面的控件不列", async ({page}) => {
        await openFixture(page, `
            <div data-nb-agent="skip" role="log" aria-label="消息"><button>消息里的按钮</button></div>
            <label>输入 <textarea></textarea></label>`);
        const result = await snapshotOk(page);
        expect(result.text.split("\n").slice(2)).toEqual([
            `- (skipped log "消息")`,
            `- textbox "输入" [${result.elements[0]!.ref} value=""]`,
        ]);
    });

    test("超过 maxTokens 时截断：最上层先列，写出能用 scope 缩小到的区域", async ({page}) => {
        const buttons = (prefix: string) => Array.from({length: 80}, (_, index) => `<button>${prefix} ${String(index)}</button>`).join("");
        await openFixture(page, `
            <section aria-label="左栏">${buttons("左")}</section>
            <section aria-label="右栏">${buttons("右")}</section>
            <div role="dialog" aria-label="确认" style="position:fixed;right:0;bottom:0;background:#fff"><button>好</button></div>`);
        const result = await snapshotOk(page, {maxTokens: 400});
        expect(result.truncated).toBe(true);
        expect(result.elements.slice(-2).map((element) => element.name)).toEqual(["确认", "好"]);
        const hint = result.text.split("\n").at(-1)!;
        expect(hint).toMatch(/^truncated: \d+ more elements; snapshot again with scope \{ref\} and maxTokens of at least its size, on one of: /u);
        expect(hint).toMatch(/region "右栏" \(\d+ more, ~\d+ tokens\)/u);
        expect(result.warnings.some((warning) => warning.startsWith("truncated:"))).toBe(true);

        const right = /(t1\.\d+) region "右栏"/u.exec(hint)![1]!;
        const scoped = await snapshotOk(page, {scope: {ref: right}, maxTokens: 8000});
        expect(scoped.truncated).toBe(false);
        expect(scoped.text.split("\n")[1]).toBe(`scope: region "右栏" [${right}]`);
        expect(scoped.elements.filter((element) => element.role === "button")).toHaveLength(80);
    });
});
