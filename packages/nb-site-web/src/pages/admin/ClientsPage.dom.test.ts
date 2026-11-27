/**
 * 管理面板的 OAuth 客户端页（`ClientsPage.vue` 与两个对话框）：装起整个站点（`testing/site-harness.ts`），以管理员身份打开
 * `/admin/clients`，列表与写入由注入的 `fetch` 回答（`testing/admin-answers.ts`）。断言表格每一列写什么、每行菜单里有哪几项、
 * 登记（机密客户端的密钥只显示一次、公开客户端只有 id）、改动只发改了的项、停用与启用、换密钥、失败落在哪。版式在 `e2e/admin-lists.e2e.ts`，登记与换密钥的整条路径在 `e2e/oauth.e2e.ts`。
 */

import {identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {CreateOAuthClientRequest, CreateOAuthClientResponse, OAuthClientItem, OAuthClientListResponse, PatchOAuthClientRequest, RotateSecretResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";

import zhCN from "../../locales/zh-CN.json";
import {ADMIN_LIST_URLS, ANCHOR, oauthClient, pageOf} from "../../testing/admin-answers";
import {chooseRightAway, cleanUp, clickOverlay, failure, menuClosed, openMenu, identityUrl, nextTask, pressEscape, SETTLE_TIMEOUT_MS, settledAt, startAt, type} from "../../testing/site-harness";
import type {Handler, Harness} from "../../testing/site-harness";
import adminZhCN from "./locales/zh-CN.json";

const text = adminZhCN.admin.clients;
const errors = zhCN.errors.identity;

afterEach(cleanUp);

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
    return template.replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => String(values[key]));
}

const LIST = `GET ${ADMIN_LIST_URLS.oauthClients}`;
const CREATE = `POST ${ADMIN_LIST_URLS.oauthClients}`;
const patchKey = (client: OAuthClientItem): string => `PATCH ${identityUrl(identityPath.adminOAuthClient(client.clientId))}`;
const rotateKey = (client: OAuthClientItem): string => `POST ${identityUrl(identityPath.adminOAuthClientRotate(client.clientId))}`;

/** 三个客户端：1 号机密、2 号公开（两个回调地址、免确认）、3 号已停用。 */
function clients(): OAuthClientItem[] {
    return [
        oauthClient(1),
        oauthClient(2, {type: "public", skipConsent: true, redirectUris: ["http://127.0.0.1/callback", "nbook://callback"]}),
        oauthClient(3, {disabled: true}),
    ];
}

const listing = (items: () => readonly OAuthClientItem[]): Handler => (_body, _server, query) => Response.json(pageOf(items(), query) satisfies OAuthClientListResponse);

async function openClients(handlers: Readonly<Record<string, Handler>> = {}, items = clients()): Promise<Harness> {
    const harness = startAt("/admin/clients", {session: {role: "admin", consentRequired: false}, handlers: {[LIST]: listing(() => items), ...handlers}});
    await settledAt(harness, "/admin/clients", "admin-clients");
    await vi.waitFor(() => expect(list(harness).querySelector(items.length === 0 ? "tbody" : "[data-site-admin-client-row]")).not.toBeNull());
    return harness;
}

function list(harness: Harness): HTMLElement {
    return harness.target.querySelector<HTMLElement>('[data-site-admin-list="oauth-clients"]')!;
}

/** 表格里每一行的客户端 id，按先后。 */
function rowIds(harness: Harness): string[] {
    return [...list(harness).querySelectorAll<HTMLElement>("[data-site-admin-client-row]")].map((cell) => cell.dataset.siteAdminClientRow ?? "");
}

function rowOf(harness: Harness, client: OAuthClientItem): HTMLTableRowElement {
    return list(harness).querySelector(`[data-site-admin-client-row="${client.clientId}"]`)!.closest("tr")!;
}

function listQueries(harness: Harness): Record<string, string>[] {
    return harness.requests.filter((request) => request.method === "GET" && request.path.startsWith(ADMIN_LIST_URLS.oauthClients)).map((request) => Object.fromEntries(new URL(request.path, "http://site.invalid").searchParams));
}

