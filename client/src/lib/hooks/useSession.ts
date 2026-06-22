import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { authApi, type LoginInput } from "@/lib/api/auth";
import { ApiError, apiBaseUrl, registerForceLogoutHandler } from "@/lib/api/client";
import type { Session } from "@/types/domain";

export const SESSION_KEY = ["session"] as const;

/** When no backend is configured, return a stub session so the UI is navigable
 * for design review (Lovable, Stackblitz, etc.). NEVER ativa em build de
 * produção — lá, apiBaseUrl vazio significa "usar rewrite proxy da Vercel",
 * não "rodar em modo demo". */
const PREVIEW_SESSION: Session = {
  user: {
    id: "preview-user",
    organizationId: "preview-org",
    name: "Visitante (Preview)",
    email: "preview@jetgo.local",
    role: "admin",
  },
  organization: {
    id: "preview-org",
    name: "JetGO Preview",
    slug: "preview",
    plan: "preview",
    settings: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const isPreviewMode =
  !apiBaseUrl &&
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  LOCAL_PREVIEW_HOSTS.has(window.location.hostname);

export function useSession() {
  const query = useQuery<Session, ApiError>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      if (isPreviewMode) return PREVIEW_SESSION;
      return authApi.me();
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return query;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: (session) => {
      qc.setQueryData(SESSION_KEY, session);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      qc.setQueryData(SESSION_KEY, null);
      qc.clear();
    },
  });
}

/** Wires ApiError 401 → clear session cache so ProtectedRoute redirects. */
export function useForceLogoutBridge(): void {
  const qc = useQueryClient();
  useEffect(() => {
    registerForceLogoutHandler(() => {
      qc.setQueryData(SESSION_KEY, null);
      qc.invalidateQueries({ queryKey: SESSION_KEY });
    });
    return () => registerForceLogoutHandler(null);
  }, [qc]);
}
