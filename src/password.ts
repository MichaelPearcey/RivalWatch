import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// OWASP-listed scrypt parameters N=2^15, r=8, p=3 (~32 MiB per hash, ~100ms). Chosen over N=2^17/p=1
// (128 MiB) so a burst of sign-ins cannot exhaust memory on a 512 MB container.
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

/** Format: scrypt$N$r$p$salt$hash (base64url). Self-describing so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when the stored hash uses weaker parameters than current and should be re-hashed on next login. */
export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split("$");
  return Number(n) < N || Number(r) < R || Number(p) < P;
}

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

/** Length-based policy (NIST 800-63B): >= 12 chars, <= 128, not obviously trivial. No composition rules. */
export function checkPasswordPolicy(password: string, email?: string): PasswordCheck {
  if (password.length < 12) return { ok: false, reason: "Use at least 12 characters (a sentence works well)." };
  if (password.length > 128) return { ok: false, reason: "Use at most 128 characters." };
  if (/^(.)\1+$/.test(password)) return { ok: false, reason: "That password is too repetitive." };
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return { ok: false, reason: "That password is too common." };
  if (email && lower.includes(email.split("@")[0]!.toLowerCase()) && email.split("@")[0]!.length >= 4) return { ok: false, reason: "Don't use your email address in your password." };
  return { ok: true };
}

const COMMON = new Set(["password1234", "123456789012", "qwertyuiop12", "letmeinletmein", "administrator", "passwordpassword", "welcome12345", "iloveyou1234", "rivalwatch123"]);
