import { Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";
import { useAppInit } from "@/hooks/useFolderLoader";
import { DashboardPage } from "@/pages/DashboardPage";
import { EditorPage } from "@/pages/EditorPage";
import { HomePage } from "@/pages/HomePage";
import { StudioPage } from "@/pages/studio/StudioPage";
import { ReelAnimationsPage } from "@/pages/ReelAnimationsPage";

function AppRoutes() {
  useAppInit();

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/audio" element={<DashboardPage />} />
      <Route path="/reel-animations" element={<ReelAnimationsPage />} />
      <Route path="/studio" element={<StudioPage />} />
      <Route path="/studio/:slug" element={<StudioPage />} />
      <Route path="/editor/:mediaId" element={<EditorPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <AppRoutes />
      <Toaster />
    </>
  );
}
