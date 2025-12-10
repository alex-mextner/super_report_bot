import { useState } from "react";
import { useAdminSubscriptions } from "../hooks/useAdminSubscriptions";
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

interface KeywordEditorProps {
  keywords: string[];
  type: "positive" | "negative";
  onChange: (keywords: string[]) => void;
}

function KeywordEditor({ keywords, type, onChange }: KeywordEditorProps) {
  const [newKeyword, setNewKeyword] = useState("");

  const handleAdd = () => {
    const kw = newKeyword.trim().toLowerCase();
    if (kw && !keywords.includes(kw)) {
      onChange([...keywords, kw]);
      setNewKeyword("");
    }
  };

  const handleRemove = (kw: string) => {
    onChange(keywords.filter((k) => k !== kw));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="keyword-editor">
      <div className="keyword-list">
        {keywords.map((kw) => (
          <span key={kw} className={`keyword-tag ${type}`}>
            {kw}
            <button className="keyword-remove" onClick={() => handleRemove(kw)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="keyword-input-row">
        <input
          type="text"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={type === "positive" ? "Добавить ключевое слово..." : "Добавить исключение..."}
          className="keyword-input"
        />
        <button onClick={handleAdd} className="keyword-add-btn" disabled={!newKeyword.trim()}>
          +
        </button>
      </div>
    </div>
  );
}

interface GroupEditorProps {
  groups: SubscriptionGroup[];
  onChange: (groups: SubscriptionGroup[]) => void;
}

function GroupEditor({ groups, onChange }: GroupEditorProps) {
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupTitle, setNewGroupTitle] = useState("");

  const handleRemove = (id: number) => {
    onChange(groups.filter((g) => g.id !== id));
  };

  const handleAdd = () => {
    const id = Number(newGroupId);
    if (id && newGroupTitle.trim() && !groups.some((g) => g.id === id)) {
      onChange([...groups, { id, title: newGroupTitle.trim() }]);
      setNewGroupId("");
      setNewGroupTitle("");
    }
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
      <div className="group-input-row">
        <input
          type="number"
          value={newGroupId}
          onChange={(e) => setNewGroupId(e.target.value)}
          placeholder="ID группы"
          className="group-id-input"
        />
        <input
          type="text"
          value={newGroupTitle}
          onChange={(e) => setNewGroupTitle(e.target.value)}
          placeholder="Название"
          className="group-title-input"
        />
        <button
          onClick={handleAdd}
          className="group-add-btn"
          disabled={!newGroupId || !newGroupTitle.trim()}
        >
          +
        </button>
      </div>
    </div>
  );
}

interface SubscriptionRowProps {
  sub: AdminSubscription;
  onUpdateKeywords: (id: number, positive: string[], negative: string[]) => Promise<boolean>;
  onUpdateGroups: (id: number, groups: SubscriptionGroup[]) => Promise<boolean>;
}

function SubscriptionRow({ sub, onUpdateKeywords, onUpdateGroups }: SubscriptionRowProps) {
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
        <div className="admin-sub-preview">
          <span className="preview-label">+</span>
          {sub.positive_keywords.slice(0, 4).map((kw) => (
            <span key={kw} className="preview-keyword positive">
              {kw}
            </span>
          ))}
          {sub.positive_keywords.length > 4 && (
            <span className="preview-more">+{sub.positive_keywords.length - 4}</span>
          )}
          {sub.negative_keywords.length > 0 && (
            <>
              <span className="preview-label">−</span>
              {sub.negative_keywords.slice(0, 2).map((kw) => (
                <span key={kw} className="preview-keyword negative">
                  {kw}
                </span>
              ))}
              {sub.negative_keywords.length > 2 && (
                <span className="preview-more">+{sub.negative_keywords.length - 2}</span>
              )}
            </>
          )}
        </div>
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
            <GroupEditor groups={groups} onChange={setGroups} />
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
  const { subscriptions, loading, error, updateKeywords, updateGroups } = useAdminSubscriptions();

  if (loading) {
    return <div className="admin-page loading">Загрузка...</div>;
  }

  if (error) {
    return <div className="admin-page error">{error}</div>;
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
            onUpdateKeywords={updateKeywords}
            onUpdateGroups={updateGroups}
          />
        ))}
      </div>
    </div>
  );
}
