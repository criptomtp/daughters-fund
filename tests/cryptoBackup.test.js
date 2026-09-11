import { describe, it, expect } from "vitest";
import { encryptBackup, decryptBackup, isEncryptedBackup } from "../src/portfolio/cryptoBackup.js";

const SAMPLE = {
  schemaVersion: 5,
  exportedAt: "2026-06-11T00:00:00.000Z",
  data: { persons: [{ id: "person-0001", name: "Донька №1 — і кирилиця, і емодзі 👧" }], lots: [] },
};

describe("cryptoBackup", () => {
  it("encrypt → decrypt roundtrip preserves payload (incl. cyrillic)", async () => {
    const env = await encryptBackup(SAMPLE, "сімейний-пароль-123");
    expect(isEncryptedBackup(env)).toBe(true);
    expect(env.data).not.toContain("Донька");          // вміст реально зашифровано
    // Маркер навмисне з дефісом: у base64 (A-Za-z0-9+/=) він не може
    // зʼявитися випадково, на відміну від короткого "p1", який там траплявся.
    expect(JSON.stringify(env)).not.toContain("person-0001");
    const back = await decryptBackup(env, "сімейний-пароль-123");
    expect(back).toEqual(SAMPLE);
  });

  it("wrong passphrase rejects with a friendly error", async () => {
    const env = await encryptBackup(SAMPLE, "correct");
    await expect(decryptBackup(env, "wrong")).rejects.toThrow("Невірний пароль");
  });

  it("plain backup is not detected as encrypted", () => {
    expect(isEncryptedBackup(SAMPLE)).toBe(false);
    expect(isEncryptedBackup(null)).toBe(false);
  });

  it("empty passphrase is refused on encrypt", async () => {
    await expect(encryptBackup(SAMPLE, "")).rejects.toThrow();
  });
});
