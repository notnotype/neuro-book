import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {withStorageHttpError} from "nbook/server/storage/http-error";
import {releaseStorageProjectContext} from "nbook/server/storage/host";

/**
 * 释放当前浏览器客户端的 project 访问上下文；重复释放幂等成功，不删除 data 中的记录。
 *
 * 释放不重新解析 ready，因此 Project 已经关闭时仍然成功；归属只按当前 data 主体与客户端核对。
 */
export default defineEventHandler(async (event) => withStorageHttpError(() => (
    withProjectHttpError(() => releaseStorageProjectContext(event))
)));
