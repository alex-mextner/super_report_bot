import { useNavigate } from "react-router-dom";
import type { SimilarProduct } from "../types";
import "./SimilarProducts.css";

interface Props {
  products: SimilarProduct[];
  loading: boolean;
}

function formatPriceDiff(diff: number | null): string | null {
  if (diff === null) return null;
  if (diff === 0) return "такая же цена";
  if (diff > 0) return `+${diff.toLocaleString("ru-RU")} ₽`;
  return `${diff.toLocaleString("ru-RU")} ₽`;
}

export function SimilarProducts({ products, loading }: Props) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="similar-products">
        <h3 className="similar-title">Похожие товары</h3>
        <div className="similar-loading">Загрузка...</div>
      </div>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <div className="similar-products">
      <h3 className="similar-title">Похожие товары</h3>
      <div className="similar-list">
        {products.map((product) => (
          <div
            key={product.id}
            className="similar-card"
            onClick={() => navigate(`/product/${product.id}`)}
          >
            <p className="similar-text">
              {product.text.length > 100
                ? product.text.slice(0, 100) + "..."
                : product.text}
            </p>
            <div className="similar-footer">
              {product.price_raw && (
                <span className="similar-price">{product.price_raw}</span>
              )}
              {formatPriceDiff(product.priceDiff) && (
                <span
                  className={`similar-diff ${
                    product.priceDiff! > 0 ? "diff-more" : "diff-less"
                  }`}
                >
                  {formatPriceDiff(product.priceDiff)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
