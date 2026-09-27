// Startup diagnostics deliberately print only our own messages and allowlisted
// codes. Never print error.message, error.stack, response bodies or environment
// variable values: connection strings, HTTP errors and SDK errors can contain secrets.
const stages = new Set([
  "DATABASE_CONFIG",
  "DATABASE_SCHEMA",
  "DATABASE_SEED",
  "HOST_SETUP",
  "MEDIA_CONFIG",
  "MEDIA_BUCKET_LOOKUP",
  "MEDIA_BUCKET_CREATE",
  "MEDIA_BUCKET_VALIDATE",
  "SERVER_STARTUP",
  "SERVER_LISTEN",
]);
const messages = {
  CONFIG_DATABASE_URL:
    "DATABASE_URL is not a valid PostgreSQL URI. Paste the plain Session pooler URI, without quotes, Markdown or http:// links.",
  CONFIG_DATABASE_PASSWORD_MISSING:
    "DATABASE_URL is missing its Supabase database username or password. Copy the Session pooler URI and replace its password placeholder privately in Render.",
  CONFIG_DATABASE_PLACEHOLDER:
    "DATABASE_URL still contains the YOUR-PASSWORD placeholder. Replace it privately in Render with the URL-encoded database password.",
  CONFIG_DATABASE_CA:
    "DATABASE_CA_CERT must contain the complete PEM certificate, including BEGIN CERTIFICATE and END CERTIFICATE lines; not a filename or download link.",
  CONFIG_MEDIA_URL:
    "SUPABASE_URL must be the HTTPS Project URL, not the Supabase dashboard URL or a PostgreSQL connection string. Remove quotes and extra spaces.",
  CONFIG_MEDIA_KEY_MISSING:
    "SUPABASE_SERVICE_KEY is missing. Add the server secret from the same Supabase project directly in Render.",
  CONFIG_MEDIA_KEY_TYPE:
    "SUPABASE_SERVICE_KEY must be an sb_secret_ server key or a legacy service_role key. Do not use the publishable/anon key, quotation marks or extra whitespace.",
  CONFIG_MEDIA_BUCKET:
    "SUPABASE_MEDIA_BUCKET must use lowercase letters, digits and hyphens only; use quizzes-media for this app.",
  HOST_SETUP_CONFIG:
    "Check INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD and ORGANIZATION_NAME. Use a valid email, a 12-128 character host password and a nonempty organization name.",
  MEDIA_BUCKET_PUBLIC:
    "The configured media bucket is public. Make this dedicated bucket private, or configure a new private bucket.",
  MEDIA_RESPONSE_INVALID:
    "The media service returned an unexpected response. Verify SUPABASE_URL points to the intended project and that the project is running.",
};
function startupError(code, stage, cause) {
  const error = new Error("Startup configuration check failed.");
  error.code = code;
  error.startupStage = stage;
  if (cause) error.cause = cause;
  return error;
}
function describeStartupFailure(defaultStage, error) {
  const stage = stages.has(error?.startupStage)
    ? error.startupStage
    : stages.has(defaultStage)
      ? defaultStage
      : "SERVER_STARTUP";
  const chain = [];
  let next = error;
  for (
    let i = 0;
    i < 6 && next && !chain.includes(next);
    i++, next = next.cause
  )
    chain.push(next);
  const codes = chain.map((x) => x.code);
  const own = codes.find((c) => Object.hasOwn(messages, c));
  if (own) return { stage, code: own, reason: messages[own] };
  const has = (...values) => values.some((v) => codes.includes(v));
  // Inspect text only to choose a fixed safe explanation; never include it in output.
  const text = chain
    .map((x) => (typeof x.message === "string" ? x.message : ""))
    .join(" ")
    .toLowerCase();
  let code = "UNKNOWN",
    reason =
      "Startup did not complete. Share this diagnostic code and stage only; do not share credentials or environment values.";
  if (
    has(
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    )
  ) {
    code = "TLS_UNTRUSTED";
    reason =
      "The TLS certificate chain is not trusted. For the database, add the Supabase CA certificate as DATABASE_CA_CERT in Render. Keep TLS verification enabled.";
  } else if (
    has(
      "CERT_HAS_EXPIRED",
      "CERT_NOT_YET_VALID",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
    )
  ) {
    code = "TLS_CERTIFICATE_INVALID";
    reason =
      "The TLS certificate is expired, not yet valid or does not match the endpoint. Check the connection host and current provider certificate; do not disable verification.";
  } else if (
    has(
      "ERR_OSSL_PEM_NO_START_LINE",
      "ERR_OSSL_ASN1_TOO_LONG",
      "ERR_OSSL_ASN1_HEADER_TOO_LONG",
    )
  ) {
    code = "TLS_CA_FORMAT";
    reason =
      "The custom CA certificate could not be parsed. Paste its complete PEM contents into DATABASE_CA_CERT, not a filename, URL or quoted string.";
  } else if (text.includes("tenant or user not found")) {
    code = "DB_POOLER_IDENTITY";
    reason =
      "Supabase could not find this pooler tenant/user. Recopy the Session pooler URI from this project, including its exact username and host.";
  } else if (
    text.includes("too many authentication errors") ||
    text.includes("circuit breaker open")
  ) {
    code = "DB_AUTH_THROTTLED";
    reason =
      "The database pooler is temporarily rejecting repeated authentication attempts. Correct DATABASE_URL credentials, allow the cooldown to pass, then redeploy.";
  } else if (has("28P01") || text.includes("password authentication failed")) {
    code = "DB_AUTH_FAILED";
    reason =
      "PostgreSQL rejected the database credentials. Use the Supabase database password, not the host-login password, and URL-encode the password portion of DATABASE_URL.";
  } else if (has("28000")) {
    code = "DB_ACCESS_DENIED";
    reason =
      "PostgreSQL rejected this connection. Check the Session pooler username, project status and database network restrictions.";
  } else if (has("42501")) {
    code = "DB_PERMISSION_DENIED";
    reason =
      "The database user lacks permission to create or access the private app schema. Use the project Session pooler credentials from Supabase Connect.";
  } else if (has("ENOTFOUND", "EAI_AGAIN")) {
    code = "DNS_LOOKUP_FAILED";
    reason =
      "The configured service hostname could not be resolved. Recopy the endpoint from the provider dashboard and check that the project is active.";
  } else if (has("ENETUNREACH", "EHOSTUNREACH")) {
    code = "NETWORK_UNREACHABLE";
    reason =
      "The service endpoint is not reachable from this host. For Supabase PostgreSQL use the IPv4-compatible Session pooler, not the direct IPv6 endpoint.";
  } else if (
    has("ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT") ||
    chain.some((x) => x.name === "TimeoutError") ||
    text.includes("connection timeout") ||
    text.includes("timeout expired") ||
    text.includes("connection terminated unexpectedly")
  ) {
    code = "CONNECTION_UNAVAILABLE";
    reason =
      "The service connection timed out, was refused or was interrupted. Check for a paused Supabase project, network restrictions and the exact endpoint/port.";
  } else if (has("MODULE_NOT_FOUND")) {
    code = "DEPLOYMENT_FILE_MISSING";
    reason =
      stage === "DATABASE_SEED"
        ? "The bundled sample file could not be loaded. Confirm seed-quiz.json is committed at the repository root."
        : "A required application file is missing. Upload all extracted source files and redeploy the latest commit.";
  } else if (has("EACCES", "EROFS", "SQLITE_CANTOPEN")) {
    code = "LOCAL_STORAGE_UNWRITABLE";
    reason =
      "Local storage is unavailable. On Render, configure PostgreSQL and Supabase media rather than relying on local files.";
  } else if (has("EADDRINUSE")) {
    code = "PORT_IN_USE";
    reason = "Another process is already using the configured listening port.";
  } else if (has("42P01", "42601", "42703", "23505")) {
    code = "DATABASE_SCHEMA_ERROR";
    reason =
      "Database schema initialization or bootstrap conflicted with existing data. Do not delete the project; share this stage/code for a migration review.";
  } else {
    const status = chain
      .map((x) => x.startupHttpStatus)
      .find((s) => Number.isInteger(s) && s >= 400 && s <= 599);
    if (status) {
      code = "MEDIA_HTTP_" + status;
      reason = [401, 403].includes(status)
        ? "Supabase Storage rejected server access. Check that SUPABASE_SERVICE_KEY is a server secret from the same project as SUPABASE_URL."
        : status === 429
          ? "Supabase Storage is rate-limiting requests. Check project usage and retry after the limit clears."
          : status >= 500
            ? "Supabase Storage reported a service error. Check the project is active and the provider service status."
            : status === 404
              ? "The media endpoint or bucket was not found. Confirm the project URL and bucket configuration."
              : "Supabase Storage rejected the bucket request. Check the project URL, server secret and bucket configuration.";
    }
  }
  return { stage, code, reason };
}
function logStartupFailure(stage, error, logger = console.error) {
  const result = describeStartupFailure(stage, error);
  logger(
    `Startup check failed [${result.stage}] [${result.code}]: ${result.reason}`,
  );
  return result;
}
function loadStartupModule(name, stage) {
  try {
    return require(name);
  } catch (error) {
    logStartupFailure(stage, error);
    process.exit(1);
  }
}
async function checkStartup(
  checks,
  logger = console.log,
  errorLogger = console.error,
) {
  const results = await Promise.allSettled(checks.map((c) => c.promise));
  let healthy = true;
  results.forEach((r, i) => {
    if (r.status === "fulfilled")
      logger(`Startup check passed [${checks[i].stage}]`);
    else {
      healthy = false;
      logStartupFailure(checks[i].stage, r.reason, errorLogger);
    }
  });
  return healthy;
}
module.exports = {
  startupError,
  describeStartupFailure,
  logStartupFailure,
  loadStartupModule,
  checkStartup,
};
