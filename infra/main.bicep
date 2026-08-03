// ---------------------------------------------------------------------------
// Feature Dashboard — single-environment Azure hosting.
//
// One App Service (Linux, Node 22) on a Basic B1 plan. Deliberately ONE
// instance and ONE environment:
//
//   * express-session runs on the default in-memory MemoryStore, so a second
//     instance would log users out at random.
//   * userStore / inviteStore / bugStore / roadmapService persist to flat JSON
//     files, which only works with a single writer.
//
// Dev / test / UAT / prod are dimensions *inside* the dashboard — the
// ENV_*_KEYS settings map GitHub branch names to columns. They are not
// separate deployments, so one App Service covers all of them.
// ---------------------------------------------------------------------------

targetScope = 'resourceGroup'

// --- Naming and placement ---------------------------------------------------

@description('Web app name. Becomes <name>.azurewebsites.net, so it must be globally unique.')
@minLength(2)
@maxLength(40)
param webAppName string = 'feature-dashboard'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Tags applied to every resource.')
param tags object = {
  workload: 'feature-dashboard'
  environment: 'shared'
}

// --- Runtime ----------------------------------------------------------------

@description('Node.js runtime. package.json requires >=18.17; 22-lts is current LTS on App Service.')
param linuxFxVersion string = 'NODE|22-lts'

@description('''
NODE_ENV value.

Keep 'production' ONLY once server/index.js calls app.set('trust proxy', 1).
App Service terminates TLS at its front end and forwards plain HTTP to the
container. authService.js sets cookie.secure = true when NODE_ENV is
'production', and without trust proxy express-session sees an insecure
connection, declines to send the cookie, and every login silently fails.

'development' is the escape hatch if you cannot patch the app yet — it drops
the cookie to secure:false, which still works fine over HTTPS.
''')
@allowed([
  'production'
  'development'
])
param nodeEnv string = 'production'

// --- GitHub data source -----------------------------------------------------

@description('Comma-separated repos (owner/repo) or org names to analyse. The app caps a snapshot at 30 repos.')
param githubScope string = ''

@description('GitHub API base. Change only for GitHub Enterprise Server.')
param githubApiBase string = 'https://api.github.com'

@description('''
GitHub PAT: repo (read), read:org, read:user. Held in Key Vault and surfaced to
the app as a Key Vault reference.

Empty means "leave whatever is already in the vault alone" — so a re-run that
does not supply the token cannot blank it. On a first deploy with no token the
dashboard boots but has no data (demo mode at /?demo=1 still works).
''')
@secure()
param githubToken string = ''

@description('Shared secret for the /api/webhooks/github receiver. Empty disables webhooks and the app falls back to 60s polling.')
@secure()
param githubWebhookSecret string = ''

// --- Sessions and auth ------------------------------------------------------

@description('''
express-session signing secret.

Leave empty and the app generates one on first boot and persists it to
.settings.json under DATA_DIR, which survives restarts and deployments now that
DATA_DIR points at /home. Supply one only if you want it managed centrally.
''')
@secure()
param sessionSecret string = ''

@description('GitHub OAuth app client ID. Leave empty to use local accounts only.')
param githubOAuthClientId string = ''

@description('GitHub OAuth app client secret. Required if githubOAuthClientId is set.')
@secure()
param githubOAuthClientSecret string = ''

// --- Optional integrations --------------------------------------------------

@description('Azure DevOps project URL for the dev environment column. Optional.')
param azdoUrlDev string = ''

@description('Azure DevOps project URL for the test environment column. Optional.')
param azdoUrlTest string = ''

@description('Azure DevOps project URL for the production environment column. Optional.')
param azdoUrlProd string = ''

@description('Azure DevOps PAT covering all three project URLs. Optional.')
@secure()
param azdoPat string = ''

@description('Google Apps Script endpoint used to deliver invites and password resets. Optional.')
param appsScriptUrl string = ''

@description('Shared secret for the Apps Script endpoint. Optional.')
@secure()
param appsScriptSecret string = ''

// --- Dashboard behaviour ----------------------------------------------------

@description('Branch-name keywords that map to the dev column.')
param envDevKeys string = 'dev,develop,development,staging-dev'

@description('Branch-name keywords that map to the test column.')
param envTestKeys string = 'test,qa,testing,sit'

@description('Branch-name keywords that map to the UAT column.')
param envUatKeys string = 'uat,staging,stage,preprod,pre-prod'

@description('Branch-name keywords that map to the production column.')
param envProdKeys string = 'main,master,prod,production,release,live'

