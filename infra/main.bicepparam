using './main.bicep'

// ---------------------------------------------------------------------------
// Non-secret configuration. Secrets are passed as inline overrides from the
// infra workflow so nothing sensitive is committed here.
// ---------------------------------------------------------------------------

// Must be globally unique — this becomes <name>.azurewebsites.net.
param webAppName = 'feature-dashboard'

param location = 'centralindia'

param tags = {
  workload: 'feature-dashboard'
  environment: 'shared'
  managedBy: 'bicep'
}

param linuxFxVersion = 'NODE|22-lts'

// Requires app.set('trust proxy', 1) in server/index.js. See main.bicep.
param nodeEnv = 'production'

// Repos or orgs to analyse, comma separated. The app caps a snapshot at 30 repos.
// Example: 'bhavanatantry16/Feature-dashboard,my-org/api,my-org/web'
param githubScope = ''

param githubApiBase = 'https://api.github.com'

// Branch-name keywords that drive the dev/test/UAT/prod columns in the
// dashboard. These are the only "environments" this deployment has.
param envDevKeys = 'dev,develop,development,staging-dev'
param envTestKeys = 'test,qa,testing,sit'
param envUatKeys = 'uat,staging,stage,preprod,pre-prod'
param envProdKeys = 'main,master,prod,production,release,live'

param cacheTtlSeconds = 60
param clientRefreshSeconds = 60

// Leave empty unless another origin calls this API from the browser.
param corsOrigins = ''

// gh-login:role pairs, comma separated. Example: 'bhavanatantry16:admin'
param rbacAssignments = ''

// GitHub OAuth client ID is not a secret; the matching secret is injected by CI.
// Leave empty to run on local accounts only.
param githubOAuthClientId = ''

// Optional Azure DevOps panels.
param azdoUrlDev = ''
param azdoUrlTest = ''
param azdoUrlProd = ''

// Optional email delivery for invites and password resets.
param appsScriptUrl = ''

param logRetentionDays = 30

// --- Secrets ---------------------------------------------------------------
// Read from the environment so values live in GitHub secrets, never in git.
// The infra workflow maps repository secrets onto these variable names.
//
// Each defaults to empty, and an empty value means "leave the vault alone" —
// so running this locally without the secrets exported is safe and will not
// wipe anything that is already configured.
// The DASH_ prefix is deliberate: GitHub Actions reserves GITHUB_* for its own
// environment variables, so the CI-side names cannot mirror the app's.
param githubToken = readEnvironmentVariable('DASH_GITHUB_TOKEN', '')
param sessionSecret = readEnvironmentVariable('DASH_SESSION_SECRET', '')
param githubWebhookSecret = readEnvironmentVariable('DASH_WEBHOOK_SECRET', '')
param githubOAuthClientSecret = readEnvironmentVariable('DASH_OAUTH_CLIENT_SECRET', '')
param azdoPat = readEnvironmentVariable('DASH_AZDO_PAT', '')
param appsScriptSecret = readEnvironmentVariable('DASH_APPS_SCRIPT_SECRET', '')
