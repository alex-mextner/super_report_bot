import { useState, useCallback } from "react";
import { apiClient } from "../api/client";

interface PriceSource {
  title: string;
  url: string;
  price: string | null;
}

interface ItemAnalysis {
  name: string;
  extractedPrice: string | null;
  extractedPriceNormalized: number | null;
  extractedCurrency: string | null;
  marketPriceMin: number | null;
  marketPriceMax: number | null;
  marketPriceAvg: number | null;
  marketCurrency: string | null;
  priceInEur: number | null;
  marketAvgInEur: number | null;
  priceVerdict: "good_deal" | "overpriced" | "fair" | "unknown";
  worthBuying: boolean;
  worthBuyingReason: string;
  sources: PriceSource[];
}

interface ScamRisk {
  level: "low" | "medium" | "high";
  score: number;
  flags: string[];
  recommendation: string;
}

interface SimilarProduct {
  id: number;
  groupId: number;
  messageId: number;
  text: string;
  price: number | null;
  currency: string | null;
  date: number;
  link: string | null;
}

export interface DeepAnalysisResult {
  isListing: boolean;
  listingType: "sale" | "rent" | "service" | "other" | null;
  notListingReason: string | null;
  items: ItemAnalysis[];
  scamRisk: ScamRisk;
  overallVerdict: string;
  similarItems: SimilarProduct[];
}

export function useDeepAnalyze() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeepAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (text: string, messageId?: number, groupId?: number) => {
    try {
      setLoading(true);
      setError(null);
      setResult(null);

      const data = await apiClient<DeepAnalysisResult>("/api/analyze-deep", {
        method: "POST",
        body: JSON.stringify({ text, messageId, groupId }),
      });

      setResult(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    analyze,
    loading,
    result,
    error,
    reset,
  };
}