function writes(harness: Harness): {method: string; path: string; body: unknown}[] {
    return harness.requests.filter((request) => request.method !== "GET").map(({method, path, body}) => ({method, path, body}));
}

function dialogStatus(found: HTMLElement): string {
    return found.querySelector("[data-dialog-status]")?.textContent?.trim() ?? "";
}

/** 标红的项（`aria-invalid`），按 `name`：回调地址是多行输入框，`invalidNames` 只看 `input`。 */
function invalidIn(found: HTMLElement): string[] {
    return [...found.querySelectorAll<HTMLElement>('[name][aria-invalid="true"]')].map((element) => element.getAttribute("name") ?? "");
}

async function openRowMenu(harness: Harness, client: OAuthClientItem): Promise<string[]> {
    await openMenu(list(harness).querySelector<HTMLElement>(`[data-site-admin-row-menu="${client.clientId}"]`)!);
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent?.trim() ?? "");
}

async function chooseInMenu(harness: Harness, client: OAuthClientItem, label: string): Promise<void> {
    await openRowMenu(harness, client);
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === label)!.click();
}

async function dialog(selector: string): Promise<HTMLElement> {
    await vi.waitFor(() => expect(document.body.querySelector(selector)).not.toBeNull(), {timeout: SETTLE_TIMEOUT_MS});
    return document.body.querySelector<HTMLElement>(selector)!;
}

async function closed(selector: string): Promise<void> {
    await vi.waitFor(() => expect(document.body.querySelector(selector)).toBeNull(), {timeout: SETTLE_TIMEOUT_MS});
}

