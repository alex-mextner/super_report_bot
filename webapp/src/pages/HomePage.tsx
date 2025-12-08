import { useState } from "react";
import { GroupFilter } from "../components/GroupFilter";
import { SearchBar } from "../components/SearchBar";
import { ProductList } from "../components/ProductList";
import { useGroups } from "../hooks/useGroups";
import { useProducts } from "../hooks/useProducts";

export function HomePage() {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { groups } = useGroups();
  const { products, loading, hasMore, loadMore } = useProducts(
    groupId ?? undefined,
    search || undefined
  );

  return (
    <div className="home-page">
      <GroupFilter groups={groups} selected={groupId} onSelect={setGroupId} />
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
