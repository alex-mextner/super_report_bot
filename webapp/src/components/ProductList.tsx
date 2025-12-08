import { useRef, useCallback, useMemo } from "react";
import { ProductCard } from "./ProductCard";
import type { Product, SearchStats } from "../types";
import "./ProductList.css";

interface Props {
  products: Product[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  total?: number;
  searchStats?: SearchStats | null;
  isSearching?: boolean;
}

interface ProductGroup {
  type: "exact" | "good" | "partial";
  label: string;
  products: Product[];
}

export function ProductList({
  products,
  loading,
  hasMore,
  onLoadMore,
  total,
  searchStats,
  isSearching
}: Props) {
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

  // Group products by match type when searching
  const groups = useMemo((): ProductGroup[] => {
    if (!isSearching) {
      return [{ type: "exact", label: "", products }];
    }

    const exact = products.filter((p) => p._matchType === "exact");
    const good = products.filter((p) => p._matchType === "good");
    const partial = products.filter((p) => p._matchType === "partial");

    const result: ProductGroup[] = [];
    if (exact.length > 0) {
      result.push({ type: "exact", label: "Точные совпадения", products: exact });
    }
    if (good.length > 0) {
      result.push({ type: "good", label: "Похожие", products: good });
    }
    if (partial.length > 0) {
      result.push({ type: "partial", label: "Возможно подходит", products: partial });
    }
    return result;
  }, [products, isSearching]);

  if (products.length === 0 && !loading) {
    return <div className="product-list-empty">Ничего не найдено</div>;
  }

  return (
    <div className="product-list">
      {isSearching && searchStats && (
        <div className="search-stats">
          Найдено: {total}
          {searchStats.exactCount > 0 && (
            <span className="stat-exact"> · {searchStats.exactCount} точных</span>
          )}
          {searchStats.goodCount > 0 && (
            <span className="stat-good"> · {searchStats.goodCount} похожих</span>
          )}
          {searchStats.partialCount > 0 && (
            <span className="stat-partial"> · {searchStats.partialCount} частичных</span>
          )}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.type} className={`product-group product-group-${group.type}`}>
          {group.label && <div className="product-group-header">{group.label}</div>}
          {group.products.map((product, index) => {
            const isLast =
              group === groups[groups.length - 1] &&
              index === group.products.length - 1;
            return (
              <div
                key={product.id}
                ref={isLast ? lastElementRef : null}
              >
                <ProductCard product={product} showScore={isSearching} />
              </div>
            );
          })}
        </div>
      ))}

      {loading && <div className="product-list-loading">Загрузка...</div>}
    </div>
  );
}
