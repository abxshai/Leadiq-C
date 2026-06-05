import type { Metadata } from "next";
import { JetBrains_Mono, Archivo } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// JetBrains Mono — body text + mono UI accents (buttons, code chips, KPI
// numbers, login-hero ASCII). Feeds `--font-sans` / `--font-mono`.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Archivo (variable, incl. the `wdth` width axis) — headings + subheadings
// only, via `--font-display` (page H1s) and `--font-heading` (Card/Dialog
// titles). A free stand-in for Neue Plak Wide SemiBold: heading elements set
// `font-stretch-expanded` (wdth 125) + `font-semibold` + `uppercase`. Drop a
// licensed Neue Plak .woff2 in and repoint these tokens to swap for the real
// thing.
const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["wdth"],
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
      className={`${jetbrainsMono.variable} ${archivo.variable} h-full antialiased`}
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
