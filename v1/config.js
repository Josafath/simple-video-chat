const path = require("path");

// Load variables from v1/.env when the file exists. Node >= 20.12 can do this
// on its own, so the dotenv package is no longer needed.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (err) {
  // A missing .env is fine: the variables may come from the hosting provider.
  if (err.code !== "ENOENT") throw err;
}

// Stops the app with a clear message instead of failing later in a strange way.
function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

// ICE servers come from the environment so no TURN credentials live in the code.
function iceServers() {
  const fallback = [{ urls: "stun:stun.l.google.com:19302" }];
  if (!process.env.ICE_SERVERS) return fallback;
  try {
    const servers = JSON.parse(process.env.ICE_SERVERS);
    if (!Array.isArray(servers)) throw new Error("ICE_SERVERS must be a JSON array");
    return servers;
  } catch (err) {
    console.error("ICE_SERVERS is not valid JSON:", err.message);
    process.exit(1);
  }
}

// Xirsys API credentials (optional). With them the server asks Xirsys for
// temporary TURN credentials on every call, so the secret never reaches the browser.
function xirsys() {
  const { XIRSYS_IDENT, XIRSYS_SECRET, XIRSYS_CHANNEL } = process.env;
  if (!XIRSYS_IDENT || !XIRSYS_SECRET || !XIRSYS_CHANNEL) return null;
  return {
    url: process.env.XIRSYS_URL || "https://global.xirsys.net",
    ident: XIRSYS_IDENT,
    secret: XIRSYS_SECRET,
    channel: XIRSYS_CHANNEL,
  };
}

module.exports = {
  mongodbUri: required("MONGODB_URI"),
  sessionSecret: required("SESSION_SECRET"),
  iceServers: iceServers(),
  xirsys: xirsys(),
  isProduction: process.env.NODE_ENV === "production",
};
