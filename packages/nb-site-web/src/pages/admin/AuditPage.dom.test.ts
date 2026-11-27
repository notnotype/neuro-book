/**
 * 管理面板的审计页（`AuditPage.vue`）：装起整个站点（`testing/site-harness.ts`），以管理员身份打开 `/admin/audit`，审计记录由注入的
 * `fetch` 按查询参数回答（`testing/admin-answers.ts`），时间由手动时钟推进。断言工具条上三个筛选（操作者、对象、动作）写进地址与请求、
 * 写得不合规则时不取，以及每条记录的动作、操作者、对象与参数怎样写。动作名的文案覆盖在 `tests/catalog.test.ts`。
 */

import {AUDIT_ACTIONS} from "@notnotype/nb-site-identity-contract/constants";
import type {AuditItem, AuditListResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../../locales/zh-CN.json";
import {ADMIN_LIST_URLS, auditItem, pageOf} from "../../testing/admin-answers";
import {cleanUp, nextTask, settledAt, startAt} from "../../testing/site-harness";
import type {Handler, Harness} from "../../testing/site-harness";
import {SEARCH_PAUSE_MS} from "./use-admin-list";

const text = zhCN.admin.audit;

afterEach(cleanUp);

/** 每个动作一条，第一条是命令行做的。 */
const ITEMS: AuditItem[] = AUDIT_ACTIONS.map((action, index) =>
    auditItem(index + 1, {
        action,
        ...(index === 0 ? {actor: null} : {}),
        ...(action === "user.role" ? {params: {from: "user", to: "admin"}} : {}),
    }),
);

const listAudit: Handler = (_body, _server, query) => Response.json(pageOf(ITEMS.filter((item) => (query.get("action") ?? item.action) === item.action), query) satisfies AuditListResponse);

async function openAudit(path = "/admin/audit"): Promise<Harness> {
    const harness = startAt(path, {session: {role: "admin", consentRequired: false}, handlers: {[`GET ${ADMIN_LIST_URLS.audit}`]: listAudit}});
    const url = new URL(path, "http://site.invalid");
    await settledAt(harness, `${url.pathname}${url.search}`, "admin-audit");
    await vi.waitFor(() => expect(cells(harness, 0).length).toBeGreaterThan(0));
    return harness;
}

/** 第 `column` 列每一行的字。 */
function cells(harness: Harness, column: number): string[] {
    return [...harness.target.querySelectorAll('[data-site-admin-list="audit"] tbody tr')].map((row) => row.querySelectorAll("td")[column]?.textContent?.trim() ?? "").filter((cell) => cell !== "");
}

function queries(harness: Harness): Record<string, string>[] {
    return harness.requests.filter((request) => request.method === "GET" && request.path.startsWith(ADMIN_LIST_URLS.audit)).map((request) => Object.fromEntries(new URL(request.path, "http://site.invalid").searchParams));
}

function textInput(harness: Harness, name: "actor" | "target-id"): HTMLInputElement {
    const root = harness.target.querySelector<HTMLElement>(`[data-site-admin-audit-${name}]`)!;
    return root instanceof HTMLInputElement ? root : root.querySelector("input")!;
}

function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
}

/** 在一个下拉里选写着 `label` 的那一项。 */
async function choose(harness: Harness, name: "target-type" | "action", label: string): Promise<void> {
    const trigger = harness.target.querySelector<HTMLElement>(`[data-site-admin-audit-${name}] [role=combobox], [role=combobox][data-site-admin-audit-${name}]`)!;
    trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(document.body.querySelector("[role=option]")).not.toBeNull());
    const option = [...document.body.querySelectorAll<HTMLElement>("[role=option]")].find((node) => node.textContent?.trim() === label);
    if (option === undefined) throw new Error(`下拉里没有“${label}”`);
    option.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(document.body.querySelector("[role=option]")).toBeNull());
}

describe("记录怎样写", () => {
    it("每个动作按文案目录写，命令行做的写“命令行”；对象写种类与 id，参数逐项写“名：值”", async () => {
        const harness = await openAudit();
        expect(queries(harness)).toEqual([{page: "1", pageSize: "20"}]);
        const labels = [...harness.target.querySelectorAll<HTMLElement>("[data-site-admin-audit-action-of]")].map((node) => ({action: node.dataset.siteAdminAuditActionOf, label: node.textContent?.trim()}));
        const catalog = text.actions as unknown as Record<string, Record<string, string>>;
        expect(labels).toEqual(AUDIT_ACTIONS.map((action) => {
            const [group, verb] = action.split(".") as [string, string];
            return {action, label: catalog[group]![verb]};
        }));
        expect(cells(harness, 1)[0]).toBe(text.cli);
        expect(cells(harness, 1)[1]).toBe("alice");
        expect(cells(harness, 3)[0]).toBe(`${text.targets.user} #12`);
        const role = AUDIT_ACTIONS.indexOf("user.role");
        expect(cells(harness, 4)[role]).toBe("from：user，to：admin");
        expect(cells(harness, 4)[0]).toBe(text.noParams);
    });
});

