import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
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

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "900"],
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
    card: "summary_large_image",
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
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-screen antialiased`}
    >
      <body className="h-screen flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
