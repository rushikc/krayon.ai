import { Clapperboard, Scissors, Volume2 } from "lucide-react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";

const tiles = [
  {
    to: "/audio",
    title: "Audio analysis",
    description: "Silence removal & clip grouping",
    icon: Volume2,
  },
  {
    to: "/reel-animations",
    title: "Reel animations",
    description: "Coming soon",
    icon: Clapperboard,
  },
  {
    to: "/studio",
    title: "Studio",
    description: "Pick the best takes from a long recording",
    icon: Scissors,
  },
] as const;

export function HomePage() {
  return (
    <AppShell>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          {tiles.map(({ to, title, description, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-6 transition-colors hover:border-foreground/20 hover:bg-card"
            >
              <Icon className="size-6 text-primary" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold tracking-tight group-hover:text-foreground">
                  {title}
                </h2>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