describe("筛选", () => {
    it("操作者：停 300 毫秒才写进地址并取；写数字 id 或 cli 都行", async () => {
        const harness = await openAudit();
        typeInto(textInput(harness, "actor"), "1");
        harness.clock.advance(100);
        await nextTask();
        typeInto(textInput(harness, "actor"), "12");
        harness.clock.advance(SEARCH_PAUSE_MS - 1);
        await nextTask();
        expect(queries(harness)).toHaveLength(1);
        harness.clock.advance(1);
        await settledAt(harness, "/admin/audit?actorId=12", "admin-audit");
        await vi.waitFor(() => expect(queries(harness).at(-1)).toEqual({page: "1", pageSize: "20", actorId: "12"}));
        expect(queries(harness)).toHaveLength(2);

        typeInto(textInput(harness, "actor"), "cli");
        harness.clock.advance(SEARCH_PAUSE_MS);
        await settledAt(harness, "/admin/audit?actorId=cli", "admin-audit");
        await vi.waitFor(() => expect(queries(harness).at(-1)).toEqual({page: "1", pageSize: "20", actorId: "cli"}));
    });

    it("操作者写得不合规则：那一格标红、读屏名字里带规则，不写进地址也不取", async () => {
        const harness = await openAudit();
        typeInto(textInput(harness, "actor"), "alice");
        harness.clock.advance(SEARCH_PAUSE_MS);
        await vi.waitFor(() => expect(textInput(harness, "actor").getAttribute("aria-invalid")).toBe("true"));
        expect(textInput(harness, "actor").getAttribute("aria-description")).toBe(text.actorRule);
        expect(queries(harness)).toHaveLength(1);
        expect(harness.site.router.currentRoute.value.query).toEqual({});
    });

    it("对象：没选种类时 id 那一格不可用；选了种类再写 id，两个一起发；种类换回全部时 id 一起清掉", async () => {
        const harness = await openAudit();
        expect(textInput(harness, "target-id").disabled).toBe(true);
        await choose(harness, "target-type", text.targets.user);
        await settledAt(harness, "/admin/audit?targetType=user", "admin-audit");
        await vi.waitFor(() => expect(queries(harness).at(-1)).toEqual({page: "1", pageSize: "20", targetType: "user"}));
        expect(textInput(harness, "target-id").disabled).toBe(false);

        typeInto(textInput(harness, "target-id"), "12");
        harness.clock.advance(SEARCH_PAUSE_MS);
        await settledAt(harness, "/admin/audit?targetType=user&targetId=12", "admin-audit");
        await vi.waitFor(() => expect(queries(harness).at(-1)).toEqual({page: "1", pageSize: "20", targetType: "user", targetId: "12"}));

        await choose(harness, "target-type", text.allTargets);
        await settledAt(harness, "/admin/audit", "admin-audit");
        await vi.waitFor(() => expect(textInput(harness, "target-id").value).toBe(""));
        expect(queries(harness).at(-1)).toEqual({page: "1", pageSize: "20"});
    });

    it("地址里只有对象 id 没有种类：id 不发（合同会拒）", async () => {
        const harness = await openAudit("/admin/audit?targetId=12");
        expect(queries(harness)).toEqual([{page: "1", pageSize: "20"}]);
    });

    it("动作：从合同的动作名里选，写进地址（push）并取；后退回到全部", async () => {
        const harness = await openAudit();
        await choose(harness, "action", text.actions.user.ban);
        await settledAt(harness, "/admin/audit?action=user.ban", "admin-audit");
        await vi.waitFor(() => expect(cells(harness, 2)).toEqual([text.actions.user.ban]));
        expect(queries(harness).at(-1)).toEqual({page: "1", pageSize: "20", action: "user.ban"});

        harness.site.router.back();
        await settledAt(harness, "/admin/audit", "admin-audit");
        await vi.waitFor(() => expect(cells(harness, 2)).toHaveLength(AUDIT_ACTIONS.length));
    });

    it("三个筛选都从地址读回来（刷新）", async () => {
        const harness = await openAudit("/admin/audit?actorId=cli&targetType=registration_code&targetId=3&action=registration_code.create");
        expect(queries(harness)).toEqual([{page: "1", pageSize: "20", actorId: "cli", targetType: "registration_code", targetId: "3", action: "registration_code.create"}]);
        expect(textInput(harness, "actor").value).toBe("cli");
        expect(textInput(harness, "target-id").value).toBe("3");
        expect(harness.target.querySelector("[data-site-admin-audit-target-type]")?.textContent).toContain(text.targets.registration_code);
        expect(harness.target.querySelector("[data-site-admin-audit-action]")?.textContent).toContain(text.actions.registration_code.create);
    });
});
