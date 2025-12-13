import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTelegram } from "../hooks/useTelegram";
import { useLocale } from "../context/LocaleContext";
import { useProduct, useSimilarProducts } from "../hooks/useProducts";
import { useDeepAnalyze } from "../hooks/useDeepAnalyze";
import { usePromotion } from "../hooks/usePromotion";
import { SellerContacts } from "../components/SellerContacts";
import { SimilarProducts } from "../components/SimilarProducts";
import { DeepAnalysis } from "../components/DeepAnalysis";
import { apiClient } from "../api/client";
import "./ProductPage.css";

interface MediaItem {
  index: number;
  type: "photo" | "video";
  url: string;
  width?: number;
  height?: number;
}

function formatDate(timestamp: number, locale: string): string {
  return new Date(timestamp * 1000).toLocaleString(locale, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { webApp, openLink } = useTelegram();
  const { intlLocale, t } = useLocale();

  const productId = Number(id);
  const { product, loading, error } = useProduct(productId);
  const { similar, loading: similarLoading } = useSimilarProducts(productId);
  const { analyze, loading: analyzing, result: analysisResult, error: analysisError } = useDeepAnalyze();

  // Promotion hook - only init after product is loaded
  const { status: promoStatus, loading: promoLoading, promoting, promote } = usePromotion(
    product?.message_id ?? 0,
    product?.group_id ?? 0
  );

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [activeImage, setActiveImage] = useState(0);

  // Load media for product
  useEffect(() => {
    if (product) {
      apiClient<{ items: MediaItem[] }>(
        `/api/products/${product.message_id}/${product.group_id}/media`
      )
        .then((data) => setMedia(data.items))
        .catch(() => setMedia([]));
    }
  }, [product]);

  // Setup back button
  useEffect(() => {
    if (webApp) {
      webApp.BackButton.show();
      const handler = () => navigate(-1);
      webApp.BackButton.onClick(handler);

      return () => {
        webApp.BackButton.hide();
        webApp.BackButton.offClick(handler);
      };
    }
  }, [webApp, navigate]);

  if (loading) {
    return <div className="product-page-loading">{t("loading")}</div>;
  }

  if (error || !product) {
    return <div className="product-page-error">{t("notFound")}</div>;
  }

  return (
    <div className="product-page">
      <div className="product-detail">
        <div className="product-meta">
          <span className="product-group">{product.group_title}</span>
          <span className="product-date">{formatDate(product.message_date, intlLocale)}</span>
        </div>

        {media.length > 0 && (
          <div className="product-gallery">
            <div className="gallery-main">
              {media[activeImage]?.type === "video" ? (
                <video
                  src={media[activeImage].url}
                  className="gallery-media"
                  controls
                  playsInline
                />
              ) : (
                <img
                  src={media[activeImage]?.url}
                  alt={t("photoAlt", { n: activeImage + 1 })}
                  className="gallery-media"
                />
              )}
            </div>
            {media.length > 1 && (
              <div className="gallery-thumbnails">
                {media.map((item, index) => (
                  <button
                    key={index}
                    className={`gallery-thumb ${index === activeImage ? "active" : ""}`}
                    onClick={() => setActiveImage(index)}
                  >
                    {item.type === "video" ? (
                      <div className="thumb-video">
                        <span className="thumb-video-icon">▶</span>
                      </div>
                    ) : (
                      <img src={item.url} alt={t("previewAlt", { n: index + 1 })} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="product-full-text">{product.text}</p>

        {product.price_raw && (
          <div className="product-price-block">
            <span className="price-label">{t("price")}</span>
            <span className="price-value">{product.price_raw}</span>
          </div>
        )}

        <div className="product-actions">
          <button
            className="goto-message-btn"
            onClick={() => openLink(product.messageLink)}
          >
            {t("goToMessage")}
          </button>

          <button
            className="analyze-btn"
            onClick={() => analyze(product.text, product.message_id, product.group_id)}
            disabled={analyzing}
          >
            {analyzing ? t("analyzing") : t("priceAnalysis")}
          </button>
        </div>

        {!promoLoading && promoStatus && (
          <div className="promotion-section">
            {promoStatus.isPromoted ? (
              <div className="promotion-active">
                {t("promotedUntil", { date: new Date(promoStatus.endsAt! * 1000).toLocaleDateString(intlLocale) })}
              </div>
            ) : promoStatus.canPromote ? (
              <div className="promotion-buttons">
                <span className="promotion-label">{t("promote")}</span>
                <div className="promotion-options">
                  <button onClick={() => promote(3)} disabled={promoting}>
                    {t("promoDays3")}
                  </button>
                  <button onClick={() => promote(7)} disabled={promoting}>
                    {t("promoDays7")}
                  </button>
                  <button onClick={() => promote(30)} disabled={promoting}>
                    {t("promoDays30")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="promotion-unavailable">
                {t("promotionOwnerOnly")}
              </div>
            )}
          </div>
        )}

        {analysisError && (
          <div className="analysis-error">{analysisError}</div>
        )}

        {analysisResult && <DeepAnalysis result={analysisResult} />}

        <SellerContacts contacts={product.contacts} />
        <SimilarProducts products={similar} loading={similarLoading} />
      </div>
    </div>
  );
}
