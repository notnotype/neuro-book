import {Command} from "commander";

type NovelPlatform = "qidian" | "fanqie";

type RankingOptions = {
    platform: NovelPlatform;
    board: string;
    baseUrl?: string;
};

type BookDetailOptions = {
    platform: NovelPlatform;
    bookId: string;
    baseUrl?: string;
};

const DEFAULT_BASE_URL = "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 15_000;

const program = new Command();

program
    .name("novel-data")
    .description("查询本地 NovelScope 缓存的小说榜单与书籍详情");

program
    .command("rankings")
    .description("查询平台最新保存的榜单快照，不触发采集")
    .requiredOption("--platform <platform>", "平台：qidian 或 fanqie", parsePlatform)
    .requiredOption("--board <board>", "榜单键，例如 yuepiao 或 0_1_1139")
    .option("--base-url <url>", "NovelScope 服务地址；覆盖环境变量 NOVEL_DATA_BASE_URL")
    .action(async (options: RankingOptions) => {
        const baseUrl = resolveBaseUrl(options.baseUrl);
        const data = await requestJson(
            baseUrl,
            `/v1/rankings/${encodeURIComponent(options.platform)}/${encodeURIComponent(options.board)}`,
        );
        printJson(data);
    });

program
    .command("book-detail")
    .description("按平台书号查询缓存书籍详情")
    .requiredOption("--platform <platform>", "平台：qidian 或 fanqie", parsePlatform)
    .requiredOption("--book-id <id>", "平台侧纯数字书号，即榜单条目的 externalBookId")
    .option("--base-url <url>", "NovelScope 服务地址；覆盖环境变量 NOVEL_DATA_BASE_URL")
    .action(async (options: BookDetailOptions) => {
        const baseUrl = resolveBaseUrl(options.baseUrl);
        const data = await requestJson(
            baseUrl,
            `/v1/books/${encodeURIComponent(options.platform)}/${encodeURIComponent(options.bookId)}`,
        );
        printJson(data);
    });

if (import.meta.main) {
    program.parseAsync().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

/** 校验平台参数，避免把未知平台请求发送给上游。 */
function parsePlatform(value: string): NovelPlatform {
    if (value === "qidian" || value === "fanqie") {
        return value;
    }
    throw new Error("platform 只支持 qidian 或 fanqie");
}

/** 按命令参数、环境变量、默认值的固定优先级解析并校验服务地址。 */
export function resolveBaseUrl(explicitBaseUrl?: string, environmentBaseUrl = process.env.NOVEL_DATA_BASE_URL): string {
    const candidate = explicitBaseUrl?.trim() || environmentBaseUrl?.trim() || DEFAULT_BASE_URL;
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        throw new Error(`NovelScope 服务地址无效：${candidate}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`NovelScope 服务地址只支持 http/https：${candidate}`);
    }
    return parsed.toString().replace(/\/$/u, "");
}

/** 请求只读 JSON 端点，并把网络错误与上游错误转为可操作的 CLI 错误。 */
async function requestJson(baseUrl: string, pathname: string): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(`${baseUrl}${pathname}`, {
            headers: {accept: "application/json"},
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法连接 NovelScope：${baseUrl}。请确认本地服务已启动。${detail}`);
    }
    if (!response.ok) {
        throw new Error(`NovelScope 请求失败（HTTP ${response.status}）：${await responseError(response)}`);
    }
    // HTTP 响应属于外部数据，保留 unknown 交给 JSON 输出，不在客户端伪造上游字段。
    return await response.json() as unknown;
}

/** 尽量提取上游 JSON message，非 JSON 响应回退为原始文本。 */
async function responseError(response: Response): Promise<string> {
    const responseText = (await response.text()).trim();
    if (!responseText) {
        return response.statusText || "上游未返回错误详情";
    }
    try {
        const parsed = JSON.parse(responseText) as {message?: unknown};
        return typeof parsed.message === "string" ? parsed.message : responseText;
    } catch {
        return responseText;
    }
}

/** 向 stdout 输出稳定、便于 Agent 阅读的格式化 JSON。 */
function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 4));
}
