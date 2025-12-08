import type { Subscription } from "../types";
import "./SubscriptionCard.css";

interface SubscriptionCardProps {
  subscription: Subscription;
  onDelete: (id: number) => void;
  deleting?: boolean;
}

export function SubscriptionCard({ subscription, onDelete, deleting }: SubscriptionCardProps) {
  const handleDelete = () => {
    if (confirm("Удалить подписку?")) {
      onDelete(subscription.id);
    }
  };

  return (
    <div className="subscription-card">
      <div className="subscription-header">
        <span className="subscription-query">{subscription.original_query}</span>
        <button
          className="subscription-delete"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? "..." : "×"}
        </button>
      </div>

      <div className="subscription-groups">
        {subscription.groups.map((group) => (
          <span key={group.id} className="subscription-group-badge">
            {group.title}
          </span>
        ))}
      </div>

      <div className="subscription-keywords">
        <div className="keywords-row">
          <span className="keywords-label">+</span>
          <div className="keywords-list positive">
            {subscription.positive_keywords.map((kw, i) => (
              <span key={i} className="keyword-badge">{kw}</span>
            ))}
          </div>
        </div>
        {subscription.negative_keywords.length > 0 && (
          <div className="keywords-row">
            <span className="keywords-label">−</span>
            <div className="keywords-list negative">
              {subscription.negative_keywords.map((kw, i) => (
                <span key={i} className="keyword-badge">{kw}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="subscription-description">
        {subscription.llm_description}
      </div>
    </div>
  );
}
