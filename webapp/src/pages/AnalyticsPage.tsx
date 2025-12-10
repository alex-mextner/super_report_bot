import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGroupAnalytics } from "../hooks/useGroupAnalytics";
import { useTelegram } from "../hooks/useTelegram";
import { useUser } from "../hooks/useUser";
import { apiClient } from "../api/client";
import "./AnalyticsPage.css";

export function AnalyticsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { webApp } = useTelegram();
  const { isAdmin } = useUser();
  const { analytics, loading, error, refetch } = useGroupAnalytics(groupId ? Number(groupId) : null);
  const [generating, setGenerating] = useState(false);

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

  const handleGenerate = async () => {
    if (!groupId) return;
    setGenerating(true);
    try {
      await apiClient(`/api/analytics/refresh/${groupId}`, { method: "POST" });
      refetch();
    } catch (e) {
      console.error("Failed to generate analytics", e);
    } finally {
      setGenerating(false);
    }
  };

  if (loading || generating) {
    return (
      <div className="analytics-page">
        <div className="analytics-loading">
          {generating ? "Генерация аналитики..." : "Загрузка..."}
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="analytics-page">
        <div className="analytics-error">
          <p>Аналитика пока не сгенерирована</p>
          <p className="analytics-hint">Автоматическая генерация в 3:00</p>
          {isAdmin && (
            <button className="generate-btn" onClick={handleGenerate}>
              Сгенерировать сейчас
            </button>
          )}
        </div>
      </div>
    );
  }

  const { stats, insights, groupTitle, computedAt } = analytics;

  return (
    <div className="analytics-page">
      <div className="analytics-header">
        <h1>{groupTitle}</h1>
        <div className="updated-at">
          Обновлено: {new Date(computedAt * 1000).toLocaleDateString("ru-RU")}
        </div>
      </div>

      {/* Summary stats */}
      <div className="stats-summary">
        <div className="stat-card">
          <div className="stat-value">{stats.uniqueSellersCount}</div>
          <div className="stat-label">Продавцов</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalMessages}</div>
          <div className="stat-label">Сообщений</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.botFoundPosts.notified}</div>
          <div className="stat-label">Найдено ботом</div>
        </div>
      </div>

      {/* AI Insights */}
      {insights && (
        <div className="insights-card">
          <h3>AI-инсайты</h3>
          <p>{insights}</p>
        </div>
      )}

      {/* Activity chart */}
      {stats.activityByDay.length > 0 && (
        <div className="section-card">
          <h3>Активность ({stats.periodDays} дн.)</h3>
          <div className="activity-chart">
            {stats.activityByDay.map((d) => {
              const maxCount = Math.max(...stats.activityByDay.map((x) => x.count));
              const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
              return (
                <div key={d.date} className="bar-container" title={`${d.date}: ${d.count}`}>
                  <div className="bar" style={{ height: `${height}%` }} />
                  <div className="bar-label">{new Date(d.date).getDate()}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top sellers */}
      {stats.topSellers.length > 0 && (
        <div className="section-card">
          <h3>Топ продавцов</h3>
          <div className="top-list">
            {stats.topSellers.slice(0, 5).map((seller, i) => (
              <div key={seller.senderId} className="top-item">
                <span className="rank">{i + 1}</span>
                <span className="name">
                  {seller.senderName || seller.senderUsername || `#${seller.senderId}`}
                </span>
                <span className="count">{seller.postCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Categories */}
      {stats.categoryCounts.length > 0 && (
        <div className="section-card">
          <h3>Категории</h3>
          <div className="top-list">
            {stats.categoryCounts.slice(0, 5).map((cat, i) => (
              <div key={cat.categoryCode} className="top-item">
                <span className="rank">{i + 1}</span>
                <span className="name">{cat.categoryName}</span>
                <span className="count">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price stats */}
      {stats.pricesByCategory.length > 0 && (
        <div className="section-card">
          <h3>Цены</h3>
          <div className="price-list">
            {stats.pricesByCategory.slice(0, 5).map((price) => (
              <div key={`${price.categoryCode}-${price.currency}`} className="price-item">
                <div className="price-category">{price.categoryName}</div>
                <div className="price-stats">
                  <span className="price-range">
                    {formatPrice(price.min, price.currency)} – {formatPrice(price.max, price.currency)}
                  </span>
                  <span className="price-avg">
                    сред: {formatPrice(price.avg, price.currency)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatPrice(value: number, currency: string): string {
  const formatter = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  try {
    return formatter.format(value);
  } catch {
    // Fallback for unsupported currencies
    return `${value.toLocaleString()} ${currency}`;
  }
}
