import { ImageResponse } from "next/og";
import { getPublicPlatformConfig } from "../lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "WhatsApp CRM platform preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const platform = await getPublicPlatformConfig();

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", color: "#f7fbf9", background: "#08271d" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
        <div style={{ width: "76px", height: "76px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "12px", color: "#08271d", background: "#75d6ad", fontSize: "38px", fontWeight: 800 }}>W</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "42px", fontWeight: 800 }}>{platform.brand_name}</span>
          <span style={{ color: "#a9c8bb", fontSize: "24px" }}>{platform.company_name}</span>
        </div>
      </div>
      <div style={{ display: "flex", maxWidth: "960px", flexDirection: "column", gap: "22px" }}>
        <span style={{ color: "#75d6ad", fontSize: "24px", fontWeight: 700, textTransform: "uppercase" }}>{platform.product_tagline}</span>
        <span style={{ fontSize: "48px", fontWeight: 800, lineHeight: 1.15 }}>{platform.workspace_intro}</span>
      </div>
    </div>,
    size
  );
}
