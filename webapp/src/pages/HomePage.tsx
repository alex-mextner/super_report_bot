import { useState } from "react";
import { GroupFilter } from "../components/GroupFilter";
import { SearchBar } from "../components/SearchBar";
import { ProductList } from "../components/ProductList";
import { useGroups } from "../hooks/useGroups";
import { useProducts } from "../hooks/useProducts";
import { useUser } from "../hooks/useUser";
import { useAnalyzeBatch } from "../hooks/useAnalyzeBatch";
import "./HomePage.css";

export function HomePage() {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { isAdmin } = useUser();
  const { groups } = useGroups();
  const { products, loading, hasMore, loadMore } = useProducts(
    groupId ?? undefined,
    search || undefined
  );
  const {
    analyzeBatch,
    loading: analyzing,
    error: analyzeError,
    getResult,
    hasResults,
  } = useAnalyzeBatch();

  const handleAnalyzeAll = () => {
    analyzeBatch(groupId ?? undefined, 50);
  };

  return (
    <div className="home-page">
      <GroupFilter groups={groups} selected={groupId} onSelect={setGroupId} />
      <SearchBar value={search} onChange={setSearch} />

      {isAdmin && (
        <div className="analyze-all-container">
          <button
            className={`analyze-all-btn ${analyzing ? "loading" : ""}`}
            onClick={handleAnalyzeAll}
            disabled={analyzing || products.length === 0}
          >
            {analyzing ? "Раскладываю..." : "Разложить по полочкам"}
          </button>
          {analyzeError && <div className="analyze-all-error">{analyzeError}</div>}
        </div>
      )}

      <ProductList
        products={products}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        getAnalysis={hasResults ? getResult : undefined}
      />
    </div>
  );
}
