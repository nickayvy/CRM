import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Space_Grotesk } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const sourceSerif = Source_Serif_4({ variable: "--font-serif-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Leadwire", template: "%s · Leadwire" },
  description: "Discover high-activity businesses and turn them into leads.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

// Explicit props type: Next's global LayoutProps/PageProps helpers only exist
// after `next dev`/`next build`/`next typegen`, and `npm run typecheck` must
// pass on a clean clone.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${spaceGrotesk.variable} ${sourceSerif.variable} h-full antialiased`}>
      <body className="min-h-full overflow-x-hidden">
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
