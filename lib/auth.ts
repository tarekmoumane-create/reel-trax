// Single-password gate. The session cookie holds a SHA-256 of the app password
// (+ a fixed prefix), so it can't be forged without knowing the password, and
// we never store the raw password in the cookie. Works in both the Edge
// middleware and Node route handlers (Web Crypto is global in both).

export const AUTH_COOKIE = "rt_auth";

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`reeltrax:v1:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
