import {readFile} from "node:fs/promises";
import {join} from "node:path";

const DESKTOP_CAPABILITY_SCHEMA = "nbook.desktop-capability/v1";
const DESKTOP_BRIDGE_SCHEMA = "nbook.desktop-bridge/v2";

type PackageManifest = {
    version?: string;
};

/** 远端 Desktop 启动前读取的只读兼容能力；不返回 State、凭据或宿主路径。 */
export default defineEventHandler(async () => ({
    schema: DESKTOP_CAPABILITY_SCHEMA,
    productVersion: await readProductVersion(),
    bridgeSchemas: [DESKTOP_BRIDGE_SCHEMA] as [typeof DESKTOP_BRIDGE_SCHEMA],
    supportsRemoteDesktop: true as const,
}));

async function readProductVersion(): Promise<string> {
    for (const path of [join(process.cwd(), "package.json"), join(process.cwd(), ".output", "server", "package.json")]) {
        try {
            const value = JSON.parse(await readFile(path, "utf8")) as PackageManifest;
            if (typeof value.version === "string" && value.version.trim()) return value.version;
        } catch {
            continue;
        }
    }
    return "unknown";
}
