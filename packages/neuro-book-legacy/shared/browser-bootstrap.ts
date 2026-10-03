import * as z from "zod";

export const BROWSER_BOOTSTRAP_PATH = "/api/runtime/browser-bootstrap";
export const BROWSER_PROTOCOL_VERSION = 1;
export const BROWSER_PLUGIN_SET_REVISION = "builtin-browser-v1";
export const WORKBENCH_BROWSER_ENTRY = {plugin: "nbook.workbench", entry: "browser"} as const;
export const FILES_BROWSER_ENTRY = {plugin: "nbook.files", entry: "browser"} as const;
export const WORKBENCH_VIEW_POINT = "workbench.view";
export const WORKBENCH_COMMAND_POINT = "workbench.command";

const BrowserManifestSchema = z.object({
    entry: z.string().min(1),
    activationEvents: z.array(z.enum(["onStartup"])),
    provides: z.array(z.string().min(1)),
    dependencies: z.array(z.string().min(1)),
    contributionPoints: z.array(z.object({id: z.string().min(1), implementation: z.enum(["required", "none"])}).strict()),
    receives: z.array(z.string().min(1)),
    contributions: z.array(z.object({capability: z.string().min(1), id: z.string().min(1)}).strict()),
}).strict();

export const BrowserBootstrapSchema = z.object({
    protocolVersion: z.number().int().positive(),
    revision: z.string().min(1),
    plugins: z.array(z.object({
        id: z.string().min(1),
        version: z.string().min(1),
        browser: BrowserManifestSchema,
    }).strict()),
}).strict();
export type BrowserBootstrap = z.infer<typeof BrowserBootstrapSchema>;
export type BrowserPlugin = BrowserBootstrap["plugins"][number];

// 固定集合不读取服务端装配对象；浏览器协议不能泄漏路径、数据库句柄或凭据。
export const BUILTIN_BROWSER_PLUGINS: readonly BrowserPlugin[] = [
    {
        id: WORKBENCH_BROWSER_ENTRY.plugin,
        version: "1.0.0",
        browser: {
            entry: WORKBENCH_BROWSER_ENTRY.entry,
            activationEvents: ["onStartup"],
            provides: ["nbook.workbench/browser"],
            dependencies: [],
            contributionPoints: [
                {id: WORKBENCH_VIEW_POINT, implementation: "required"},
                {id: WORKBENCH_COMMAND_POINT, implementation: "required"},
            ],
            receives: [WORKBENCH_VIEW_POINT, WORKBENCH_COMMAND_POINT],
            contributions: [],
        },
    },
    {
        id: FILES_BROWSER_ENTRY.plugin,
        version: "1.0.0",
        browser: {
            entry: FILES_BROWSER_ENTRY.entry,
            activationEvents: [],
            provides: ["nbook.files/browser"],
            dependencies: ["nbook.workbench/browser"],
            contributionPoints: [],
            receives: [],
            contributions: [
                {capability: WORKBENCH_VIEW_POINT, id: "nbook.files"},
                {capability: WORKBENCH_COMMAND_POINT, id: "nbook.view.refresh-files"},
            ],
        },
    },
];
