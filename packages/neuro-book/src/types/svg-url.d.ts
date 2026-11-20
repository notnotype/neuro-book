/** Vite 的 `?url` 资源导入：服务商图标的地址表（`urls.ts`）用。后端的类型检查也覆盖 `src/ui`，所以这里声明，不依赖 `vite/client`。 */
declare module "*.svg?url" {
    const src: string;
    export default src;
}
