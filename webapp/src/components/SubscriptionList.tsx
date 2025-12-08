import { useState } from "react";
import { SubscriptionCard } from "./SubscriptionCard";
import type { Subscription } from "../types";
import "./SubscriptionList.css";

interface SubscriptionListProps {
  subscriptions: Subscription[];
  loading: boolean;
  error: string | null;
  onDelete: (id: number) => Promise<boolean>;
}

export function SubscriptionList({
  subscriptions,
  loading,
  error,
  onDelete,
}: SubscriptionListProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  };

  if (loading) {
    return (
      <div className="subscription-list-loading">
        Загрузка...
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
        <div className="empty-text">Нет активных подписок</div>
        <div className="empty-hint">
          Создайте подписку в боте командой /new
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
          deleting={deletingId === sub.id}
        />
      ))}
    </div>
  );
}