describe("列表", () => {
    it("列依次是名字、客户端 ID、种类、回调地址、免确认、状态、登记时间；照服务端的顺序，取第 1 页", async () => {
        const harness = await openClients();
        const headers = [...list(harness).querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
        expect(headers).toEqual([text.columns.name, text.columns.clientId, text.columns.type, text.columns.redirectUris, text.columns.skipConsent, text.columns.state, text.columns.createdAt, ""]);
        expect(rowIds(harness)).toEqual(clients().map((client) => client.clientId));
        expect(listQueries(harness)).toEqual([{page: "1", pageSize: "20"}]);
    });

    it("每一格：客户端 ID 带复制；种类、免确认、状态写成字；回调地址写第一个，多的写“等 N 个”，全部在悬停提示里", async () => {
        const harness = await openClients();
        const [confidential, publicClient, disabled] = clients() as [OAuthClientItem, OAuthClientItem, OAuthClientItem];
        const cells = (client: OAuthClientItem): string[] => [...rowOf(harness, client).querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? "");

        expect(cells(confidential).slice(0, 6)).toEqual([confidential.name, confidential.clientId, text.types.confidential, confidential.redirectUris[0], text.skipConsentNo, text.states.enabled]);
        expect(rowOf(harness, confidential).querySelector("td:nth-child(2) button")?.getAttribute("aria-label")).toBe(fill(text.copyId, {clientId: confidential.clientId}));

        const uris = rowOf(harness, publicClient).querySelector<HTMLElement>("[data-site-admin-client-uris]")!;
        expect(uris.textContent?.replace(/\s+/gu, "")).toBe(`http://127.0.0.1/callback${fill(text.moreUris, {count: 1})}`.replace(/\s+/gu, ""));
        expect(uris.title).toBe("http://127.0.0.1/callback\nnbook://callback");
        expect(cells(publicClient).slice(2, 3)).toEqual([text.types.public]);
        expect(cells(publicClient)[4]).toBe(text.skipConsentYes);

        expect(rowOf(harness, disabled).querySelector("[data-site-admin-client-state]")?.textContent?.trim()).toBe(text.states.disabled);
    });

    it("还没有客户端：表格写空状态", async () => {
        const harness = await openClients({}, []);
        await vi.waitFor(() => expect(list(harness).textContent).toContain(text.empty));
    });

    it("每行菜单：机密客户端有改动、换密钥、停用；公开客户端没有换密钥；已停用的是启用", async () => {
        const harness = await openClients();
        const [confidential, publicClient, disabled] = clients() as [OAuthClientItem, OAuthClientItem, OAuthClientItem];
        const trigger = (client: OAuthClientItem): HTMLElement => list(harness).querySelector<HTMLElement>(`[data-site-admin-row-menu="${client.clientId}"]`)!;
        expect(await openRowMenu(harness, confidential)).toEqual([text.edit.menu, text.rotate.menu, text.disable.menu]);
        document.body.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await menuClosed(trigger(confidential));
        expect(await openRowMenu(harness, publicClient)).toEqual([text.edit.menu, text.disable.menu]);
        document.body.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await menuClosed(trigger(publicClient));
        expect(await openRowMenu(harness, disabled)).toEqual([text.edit.menu, text.rotate.menu, text.enable.menu]);
    });
});

describe("登记", () => {
    const DIALOG = "[data-site-admin-client-dialog]";

    async function openRegister(harness: Harness): Promise<HTMLElement> {
        harness.target.querySelector<HTMLButtonElement>("[data-site-admin-client-register]")!.click();
        return dialog(DIALOG);
    }

    const nameField = (found: HTMLElement): HTMLInputElement => found.querySelector<HTMLInputElement>('input[name="name"]')!;
    const urisField = (found: HTMLElement): HTMLTextAreaElement => found.querySelector<HTMLTextAreaElement>('textarea[name="redirectUris"]')!;
    const submit = (found: HTMLElement): HTMLButtonElement => found.querySelector<HTMLButtonElement>("[data-site-admin-client-submit]")!;

    /** 离开多行输入框：与 `leaveField` 同样的几个事件（它只收 `input`）。 */
    function leaveBox(box: HTMLTextAreaElement): void {
        box.dispatchEvent(new Event("change", {bubbles: true}));
        box.dispatchEvent(new FocusEvent("blur"));
        box.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
    }

    function typeUris(found: HTMLElement, value: string): void {
        const box = urisField(found);
        box.value = value;
        box.dispatchEvent(new Event("input", {bubbles: true}));
    }

    /** 照请求登记一个新客户端，加到列表最前面；机密的回一个密钥。 */
    function registering(items: OAuthClientItem[]): Handler {
        return (body) => {
            const request = body as CreateOAuthClientRequest;
            const client = oauthClient(9, {...request, clientId: "newClient0009AbCdEfGhIjKlMnOp"});
            items.unshift(client);
            return Response.json({client, clientSecret: request.type === "confidential" ? "nbs_new_secret_Xy7Qm2Lp9Kt4" : null} satisfies CreateOAuthClientResponse);
        };
    }

    it("机密客户端：名字与回调地址去掉首尾空白、空行不算；成功后同一个对话框显示客户端 ID 与密钥（各带复制），列表丢掉基准重取", async () => {
        const items = clients();
        const harness = await openClients({[CREATE]: registering(items)}, items);
        const found = await openRegister(harness);
        expect(found.dataset.siteAdminClientStep).toBe("form");
        expect(submit(found).disabled).toBe(true);
        type(nameField(found), "  书架同步助手 ");
        typeUris(found, " https://shelf.example.com/callback \n\nhttps://shelf.example.com/alt\n");
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
        submit(found).click();

        await vi.waitFor(() => expect(found.dataset.siteAdminClientStep).toBe("created"), {timeout: SETTLE_TIMEOUT_MS});
        expect(writes(harness)).toEqual([{method: "POST", path: ADMIN_LIST_URLS.oauthClients, body: {
            name: "书架同步助手",
            redirectUris: ["https://shelf.example.com/callback", "https://shelf.example.com/alt"],
            type: "confidential",
            skipConsent: false,
        } satisfies CreateOAuthClientRequest}]);
        // 正文换步骤有过渡（`nb-ui-switch` 的 out-in）：表单先淡出，新内容才进来。
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-created-client-id]")?.textContent).toBe("newClient0009AbCdEfGhIjKlMnOp"), {timeout: SETTLE_TIMEOUT_MS});
        expect(found.querySelector("[data-site-admin-created-secret]")?.textContent).toBe("nbs_new_secret_Xy7Qm2Lp9Kt4");
        expect(found.textContent).toContain(text.register.secretNote);
        expect([...found.querySelectorAll(".nb-copy-button button")].map((element) => element.textContent?.trim())).toEqual([text.credentials.copyId, text.credentials.copySecret]);
        await vi.waitFor(() => expect(listQueries(harness)).toHaveLength(2));
        // 新客户端登记在旧基准之后：重取不带基准，否则列表里没有它。
        expect(listQueries(harness).at(-1)).toEqual({page: "1", pageSize: "20"});
        await vi.waitFor(() => expect(rowIds(harness)[0]).toBe("newClient0009AbCdEfGhIjKlMnOp"));
    });

    it("密钥只显示这一次：关掉再打开是一张空白的表，页面上哪里都没有那个密钥", async () => {
        const items = clients();
        const harness = await openClients({[CREATE]: registering(items)}, items);
        const found = await openRegister(harness);
        type(nameField(found), "书架同步助手");
        typeUris(found, "https://shelf.example.com/callback");
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
        submit(found).click();
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-created-secret]")).not.toBeNull(), {timeout: SETTLE_TIMEOUT_MS});

        // 显示密钥期间 Esc 与点遮罩都不关，只有“完成”关。
        pressEscape(found);
        clickOverlay();
        await nextTask();
        expect(document.body.querySelector(DIALOG)).toBe(found);
        found.querySelector<HTMLButtonElement>("[data-site-admin-client-finish]")!.click();
        await closed(DIALOG);
        expect(document.body.textContent).not.toContain("nbs_new_secret_Xy7Qm2Lp9Kt4");
        const again = await openRegister(harness);
        expect(again.dataset.siteAdminClientStep).toBe("form");
        expect([nameField(again).value, urisField(again).value]).toEqual(["", ""]);
        expect(document.body.textContent).not.toContain("nbs_new_secret_Xy7Qm2Lp9Kt4");
    });

    it("点了“完成”马上又点“登记”（上一次还没关完）：也是一张空白的表，页面上哪里都没有上一次的密钥", async () => {
        const items = clients();
        const harness = await openClients({[CREATE]: registering(items)}, items);
        const found = await openRegister(harness);
        type(nameField(found), "书架同步助手");
        typeUris(found, "https://shelf.example.com/callback");
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
        submit(found).click();
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-created-secret]")).not.toBeNull(), {timeout: SETTLE_TIMEOUT_MS});

        // 两次点击之间只让 Vue 画一次（微任务），不让出事件循环：nb-ui 的 `closed` 排在之后的宏任务里，这时一定还没发。
        found.querySelector<HTMLButtonElement>("[data-site-admin-client-finish]")!.click();
        await nextTick();
        harness.target.querySelector<HTMLButtonElement>("[data-site-admin-client-register]")!.click();
        await nextTick();
        const again = document.body.querySelector<HTMLElement>(DIALOG)!;
        expect(again.dataset.siteAdminClientStep).toBe("form");
        await vi.waitFor(() => expect(document.body.textContent).not.toContain("nbs_new_secret_Xy7Qm2Lp9Kt4"), {timeout: SETTLE_TIMEOUT_MS});
        expect([nameField(again).value, urisField(again).value]).toEqual(["", ""]);
    });

    it("公开客户端：选“公开”、勾免确认照选的发；成功后只有客户端 ID，没有密钥", async () => {
        const items = clients();
        const harness = await openClients({[CREATE]: registering(items)}, items);
        const found = await openRegister(harness);
        type(nameField(found), "桌面端");
        typeUris(found, "http://127.0.0.1/callback");
        found.querySelector<HTMLButtonElement>('[data-site-admin-client-type] [role="radio"][value="public"]')!.click();
        found.querySelector<HTMLInputElement>('input[name="skipConsent"]')!.click();
        await vi.waitFor(() => expect(found.querySelector('[role="radio"][value="public"]')?.getAttribute("aria-checked")).toBe("true"));
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
        submit(found).click();

        await vi.waitFor(() => expect(found.dataset.siteAdminClientStep).toBe("created"), {timeout: SETTLE_TIMEOUT_MS});
        expect(writes(harness)[0]!.body).toEqual({name: "桌面端", redirectUris: ["http://127.0.0.1/callback"], type: "public", skipConsent: true} satisfies CreateOAuthClientRequest);
        // 正文换步骤有过渡（`nb-ui-switch` 的 out-in）：表单先淡出，新内容才进来。
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-created-client-id]")?.textContent).toBe("newClient0009AbCdEfGhIjKlMnOp"), {timeout: SETTLE_TIMEOUT_MS});
        expect(found.querySelector("[data-site-admin-created-secret]")).toBeNull();
        expect(found.textContent).toContain(text.register.publicNote);
    });

    it("回调地址超过五个：提交按钮不可用，离开时状态行写规则、那一项标红", async () => {
        const harness = await openClients();
        const found = await openRegister(harness);
        type(nameField(found), "书架同步助手");
        typeUris(found, Array.from({length: 6}, (_, index) => `https://shelf.example.com/${index}`).join("\n"));
        await vi.waitFor(() => expect(urisField(found).value).toContain("/5"));
        expect(submit(found).disabled).toBe(true);
        leaveBox(urisField(found));
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(fill(text.form.rules.redirectUrisCount, {max: 5})));
        expect(invalidIn(found)).toEqual(["redirectUris"]);
        expect(writes(harness)).toEqual([]);
    });

    it("validation_failed：按 fields 标红；redirect_uri_invalid（不合种类的规则）标红回调地址；原因写在对话框的状态行", async () => {
        for (const [answer, expected] of [
            [failure({error: {code: "validation_failed", fields: ["name"]}}, 400), {status: errors.validation_failed, invalid: ["name"]}],
            [failure({error: {code: "redirect_uri_invalid"}}, 400), {status: errors.redirect_uri_invalid, invalid: ["redirectUris"]}],
        ] as const) {
            const harness = await openClients({[CREATE]: () => answer.clone()});
            const found = await openRegister(harness);
            type(nameField(found), "书架同步助手");
            typeUris(found, "http://shelf.example.com/callback");
            await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
            submit(found).click();
            await vi.waitFor(() => expect(dialogStatus(found)).toBe(expected.status));
            expect(invalidIn(found)).toEqual(expected.invalid);
            expect(found.dataset.siteAdminClientStep).toBe("form");
            cleanUp();
        }
    });
});

