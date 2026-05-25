import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Loader2, Send } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { connectionsApi } from "@/lib/api/connections";
import type { WhatsAppConnection } from "@/types/domain";

const schema = z.object({
  number: z.string().min(10, "Informe o numero com DDI e DDD"),
  text: z.string().min(1, "Digite a mensagem").max(500, "Limite de 500 caracteres"),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  connection: WhatsAppConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendTestMessageDialog({ connection, open, onOpenChange }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      number: connection.phoneNumber || "",
      text: "Teste enviado pelo painel do JetGO",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        number: connection.phoneNumber || "",
        text: "Teste enviado pelo painel do JetGO",
      });
    }
  }, [connection.phoneNumber, form, open]);

  const mutation = useMutation({
    mutationFn: (input: FormValues) =>
      connectionsApi.sendTest({
        connectionId: connection.id,
        number: input.number,
        text: input.text,
      }),
    onSuccess: () => {
      toast.success("Mensagem de teste enviada");
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Falha ao enviar mensagem de teste");
    },
  });

  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Enviar mensagem de teste</DialogTitle>
          <DialogDescription>
            A mensagem sai pelo backend usando a instancia {connection.evolutionInstance || connection.name}.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="test-number">Numero destino</Label>
            <Input id="test-number" placeholder="5511999999999" inputMode="numeric" {...form.register("number")} />
            {form.formState.errors.number && (
              <p className="text-xs text-danger">{form.formState.errors.number.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-text">Mensagem</Label>
            <Textarea id="test-text" rows={5} {...form.register("text")} />
            {form.formState.errors.text && (
              <p className="text-xs text-danger">{form.formState.errors.text.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Enviar teste
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
