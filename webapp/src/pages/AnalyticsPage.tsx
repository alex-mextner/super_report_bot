import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGroupAnalytics } from "../hooks/useGroupAnalytics";
import { useTelegram } from "../hooks/useTelegram";
import { useUser } from "../hooks/useUser";
import { useLocale } from "../context/LocaleContext";
import { apiClient } from "../api/client";
import "./AnalyticsPage.css";

export function AnalyticsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { webApp } = useTelegram();
  const { isAdmin } = useUser();
  const { intlLocale, t } = useLocale();
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
          {generating ? t("generatingAnalytics") : t("loading")}
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="analytics-page">
        <div className="analytics-error">
          <p>{t("analyticsNotGenerated")}</p>
          <p className="analytics-hint">{t("autoGeneration")}</p>
          {isAdmin && (
            <button className="generate-btn" onClick={handleGenerate}>
              {t("generateNow")}
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
          {t("updatedAt", { date: new Date(computedAt * 1000).toLocaleDateString(intlLocale) })}
        </div>
      </div>

      {/* Summary stats */}
      <div className="stats-summary">
        <div className="stat-card">
          <div className="stat-value">{stats.uniqueSellersCount}</div>
          <div className="stat-label">{t("sellers")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalMessages}</div>
          <div className="stat-label">{t("messages")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.botFoundPosts.notified}</div>
          <div className="stat-label">{t("foundByBot")}</div>
        </div>
      </div>

      {/* AI Insights */}
      {insights && (
        <div className="insights-card">
          <h3>{t("aiInsights")}</h3>
          <p>{insights}</p>
        </div>
      )}

      {/* Activity chart */}
      {stats.activityByDay.length > 0 && (
        <div className="section-card">
          <h3>{t("activity", { days: stats.periodDays })}</h3>
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
          <h3>{t("topSellers")}</h3>
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
          <h3>{t("categories")}</h3>
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
          <h3>{t("prices")}</h3>
          <div className="price-list">
            {stats.pricesByCategory.slice(0, 5).map((price) => (
              <div key={`${price.categoryCode}-${price.currency}`} className="price-item">
                <div className="price-category">{price.categoryName}</div>
                <div className="price-stats">
                  <span className="price-range">
                    {formatPrice(price.min, price.currency, intlLocale)} – {formatPrice(price.max, price.currency, intlLocale)}
                  </span>
                  <span className="price-avg">
                    {t("avgPrice", { price: formatPrice(price.avg, price.currency, intlLocale) })}
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

function formatPrice(value: number, currency: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  try {
    return formatter.format(value);
  } catch {
    // Fallback for unsupported currencies
    return `${value.toLocaleString(locale)} ${currency}`;
  }
}
