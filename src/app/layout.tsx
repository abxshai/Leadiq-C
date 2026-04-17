import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";

const spaceMono = Space_Mono({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const spaceMonoItalic = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Qualifier — Lead Qualification Dashboard",
  description:
    "Ingest LinkedIn profiles, qualify against ICP via Groq, export to CSV or Google Sheets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${spaceMono.variable} ${spaceMonoItalic.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
