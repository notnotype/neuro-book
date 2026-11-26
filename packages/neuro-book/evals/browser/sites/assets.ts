/** 假站的静态资源：`pages/<站>/assets/<名>`，只认文件名里的字母、数字、点、横线与下划线。 */

import {join} from "node:path";

const TYPES: Readonly<Record<string, string>> = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"};

export async function serveAsset(site: string, name: string): Promise<Response> {
    const ext = name.slice(name.lastIndexOf("."));
    const type = TYPES[ext];
    if (!/^[\w.-]+$/u.test(name) || type === undefined) return new Response("not found", {status: 404});
    const file = Bun.file(join(import.meta.dir, "pages", site, "assets", name));
    if (!(await file.exists())) return new Response("not found", {status: 404});
    return new Response(file, {headers: {"content-type": type}});
}