@description('Server-side cache TTL in seconds.')
param cacheTtlSeconds int = 60

@description('Client polling interval in seconds, used when webhooks are unavailable.')
param clientRefreshSeconds int = 60

@description('Comma-separated CORS origins. Leave empty unless another origin calls the API.')
param corsOrigins string = ''

@description('Role assignments as gh-login:role pairs, comma separated. Example: octocat:admin,hubot:viewer')
param rbacAssignments string = ''

@description('Log Analytics retention in days.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${webAppName}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: logRetentionDays
    features: {
      searchVersion: 1
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${webAppName}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    // Workspace-based: classic Application Insights is retired.
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

// ---------------------------------------------------------------------------
// Key Vault — every secret lives here; app settings only carry references.
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  // Vault names are globally unique and capped at 24 characters.
  name: 'kv-${uniqueString(resourceGroup().id, webAppName)}'
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    // RBAC rather than access policies: one less parallel permission model.
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // Purge protection is irreversible once enabled. It also means a vault of
    // this name cannot be recreated for 90 days after deletion — expected, and
    // the reason the name is derived from the resource group id rather than
    // being hand-picked.
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// Every secret is written only when a value is supplied, and the matching app
// setting is only emitted alongside it. Two reasons:
//
//   1. Re-running the template without a value leaves the existing secret
//      untouched instead of blanking it.
//   2. A Key Vault reference pointing at a secret that does not exist fails to
//      resolve, and App Service then hands the app the raw
//      "@Microsoft.KeyVault(...)" string as the value. For SESSION_SECRET that
//      would silently become the signing key.
resource secretGithubToken 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(githubToken)) {
  parent: keyVault
  name: 'github-token'
  properties: {
    value: githubToken
  }
}

resource secretSessionSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(sessionSecret)) {
  parent: keyVault
  name: 'session-secret'
  properties: {
    value: sessionSecret
  }
}

resource secretWebhook 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(githubWebhookSecret)) {
  parent: keyVault
  name: 'github-webhook-secret'
  properties: {
    value: githubWebhookSecret
  }
}

resource secretOAuthClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(githubOAuthClientSecret)) {
  parent: keyVault
  name: 'github-oauth-client-secret'
  properties: {
    value: githubOAuthClientSecret
  }
}

resource secretAzdoPat 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(azdoPat)) {
  parent: keyVault
  name: 'azdo-pat'
  properties: {
    value: azdoPat
  }
}

resource secretAppsScript 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(appsScriptSecret)) {
  parent: keyVault
  name: 'apps-script-secret'
  properties: {
    value: appsScriptSecret
  }
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-${webAppName}'
  location: location
  tags: tags
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  kind: 'linux'
  properties: {
    // 'reserved' is what makes an App Service plan Linux.
    reserved: true
  }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    // Used to read Key Vault. No secret to rotate, nothing stored in GitHub.
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // Insurance only — the app is pinned to one instance, but if that ever
    // changes, ARR affinity keeps a user pinned to the worker holding their
    // in-memory session.
    clientAffinityEnabled: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      // The flat-file stores call writeFileSync straight onto DATA_DIR without
      // creating it first, so an absent /home/data crashes the process on boot
      // (ENOENT on .users.json, from ensureBootstrapAdmin). Creating it here
      // keeps that self-healing rather than a one-off manual step.
      appCommandLine: 'mkdir -p /home/data && node server/index.js'
      // Required: the in-memory TTL cache and open SSE streams do not survive
      // the platform unloading an idle app.
      alwaysOn: true
      numberOfWorkers: 1
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      // SSE (/api/events) is plain HTTP streaming, not WebSockets.
      webSocketsEnabled: false
      // /healthz is the one route the app leaves anonymous (server/index.js
      // allow-lists it ahead of the auth redirect), so it is safe to probe.
      // With a single instance App Service restarts it when unhealthy rather
      // than pulling it from rotation.
      healthCheckPath: '/healthz'
      httpLoggingEnabled: true
      detailedErrorLoggingEnabled: true
      requestTracingEnabled: false
    }
    // appSettings live in the child resource below so they can be ordered
    // after the Key Vault role assignment.
  }
}

// ---------------------------------------------------------------------------
// Authorisation — the app's identity reads secrets from the vault.
// ---------------------------------------------------------------------------

@description('Built-in Key Vault Secrets User role.')
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, web.id, keyVaultSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

// Versionless secret URIs, so rotating a secret in the vault propagates
// without redeploying the app.
var kvSecretPrefix = '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/'
var appUrl = 'https://${web.properties.defaultHostName}'

