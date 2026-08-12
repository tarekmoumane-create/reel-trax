"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ClientDTO } from "@/lib/types";

interface ClientsCtx {
  clients: ClientDTO[];
  loading: boolean;
  currentClientId: string | null;
  currentClient: ClientDTO | null;
  setCurrentClientId: (id: string) => void;
  reloadClients: () => Promise<ClientDTO[]>;
}

const Ctx = createContext<ClientsCtx | null>(null);

const LS_KEY = "reeltrax.currentClientId";

export function ClientsProvider({ children }: { children: React.ReactNode }) {
  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentClientId, setCurrentId] = useState<string | null>(null);

  const reloadClients = useCallback(async () => {
    const res = await fetch("/api/clients");
    const data: ClientDTO[] = await res.json();
    setClients(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    reloadClients().then((data) => {
      const saved =
        typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
      const exists = saved && data.some((c) => c.id === saved);
      setCurrentId(exists ? saved : data[0]?.id ?? null);
    });
  }, [reloadClients]);

  const setCurrentClientId = useCallback((id: string) => {
    setCurrentId(id);
    if (typeof window !== "undefined") localStorage.setItem(LS_KEY, id);
  }, []);

  // If clients changed and current is gone, fall back to first.
  useEffect(() => {
    if (
      currentClientId &&
      clients.length &&
      !clients.some((c) => c.id === currentClientId)
    ) {
      setCurrentClientId(clients[0].id);
    }
  }, [clients, currentClientId, setCurrentClientId]);

  const currentClient =
    clients.find((c) => c.id === currentClientId) ?? null;

  return (
    <Ctx.Provider
      value={{
        clients,
        loading,
        currentClientId,
        currentClient,
        setCurrentClientId,
        reloadClients,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useClients() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useClients must be used within ClientsProvider");
  return ctx;
}
