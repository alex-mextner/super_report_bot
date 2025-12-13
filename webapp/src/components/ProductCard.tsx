import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Product } from "../types";
import { apiClient } from "../api/client";
import { useLocale } from "../context/LocaleContext";
import type { TranslationKey } from "../i18n";
import "./ProductCard.css";

interface Props {
  product: Product;
  showScore?: boolean;
}

interface MediaItem {
  index: number;
  type: "photo" | "video";
  url: string;
}

function formatDate(
  timestamp: number,
  locale: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return t("minutesAgo", { n: minutes });
  if (hours < 24) return t("hoursAgo", { n: hours });
  if (days < 7) return t("daysAgo", { n: days });

  return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function ProductCard({ product, showScore }: Props) {
  const navigate = useNavigate();
  const { intlLocale, t } = useLocale();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    // Check if product has media
    apiClient<{ items: MediaItem[] }>(
      `/api/products/${product.message_id}/${product.group_id}/media`
    )
      .then((data) => {
        const firstPhoto = data.items.find((m) => m.type === "photo");
        if (firstPhoto) {
          setThumbnailUrl(firstPhoto.url);
        }
      })
      .catch(() => {
        // Ignore errors - no media available
      });
  }, [product.message_id, product.group_id]);

  return (
    <div className="product-card" onClick={() => navigate(`/product/${product.id}`)}>
      {thumbnailUrl && (
        <div className="product-thumbnail">
          <img src={thumbnailUrl} alt="" loading="lazy" />
        </div>
      )}

      <div className="product-content">
        <div className="product-header">
          <span className="product-group">{product.group_title}</span>
          {product.topic_title && (
            <span className="product-topic">{product.topic_title}</span>
          )}
          <span className="product-date">{formatDate(product.message_date, intlLocale, t)}</span>
          {showScore && product._score !== undefined && (
            <span className={`product-score score-${product._matchType}`}>
              {Math.round(product._score * 100)}%
            </span>
          )}
        </div>

        <p className="product-text">
          {product.text.length > 200 ? product.text.slice(0, 200) + "..." : product.text}
        </p>
      </div>
    </div>
  );
}
