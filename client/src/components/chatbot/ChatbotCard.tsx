import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Pencil, PlayCircle, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { Chatbot } from "@/types/domain";
import { chatbotsApi } from "@/lib/api/chatbots";
import { ApiError } from "@/lib/api/client";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ChatbotCardProps {
  chatbot: Chatbot;
}

export function ChatbotCard({ chatbot }: ChatbotCardProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggle = useMutation({
    mutationFn: () => (chatbot.isActive ? chatbotsApi.deactivate(chatbot.id) : chatbotsApi.activate(chatbot.id)),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["chatbots"] });
      const previous = qc.getQueryData<Chatbot[]>(["chatbots"]);
      qc.setQueryData<Chatbot[]>(["chatbots"], (old) =>
        old?.map((c) => (c.id === chatbot.id ? { ...c, isActive: !c.isActive } : c)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["chatbots"], ctx.previous);
      toast.error(err instanceof ApiError ? err.message : "Falha ao alterar status");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["chatbots"] }),
  });

  const duplicate = useMutation({
    mutationFn: () => chatbotsApi.duplicate(chatbot.id),
    onSuccess: () => {
      toast.success("Chatbot duplicado");
      qc.invalidateQueries({ queryKey: ["chatbots"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha ao duplicar"),
  });

  const remove = useMutation({
    mutationFn: () => chatbotsApi.remove(chatbot.id),
    onSuccess: () => {
      toast.success("Chatbot excluido");
      qc.invalidateQueries({ queryKey: ["chatbots"] });
      setConfirmOpen(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha ao excluir"),
  });

  const updatedAt = (() => {
    try {
      return format(parseISO(chatbot.updatedAt), "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return "-";
    }
  })();

  return (
    <Card className="p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-foreground">{chatbot.name}</h3>
          <Badge
            variant="outline"
            className={
              chatbot.isActive
                ? "bg-success-soft text-success border-transparent"
                : "bg-secondary text-muted-foreground border-transparent"
            }
          >
            {chatbot.isActive ? "Ativo" : "Inativo"}
          </Badge>
          {chatbot.type === "ai_generated" && (
            <Badge variant="outline" className="bg-ai-soft text-ai border-transparent">
              IA
            </Badge>
          )}
          {chatbot.type === "ai_agent" && (
            <Badge variant="outline" className="bg-ai-soft text-ai border-transparent">
              Agente IA
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{chatbot.isActive ? "Desativar" : "Ativar"}</span>
          <Switch
            checked={chatbot.isActive}
            onCheckedChange={() => toggle.mutate()}
            disabled={toggle.isPending}
            aria-label={chatbot.isActive ? "Desativar chatbot" : "Ativar chatbot"}
          />
        </div>
      </div>

      {chatbot.description && <p className="mt-2 text-sm text-muted-foreground">{chatbot.description}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Conexoes Ativas" value={chatbot.metrics?.connections ?? 0} />
        <Metric label="Total de Etapas" value={chatbot.metrics?.totalNodes ?? 0} />
        <Metric label="Mensagens Processadas" value={chatbot.metrics?.messagesProcessed ?? 0} />
        <Metric label="Ultima Modificacao" value={updatedAt} small />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => navigate(`/chatbots/${chatbot.id}`)}>
          <Pencil className="h-4 w-4" />
          Editar Fluxo
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (!chatbot.activeFlowId) {
              toast.error("Este chatbot ainda nao tem um fluxo ativo para testar");
              return;
            }
            navigate(`/chatbots/${chatbot.id}?tester=1`);
          }}
        >
          <PlayCircle className="h-4 w-4" />
          Testar Bot
        </Button>
        <Button variant="ghost" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
          <Copy className="h-4 w-4" />
          Duplicar
        </Button>
        <Button
          variant="ghost"
          onClick={() => setConfirmOpen(true)}
          className="ml-auto text-danger hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
          Excluir
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir chatbot?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. O chatbot <strong>{chatbot.name}</strong> e todos os seus fluxos serao removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              disabled={remove.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Metric({ label, value, small }: { label: string; value: number | string; small?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={small ? "mt-1 text-base font-semibold text-foreground" : "mt-1 text-2xl font-bold text-foreground"}>
        {value}
      </p>
    </div>
  );
}
