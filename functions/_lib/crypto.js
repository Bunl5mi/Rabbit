const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100000;

function toHex(bytes) {
  return Array.from(
    bytes,
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}

function fromHex(value) {
  if (
    typeof value !== "string" ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(value)
  ) {
    throw new Error("INVALID_HEX");
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(
      value.slice(index * 2, index * 2 + 2),
      16
    );
  }

  return bytes;
}

function equalBytes(first, second) {
  if (first.length !== second.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index] ^ second[index];
  }

  return difference === 0;
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashToken(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value)
  );

  return toHex(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(salt),
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  return new Uint8Array(bits);
}

export async function createPasswordRecord(password) {
  if (
    typeof password !== "string" ||
    password.length < 20 ||
    password.length > 256
  ) {
    throw new Error("INVALID_PASSWORD_LENGTH");
  }

  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);

  const salt = toHex(saltBytes);
  const hash = await derivePassword(
    password,
    salt,
    PASSWORD_ITERATIONS
  );

  return {
    password_hash: toHex(hash),
    password_salt: salt,
    password_iterations: PASSWORD_ITERATIONS
  };
}

export async function verifyPasswordRecord(password, record) {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > 256 ||
    !record
  ) {
    return false;
  }

  const iterations = Number(record.password_iterations);

  if (
    iterations !== PASSWORD_ITERATIONS ||
    !/^[0-9a-f]{32}$/i.test(record.password_salt) ||
    !/^[0-9a-f]{64}$/i.test(record.password_hash)
  ) {
    return false;
  }

  const suppliedHash = await derivePassword(
    password,
    record.password_salt,
    iterations
  );

  const expectedHash = fromHex(record.password_hash);

  return equalBytes(suppliedHash, expectedHash);
}

export async function verifySecret(supplied, expected) {
  if (
    typeof supplied !== "string" ||
    typeof expected !== "string" ||
    supplied.length === 0 ||
    supplied.length > 1024 ||
    expected.length === 0
  ) {
    return false;
  }

  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);

  return equalBytes(
    new Uint8Array(suppliedDigest),
    new Uint8Array(expectedDigest)
  );
}
