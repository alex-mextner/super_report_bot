import { useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useTelegram } from "../hooks/useTelegram";
import { useProduct, useSimilarProducts } from "../hooks/useProducts";
import { SellerContacts } from "../components/SellerContacts";
import { SimilarProducts } from "../components/SimilarProducts";
import "./ProductPage.css";

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

        <p className="product-full-text">{product.text}</p>

        {product.price_raw && (
          <div className="product-price-block">
            <span className="price-label">Цена:</span>
            <span className="price-value">{product.price_raw}</span>
          </div>
        )}

        <button
          className="goto-message-btn"
          onClick={() => openLink(product.messageLink)}
        >
          Перейти к сообщению
        </button>

        <SellerContacts contacts={product.contacts} />
        <SimilarProducts products={similar} loading={similarLoading} />
      </div>
    </div>
  );
}
