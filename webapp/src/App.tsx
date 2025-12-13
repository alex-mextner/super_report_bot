import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useTelegram } from "./hooks/useTelegram";
import { setInitData } from "./api/client";
import { LocaleProvider } from "./context/LocaleContext";
import { HomePage } from "./pages/HomePage";
import { ProductPage } from "./pages/ProductPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import { AdminPage } from "./pages/AdminPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminGroupsPage } from "./pages/AdminGroupsPage";
import { AdminPresetsPage } from "./pages/AdminPresetsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import "./App.css";

export function App() {
  const { initData, colorScheme } = useTelegram();

  // Set initData for API client
  useEffect(() => {
    console.log("[App] initData from Telegram:", { hasInitData: !!initData, length: initData?.length ?? 0 });
    if (initData) {
      setInitData(initData);
    }
  }, [initData]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", colorScheme);
  }, [colorScheme]);

  return (
    <LocaleProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/product/:id" element={<ProductPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/groups" element={<AdminGroupsPage />} />
          <Route path="/admin/presets" element={<AdminPresetsPage />} />
          <Route path="/analytics/:groupId" element={<AnalyticsPage />} />
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  );
}
