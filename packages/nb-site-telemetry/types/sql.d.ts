// 迁移文件以文字导入（`with {type: "text"}`），`bun build` 把内容内联进产物；Bun 自带的类型只声明了 .txt 等几种扩展名。
declare module "*.sql" {
    const text: string;
    export default text;
}
