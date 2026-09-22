/** @type {import('next').NextConfig} */
const httpsDeployment = String(process.env.APP_URL || '').startsWith('https://');
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline' https://connect.facebook.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https://graph.facebook.com https://www.facebook.com; frame-src https://www.facebook.com https://web.facebook.com; font-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'${httpsDeployment ? '; upgrade-insecure-requests' : ''}` }
];
if (httpsDeployment) securityHeaders.splice(4, 0, { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });

const nextConfig = {
  agentRules: false,
  devIndicators: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  }
};

export default nextConfig;
