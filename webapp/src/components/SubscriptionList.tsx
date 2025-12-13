import { useState } from "react";
import { SubscriptionCard } from "./SubscriptionCard";
import { useLocale } from "../context/LocaleContext";
import type { Subscription } from "../types";
import "./SubscriptionList.css";

interface SubscriptionListProps {
  subscriptions: Subscription[];
  loading: boolean;
  error: string | null;
  onDelete: (id: number) => Promise<boolean>;
  onUpdateKeywords?: (id: number, positive: string[], negative: string[]) => Promise<boolean>;
}

export function SubscriptionList({
  subscriptions,
  loading,
  error,
  onDelete,
  onUpdateKeywords,
}: SubscriptionListProps) {
  const { t } = useLocale();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  };

  if (loading) {
    return (
      <div className="subscription-list-loading">
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="subscription-list-error">
        {error}
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <div className="subscription-list-empty">
        <div className="empty-icon">📋</div>
        <div className="empty-text">{t("noActiveSubscriptions")}</div>
        <div className="empty-hint">
          {t("createInBot")}
        </div>
      </div>
    );
  }

  return (
    <div className="subscription-list">
      {subscriptions.map((sub) => (
        <SubscriptionCard
          key={sub.id}
          subscription={sub}
          onDelete={handleDelete}
          onUpdateKeywords={onUpdateKeywords}
          deleting={deletingId === sub.id}
        />
      ))}
    </div>
  );
}
