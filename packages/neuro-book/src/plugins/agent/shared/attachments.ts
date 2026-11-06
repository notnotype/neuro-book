/** 单个附件的上限（开发者 2026-11-06）：防误传，不是用量控制。浏览器先查一次，服务端边读边数。 */
export const ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
