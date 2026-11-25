import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MapleLens",
  description: "Tự cắt và giải nhanh thử thách chọn câu trong MapleStory PC.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MapleLens" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1019" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
