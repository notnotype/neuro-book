-- Better Auth 自己导出的四张表的原文：better-auth 1.7.27，插件 username()、admin()，advanced.database.generateId = "serial"。
-- 导出方法：对一个空的 SQLite 库调 better-auth/db/migration 的 getMigrations(auth.options)，再取 compileMigrations() 的结果，
-- 原样放在下面（语句之间空一行，末尾一个换行）。src/db/schema.test.ts 照同样的做法现场导出一次与本文件比对。
--
-- 本文件不是迁移，不执行。它是升级库时的对照（ADR 0060 后果第三条）：
-- - 库升级以后“当前导出等于本文件”那条用例先失败。逐句对照新旧导出，库的表有变化时在新的迁移里手写增量，再把本文件换成新版本的导出、改上面的版本号。
-- - migrations/0001_init.sql 里库的四张表与本文件只差一处：每张表的 "id" integer not null primary key 换成 "id" integer primary key autoincrement（理由见那里）。同一个用例文件核对这一点。

create table "user" ("id" integer not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "username" text unique, "displayUsername" text, "role" text, "banned" integer, "banReason" text, "banExpires" date);

create table "session" ("id" integer not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" integer not null references "user" ("id") on delete cascade, "impersonatedBy" text);

create table "account" ("id" integer not null primary key, "accountId" text not null, "providerId" text not null, "userId" integer not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" integer not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");
