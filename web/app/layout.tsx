import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bengaluru Neighbourhood Explorer",
  description: "Explore and compare Bengaluru neighbourhoods by livability score — air quality, amenities, metro access and more.",
  openGraph: {
    title: "Bengaluru Neighbourhood Explorer",
    description: "Explore and compare Bengaluru neighbourhoods by livability score — air quality, amenities, metro access and more.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Bengaluru Neighbourhood Explorer",
    description: "Explore and compare Bengaluru neighbourhoods by livability score — air quality, amenities, metro access and more.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-screen antialiased`}
    >
      <body className="h-screen flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
