import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, Upload, Search, Target, Settings as SettingsIcon, TrendingUp, Radar, Zap, Flame } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Surebets (live)", url: "/surebets", icon: Flame },
  { title: "Bookmakers", url: "/bookmakers", icon: Building2 },
  { title: "Odds Import", url: "/odds", icon: Upload },
  { title: "Live Scanner", url: "/live", icon: Radar },
  { title: "RU Live Scanner", url: "/ru-live", icon: Radar },
  { title: "Quick RU Arb", url: "/quick", icon: Zap },
  { title: "Manual Scanner", url: "/scanner", icon: Search },
  { title: "Opportunities", url: "/opportunities", icon: Target },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--gradient-primary)" }}>
            <TrendingUp className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-base font-bold text-sidebar-foreground">Okak</span>
            <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Arbitrage Scanner</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = path === item.url;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
