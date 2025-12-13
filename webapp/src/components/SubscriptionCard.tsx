import { useState } from "react";
import type { Subscription } from "../types";
import { KeywordsDisplay } from "./KeywordsDisplay";
import { KeywordEditor } from "./KeywordEditor";
import { useLocale } from "../context/LocaleContext";
import "./SubscriptionCard.css";

interface SubscriptionCardProps {
  subscription: Subscription;
  onDelete: (id: number) => void;
  onUpdateKeywords?: (id: number, positive: string[], negative: string[]) => Promise<boolean>;
  deleting?: boolean;
}

export function SubscriptionCard({ subscription, onDelete, onUpdateKeywords, deleting }: SubscriptionCardProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [positive, setPositive] = useState(subscription.positive_keywords);
  const [negative, setNegative] = useState(subscription.negative_keywords);
  const [saving, setSaving] = useState(false);

  const handleDelete = () => {
    if (confirm(t("deleteSubscription"))) {
      onDelete(subscription.id);
    }
  };

  const hasChanges =
    JSON.stringify(positive) !== JSON.stringify(subscription.positive_keywords) ||
    JSON.stringify(negative) !== JSON.stringify(subscription.negative_keywords);

  const handleSave = async () => {
    if (!onUpdateKeywords) return;
    setSaving(true);
    const success = await onUpdateKeywords(subscription.id, positive, negative);
    setSaving(false);
    if (success) {
      setEditing(false);
    }
  };

  const handleCancel = () => {
    setPositive(subscription.positive_keywords);
    setNegative(subscription.negative_keywords);
    setEditing(false);
  };

  return (
    <div className="subscription-card">
      <div className="subscription-header">
        <span className="subscription-query">{subscription.original_query}</span>
        <div className="subscription-actions">
          {onUpdateKeywords && (
            <button
              className="subscription-edit"
              onClick={() => setEditing(!editing)}
              disabled={deleting || saving}
            >
              {editing ? "✕" : "✎"}
            </button>
          )}
          <button
            className="subscription-delete"
            onClick={handleDelete}
            disabled={deleting || saving}
          >
            {deleting ? "..." : "🗑"}
          </button>
        </div>
      </div>

      <div className="subscription-groups">
        {subscription.groups.map((group) => (
          <span key={group.id} className="subscription-group-badge">
            {group.title}
          </span>
        ))}
      </div>

      {!editing ? (
        <KeywordsDisplay
          positive={subscription.positive_keywords}
          negative={subscription.negative_keywords}
        />
      ) : (
        <div className="subscription-edit-section">
          <div className="edit-field">
            <div className="edit-label">{t("positiveKeywords")}</div>
            <KeywordEditor keywords={positive} type="positive" onChange={setPositive} />
          </div>
          <div className="edit-field">
            <div className="edit-label">{t("negativeKeywords")}</div>
            <KeywordEditor keywords={negative} type="negative" onChange={setNegative} />
          </div>
          {hasChanges && (
            <div className="edit-actions">
              <button className="save-btn" onClick={handleSave} disabled={saving}>
                {saving ? "..." : t("save")}
              </button>
              <button className="cancel-btn" onClick={handleCancel} disabled={saving}>
                {t("cancel")}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="subscription-description">
        {subscription.llm_description}
      </div>
    </div>
  );
}
