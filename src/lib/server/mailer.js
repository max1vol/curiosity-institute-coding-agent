import nodemailer from "nodemailer";

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

let cachedTransportKey = "";
let cachedTransport = null;

export function createMailConfig(env = {}) {
  const smtpUrl = normalizeValue(env.SMTP_URL);
  const host = normalizeValue(env.SMTP_HOST);
  const port = Number.parseInt(normalizeValue(env.SMTP_PORT), 10);
  const secureValue = normalizeValue(env.SMTP_SECURE).toLowerCase();
  const user = normalizeValue(env.SMTP_USER);
  const pass = normalizeValue(env.SMTP_PASS);
  const from = normalizeValue(env.SMTP_FROM);

  return {
    smtpUrl,
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: secureValue ? secureValue === "true" : Number.isFinite(port) && port === 465,
    user,
    pass,
    from
  };
}

export function isMailConfigured(config) {
  if (!normalizeValue(config?.from)) {
    return false;
  }

  if (normalizeValue(config?.smtpUrl)) {
    return true;
  }

  return Boolean(normalizeValue(config?.host) && normalizeValue(config?.user) && normalizeValue(config?.pass));
}

function getTransport(config) {
  const transportKey = JSON.stringify(config);

  if (cachedTransport && cachedTransportKey === transportKey) {
    return cachedTransport;
  }

  cachedTransportKey = transportKey;
  cachedTransport = normalizeValue(config.smtpUrl)
    ? nodemailer.createTransport(config.smtpUrl)
    : nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass
        }
      });

  return cachedTransport;
}

export async function sendLoginCode(config, details) {
  const expiresInMinutes = Math.max(
    1,
    Math.round((Number(details?.expiresAt || 0) - Math.floor(Date.now() / 1000)) / 60)
  );
  const transport = getTransport(config);
  const subject = "Curiosity Chat login code";
  const text = [
    `Your Curiosity Chat login code is: ${details.code}`,
    "",
    `It expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? "" : "s"} and can only be used once.`,
    "If you did not request this code, you can ignore this email."
  ].join("\n");

  await transport.sendMail({
    from: config.from,
    to: details.to,
    subject,
    text,
    html: `<p>Your <strong>Curiosity Chat</strong> login code is <strong>${details.code}</strong>.</p><p>It expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? "" : "s"} and can only be used once.</p><p>If you did not request this code, you can ignore this email.</p>`
  });
}
