import type { Metadata } from "next";
import { Space_Mono, JetBrains_Mono, VT323 } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Body / long-form prose / Card + Dialog titles. Default sans face.
const spaceMono = Space_Mono({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "700"],
});

// UI accents — buttons, code chips, error displays, KPI numbers,
// the login-hero ASCII, template version previews. Anything with the
// `font-mono` utility. Cloned from aiengineeringfromscratch.com's sub
// font.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Display only — page H1 titles in PageHeader. Cloned from
// aiengineeringfromscratch.com's heading face. Pixel-terminal retro,
// reads small at body sizes — keep restricted to titles via the
// `font-display` utility.
const vt323 = VT323({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
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
      suppressHydrationWarning
      className={`${spaceMono.variable} ${jetbrainsMono.variable} ${vt323.variable} h-full antialiased`}
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
