/**
 * `pi-ai` 对 400、413 把请求全文写进 `~/.omp/logs/http-400-requests/`，再把路径写进错误文字（docs/specs/harness/models.md 输出 19）。
 * 它没有关闭的选项，所以这里按完整行取出这些路径、去掉这些行。行不一定在末尾：`openai-completions` 还会把服务商的 `metadata.raw`
 * 接在路径行后面，所以不能用 `pi-ai` 只处理末尾的 `stripRawHttpRequestDiagnostics`。
 * 这行的写法是 `pi-ai` 的内部约定，改了之后 `tests/models.test.ts` 的子进程用例会失败。
 */

const DUMP_PATH = "raw-http-request=";
const DUMP_FAILED = "raw-http-request-save-failed=";

export function takeRequestDumps(message: string): {readonly text: string; readonly paths: readonly string[]} {
    const paths: string[] = [];
    const kept = message.split("\n").filter((line) => {
        if (line.startsWith(DUMP_PATH)) {
            paths.push(line.slice(DUMP_PATH.length));
            return false;
        }
        return !line.startsWith(DUMP_FAILED);
    });
    return {text: kept.join("\n"), paths};
}