describe("改动", () => {
    const DIALOG = "[data-site-admin-client-dialog]";

    it("打开时填着现在的值、没有种类一项，什么都没改时“保存”不可用；只发改了的项，成功后关掉、重取当前页（沿用基准）", async () => {
        const items = clients();
        const target = items[0]!;
        const harness = await openClients({
            [patchKey(target)]: (body) => {
                items[0] = {...items[0]!, ...(body as PatchOAuthClientRequest)};
                return Response.json(items[0]);
            },
        }, items);
        await chooseInMenu(harness, target, text.edit.menu);
        const found = await dialog(DIALOG);
        const name = found.querySelector<HTMLInputElement>('input[name="name"]')!;
        expect(name.value).toBe(target.name);
        expect(found.querySelector<HTMLTextAreaElement>('textarea[name="redirectUris"]')!.value).toBe(target.redirectUris.join("\n"));
        expect(found.querySelector("[data-site-admin-client-type]")).toBeNull();
        const save = found.querySelector<HTMLButtonElement>("[data-site-admin-client-submit]")!;
        expect(save.disabled).toBe(true);

        type(name, "书架同步");
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();
        await closed(DIALOG);
        expect(writes(harness)).toEqual([{method: "PATCH", path: identityUrl(identityPath.adminOAuthClient(target.clientId)), body: {name: "书架同步"}}]);
        await vi.waitFor(() => expect(listQueries(harness)).toHaveLength(2));
        expect(listQueries(harness).at(-1)).toEqual({page: "1", pageSize: "20", anchor: ANCHOR});
        await vi.waitFor(() => expect(rowOf(harness, target).querySelector("td")?.textContent?.trim()).toBe("书架同步"));
    });

    it("客户端已经不在了（not_found）：原因写在对话框的状态行，列表重取", async () => {
        const target = clients()[0]!;
        const harness = await openClients({[patchKey(target)]: () => failure({error: {code: "not_found"}}, 404)});
        await chooseInMenu(harness, target, text.edit.menu);
        const found = await dialog(DIALOG);
        type(found.querySelector<HTMLInputElement>('input[name="name"]')!, "书架同步");
        const save = found.querySelector<HTMLButtonElement>("[data-site-admin-client-submit]")!;
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.not_found));
        await vi.waitFor(() => expect(listQueries(harness)).toHaveLength(2));
    });
});

