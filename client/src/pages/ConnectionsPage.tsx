import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageContainer, PageHeader } from "@/components/layout/PageHeader";
import { NewConnectionDialog } from "@/components/connection/NewConnectionDialog";
import { SendTestMessageDialog } from "@/components/connection/SendTestMessageDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { connectionsApi, type EvolutionStatusResponse } from "@/lib/api/connections";
import { cn } from "@/lib/utils";
import type { WhatsAppConnection } from "@/types/domain";

export default function ConnectionsPage() {
  const [openNew, setOpenNew] = useState(false);
  const [testConnection, setTestConnection] = useState<WhatsAppConnection | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: () => connectionsApi.list(),
    staleTime: 30_000,
  });

  const statusQuery = useQuery({
    queryKey: ["evolution-status"],
    queryFn: () => connectionsApi.getStatus(),
    retry: false,
    staleTime: 30_000,
  });

  return (
    <PageContainer>
      <PageHeader
        title="Gerenciar conexoes WhatsApp"
        subtitle="A Evolution fica protegida no backend e o painel fala apenas com /api/v1."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                statusQuery.refetch();
                connectionsQuery.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
            <Button onClick={() => setOpenNew(true)}>
              <Plus className="h-4 w-4" />
              Nova conexao
            </Button>
          </>
        }
      />

      <StatusCard
        isLoading={statusQuery.isLoading}
        isError={statusQuery.isError}
        error={statusQuery.error}
        data={statusQuery.data}
        onRetry={() => statusQuery.refetch()}
      />

      {connectionsQuery.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="p-5">
              <div className="flex gap-3">
                <Skeleton className="h-12 w-12 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="mt-4 h-8 w-full" />
            </Card>
          ))}
        </div>
      )}

      {!connectionsQuery.isLoading && connectionsQuery.isError && (
        <Card className="p-10 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold text-foreground">Nao foi possivel carregar as conexoes</h3>
          <p className="mt-1 text-sm text-muted-foreground">Verifique a conexao com o backend e tente novamente.</p>
          <Button variant="outline" className="mt-4" onClick={() => connectionsQuery.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      )}

      {!connectionsQuery.isLoading &&
        !connectionsQuery.isError &&
        connectionsQuery.data &&
        connectionsQuery.data.length === 0 && (
          <Card className="p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
              <Smartphone className="h-7 w-7 text-success" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma conexao configurada</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione um numero WhatsApp para comecar a receber atendimentos.
            </p>
            <Button className="mt-5" onClick={() => setOpenNew(true)}>
              <Plus className="h-4 w-4" />
              Nova conexao
            </Button>
          </Card>
        )}

      {!connectionsQuery.isLoading &&
        !connectionsQuery.isError &&
        connectionsQuery.data &&
        connectionsQuery.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {connectionsQuery.data.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                onSendTest={() => setTestConnection(connection)}
              />
            ))}
          </div>
        )}

      <NewConnectionDialog open={openNew} onOpenChange={setOpenNew} />
      {testConnection && (
        <SendTestMessageDialog
          connection={testConnection}
          open={!!testConnection}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setTestConnection(null);
          }}
        />
      )}
    </PageContainer>
  );
}

function StatusCard({
  isLoading,
  isError,
  error,
  data,
  onRetry,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data?: EvolutionStatusResponse;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <Card className="mb-6 p-5">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-3 h-4 w-72" />
      </Card>
    );
  }

  if (isError) {
    const message = error instanceof ApiError ? error.message : "Nao foi possivel consultar a Evolution API.";
    return (
      <Card className="mb-6 border-warning/40 bg-warning/5 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-warning" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Evolution API indisponivel</h3>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Tentar de novo
          </Button>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success">
            <Wifi className="h-3.5 w-3.5" />
            Evolution conectada
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            {data.info?.message || "Conexao com a Evolution API validada"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.baseUrl}
            {data.info?.version ? ` · versao ${data.info.version}` : ""}
          </p>
        </div>

        {data.defaultInstance && (
          <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{data.defaultInstance.instanceName}</div>
            <div>
              {data.defaultInstance.error
                ? data.defaultInstance.error
                : `Status ${data.defaultInstance.status || "desconhecido"}`}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ConnectionCard({
  connection,
  onSendTest,
}: {
  connection: WhatsAppConnection;
  onSendTest: () => void;
}) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isConnected = connection.status === "connected";
  const isPending = connection.status === "pending_qr";

  const refreshQr = useMutation({
    mutationFn: () => connectionsApi.refreshQr(connection.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Novo QR Code gerado");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha ao gerar QR"),
  });

  const remove = useMutation({
    mutationFn: () => connectionsApi.remove(connection.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Conexao removida");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha ao remover"),
  });

  const lastActivity = connection.lastActivityAt
    ? formatDistanceToNow(new Date(connection.lastActivityAt), { locale: ptBR, addSuffix: true })
    : "-";

  return (
    <>
      <Card className="relative p-5">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Remover conexao"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-success-soft">
            <Phone className="h-6 w-6 text-success" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">{connection.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{connection.phoneNumber || "Sem numero sincronizado"}</p>
            {connection.evolutionInstance && (
              <p className="truncate text-[11px] text-muted-foreground">{connection.evolutionInstance}</p>
            )}
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  isConnected ? "bg-success" : isPending ? "bg-warning" : "bg-danger",
                )}
              />
              <span className="text-xs font-medium text-foreground">
                {isConnected ? "Conectado" : isPending ? "Aguardando QR" : "Desconectado"}
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">{lastActivity}</span>
            </div>
          </div>
        </div>

        {connection.metricsToday && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
            <MessageCircle className="h-3 w-3" />
            {connection.metricsToday.conversations} atendimentos hoje
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onSendTest}>
            <Send className="h-3.5 w-3.5" />
            Enviar teste
          </Button>
        </div>

        {!isConnected && (
          <QrBlock connection={connection} onRefresh={() => refreshQr.mutate()} pending={refreshQr.isPending} />
        )}
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conexao?</AlertDialogTitle>
            <AlertDialogDescription>
              A conexao <strong>{connection.name}</strong> sera desconectada. Voce pode adicionar novamente depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => remove.mutate()}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
            >
              <Trash2 className="h-4 w-4" />
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function QrBlock({
  connection,
  onRefresh,
  pending,
}: {
  connection: WhatsAppConnection;
  onRefresh: () => void;
  pending: boolean;
}) {
  const expires = connection.qrExpiresAt ? new Date(connection.qrExpiresAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = expires ? Math.max(0, Math.floor((expires - now) / 1000)) : 0;
  const total = 60;
  const progress = expires ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0;
  const mm = String(Math.floor(remaining / 60)).padStart(1, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="mt-4 rounded-md border border-border bg-secondary p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">QR Code</span>
        {expires && <span className="text-xs font-mono text-warning">{`${mm}:${ss}`}</span>}
      </div>
      {expires && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
          <div className="h-full bg-warning transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="mt-3 flex items-center justify-center rounded-md bg-card p-3">
        {connection.qrCode ? (
          <img
            src={connection.qrCode}
            alt="QR Code de pareamento"
            width={140}
            height={140}
            className="h-[140px] w-[140px]"
          />
        ) : (
          <div className="flex h-[140px] w-[140px] items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
            Aguardando QR...
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Abra o WhatsApp no celular e escaneie para reconectar
      </p>
      <Button variant="outline" size="sm" className="mt-2 w-full text-primary" onClick={onRefresh} disabled={pending}>
        <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} />
        Novo QR Code
      </Button>
    </div>
  );
}
