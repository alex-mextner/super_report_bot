import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTelegram } from "../hooks/useTelegram";
import { useProduct, useSimilarProducts } from "../hooks/useProducts";
import { useDeepAnalyze } from "../hooks/useDeepAnalyze";
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

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("ru-RU", {
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

  const productId = Number(id);
  const { product, loading, error } = useProduct(productId);
  const { similar, loading: similarLoading } = useSimilarProducts(productId);
  const { analyze, loading: analyzing, result: analysisResult, error: analysisError } = useDeepAnalyze();

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
    return <div className="product-page-loading">Загрузка...</div>;
  }

  if (error || !product) {
    return <div className="product-page-error">Не найдено</div>;
  }

  return (
    <div className="product-page">
      <div className="product-detail">
        <div className="product-meta">
          <span className="product-group">{product.group_title}</span>
          <span className="product-date">{formatDate(product.message_date)}</span>
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
                  alt={`Фото ${activeImage + 1}`}
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
                      <img src={item.url} alt={`Превью ${index + 1}`} />
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
            <span className="price-label">Цена:</span>
            <span className="price-value">{product.price_raw}</span>
          </div>
        )}

        <div className="product-actions">
          <button
            className="goto-message-btn"
            onClick={() => openLink(product.messageLink)}
          >
            Перейти к сообщению
          </button>

          <button
            className="analyze-btn"
            onClick={() => analyze(product.text, product.message_id, product.group_id)}
            disabled={analyzing}
          >
            {analyzing ? "Анализирую..." : "Анализ цены"}
          </button>
        </div>

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
