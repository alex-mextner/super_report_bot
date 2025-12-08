import { useState } from "react";
import { CategoryFilter } from "../components/CategoryFilter";
import { SearchBar } from "../components/SearchBar";
import { ProductList } from "../components/ProductList";
import { useCategories } from "../hooks/useCategories";
import { useProducts } from "../hooks/useProducts";

export function HomePage() {
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { categories } = useCategories();
  const { products, loading, hasMore, loadMore } = useProducts(
    category || undefined,
    search || undefined
  );

  const hasCategories = categories.length > 0;

  return (
    <div className="home-page">
      {hasCategories && (
        <CategoryFilter
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />
      )}
      <SearchBar value={search} onChange={setSearch} />
      <ProductList
        products={products}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
