import { useSubscriptions } from "../hooks/useSubscriptions";
import { SubscriptionList } from "../components/SubscriptionList";
import "./SubscriptionsPage.css";

export function SubscriptionsPage() {
  const { subscriptions, loading, error, deleteSubscription } = useSubscriptions();

  return (
    <div className="subscriptions-page">
      <SubscriptionList
        subscriptions={subscriptions}
        loading={loading}
        error={error}
        onDelete={deleteSubscription}
      />
    </div>
  );
}
