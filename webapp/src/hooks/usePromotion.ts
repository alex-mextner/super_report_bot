import { useState, useEffect } from "react";
import { apiClient } from "../api/client";
import { useTelegram } from "./useTelegram";

interface PromotionStatus {
  canPromote: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  isPromoted: boolean;
  endsAt: number | null;
}

export function usePromotion(messageId: number, groupId: number) {
  const { webApp } = useTelegram();
  const [status, setStatus] = useState<PromotionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    apiClient<PromotionStatus>(`/api/promotion/check/${messageId}/${groupId}`)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [messageId, groupId]);

  const promote = async (days: 3 | 7 | 30) => {
    setPromoting(true);
    try {
      const result = await apiClient<{ invoiceLink: string }>(
        "/api/promotion/invoice",
        {
          method: "POST",
          body: JSON.stringify({ messageId, groupId, days }),
        }
      );

      if (result.invoiceLink && webApp) {
        // Open Telegram payment (everyone pays, including admin)
        webApp.openInvoice(result.invoiceLink, (invoiceStatus: string) => {
          if (invoiceStatus === "paid") {
            // Refresh promotion status after payment
            apiClient<PromotionStatus>(`/api/promotion/check/${messageId}/${groupId}`)
              .then(setStatus);
          }
        });
        return { success: true };
      }
      return { success: false };
    } catch (error) {
      console.error("Promotion error:", error);
      return { success: false, error };
    } finally {
      setPromoting(false);
    }
  };

  return { status, loading, promoting, promote };
}
