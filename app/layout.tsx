import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "店界 POI｜门店周边设施分析平台",
  description: "支持门店候选确认、周边 POI 搜索、批量导入、统计与 Excel 导出的企业级工作台。",
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
