import path from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig, env} from "prisma/config";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || moduleRoot);
process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;

export default defineConfig({
    schema: path.resolve(applicationRoot, "prisma", "schema.sqlite.prisma"),
    datasource: {
        url: env("DATABASE_URL"),
    },
    migrations: {
        path: path.resolve(applicationRoot, "prisma", "migrations", "sqlite"),
    },
});
