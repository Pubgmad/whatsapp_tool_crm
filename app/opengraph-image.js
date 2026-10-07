import { ImageResponse } from "next/og";
import sharp from 'sharp';
import { getPublicPlatformConfig } from "../lib/platform";
import {loadBrandAsset} from '../lib/public-site';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Platform preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const platform = await getPublicPlatformConfig();
  const logo=await loadBrandAsset('logo');
  const logoUrl=logo?`data:image/png;base64,${(await sharp(logo.image_data).png().toBuffer()).toString('base64')}`:null;

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", color: "#f7fbf9", background: "#08271d" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
        {logoUrl&&<img src={logoUrl} alt="" style={{maxWidth:'180px',maxHeight:'76px',objectFit:'contain'}}/>}
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
