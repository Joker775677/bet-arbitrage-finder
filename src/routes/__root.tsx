import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { Disclaimer } from "@/components/Disclaimer";
import { AppGate } from "@/components/AppGate";

import appCss from "../styles.css?url";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
});

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Okak - Bookmaker Arbitrage Scanner" },
      { name: "description", content: "Find arbitrage opportunities (sure bets) across your own list of bookmakers." },
      { property: "og:title", content: "Okak - Bookmaker Arbitrage Scanner" },
      { name: "twitter:title", content: "Okak - Bookmaker Arbitrage Scanner" },
      { property: "og:description", content: "Find arbitrage opportunities (sure bets) across your own list of bookmakers." },
      { name: "twitter:description", content: "Find arbitrage opportunities (sure bets) across your own list of bookmakers." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a2b403ad-5345-4eea-b852-84175d909110/id-preview-52322946--7571ac17-6219-4b02-914c-fc2d243c62dc.lovable.app-1778137217975.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a2b403ad-5345-4eea-b852-84175d909110/id-preview-52322946--7571ac17-6219-4b02-914c-fc2d243c62dc.lovable.app-1778137217975.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppGate>
        <SidebarProvider>
          <div className="flex min-h-screen w-full bg-background">
            <AppSidebar />
            <div className="flex flex-1 flex-col">
              <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
                <SidebarTrigger />
                <span className="font-display text-sm font-semibold tracking-tight text-foreground">Okak</span>
              </header>
              <main className="flex-1">
                <Outlet />
              </main>
              <Disclaimer />
            </div>
          </div>
        </SidebarProvider>
      </AppGate>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
