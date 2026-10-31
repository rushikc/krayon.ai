import { AppShell } from "@/components/layout/AppShell";
import { DashboardPanel } from "@/components/layout/DashboardPanel";
import { LibrarySidebar } from "@/components/layout/LibrarySidebar";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { useFolderActions } from "@/hooks/useFolderLoader";

export function DashboardPage() {
  const { handleOpenFolder } = useFolderActions();

  return (
    <AppShell title="library">
      <LibrarySidebar onOpenFolder={() => void handleOpenFolder()} />
      <VideoPlayer />
      <DashboardPanel />
    </AppShell>
  );
}
