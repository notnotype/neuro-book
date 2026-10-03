import {createApp, createError, defineEventHandler, getRequestURL, sendRedirect, toWebHandler, useSession, type H3Event} from "h3";
import {afterEach, expect, it, vi} from "vitest";
import {BROWSER_BOOTSTRAP_PATH, BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema} from "nbook/shared/browser-bootstrap";
import auth from "nbook/server/middleware/auth";
import bootstrap from "./browser-bootstrap.get";

vi.hoisted(() => vi.stubGlobal("defineEventHandler", (handler: unknown) => handler));

vi.mock("nbook/server/utils/auth", () => ({
    isAuthEnabled: () => true,
    getCurrentUser: async (event: H3Event) => (await session(event)).data.user ?? null,
}));
const session = (event: H3Event) => useSession<{user?: {id: string}}>(event, {
    password: "browser-bootstrap-contract-password-32-bytes", cookie: {secure: false, sameSite: "lax"},
});
afterEach(() => vi.unstubAllGlobals());

it("场景 8：引导接口未登录返回 401，登录后返回两个插件、协议与修订号，不含服务端路径", async () => {
    vi.stubGlobal("defineEventHandler", defineEventHandler);
    vi.stubGlobal("createError", createError);
    vi.stubGlobal("getRequestURL", getRequestURL);
    vi.stubGlobal("sendRedirect", sendRedirect);
    const app = createApp();
    app.use(auth);
    app.use("/api/auth/login", defineEventHandler(async (event) => {
        await (await session(event)).update({user: {id: "7"}});
        return {ok: true};
    }));
    app.use(BROWSER_BOOTSTRAP_PATH, bootstrap);
    const send = toWebHandler(app);
    expect((await send(new Request(`http://browser.test${BROWSER_BOOTSTRAP_PATH}`))).status).toBe(401);
    const login = await send(new Request("http://browser.test/api/auth/login", {method: "POST"}));
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await send(new Request(`http://browser.test${BROWSER_BOOTSTRAP_PATH}`, {headers: {cookie}}));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const result = BrowserBootstrapSchema.parse(body);
    expect(result.protocolVersion).toBe(BROWSER_PROTOCOL_VERSION);
    expect(result.revision).toBe("builtin-browser-v1");
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(["nbook.workbench", "nbook.files"]);
    expect(result.plugins.map((plugin) => [plugin.version, plugin.browser.entry])).toEqual([["1.0.0", "browser"], ["1.0.0", "browser"]]);
    const values = JSON.stringify(body);
    expect(values).not.toMatch(/(?:\/home\/|\/tmp\/|[A-Z]:\\|database|password|token|credential)/iu);
});