var coreSettings = {
  NODE_ENV: nodeEnv
  // Without this, flat-file state lands in /home/site/wwwroot and is wiped by
  // every deployment. /home is Azure Files-backed and persists.
  DATA_DIR: '/home/data'
  APP_URL: appUrl

  // Dependencies are installed on the CI runner and shipped in the zip, so
  // Oryx has nothing to do at deploy time.
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  ENABLE_ORYX_BUILD: 'false'

  GITHUB_API_BASE: githubApiBase
  GITHUB_SCOPE: githubScope

  ENV_DEV_KEYS: envDevKeys
  ENV_TEST_KEYS: envTestKeys
  ENV_UAT_KEYS: envUatKeys
  ENV_PROD_KEYS: envProdKeys

  CACHE_TTL_SECONDS: string(cacheTtlSeconds)
  CLIENT_REFRESH_SECONDS: string(clientRefreshSeconds)
  CORS_ORIGINS: corsOrigins
  RBAC_ASSIGNMENTS: rbacAssignments
}

var monitoringSettings = {
  APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
  // '~3' is the Linux Node.js agent line. Auto-instrumentation means no SDK
  // changes in the app itself.
  ApplicationInsightsAgent_EXTENSION_VERSION: '~3'
}

var tokenSettings = empty(githubToken) ? {} : {
  GITHUB_TOKEN: '${kvSecretPrefix}github-token/)'
}

var sessionSettings = empty(sessionSecret) ? {} : {
  SESSION_SECRET: '${kvSecretPrefix}session-secret/)'
}

var webhookSettings = empty(githubWebhookSecret) ? {} : {
  GITHUB_WEBHOOK_SECRET: '${kvSecretPrefix}github-webhook-secret/)'
}

// Gated on both halves: emitting the reference without the vault secret behind
// it would hand the app the literal "@Microsoft.KeyVault(...)" string.
var oauthSettings = (empty(githubOAuthClientId) || empty(githubOAuthClientSecret)) ? {} : {
  GITHUB_OAUTH_CLIENT_ID: githubOAuthClientId
  GITHUB_OAUTH_CLIENT_SECRET: '${kvSecretPrefix}github-oauth-client-secret/)'
  GITHUB_OAUTH_CALLBACK_URL: '${appUrl}/api/auth/github/callback'
}

var azdoSettings = empty(azdoPat) ? {} : {
  AZDO_PAT: '${kvSecretPrefix}azdo-pat/)'
  AZDO_URL_DEV: azdoUrlDev
  AZDO_URL_TEST: azdoUrlTest
  AZDO_URL_PROD: azdoUrlProd
}

var emailSettings = (empty(appsScriptUrl) || empty(appsScriptSecret)) ? {} : {
  APPS_SCRIPT_URL: appsScriptUrl
  APPS_SCRIPT_SECRET: '${kvSecretPrefix}apps-script-secret/)'
}

resource webAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: web
  name: 'appsettings'
  properties: union(
    coreSettings,
    monitoringSettings,
    tokenSettings,
    sessionSettings,
    webhookSettings,
    oauthSettings,
    azdoSettings,
    emailSettings
  )
  dependsOn: [
    // Key Vault references resolve when the app starts. Without this ordering
    // the first boot races the role assignment and every reference reads empty.
    kvSecretsUser
    secretGithubToken
    secretSessionSecret
    secretWebhook
    secretOAuthClientSecret
    secretAzdoPat
    secretAppsScript
  ]
}

resource webLogs 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: web
  name: 'logs'
  properties: {
    applicationLogs: {
      fileSystem: {
        level: 'Information'
      }
    }
    httpLogs: {
      fileSystem: {
        enabled: true
        retentionInDays: 7
        retentionInMb: 35
      }
    }
    detailedErrorMessages: {
      enabled: true
    }
    failedRequestsTracing: {
      enabled: false
    }
  }
}

resource webDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: web
  name: 'to-log-analytics'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        category: 'AppServiceHTTPLogs'
        enabled: true
      }
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
      {
        category: 'AppServiceAppLogs'
        enabled: true
      }
      {
        category: 'AppServicePlatformLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output webAppName string = web.name
output webAppUrl string = appUrl
output webhookUrl string = '${appUrl}/api/webhooks/github'
output oauthCallbackUrl string = '${appUrl}/api/auth/github/callback'
output keyVaultName string = keyVault.name
output appInsightsName string = appInsights.name
output principalId string = web.identity.principalId
