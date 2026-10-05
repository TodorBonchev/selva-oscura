/**
 * Soft anti-alt link keys. The server only ever keeps salted, truncated hashes of a
 * socket's client IP and the browser's random device id — never the raw values — and
 * only in memory on the socket (pvp.mjs linkedPair). Used to shrink rating gains
 * between pilgrims who share a connection or device; never to block anyone.
 */
import crypto from "node:crypto";

const LINK_SALT = process.env.LINK_SALT || "selva-link-v1";

export function linkHash(v) {
  return crypto.createHash("sha256").update(`${LINK_SALT}|${v}`).digest("hex").slice(0, 16);
}

/**
 * Client IP behind Railway's edge. X-Real-IP is set by the proxy; failing that the
 * right-most X-Forwarded-For hop is the one the proxy appended (left-most entries are
 * client-supplied and spoofable). Falls back to the socket address.
 */
export function clientIp(req) {
  const h = req?.headers || {};
  const real = String(h["x-real-ip"] || "").trim();
  if (real) return real;
  const hops = String(h["x-forwarded-for"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  return String(req?.socket?.remoteAddress || "");
}

const LOOPBACK = /^(::1|127\.|::ffff:127\.)/;

/** { ip, dev } link keys for a new socket (loopback — local dev and tests — never links). */
export function linkFor(req) {
  try {
    const ip = clientIp(req);
    return { ip: ip && !LOOPBACK.test(ip) ? linkHash(`ip:${ip}`) : null, dev: null };
  } catch {
    return { ip: null, dev: null };
  }
}

/** Device key from the hello's random per-browser id (8–64 chars), else null. */
export function deviceKey(device) {
  if (typeof device !== "string" || device.length < 8 || device.length > 64) return null;
  return linkHash(`dev:${device}`);
}