describe("停用与启用", () => {
    it("停用先确认；确认后发 disabled: true，重取，那一行的状态变成已停用", async () => {
        const items = clients();
        const target = items[0]!;
        const harness = await openClients({
            [patchKey(target)]: (body) => {
                items[0] = {...items[0]!, ...(body as PatchOAuthClientRequest)};
                return Response.json(items[0]);
            },
        }, items);
        await chooseInMenu(harness, target, text.disable.menu);
        const found = await dialog("[data-site-admin-confirm]");
        expect(found.textContent).toContain(fill(text.disable.title, {name: target.name}));
        expect(found.textContent).toContain(text.disable.description);
        expect(writes(harness)).toEqual([]);
        found.querySelector<HTMLButtonElement>("[data-site-admin-confirm-button]")!.click();
        await closed("[data-site-admin-confirm]");
        expect(writes(harness)).toEqual([{method: "PATCH", path: identityUrl(identityPath.adminOAuthClient(target.clientId)), body: {disabled: true}}]);
        await vi.waitFor(() => expect(rowOf(harness, target).querySelector("[data-site-admin-client-state]")?.textContent?.trim()).toBe(text.states.disabled));
    });

    it("已停用的启用：发 disabled: false", async () => {
        const items = clients();
        const target = items[2]!;
        const harness = await openClients({
            [patchKey(target)]: (body) => {
                items[2] = {...items[2]!, ...(body as PatchOAuthClientRequest)};
                return Response.json(items[2]);
            },
        }, items);
        await chooseInMenu(harness, target, text.enable.menu);
        const found = await dialog("[data-site-admin-confirm]");
        expect(found.textContent).toContain(fill(text.enable.title, {name: target.name}));
        found.querySelector<HTMLButtonElement>("[data-site-admin-confirm-button]")!.click();
        await closed("[data-site-admin-confirm]");
        expect(writes(harness)).toEqual([{method: "PATCH", path: identityUrl(identityPath.adminOAuthClient(target.clientId)), body: {disabled: false}}]);
        await vi.waitFor(() => expect(rowOf(harness, target).querySelector("[data-site-admin-client-state]")?.textContent?.trim()).toBe(text.states.enabled));
    });
});

