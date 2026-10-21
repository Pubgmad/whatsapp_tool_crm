import Script from "next/script";
import "./globals.css";
import "./route-navigation.css";
import "./template-picker.css";
import "./visual-refresh.css";
import "./crm-vibrant-theme.css";
import "./premium-design-system.css";
import { getPublicPlatformConfig } from "../lib/platform";

/* Force light-first product chrome; clear sticky dark prefs from earlier themes. */
const themeInitScript = `(function(){var k='wcrm_theme';var d=document.documentElement;try{localStorage.setItem(k,'light');}catch(e){}d.setAttribute('data-theme','light');})();`;

export const dynamic = "force-dynamic";

function getMetadataBase() {
  try {
    return new URL(process.env.APP_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export async function generateMetadata() {
  const platform = await getPublicPlatformConfig();
  const title = `${platform.brand_name} | ${platform.product_tagline}`;
  const description = platform.workspace_intro;

  return {
    metadataBase: getMetadataBase(),
    title,
    description,
    icons: platform.favicon_url ? { icon: platform.favicon_url } : undefined,
    openGraph: {
      title,
      description,
      url: "/",
      siteName: platform.brand_name,
      type: "website",
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: title }]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"]
    }
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="wcrm-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
