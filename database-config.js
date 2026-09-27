const { rootCertificates } = require("node:tls");
const { startupError } = require("./startup-diagnostics");

// Build explicit pg fields. Do not pass connectionString as well: pg gives URL
// query parameters precedence over separately supplied authentication/TLS fields.
function databaseConfig(env = process.env) {
  let address;
  const separatePassword = Object.hasOwn(env, "DATABASE_PASSWORD");
  try {
    const value = env.DATABASE_URL;
    if (
      typeof value !== "string" ||
      value !== value.trim() ||
      /[\r\n]/.test(value)
    )
      throw Error();
    address = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(address.protocol) ||
      !address.hostname ||
      address.hash
    )
      throw Error();
  } catch {
    throw startupError("CONFIG_DATABASE_URL", "DATABASE_CONFIG");
  }
  let user, password, database;
  try {
    user = decodeURIComponent(address.username);
    // A separate password is passed verbatim: no trimming, URL decoding,
    // interpolation, logging, or reconstruction of a connection URI.
    password = separatePassword
      ? env.DATABASE_PASSWORD
      : decodeURIComponent(address.password);
    database = decodeURIComponent(address.pathname.slice(1)) || "postgres";
  } catch {
    throw startupError("CONFIG_DATABASE_URL", "DATABASE_CONFIG");
  }
  const supabaseHost =
    address.hostname.endsWith(".supabase.com") ||
    address.hostname.endsWith(".supabase.co");
  if (
    (separatePassword && (typeof password !== "string" || !password.length)) ||
    (supabaseHost && (!user || !password))
  ) {
    throw startupError("CONFIG_DATABASE_PASSWORD_MISSING", "DATABASE_CONFIG");
  }
  if (
    !separatePassword &&
    password?.toUpperCase().includes("[YOUR-PASSWORD]")
  ) {
    throw startupError("CONFIG_DATABASE_PLACEHOLDER", "DATABASE_CONFIG");
  }
  const port = Number(address.port || 5432);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !database ||
    database.includes("/")
  ) {
    throw startupError("CONFIG_DATABASE_URL", "DATABASE_CONFIG");
  }
  // Check only recognizable hosted Supabase endpoints. Other PostgreSQL
  // installations and custom API domains remain supported.
  let mediaProject;
  try {
    const url = new URL(env.SUPABASE_URL);
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
    if (match) mediaProject = match[1];
  } catch {
    /* media-store supplies its own safe URL diagnostic */
  }
  if (mediaProject) {
    const pooled = address.hostname.endsWith(".pooler.supabase.com");
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(address.hostname);
    if (
      (pooled && !user.endsWith("." + mediaProject)) ||
      (direct && direct[1] !== mediaProject)
    ) {
      throw startupError("CONFIG_DATABASE_PROJECT_MISMATCH", "DATABASE_CONFIG");
    }
  }
  let ca;
  if (env.DATABASE_CA_CERT) {
    const pem = env.DATABASE_CA_CERT.replace(/\\n/g, "\n").trim();
    if (
      !pem.startsWith("-----BEGIN CERTIFICATE-----") ||
      !pem.endsWith("-----END CERTIFICATE-----")
    ) {
      throw startupError("CONFIG_DATABASE_CA", "DATABASE_CONFIG");
    }
    ca = [...rootCertificates, pem];
  }
  const ssl =
    env.NODE_ENV === "test" && env.DATABASE_TEST_NO_TLS === "true"
      ? false
      : { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  return {
    passwordSource: separatePassword ? "separate" : "url",
    options: {
      host: address.hostname,
      port,
      ...(user ? { user } : {}),
      password,
      database,
      ssl,
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      keepAlive: true,
      application_name: "quizzes",
    },
  };
}
module.exports = { databaseConfig };
