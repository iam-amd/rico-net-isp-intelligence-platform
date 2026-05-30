"use client";

import React from "react";
import {
    Home,
    Inbox,
    Users,
    Wrench,
    BarChart3,
    LogOut,
    PhoneCall,
    MapPin,
    Network,
    Radio,
    MonitorDot,
    ClipboardList,
    Building2,
    Cpu,
    Activity,
    GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
// M-02/M-03 FIX: Import useLogout to wire up the logout button; removed dead Settings import.

export function MainSidebar() {
    const pathname = usePathname();
    const router = useRouter();

    // M-03 FIX: Real logout — clears token/user from localStorage and redirects to login.
    const handleLogout = () => {
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_user");
        router.push("/login");
    };

    const navItems = [
        { href: "/", icon: Home, label: "Home" },
        { href: "/tickets", icon: Inbox, label: "Tickets", badge: true },
        { href: "/customers", icon: Users, label: "Customers" },
        { href: "/technicians", icon: Wrench, label: "Technicians" },
        { href: "/dashboard", icon: BarChart3, label: "Dashboard" },
        // M-10 FIX: Added phone lookup (Call Pop-Up) to sidebar navigation.
        { href: "/phone-lookup", icon: PhoneCall, label: "Call Pop-Up" },
        { href: "/survey", icon: MapPin, label: "Field Survey" },
        { href: "/technicians/live-map", icon: Radio, label: "Live Tracker" },
        { href: "/pole-groups", icon: Network, label: "Pole Groups" },
        { href: "/collection", icon: ClipboardList, label: "Data Collection" },
        { href: "/noc", icon: MonitorDot, label: "NOC" },
        { href: "/engine", icon: Cpu, label: "Engine" },
        { href: "/engine/monitor", icon: Activity, label: "Engine Monitor" },
        { href: "/pipeline", icon: GitBranch, label: "Pipeline" },
        { href: "/pg", icon: Building2, label: "PG Buildings" },
    ];

    return (
        <div className="w-20 bg-[#0C3B2E] flex flex-col items-center py-6 gap-8 flex-shrink-0 z-20 shadow-xl min-h-screen">
            <div className="h-10 w-10 bg-white/10 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                R
            </div>
            <div className="flex flex-col gap-6 w-full px-2">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
                    return (
                        <Link key={item.href} href={item.href}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "w-full rounded-xl transition-all duration-200 relative",
                                    isActive
                                        ? "text-white bg-white/10 shadow-lg shadow-black/20"
                                        : "text-white/50 hover:text-white hover:bg-white/10"
                                )}
                            >
                                <item.icon className="h-5 w-5" />
                                {item.badge && (
                                    <span className="absolute top-2 right-3 h-2 w-2 bg-lime-400 rounded-full border-2 border-[#0C3B2E]"></span>
                                )}
                            </Button>
                        </Link>
                    );
                })}
            </div>
            <div className="mt-auto flex flex-col gap-6 w-full px-2">
                {/* M-03 FIX: Replaced dead Settings button with a working Logout button. */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="w-full text-white/50 hover:text-red-300 hover:bg-white/10 rounded-xl"
                    onClick={handleLogout}
                    title="Logout"
                >
                    <LogOut className="h-5 w-5" />
                </Button>
                <Avatar className="h-8 w-8 border-2 border-white/20">
                    <AvatarFallback className="bg-emerald-800 text-white text-xs">AH</AvatarFallback>
                </Avatar>
            </div>
        </div>
    );
}
