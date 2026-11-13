/**
 * 自有服务端的输出写进文件（docs/specs/runtime/desktop-shell.md 输出 7）：超过上限时把当前文件改名为 `<名>.1.log`（覆盖旧的）
 * 后重新开始。标准输出与标准错误写同一个文件，按到达的先后。写入失败只记诊断，不影响服务端：管道一直要有人读，否则写满了
 * 服务端会被挡住。
 */

import {appendFileSync, existsSync, mkdirSync, renameSync, statSync} from "node:fs";
import {dirname} from "node:path";

export interface RotatingLog {
    write(chunk: Uint8Array): void;
}

export function rotatingLog(path: string, limitBytes: number, report: (event: string, error: unknown) => void): RotatingLog {
    mkdirSync(dirname(path), {recursive: true});
    let size = existsSync(path) ? statSync(path).size : 0;
    const rotated = path.replace(/\.log$/u, ".1.log");
    return {
        write(chunk) {
            try {
                if (size > 0 && size + chunk.byteLength > limitBytes) {
                    renameSync(path, rotated);
                    size = 0;
                }
                // 同步追加：输出量小（服务端的日志主要写自己的诊断文件），换来顺序与轮转不必再协调。
                appendFileSync(path, chunk);
                size += chunk.byteLength;
            } catch (error) {
                report("desktop.server-output.write-failed", error);
            }
        },
    };
}

/** 把一个可读流全部交给日志，读到结束为止。 */
export async function drainInto(stream: NodeJS.ReadableStream | undefined, log: RotatingLog): Promise<void> {
    if (stream === undefined) return;
    for await (const chunk of stream) log.write(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Uint8Array));
}
