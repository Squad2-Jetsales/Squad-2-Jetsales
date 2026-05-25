import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Play, RotateCcw, Send, User } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { flowsApi } from "@/lib/api/flows";
import { ApiError } from "@/lib/api/client";

interface TesterMessage {
  id: string;
  role: "bot" | "user";
  text: string;
}

interface Props {
  flowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

function mapBotMessages(
  responses: Array<{ message?: string | null }> | undefined,
  offset = 0,
): TesterMessage[] {
  return (responses ?? [])
    .filter((item) => item.message && item.message.trim().length > 0)
    .map((item, index) => ({
      id: `bot-${offset + index}`,
      role: "bot" as const,
      text: item.message!.trim(),
    }));
}

export function FlowTesterDialog({ flowId, open, onOpenChange, title }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TesterMessage[]>([]);
  const [input, setInput] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const startMutation = useMutation({
    mutationFn: () => flowsApi.startSession(flowId),
    onSuccess: (result) => {
      setSessionId(result.sessionId);
      setMessages(mapBotMessages(result.responses));
      setIsComplete(Boolean(result.isComplete));
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Falha ao iniciar o teste do fluxo");
    },
  });

  const sendMutation = useMutation({
    mutationFn: ({ activeSessionId, value }: { activeSessionId: string; value: string }) =>
      flowsApi.processInput(activeSessionId, value),
    onSuccess: (result, variables) => {
      setMessages((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: "user", text: variables.value },
        ...mapBotMessages(result.responses, current.length + 1),
      ]);
      setIsComplete(Boolean(result.isComplete));
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Falha ao enviar a mensagem de teste");
    },
  });

  const restartMutation = useMutation({
    mutationFn: async () => {
      if (sessionId) {
        await flowsApi.endSession(sessionId);
      }
      return flowsApi.startSession(flowId);
    },
    onSuccess: (result) => {
      setSessionId(result.sessionId);
      setMessages(mapBotMessages(result.responses));
      setInput("");
      setIsComplete(Boolean(result.isComplete));
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Falha ao reiniciar o teste do fluxo");
    },
  });

  useEffect(() => {
    if (!open) {
      setInput("");
      setMessages([]);
      setSessionId(null);
      setIsComplete(false);
      return;
    }

    setInput("");
    setMessages([]);
    setSessionId(null);
    setIsComplete(false);
    startMutation.reset();
    sendMutation.reset();
    restartMutation.reset();
    startMutation.mutate();
  }, [flowId, open]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const isBusy = startMutation.isPending || sendMutation.isPending || restartMutation.isPending;
  const canSend = useMemo(
    () => Boolean(sessionId) && input.trim().length > 0 && !isBusy && !isComplete,
    [input, isBusy, isComplete, sessionId],
  );

  const handleSend = () => {
    const value = input.trim();
    if (!sessionId || !value || isBusy || isComplete) return;
    setInput("");
    sendMutation.mutate({ activeSessionId: sessionId, value });
  };

  const handleRestart = () => {
    if (isBusy) return;
    restartMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Testar Bot</DialogTitle>
          <DialogDescription>
            Simule uma conversa com o fluxo {title ? <strong>{title}</strong> : "ativo"} sem sair do editor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-medium text-foreground">Conversa de teste</div>
              <Button variant="outline" size="sm" onClick={handleRestart} disabled={isBusy}>
                {restartMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Reiniciar
              </Button>
            </div>

            <div ref={scrollRef} className="max-h-[360px] space-y-3 overflow-y-auto p-4">
              {startMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Iniciando a sessao de teste...
                </div>
              )}

              {!startMutation.isPending && messages.length === 0 && (
                <div className="text-sm text-muted-foreground">Nenhuma mensagem retornada pelo fluxo.</div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex max-w-[80%] items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      message.role === "user"
                        ? "border-primary/20 bg-primary/10 text-foreground"
                        : "border-border bg-background text-foreground"
                    }`}
                  >
                    {message.role === "user" ? (
                      <User className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="whitespace-pre-wrap leading-relaxed">{message.text}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isComplete ? "Fluxo finalizado. Reinicie para testar de novo." : "Digite uma mensagem"}
              disabled={!sessionId || isBusy || isComplete}
            />
            <Button onClick={handleSend} disabled={!canSend}>
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Enviar
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button type="button" variant="outline" onClick={handleRestart} disabled={isBusy}>
            <Play className="h-4 w-4" />
            Testar de novo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
