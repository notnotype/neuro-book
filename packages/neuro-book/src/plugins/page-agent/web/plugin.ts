/**
 * `nbook.page-agent` 的浏览器入口（docs/specs/agent/page-agent.md）：随窗口启动，把页面引擎挂成工作台浮层，并向服务端提供窗口合同
 * `nbook.page-agent/window`。
 *
 * 引擎在浮层组件里（`engine/PageAgentEngine.vue`）：这个文件在后端类型检查的范围里，没有 DOM 类型，引擎经 `PageSide` 交过来。
 * 浮层挂上之前到的调用等它挂上；调用方的时限照常走，窗口一直没挂上引擎时调用方按超时处理。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {TextPort} from "@notnotype/nb-ui/text-port";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {defineComponent, h} from "vue";

import {commandServiceKey, currentKeyPlatform, formatKeybinding, runsWithoutArgs} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {displayLocale, settingsCatalogKey, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {WORKBENCH_OVERLAYS_POINT, workbenchCatalogKey} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchOverlayImplementation} from "nbook/plugins/workbench/web/contracts";
import {windowTextPort} from "nbook/shared/window-text";
import {windowTextKey} from "nbook/shared/window-text-key";

import {descriptor} from "../plugin";
import {CAPTURE_TOKEN_HEADER, CAPTURE_UPLOAD_PATH, pageAgentWindowContract} from "../shared/contracts";
import type {PageFailureDetail} from "../shared/contracts";
import {findInCatalog} from "./catalog";
import type {CatalogCommand} from "./catalog";
import type {CaptureOutcome, ConnectPage, PageHighlight, PageSide} from "./page-side";

/** 浮层的贡献 id：引擎的挂载点。 */
export const ENGINE_OVERLAY = `${descriptor.id}.engine`;

function catalogCommand(commands: CommandService, text: TextPort, id: string): CatalogCommand | null {
    const found = commands.get(id);
    if (!found.ok) return null;
    const command = found.value;
    const enabled = commands.isEnabled(id);
    return {
        id,
        title: text.t(command.title),
        keybinding: command.keybinding === undefined ? null : formatKeybinding(command.keybinding, currentKeyPlatform()),
        palette: command.expose?.human !== false && runsWithoutArgs(command.args) && enabled.ok && enabled.value,
    };
}

/**
 * 凭服务端签发的凭证把截图传上去（docs/specs/agent/page-agent.md 输出 8）。凭证只在请求头里；调用被停止时 `signal` 取消上传，
 * 服务端那边凭证也已作废。
 */
async function uploadCapture(token: string, image: Blob, signal: AbortSignal): Promise<string | null> {
    let response: Response;
    try {
        response = await fetch(CAPTURE_UPLOAD_PATH, {method: "PUT", headers: {[CAPTURE_TOKEN_HEADER]: token, "content-type": "image/jpeg"}, body: image, signal});
    } catch (error) {
        return `上传截图失败：${error instanceof Error ? error.message : String(error)}`;
    }
    if (response.ok) return null;
    // 路由的失败正文是 `{error: {code, message}}`；读不出来时只报状态码。
    const body = await response.json().catch(() => null) as {error?: {message?: unknown}} | null;
    const message = typeof body?.error?.message === "string" ? body.error.message : null;
    return `上传截图失败（HTTP ${String(response.status)}）${message === null ? "" : `：${message}`}`;
}

