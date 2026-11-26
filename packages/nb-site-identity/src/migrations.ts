/// <reference path="../types/sql.d.ts" />
// 上面的引用让导入本包源码的包（nb-site-server 的类型检查）也认得 `*.sql`：它们的 tsconfig 不含本包的 types/。

/**
 * 账号模块的迁移清单。每条是 `migrations/NNNN_<名字>.sql`，按编号从小到大逐个以文字导入，例如
 * `import init from "../migrations/0001_init.sql" with {type: "text"};`：`bun build` 把文字内联进产物，镜像里不用带迁移目录。
 * 文件的写法与执行规则见 `nb-site-server/AGENTS.md` 的“迁移”；漏列的文件由 `migrations.test.ts` 抓到。
 */

import init from "../migrations/0001_init.sql" with {type: "text"};
import oauth from "../migrations/0002_oauth.sql" with {type: "text"};
import social from "../migrations/0003_social.sql" with {type: "text"};
import sessionBanGuard from "../migrations/0004_session_ban_guard.sql" with {type: "text"};

export interface IdentityMigration {
    /** 去掉 `.sql` 的文件名，例如 `0001_init`；写进库里的迁移账本，发布后不能改。 */
    readonly id: string;
    readonly sql: string;
}

export const identityMigrations: readonly IdentityMigration[] = [
    {id: "0001_init", sql: init},
    {id: "0002_oauth", sql: oauth},
    {id: "0003_social", sql: social},
    {id: "0004_session_ban_guard", sql: sessionBanGuard},
];
