import "./globals.css";
import { getPublicPlatformConfig } from "../lib/platform";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
