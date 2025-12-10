import { useState } from "react";
import { Link } from "react-router-dom";
import { GroupFilter } from "../components/GroupFilter";
import { SearchBar } from "../components/SearchBar";
import { ProductList } from "../components/ProductList";
import { useGroups } from "../hooks/useGroups";
import { useProducts } from "../hooks/useProducts";
import { useUser } from "../hooks/useUser";
import "./HomePage.css";

export function HomePage() {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { groups } = useGroups();
  const { products, loading, hasMore, loadMore, total, searchStats } = useProducts(
    groupId ?? undefined,
    search || undefined
  );
  const { isAdmin } = useUser();

  return (
    <div className="home-page">
      <div className="home-header">
        <Link to="/subscriptions" className="subscriptions-link">
          Мои подписки
        </Link>
        {isAdmin && (
          <Link to="/admin" className="admin-link">
            Админ
          </Link>
        )}
      </div>
      <GroupFilter groups={groups} selected={groupId} onSelect={setGroupId} />
      <SearchBar value={search} onChange={setSearch} />
      <ProductList
        products={products}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        total={total}
        searchStats={searchStats}
        isSearching={!!search}
      />
    </div>
  );
}
