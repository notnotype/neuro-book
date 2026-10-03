import {sendStream, setResponseHeader} from "h3";
import {createAppLogsZipStream} from "nbook/server/app-logs/archive";
import {encodeRfc5987Filename} from "nbook/server/utils/rfc5987";

/**
 * 下载错误报告日志包。日志包只包含 logs/ 和 manifest.json。
 */
export default defineEventHandler(async (event) => {
    const archive = await createAppLogsZipStream();
    const filename = encodeRfc5987Filename(archive.filename);

    setResponseHeader(event, "Content-Type", "application/zip");
    setResponseHeader(event, "Content-Disposition", `attachment; filename="${archive.filename}"; filename*=UTF-8''${filename}`);
    return sendStream(event, archive.stream);
});
