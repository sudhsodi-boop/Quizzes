const { rootCertificates } = require("node:tls");
const { X509Certificate, createHash } = require("node:crypto");
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
  // A PEM with blank lines can be silently ignored by the TLS CA loader.
  // Decode escaped line breaks, validate each certificate, and re-emit canonical PEM.
  // Trust is never disabled; this changes formatting, not certificate contents.
  const diagnostics = env.DATABASE_TLS_DIAGNOSTICS === "true";
  const report = (message) => {
    if (diagnostics) console.log("Database TLS check v2: " + message);
  };
  const endpointTag = createHash("sha256")
    .update(address.hostname + ":" + port).digest("hex").slice(0, 16);
  report("endpoint tag=" + endpointTag + "; peer verification=enabled");
  let ca;
  if (env.DATABASE_CA_CERT) {
    try {
      if (typeof env.DATABASE_CA_CERT !== "string" || env.DATABASE_CA_CERT.length > 131072) throw Error();
      const pem = env.DATABASE_CA_CERT.replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n").replace(/\\r/g, "\n").trim();
      const pattern = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
      const blocks = [...pem.matchAll(pattern)];
      if (!blocks.length || blocks.length > 20 || pem.replace(pattern, "").trim()) throw Error();
      const certificates = blocks.map(block => {
        const encoded = block[1].replace(/\s/g, "");
        if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error();
        const raw = Buffer.from(encoded, "base64");
        if (raw.toString("base64") !== encoded) throw Error();
        const cert = new X509Certificate(raw);
        // Reject trailing bytes instead of silently trusting a truncated object.
        if (!cert.raw.equals(raw)) throw Error();
        return cert;
      });
      ca = [...rootCertificates, ...certificates.map(cert => cert.toString())];
      report("runtime CA=present; parsed certificates=" + certificates.length);
      certificates.forEach((cert, index) => report(
        "CA " + (index + 1) + " SHA256=" + cert.fingerprint256.replace(/:/g, "")
        + "; currently valid=" + (Date.now() >= Date.parse(cert.validFrom) && Date.now() <= Date.parse(cert.validTo))
      ));
    } catch {
      report("runtime CA=present but invalid; contents were not logged");
      throw startupError("CONFIG_DATABASE_CA", "DATABASE_CONFIG");
    }
  } else {
    report("runtime CA=missing or empty; only standard roots loaded");
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
