import { useState, useEffect } from "react";
import { apiClient } from "../api/client";

interface UserInfo {
  userId: number | null;
  isAdmin: boolean;
}

export function useUser() {
  const [user, setUser] = useState<UserInfo>({ userId: null, isAdmin: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const data = await apiClient<UserInfo>("/api/me");
        setUser(data);
      } catch {
        setUser({ userId: null, isAdmin: false });
      } finally {
        setLoading(false);
      }
    }

    fetch();
  }, []);

  return { ...user, loading };
}
