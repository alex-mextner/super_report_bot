import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminUsers } from "../hooks/useAdminUsers";
import { useTelegram } from "../hooks/useTelegram";
import { useLocale } from "../context/LocaleContext";
import { UserChat } from "../components/UserChat";
import type { TranslationKey } from "../i18n";
import "./AdminUsersPage.css";

function formatLastActive(
  timestamp: number | null,
  locale: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  if (!timestamp) return t("never");

  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 10) return t("online");
  if (diff < 60) return t("secondsAgo", { n: diff });
  if (diff < 3600) return t("minutesAgoShort", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("hoursAgoShort", { n: Math.floor(diff / 3600) });

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(locale);
}

function getUserDisplayName(user: { first_name: string | null; username: string | null; id: number }): string {
  if (user.first_name) {
    return user.username ? `${user.first_name} (@${user.username})` : user.first_name;
  }
  if (user.username) {
    return `@${user.username}`;
  }
  return `#${user.id}`;
}

function getAvatarLetter(user: { first_name: string | null; username: string | null }): string {
  const name = user.first_name || user.username || "?";
  return name[0].toUpperCase();
}

export function AdminUsersPage() {
  const navigate = useNavigate();
  const { webApp } = useTelegram();
  const { intlLocale, t } = useLocale();
  const { users, loading, error } = useAdminUsers();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // Back button handling
  useEffect(() => {
    if (!webApp) return;

    const handleBack = () => {
      if (selectedUserId) {
        setSelectedUserId(null);
      } else {
        navigate("/admin");
      }
    };

    webApp.BackButton.show();
    webApp.BackButton.onClick(handleBack);

    return () => {
      webApp.BackButton.offClick(handleBack);
      webApp.BackButton.hide();
    };
  }, [webApp, navigate, selectedUserId]);

  // Recompute online status every second
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="admin-users-page">
        <div className="loading">{t("loadingUsers")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-users-page">
        <div className="error">{error}</div>
      </div>
    );
  }

  // Show chat if user selected
  if (selectedUserId) {
    const user = users.find((u) => u.id === selectedUserId);
    if (!user) {
      setSelectedUserId(null);
      return null;
    }

    return (
      <UserChat
        telegramId={selectedUserId}
        userName={getUserDisplayName(user)}
        onClose={() => setSelectedUserId(null)}
      />
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const onlineCount = users.filter((u) => u.last_active && now - u.last_active < 10).length;

  return (
    <div className="admin-users-page">
      <div className="admin-users-header">
        <h1>{t("users")}</h1>
        <div className="users-stats">
          <span className="total-count">{t("totalUsers", { count: users.length })}</span>
          {onlineCount > 0 && (
            <span className="online-count">{t("onlineUsers", { count: onlineCount })}</span>
          )}
        </div>
      </div>

      <div className="users-list">
        {users.length === 0 ? (
          <div className="empty-state">{t("noUsersYet")}</div>
        ) : (
          users.map((user) => {
            const isOnline = user.last_active && now - user.last_active < 10;

            return (
              <div
                key={user.id}
                className={`user-row ${isOnline ? "online" : ""}`}
                onClick={() => setSelectedUserId(user.id)}
              >
                <div className="user-avatar">
                  {isOnline && <span className="online-indicator" />}
                  <span className="avatar-letter">{getAvatarLetter(user)}</span>
                </div>

                <div className="user-info">
                  <div className="user-name">{getUserDisplayName(user)}</div>
                  <div className="user-last-active">
                    {formatLastActive(user.last_active, intlLocale, t)}
                  </div>
                </div>

                <div className="user-arrow">&#8250;</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
