import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminSubscriptions } from "../hooks/useAdminSubscriptions";
import { useAdminGroups, type AvailableGroup } from "../hooks/useAdminGroups";
import { useTelegram } from "../hooks/useTelegram";
import { KeywordsDisplay } from "../components/KeywordsDisplay";
import { KeywordEditor } from "../components/KeywordEditor";
import type { AdminSubscription, SubscriptionGroup } from "../types";
import "./AdminPage.css";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUser(sub: AdminSubscription): string {
  if (sub.first_name) {
    return sub.username ? `${sub.first_name} (@${sub.username})` : sub.first_name;
  }
  if (sub.username) {
    return `@${sub.username}`;
  }
  return `#${sub.telegram_id}`;
}

interface GroupEditorProps {
  groups: SubscriptionGroup[];
  availableGroups: AvailableGroup[];
  onChange: (groups: SubscriptionGroup[]) => void;
}

function GroupEditor({ groups, availableGroups, onChange }: GroupEditorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedIds = new Set(groups.map((g) => g.id));

  const handleToggle = (group: AvailableGroup) => {
    if (selectedIds.has(group.id)) {
      onChange(groups.filter((g) => g.id !== group.id));
    } else {
      onChange([...groups, { id: group.id, title: group.title || `#${group.id}` }]);
    }
  };

  const handleRemove = (id: number) => {
    onChange(groups.filter((g) => g.id !== id));
  };

  return (
    <div className="group-editor">
      <div className="group-list">
        {groups.map((g) => (
          <span key={g.id} className="group-tag">
            {g.title}
            <button className="group-remove" onClick={() => handleRemove(g.id)}>
              ×
            </button>
          </span>
        ))}
        {groups.length === 0 && <span className="no-groups">Нет групп</span>}
      </div>
      <div className="group-selector">
        <button className="group-dropdown-btn" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? "Скрыть список" : "Выбрать группы"}
        </button>
        {isOpen && (
          <div className="group-dropdown">
            {availableGroups.length === 0 ? (
              <div className="group-dropdown-empty">Нет доступных групп</div>
            ) : (
              availableGroups.map((g) => (
                <label key={g.id} className="group-checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(g.id)}
                    onChange={() => handleToggle(g)}
                  />
                  <span>{g.title || `#${g.id}`}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface SubscriptionRowProps {
  sub: AdminSubscription;
  availableGroups: AvailableGroup[];
  onUpdateKeywords: (id: number, positive: string[], negative: string[]) => Promise<boolean>;
  onUpdateGroups: (id: number, groups: SubscriptionGroup[]) => Promise<boolean>;
}

function SubscriptionRow({ sub, availableGroups, onUpdateKeywords, onUpdateGroups }: SubscriptionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [positive, setPositive] = useState(sub.positive_keywords);
  const [negative, setNegative] = useState(sub.negative_keywords);
  const [groups, setGroups] = useState(sub.groups);
  const [saving, setSaving] = useState(false);

  const hasChanges =
    JSON.stringify(positive) !== JSON.stringify(sub.positive_keywords) ||
    JSON.stringify(negative) !== JSON.stringify(sub.negative_keywords) ||
    JSON.stringify(groups) !== JSON.stringify(sub.groups);

  const handleSave = async () => {
    setSaving(true);
    const keywordsChanged =
      JSON.stringify(positive) !== JSON.stringify(sub.positive_keywords) ||
      JSON.stringify(negative) !== JSON.stringify(sub.negative_keywords);
    const groupsChanged = JSON.stringify(groups) !== JSON.stringify(sub.groups);

    if (keywordsChanged) {
      await onUpdateKeywords(sub.id, positive, negative);
    }
    if (groupsChanged) {
      await onUpdateGroups(sub.id, groups);
    }
    setSaving(false);
  };

  const handleReset = () => {
    setPositive(sub.positive_keywords);
    setNegative(sub.negative_keywords);
    setGroups(sub.groups);
  };

  return (
    <div className={`admin-sub-row ${sub.is_active ? "" : "inactive"}`}>
      <div className="admin-sub-header" onClick={() => setExpanded(!expanded)}>
        <span className="admin-sub-user">{formatUser(sub)}</span>
        <span className="admin-sub-date">{formatDate(sub.created_at)}</span>
        {!sub.is_active && <span className="admin-sub-badge inactive">OFF</span>}
        <span className={`expand-icon ${expanded ? "expanded" : ""}`}>▼</span>
      </div>
      <div className="admin-sub-query">{sub.original_query}</div>

      {!expanded && (
        <KeywordsDisplay
          positive={sub.positive_keywords}
          negative={sub.negative_keywords}
          maxShow={6}
        />
      )}

      {expanded && (
        <div className="admin-sub-expanded">
          <div className="editor-section">
            <div className="editor-label">Ключевые слова (+)</div>
            <KeywordEditor keywords={positive} type="positive" onChange={setPositive} />
          </div>

          <div className="editor-section">
            <div className="editor-label">Исключения (−)</div>
            <KeywordEditor keywords={negative} type="negative" onChange={setNegative} />
          </div>

          <div className="editor-section">
            <div className="editor-label">Группы</div>
            <GroupEditor groups={groups} availableGroups={availableGroups} onChange={setGroups} />
          </div>

          {hasChanges && (
            <div className="editor-actions">
              <button className="save-btn" onClick={handleSave} disabled={saving}>
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
              <button className="reset-btn" onClick={handleReset} disabled={saving}>
                Отменить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminPage() {
  const navigate = useNavigate();
  const { webApp } = useTelegram();
  const { subscriptions, loading, error, updateKeywords, updateGroups } = useAdminSubscriptions();
  const { groups: availableGroups, loading: groupsLoading, error: groupsError } = useAdminGroups();

  // Setup Telegram BackButton
  useEffect(() => {
    if (!webApp) return;

    const handleBack = () => navigate("/");

    webApp.BackButton.show();
    webApp.BackButton.onClick(handleBack);

    return () => {
      webApp.BackButton.offClick(handleBack);
      webApp.BackButton.hide();
    };
  }, [webApp, navigate]);

  if (loading || groupsLoading) {
    return <div className="admin-page loading">Загрузка...</div>;
  }

  if (error || groupsError) {
    return <div className="admin-page error">{error || groupsError}</div>;
  }

  const activeCount = subscriptions.filter((s) => s.is_active).length;
  const uniqueUsers = new Set(subscriptions.map((s) => s.telegram_id)).size;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Подписки</h1>
        <div className="admin-stats">
          <span>{subscriptions.length} всего</span>
          <span>{activeCount} активных</span>
          <span>{uniqueUsers} пользователей</span>
        </div>
      </div>
      <div className="admin-list">
        {subscriptions.map((sub) => (
          <SubscriptionRow
            key={sub.id}
            sub={sub}
            availableGroups={availableGroups}
            onUpdateKeywords={updateKeywords}
            onUpdateGroups={updateGroups}
          />
        ))}
      </div>
    </div>
  );
}
