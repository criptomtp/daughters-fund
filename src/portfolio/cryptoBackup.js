// WebCrypto-шифрування бекапу: PBKDF2 (SHA-256) → AES-GCM 256.
// Формат-конверт зберігається як звичайний JSON, тож існуючий потік
// експорт/імпорт файлів не змінюється — лише вміст захищений паролем.

const FORMAT = "df-encrypted-v1";
const PBKDF2_ITERATIONS = 310_000;

const te = new TextEncoder();
const td = new TextDecoder();

/* global Buffer */ // у Node (vitest) є, у браузері — ні; нижче все під typeof-перевіркою
// Base64: у Node (vitest) — через Buffer; у браузері — btoa/atob чанками
// (String.fromCharCode(...великий масив) валить стек, тому CHUNK).
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBuf(s) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    "raw", te.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isEncryptedBackup(obj) {
  return !!obj && typeof obj === "object" && obj.format === FORMAT;
}

export async function encryptBackup(payload, passphrase) {
  if (!passphrase) throw new Error("Порожній пароль");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = te.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    format: FORMAT,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: bufToB64(salt) },
    cipher: { name: "AES-GCM", iv: bufToB64(iv) },
    exportedAt: payload?.exportedAt || null,
    data: bufToB64(ciphertext),
  };
}

export async function decryptBackup(envelope, passphrase) {
  if (!isEncryptedBackup(envelope)) throw new Error("Це не зашифрований бекап");
  if (!passphrase) throw new Error("Порожній пароль");
  const salt = b64ToBuf(envelope.kdf?.salt || "");
  const iv = b64ToBuf(envelope.cipher?.iv || "");
  const iterations = Number(envelope.kdf?.iterations) || PBKDF2_ITERATIONS;
  const key = await deriveKey(passphrase, salt, iterations);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv }, key, b64ToBuf(envelope.data || "")
    );
  } catch {
    throw new Error("Невірний пароль або пошкоджений файл");
  }
  return JSON.parse(td.decode(plaintext));
}
