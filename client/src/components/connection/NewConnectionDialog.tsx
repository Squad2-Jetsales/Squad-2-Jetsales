import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { chatbotsApi } from "@/lib/api/chatbots";
import { connectionsApi } from "@/lib/api/connections";
import { ApiError } from "@/lib/api/client";
import type { WhatsAppConnection } from "@/types/domain";

const schema = z.object({
  name: z.string().min(2, "Minimo 2 caracteres").max(60),
  chatbotId: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewConnectionDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [created, setCreated] = useState<WhatsAppConnection | null>(null);

  const { data: chatbots = [] } = useQuery({
    queryKey: ["chatbots", "connections-dialog"],
    queryFn: () => chatbotsApi.list({ status: "active" }),
    enabled: open,
    staleTime: 60_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      chatbotId: "none",
    },
  });

  const create = useMutation({
    mutationFn: (input: FormValues) =>
      connectionsApi.create({
        name: input.name,
        chatbotId: input.chatbotId && input.chatbotId !== "none" ? input.chatbotId : undefined,
      }),
    onSuccess: (conn) => {
      setCreated(conn);
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Falha ao criar conexao"),
  });

  const poll = useQuery({
    queryKey: ["connection-poll", created?.id],
    queryFn: () => connectionsApi.get(created!.id),
    enabled: !!created && open,
    refetchInterval: (query) => {
      const data = query.state.data as WhatsAppConnection | undefined;
      return data?.status === "connected" ? false : 3000;
    },
  });

  useEffect(() => {
    if (poll.data?.status === "connected") {
      toast.success("WhatsApp conectado");
      qc.invalidateQueries({ queryKey: ["connections"] });
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.data?.status]);

  const handleClose = () => {
    setCreated(null);
    form.reset({
      name: "",
      chatbotId: "none",
    });
    onOpenChange(false);
  };

  const submit = form.handleSubmit((values) => create.mutate(values));
  const conn = poll.data ?? created;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? handleClose() : onOpenChange(nextOpen))}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nova conexao WhatsApp</DialogTitle>
          <DialogDescription>
            Diga um nome para a conexao, vincule um chatbot se fizer sentido e escaneie o QR Code.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="conn-name">Nome da conexao</Label>
            <Input
              id="conn-name"
              placeholder="Ex: Atendimento principal"
              disabled={!!created}
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-danger">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Chatbot vinculado</Label>
            <Select
              value={form.watch("chatbotId") ?? "none"}
              onValueChange={(value) => form.setValue("chatbotId", value, { shouldDirty: true })}
              disabled={!!created}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um chatbot" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem chatbot por enquanto</SelectItem>
                {chatbots.map((chatbot) => (
                  <SelectItem key={chatbot.id} value={chatbot.id}>
                    {chatbot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Vincular um chatbot ajuda a persistir mensagens recebidas quando os webhooks chegarem.
            </p>
          </div>

          {conn && (
            <div className="rounded-md border border-border bg-secondary p-4">
              <h3 className="text-sm font-semibold text-foreground">Escaneie o QR Code</h3>
              <div className="mt-3 flex items-center justify-center rounded-md bg-card p-4">
                {conn.qrCode ? (
                  <img src={conn.qrCode} alt="QR Code" width={200} height={200} className="h-[200px] w-[200px]" />
                ) : (
                  <div className="flex h-[200px] w-[200px] items-center justify-center text-xs text-muted-foreground">
                    Gerando QR...
                  </div>
                )}
              </div>
              <ol className="mt-4 list-inside list-decimal space-y-1.5 text-xs text-muted-foreground">
                <li>Abra o WhatsApp no celular</li>
                <li>Entre em aparelhos conectados</li>
                <li>Toque em conectar um aparelho</li>
                <li>Escaneie o QR desta tela</li>
              </ol>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose}>
              {conn ? "Fechar" : "Cancelar"}
            </Button>
            {!created && (
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Adicionar
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
