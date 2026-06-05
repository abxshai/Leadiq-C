import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// JetBrains Mono is the single typeface across the whole app — body text,
// page-title headings, and mono UI accents (buttons, code chips, error
// displays, KPI numbers, login-hero ASCII, template previews). It feeds every
// font token (`--font-sans` / `--font-heading` / `--font-display` /
// `--font-mono`) via globals.css `@theme inline`. Adopted 2026-06-05,
// replacing Space Mono (body) and VT323 (display): one readable monospace
// family throughout, matching cyber.fund's type system.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Lead-IQ",
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
      suppressHydrationWarning
      className={`${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
