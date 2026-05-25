import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  MoreVertical,
  Search,
  Send,
  UserCog,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ticketsApi, type ConversationFilter, type ConversationWithContact } from "@/lib/api/tickets";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/** Converte string em Date apenas se for válida; evita "Invalid time value". */
function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function TicketsPage() {
  const [filter, setFilter] = useState<ConversationFilter>("open");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["conversations", filter],
    queryFn: () => ticketsApi.listConversations(filter === "all" ? "all" : filter),
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    if (!list.data) return [];
    if (!search.trim()) return list.data;
    const q = search.toLowerCase();
    return list.data.filter(
      (c) =>
        (c.contact?.name ?? "").toLowerCase().includes(q) ||
        (c.contact?.phone ?? "").includes(q) ||
        (c.lastMessagePreview ?? "").toLowerCase().includes(q),
    );
  }, [list.data, search]);

  // auto-pick first conversation
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0]!.id);
    }
    if (selectedId && filtered.length > 0 && !filtered.some((c) => c.id === selectedId)) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selectedId]);

  return (
    <PageContainer className="!p-0">
      <div className="p-8 pb-4">
        <PageHeader title="Tickets" subtitle="Conversas em andamento e atendimentos humanos" />
      </div>
      <div className="mx-8 mb-8 flex h-[calc(100vh-180px)] gap-0 overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {/* Left: list */}
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-3 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversa..."
                className="pl-9"
              />
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as ConversationFilter)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value="open">Abertos</TabsTrigger>
                <TabsTrigger value="closed">Encerrados</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {list.isLoading && (
              <div className="space-y-1 p-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="rounded-md p-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="mt-2 h-3 w-1/2" />
                  </div>
                ))}
              </div>
            )}
            {list.isError && (
              <div className="p-6 text-center">
                <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">Não foi possível carregar.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => list.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            )}
            {!list.isLoading && !list.isError && filtered.length === 0 && (
              <div className="p-8 text-center">
                <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Nenhuma conversa</p>
              </div>
            )}
            {filtered.map((c) => (
              <ConversationListItem
                key={c.id}
                conv={c}
                selected={c.id === selectedId}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
          </div>
        </aside>

        {/* Right: chat */}
        <section className="flex flex-1 flex-col">
          {selectedId ? (
            <ChatWindow conversationId={selectedId} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Selecione uma conversa para visualizar
            </div>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function ConversationListItem({
  conv,
  selected,
  onSelect,
}: {
  conv: ConversationWithContact;
  selected: boolean;
  onSelect: () => void;
}) {
  const isOpen = conv.status === "open" || conv.status === "waiting";
  const parsedCreatedAt = safeDate(conv.createdAt);
  const time = parsedCreatedAt
    ? formatDistanceToNow(parsedCreatedAt, { locale: ptBR, addSuffix: false })
    : "";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary",
        selected && "bg-primary-soft hover:bg-primary-soft",
      )}
    >
      {selected && <span className="absolute left-0 top-0 h-full w-[3px] bg-primary" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{conv.contact?.name || conv.contact?.phone || "Contato"}</span>
          {(conv.unreadCount ?? 0) > 0 && (
            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
              {conv.unreadCount}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{conv.contact?.phone || "—"}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{conv.lastMessagePreview ?? "—"}</p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1.5 text-[10px]",
              isOpen ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground",
            )}
          >
            {isOpen ? "Aberto" : "Encerrado"}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{time}</span>
        </div>
      </div>
    </button>
  );
}

function ChatWindow({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const detail = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => ticketsApi.getConversation(conversationId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [detail.data?.messages?.length]);

  const send = useMutation({
    mutationFn: (content: string) => ticketsApi.sendMessage(conversationId, content),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha ao enviar"),
  });

  const takeover = useMutation({
    mutationFn: () => ticketsApi.takeover(conversationId),
    onSuccess: () => {
      toast.success("Você assumiu a conversa");
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha"),
  });

  const close = useMutation({
    mutationFn: () => ticketsApi.closeConversation(conversationId),
    onSuccess: () => {
      toast.success("Conversa encerrada");
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha"),
  });

  if (detail.isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="border-b border-border p-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex-1 space-y-3 p-4">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
          <Skeleton className="h-14 w-3/5" />
        </div>
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Não foi possível carregar a conversa.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => detail.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  const c = detail.data;
  const isOpen = c.status === "open" || c.status === "waiting";

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">{c.contact?.name || c.contact?.phone || "Contato"}</h2>
          <p className="text-xs text-muted-foreground">{c.contact?.phone || "—"}</p>
        </div>
        {c.currentFlowPath && (
          <div className="ml-auto hidden items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs text-primary md:flex">
            <span className="text-muted-foreground">Etapa do Fluxo:</span>
            <span className="font-medium">{c.currentFlowPath}</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto md:ml-2" aria-label="Mais ações">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => takeover.mutate()} disabled={!isOpen}>
              <UserCog className="h-4 w-4" /> Assumir conversa
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => close.mutate()}
              disabled={!isOpen}
              className="text-danger focus:text-danger"
            >
              <CheckCircle2 className="h-4 w-4" /> Encerrar conversa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-chat-bg p-4 scrollbar-thin">
        {(c.messages ?? []).length === 0 && (
          <p className="text-center text-xs text-muted-foreground">Sem mensagens nesta conversa</p>
        )}
        <div className="space-y-2">
          {(c.messages ?? []).map((m) => (
            <MessageBubble key={m.id} direction={m.direction} content={m.content} createdAt={m.createdAt} />
          ))}
        </div>
      </div>

      {/* Footer */}
      {isOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (!v) return;
            send.mutate(v);
          }}
          className="flex items-center gap-2 border-t border-border bg-card p-3"
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Digite uma mensagem"
            disabled={send.isPending}
          />
          <Button type="submit" disabled={!draft.trim() || send.isPending} aria-label="Enviar">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <div className="border-t border-border bg-secondary px-4 py-3 text-center text-xs text-muted-foreground">
          Conversa encerrada
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  direction,
  content,
  createdAt,
}: {
  direction: "in" | "out";
  content: string;
  createdAt: string;
}) {
  const isOut = direction === "out";
  const parsed = safeDate(createdAt);
  const time = parsed ? format(parsed, "HH:mm") : "";
  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-lg px-3 py-2 shadow-sm",
          isOut ? "bg-chat-out text-foreground" : "bg-card text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
        <span className="mt-1 block text-right text-[10px] text-muted-foreground">{time}</span>
      </div>
    </div>
  );
}
