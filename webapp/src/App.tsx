import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useTelegram } from "./hooks/useTelegram";
import { setInitData } from "./api/client";
import { HomePage } from "./pages/HomePage";
import { ProductPage } from "./pages/ProductPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
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
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