export const pageAgentWebPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [
            {key: settingsKey},
            {key: commandServiceKey, required: false},
            {key: settingsCatalogKey, required: false},
            {key: workbenchCatalogKey, required: false},
            {key: windowTextKey, required: false},
        ],
        contributions: [{capability: WORKBENCH_OVERLAYS_POINT, id: ENGINE_OVERLAY, declaration: {}}],
        remoteProvides: [pageAgentWindowContract],
        activate: async (context) => {
            const settings = context.services.require(settingsKey);
            const text = await windowTextPort(context.services, () => displayLocale(settings));
            const resolvedOf = async <T>(key: ServiceKey<T>): Promise<T | null> => {
                const resolved = await context.services.resolve(key);
                return resolved.status === "resolved" ? resolved.instance : null;
            };
            const commands = await resolvedOf(commandServiceKey);
            const settingsCatalog = await resolvedOf(settingsCatalogKey);
            const workbenchCatalog = await resolvedOf(workbenchCatalogKey);

            let page: PageSide | null = null;
            const waiting = new Set<(page: PageSide) => void>();
            const connect: ConnectPage = (next) => {
                page = next;
                for (const resolve of [...waiting]) resolve(next);
                waiting.clear();
                return () => {
                    if (page === next) page = null;
                };
            };
            const ready = (signal: AbortSignal): Promise<PageSide> => {
                if (page !== null) return Promise.resolve(page);
                return new Promise<PageSide>((resolve, reject) => {
                    const onAbort = (): void => {
                        waiting.delete(settle);
                        reject(signal.reason);
                    };
                    const settle = (connected: PageSide): void => {
                        signal.removeEventListener("abort", onAbort);
                        resolve(connected);
                    };
                    waiting.add(settle);
                    signal.addEventListener("abort", onAbort, {once: true});
                });
            };

            const overlay: WorkbenchOverlayImplementation = {
                load: async () => {
                    const Engine = (await import("./engine/PageAgentEngine.vue")).default;
                    return defineComponent({name: "PageAgentOverlay", setup: () => () => h(Engine, {connect, text})});
                },
            };

            return {
                contributions: {[WORKBENCH_OVERLAYS_POINT]: {[ENGINE_OVERLAY]: overlay}},
                remote: [provideRemote(pageAgentWindowContract, () => ({
                    methods: {
                        info: async (_input, call) => call.ok((await ready(call.signal)).info()),
                        snapshot: async (input, call) => {
                            const side = await ready(call.signal);
                            let result: ReturnType<PageSide["snapshot"]>;
                            try {
                                result = side.snapshot(input);
                            } catch (error) {
                                // 引擎对写错的定位抛 TypeError；服务端发来之前已核对过，这里只兜住别的调用方。
                                if (error instanceof TypeError) return call.fail("invalid-locator", {message: error.message});
                                throw error;
                            }
                            if ("ok" in result) {
                                const detail = {message: result.message, ...result.details};
                                switch (result.code) {
                                    case "stale-ref": return call.fail("stale-ref", detail);
                                    case "ambiguous": return call.fail("ambiguous", detail);
                                    case "not-found": return call.fail("not-found", detail);
                                }
                            }
                            return call.ok({window: side.info(), snapshot: result});
                        },
                        find: async (input, call) => {
                            const side = await ready(call.signal);
                            const entries = findInCatalog({
                                settings: settingsCatalog?.read() ?? null,
                                workbench: workbenchCatalog?.read() ?? null,
                                command: (id) => (commands === null ? null : catalogCommand(commands, text, id)),
                                present: (locator) => side.present(locator),
                            }, input.query, input.kind, input.limit);
                            return call.ok({window: side.info(), entries});
                        },
                        capture: async (input, call) => {
                            const side = await ready(call.signal);
                            let outcome: CaptureOutcome;
                            try {
                                outcome = await side.capture(input.of);
                            } catch (error) {
                                if (error instanceof TypeError) return call.fail("invalid-locator", {message: error.message});
                                throw error;
                            }
                            if (!outcome.ok) {
                                const detail = {message: outcome.message, ...("details" in outcome ? outcome.details : {})};
                                switch (outcome.code) {
                                    case "stale-ref": return call.fail("stale-ref", detail);
                                    case "ambiguous": return call.fail("ambiguous", detail);
                                    case "not-found": return call.fail("not-found", detail);
                                    case "window-hidden": return call.fail("window-hidden", detail);
                                    case "capture-failed": return call.fail("capture-failed", detail);
                                }
                            }
                            const failed = await uploadCapture(input.token, outcome.image, call.signal);
                            if (failed !== null) return call.fail("capture-failed", {message: failed});
                            return call.ok({window: side.info(), target: outcome.target, width: outcome.width, height: outcome.height, warnings: [...outcome.warnings]});
                        },
                    },
                    events: {
                        /**
                         * 高亮（输出 9）：订阅一次高亮一次。业务失败交 `failed` 事件，不抛错；服务端收到结局或失败就退订，退订（signal）
                         * 撤掉还在的高亮。
                         */
                        highlight: {
                            subscribe: async (filter, sink, call) => {
                                const side = await ready(call.signal);
                                const fail = (code: "stale-ref" | "ambiguous" | "not-found" | "invalid-locator" | "window-hidden" | "guide-failed", message: string, details?: Omit<PageFailureDetail, "message">): void => {
                                    sink.next({kind: "failed", code, detail: {message: message.slice(0, 1024), ...details}});
                                };
                                if (!side.info().visible) {
                                    fail("window-hidden", "这个窗口现在看不见");
                                    return;
                                }
                                let handle: PageHighlight;
                                try {
                                    handle = side.highlight(filter);
                                } catch (error) {
                                    if (error instanceof TypeError) {
                                        fail("invalid-locator", error.message);
                                        return;
                                    }
                                    throw error;
                                }
                                call.signal.addEventListener("abort", () => handle.cancel(), {once: true});
                                void handle.installed.then((installed) => {
                                    if (installed !== null && !call.signal.aborted) sink.next({kind: "installed", window: side.info(), ...installed});
                                });
                                void handle.outcome.then((end) => {
                                    if (call.signal.aborted) return;
                                    if ("code" in end) fail(end.code, end.message, end.code === "guide-failed" ? undefined : end.details);
                                    else if (end.outcome !== "cancelled") sink.next({kind: "outcome", outcome: end});
                                });
                            },
                        },
                    },
                }))],
            };
        },
    })],
};