describe("换密钥", () => {
    const DIALOG = "[data-site-admin-rotate-dialog]";
    const target = clients()[0]!;

    it("先说清后果；确认后同一个对话框显示新密钥，关掉再打开回到确认，新密钥不在页面上了", async () => {
        const harness = await openClients({[rotateKey(target)]: () => Response.json({clientSecret: "nbs_rotated_9fK2mQ7xL4pW8tR1"} satisfies RotateSecretResponse)});
        await chooseInMenu(harness, target, text.rotate.menu);
        const found = await dialog(DIALOG);
        expect(found.dataset.siteAdminRotateStep).toBe("confirm");
        expect(found.textContent).toContain(fill(text.rotate.title, {name: target.name}));
        expect(found.textContent).toContain(text.rotate.description);
        expect(writes(harness)).toEqual([]);

        found.querySelector<HTMLButtonElement>("[data-site-admin-rotate-confirm]")!.click();
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-rotated-secret]")?.textContent).toBe("nbs_rotated_9fK2mQ7xL4pW8tR1"), {timeout: SETTLE_TIMEOUT_MS});
        expect(found.dataset.siteAdminRotateStep).toBe("secret");
        expect(writes(harness)).toEqual([{method: "POST", path: identityUrl(identityPath.adminOAuthClientRotate(target.clientId)), body: undefined}]);

        // 显示新密钥期间 Esc 与点遮罩都不关，只有“完成”关。
        pressEscape(found);
        clickOverlay();
        await nextTask();
        expect(document.body.querySelector(DIALOG)).toBe(found);
        found.querySelector<HTMLButtonElement>("[data-site-admin-rotate-finish]")!.click();
        await closed(DIALOG);
        expect(document.body.textContent).not.toContain("nbs_rotated_9fK2mQ7xL4pW8tR1");
        await chooseInMenu(harness, target, text.rotate.menu);
        const again = await dialog(DIALOG);
        expect(again.dataset.siteAdminRotateStep).toBe("confirm");
        expect(document.body.textContent).not.toContain("nbs_rotated_9fK2mQ7xL4pW8tR1");
    });

    it("点了“完成”马上又从菜单点“换密钥”（上一次还没关完）：回到确认那一步，页面上哪里都没有上一次的密钥", async () => {
        const harness = await openClients({[rotateKey(target)]: () => Response.json({clientSecret: "nbs_rotated_9fK2mQ7xL4pW8tR1"} satisfies RotateSecretResponse)});
        await chooseInMenu(harness, target, text.rotate.menu);
        const found = await dialog(DIALOG);
        found.querySelector<HTMLButtonElement>("[data-site-admin-rotate-confirm]")!.click();
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-rotated-secret]")?.textContent).toBe("nbs_rotated_9fK2mQ7xL4pW8tR1"), {timeout: SETTLE_TIMEOUT_MS});

        found.querySelector<HTMLButtonElement>("[data-site-admin-rotate-finish]")!.click();
        await nextTick();
        await chooseRightAway(list(harness).querySelector<HTMLElement>(`[data-site-admin-row-menu="${target.clientId}"]`)!, text.rotate.menu);
        const again = document.body.querySelector<HTMLElement>(DIALOG)!;
        expect(again.dataset.siteAdminRotateStep).toBe("confirm");
        await vi.waitFor(() => expect(document.body.textContent).not.toContain("nbs_rotated_9fK2mQ7xL4pW8tR1"), {timeout: SETTLE_TIMEOUT_MS});
    });

    it("回 client_public（列表旧了，它其实是公开客户端）：原因写在状态行，对话框留着", async () => {
        const harness = await openClients({[rotateKey(target)]: () => failure({error: {code: "client_public"}}, 409)});
        await chooseInMenu(harness, target, text.rotate.menu);
        const found = await dialog(DIALOG);
        found.querySelector<HTMLButtonElement>("[data-site-admin-rotate-confirm]")!.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.client_public));
        expect(found.dataset.siteAdminRotateStep).toBe("confirm");
    });

    it("回 not_found：原因写在状态行，列表重取", async () => {
        const harness = await openClients({[rotateKey(target)]: () => failure({error: {code: "not_found"}}, 404)});
        await chooseInMenu(harness, target, text.rotate.menu);
        const found = await dialog(DIALOG);
        found.querySelector<HTMLButtonElement>("[data-site-admin-rotate-confirm]")!.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.not_found));
        await vi.waitFor(() => expect(listQueries(harness)).toHaveLength(2));
    });
});
