import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "店界 POI｜门店周边潜在人群分析平台",
    description: "用周边 POI 看懂潜在人群年龄倾向、消费环境与商场档次线索，并明确展示依据和可信度。",
    openGraph: {title:"店界 POI",description:"看懂门店周边潜在人群",images:[image]},
    twitter: {card:"summary_large_image",title:"店界 POI",description:"看懂门店周边潜在人群",images:[image]},
  };
}

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
