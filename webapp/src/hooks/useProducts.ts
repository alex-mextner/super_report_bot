import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client";
import type { Product, ProductsResponse, ProductWithContacts, SimilarResponse } from "../types";

export function useProducts(category?: string, search?: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchProducts = useCallback(
    async (reset = false) => {
      try {
        setLoading(true);
        const currentOffset = reset ? 0 : offset;

        const params = new URLSearchParams();
        if (category) params.set("category", category);
        if (search) params.set("search", search);
        params.set("offset", String(currentOffset));
        params.set("limit", "20");

        const data = await apiClient<ProductsResponse>(
          `/api/products?${params.toString()}`
        );

        if (reset) {
          setProducts(data.items);
        } else {
          setProducts((prev) => [...prev, ...data.items]);
        }

        setHasMore(data.hasMore);
        setOffset(currentOffset + data.items.length);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load products");
      } finally {
        setLoading(false);
      }
    },
    [category, search, offset]
  );

  useEffect(() => {
    setOffset(0);
    fetchProducts(true);
  }, [category, search]);

  const loadMore = () => {
    if (!loading && hasMore) {
      fetchProducts(false);
    }
  };

  return { products, loading, error, hasMore, loadMore };
}

export function useProduct(id: number) {
  const [product, setProduct] = useState<ProductWithContacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        setLoading(true);
        const data = await apiClient<ProductWithContacts>(`/api/products/${id}`);
        setProduct(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load product");
      } finally {
        setLoading(false);
      }
    }

    fetch();
  }, [id]);

  return { product, loading, error };
}

export function useSimilarProducts(id: number) {
  const [similar, setSimilar] = useState<SimilarResponse["items"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        setLoading(true);
        const data = await apiClient<SimilarResponse>(`/api/products/${id}/similar`);
        setSimilar(data.items);
      } catch {
        setSimilar([]);
      } finally {
        setLoading(false);
      }
    }

    fetch();
  }, [id]);

  return { similar, loading };
}
