-- 账号模块的第二条迁移：对外 OAuth 服务（docs/specs/site/oauth-provider.md）要的库的表，只有库的表。社交登录自家的两张表在 0003。
-- 发布后不改（发布之前，第 3 片之后的审查定稿前可改）。
--
-- 来源：better-auth 1.7.27 加 @better-auth/oauth-provider 1.7.27，在本包的装配下（src/auth.ts：jwt、oauthProvider 插件，
-- advanced.database.generateId = "serial"）库对空库导出的结构里新增的 8 张表与 15 个索引，导出方法与全文在
-- schema/better-auth-baseline.sql。与 0001 同一个规则，只改一处：每张表的 "id" integer not null primary key 换成
-- "id" integer primary key autoincrement，别的一个字不改，不加 STRICT。外键照库的原文（on delete cascade、on delete set null），
-- 与 0001 里库的表一样原样保留。src/db/schema.test.ts 核对“只差这一处”。
--
-- 为什么全部自增：不加 AUTOINCREMENT 时 SQLite 把刚删掉的最大 id 发给下一行（t08 第六轮探针：删掉最新的会话再登录，新会话拿到
-- 旧会话的 id）。这几张表的 id 有的对外可见（签名钥的 id 是 id_token 头里的 kid，客户端按它缓存公钥），有的被别的行与审计引用
-- （oauthClient 的 id 进审计），重用会让旧的引用对上新的行。与 0001 一样一律自增，不逐张判断。
--
-- 没有调用方的 oauthResource、oauthClientResource、oauthClientAssertion 与 oauthRefreshToken（本站不发刷新令牌）也建：库按
-- 装配登记了它们，建全免得以后为库的结构检查补迁移。

-- 签 id_token 的钥匙。id 是 kid；privateKey 是用会话密钥加密的私钥；alg 只许 RS256（启动检查，src/oauth/signing-key.ts）；
-- expiresAt 为空是活钥，换会话密钥后解不开的旧钥被标成过期、留在公钥地址里过宽限期。
create table "jwks" ("id" integer primary key autoincrement, "publicKey" text not null, "privateKey" text not null, "createdAt" date not null, "expiresAt" date, "alg" text, "crv" text);

-- 对外 OAuth 的客户端，只经管理接口登记。clientSecret 是密钥的哈希（src/oauth/client-secret.ts）。
create table "oauthClient" ("id" integer primary key autoincrement, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" integer, "skipConsent" integer, "enableEndSession" integer, "subjectType" text, "scopes" text, "clientCredentialsScopes" text, "userId" integer references "user" ("id") on delete cascade, "createdAt" date, "updatedAt" date, "name" text, "uri" text, "icon" text, "contacts" text, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" text not null, "postLogoutRedirectUris" text, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" integer, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" text, "responseTypes" text, "requirePKCE" integer, "dpopBoundAccessTokens" integer, "referenceId" text, "metadata" text);

-- 资源服务器（本站不配，库要这张表）。
create table "oauthResource" ("id" integer primary key autoincrement, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" text, "customClaims" text, "dpopBoundAccessTokensRequired" integer, "disabled" integer, "createdAt" date, "updatedAt" date, "policyVersion" integer, "metadata" text);

-- 客户端与资源服务器的对应（本站不配）。
create table "oauthClientResource" ("id" integer primary key autoincrement, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "resourceId" text not null references "oauthResource" ("identifier") on delete cascade, "metadata" text, "createdAt" date);

-- 刷新令牌（本站只有授权码一种授权方式，不发）。
create table "oauthRefreshToken" ("id" integer primary key autoincrement, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" integer references "session" ("id") on delete set null, "userId" integer not null references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "rotatedAt" date, "rotationReplayResponse" text, "rotationReplayExpiresAt" date, "authTime" date, "confirmation" text, "scopes" text not null);

-- 访问令牌，token 存哈希；sessionId 指向签发时的会话，撤销按会话找令牌（计划 3.5）。
create table "oauthAccessToken" ("id" integer primary key autoincrement, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" integer references "session" ("id") on delete set null, "userId" integer references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "refreshId" integer references "oauthRefreshToken" ("id") on delete cascade, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "confirmation" text, "scopes" text not null);

-- 账号对客户端的授权记录。
create table "oauthConsent" ("id" integer primary key autoincrement, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "userId" integer references "user" ("id") on delete cascade, "referenceId" text, "resources" text, "requestedUserInfoClaims" text, "scopes" text not null, "createdAt" date not null, "updatedAt" date not null);

-- 客户端断言的单次使用记录（本站不收 private_key_jwt，库要这张表）。
create table "oauthClientAssertion" ("id" integer primary key autoincrement, "expiresAt" date not null);

create index "oauthClient_userId_idx" on "oauthClient" ("userId");

create index "oauthClientResource_clientId_idx" on "oauthClientResource" ("clientId");

create index "oauthClientResource_resourceId_idx" on "oauthClientResource" ("resourceId");

create index "oauthRefreshToken_clientId_idx" on "oauthRefreshToken" ("clientId");

create index "oauthRefreshToken_sessionId_idx" on "oauthRefreshToken" ("sessionId");

create index "oauthRefreshToken_userId_idx" on "oauthRefreshToken" ("userId");

create index "oauthRefreshToken_authorizationCodeId_idx" on "oauthRefreshToken" ("authorizationCodeId");

create index "oauthAccessToken_clientId_idx" on "oauthAccessToken" ("clientId");

create index "oauthAccessToken_sessionId_idx" on "oauthAccessToken" ("sessionId");

create index "oauthAccessToken_userId_idx" on "oauthAccessToken" ("userId");

create index "oauthAccessToken_authorizationCodeId_idx" on "oauthAccessToken" ("authorizationCodeId");

create index "oauthAccessToken_refreshId_idx" on "oauthAccessToken" ("refreshId");

create index "oauthConsent_clientId_idx" on "oauthConsent" ("clientId");

create index "oauthConsent_userId_idx" on "oauthConsent" ("userId");

create unique index "oauthClientResource_clientId_resourceId_uidx" on "oauthClientResource" ("clientId", "resourceId");
