import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { GroupFilter } from "../components/GroupFilter";
import { SearchBar } from "../components/SearchBar";
import { ProductList } from "../components/ProductList";
import { useGroups } from "../hooks/useGroups";
import { useProducts } from "../hooks/useProducts";
import { useUser } from "../hooks/useUser";
import { useLocale } from "../context/LocaleContext";
import "./HomePage.css";

export function HomePage() {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { groups } = useGroups();

  // Select first group by default
  useEffect(() => {
    if (groups.length > 0 && groupId === null) {
      setGroupId(groups[0].id);
    }
  }, [groups, groupId]);
  const { products, loading, hasMore, loadMore, total, searchStats } = useProducts(
    groupId ?? undefined,
    search || undefined
  );
  const { isAdmin } = useUser();
  const { t } = useLocale();

  return (
    <div className="home-page">
      <div className="home-header">
        <Link to="/subscriptions" className="subscriptions-link">
          {t("mySubscriptions")}
        </Link>
        {isAdmin && (
          <Link to="/admin" className="admin-link">
            {t("admin")}
          </Link>
        )}
      </div>
      <GroupFilter groups={groups} selected={groupId} onSelect={setGroupId} />
      <SearchBar value={search} onChange={setSearch} selectedGroupId={groupId} />
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
