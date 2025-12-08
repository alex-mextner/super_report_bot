import { useNavigate } from "react-router-dom";
import type { Product } from "../types";
import "./ProductCard.css";

interface Props {
  product: Product;
  showScore?: boolean;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes} мин назад`;
  if (hours < 24) return `${hours} ч назад`;
  if (days < 7) return `${days} дн назад`;

  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function ProductCard({ product, showScore }: Props) {
  const navigate = useNavigate();

  return (
    <div className="product-card" onClick={() => navigate(`/product/${product.id}`)}>
      <div className="product-header">
        <span className="product-group">{product.group_title}</span>
        <span className="product-date">{formatDate(product.message_date)}</span>
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
  );
}
