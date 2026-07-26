import type { NextConfig } from "next";

// Security headers. Notes on the two loose spots:
// - script-src needs 'unsafe-inline' for Next's hydration bootstrap (a nonce
//   setup via middleware is the upgrade path if this ever needs tightening).
// - style-src needs 'unsafe-inline' because the app styles with React
//   `style={{...}}` attributes throughout.
// Nothing here is ever legitimately framed, fetched cross-origin, or
// embedded, so the rest can be strict.
// React needs eval() for dev-mode debugging features; production never does.
const dev = process.env.NODE_ENV === "development";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
