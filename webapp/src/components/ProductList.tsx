import { useRef, useCallback } from "react";
import { ProductCard } from "./ProductCard";
import type { Product } from "../types";
import "./ProductList.css";

interface Props {
  products: Product[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function ProductList({ products, loading, hasMore, onLoadMore }: Props) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading) return;

      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          onLoadMore();
        }
      });

      if (node) {
        observerRef.current.observe(node);
      }
    },
    [loading, hasMore, onLoadMore]
  );

  if (products.length === 0 && !loading) {
    return <div className="product-list-empty">Ничего не найдено</div>;
  }

  return (
    <div className="product-list">
      {products.map((product, index) => (
        <div
          key={product.id}
          ref={index === products.length - 1 ? lastElementRef : null}
        >
          <ProductCard product={product} />
        </div>
      ))}
      {loading && <div className="product-list-loading">Загрузка...</div>}
    </div>
  );
}
