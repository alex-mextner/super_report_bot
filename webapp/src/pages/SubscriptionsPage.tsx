import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useTelegram } from "../hooks/useTelegram";
import { SubscriptionList } from "../components/SubscriptionList";
import "./SubscriptionsPage.css";

export function SubscriptionsPage() {
  const navigate = useNavigate();
  const { webApp } = useTelegram();
  const { subscriptions, loading, error, deleteSubscription, updateKeywords } = useSubscriptions();

  // Setup back button
  useEffect(() => {
    if (webApp) {
      webApp.BackButton.show();
      const handler = () => navigate(-1);
      webApp.BackButton.onClick(handler);

      return () => {
        webApp.BackButton.hide();
        webApp.BackButton.offClick(handler);
      };
    }
  }, [webApp, navigate]);

  return (
    <div className="subscriptions-page">
      <SubscriptionList
        subscriptions={subscriptions}
        loading={loading}
        error={error}
        onDelete={deleteSubscription}
        onUpdateKeywords={updateKeywords}
      />
    </div>
  );
}
