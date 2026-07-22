import type { Metadata } from "next";
import { JetBrains_Mono, Major_Mono_Display } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// JetBrains Mono — body text + mono UI accents (buttons, code chips, KPI
// numbers). Feeds `--font-sans` / `--font-mono`.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Major Mono Display — headings + subheadings only, via `--font-display` (page
// H1s) and `--font-heading` (Card/Dialog titles). A geometric display
// monospace; single weight (400). Heading elements add `uppercase` +
// `tracking-wide`. Body stays JetBrains Mono.
const majorMono = Major_Mono_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
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
      className={`${jetbrainsMono.variable} ${majorMono.variable} h-full antialiased`}
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
