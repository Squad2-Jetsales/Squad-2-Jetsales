import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { JetSalesLogo } from "@/components/layout/JetSalesLogo";
import { useLogin, useSession } from "@/lib/hooks/useSession";
import { ApiError } from "@/lib/api/client";
import { Navigate } from "react-router-dom";

const schema = z.object({
  email: z.string().min(1, "Informe o email").email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const login = useLogin();
  const { data: session, isLoading } = useSession();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // Already authenticated → bounce to dashboard
  if (session && !isLoading) {
    return <Navigate to={next} replace />;
  }

  const onSubmit = async (values: FormValues) => {
    try {
      await login.mutateAsync({ email: values.email, password: values.password });
      toast.success("Bem vindo!");
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          toast.error("Email ou senha inválidos");
        } else if (err.status === 0) {
          toast.error("Não foi possível alcançar o backend. Verifique sua conexão.");
        } else {
          toast.error(err.message || "Não foi possível entrar");
        }
      } else {
        toast.error("Erro de conexão. Tente novamente.");
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[480px] overflow-hidden rounded-xl border border-border bg-card shadow-card">
        {/* Brand-blue top border */}
        <div className="h-1 bg-primary" />

        <div className="px-8 py-10">
          <div className="mb-8 flex flex-col items-center text-center">
            <JetSalesLogo className="mb-6" />
            <h1 className="text-2xl font-semibold text-primary">Bem vindo!</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Faça login para acessar sua conta JetGO
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="seu@email.com"
                          className="pl-10"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="••••••••"
                          className="pl-10 pr-10"
                          {...field}
                        />
                        <button
                          type="button"
                          aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full uppercase tracking-wide" disabled={login.isPending}>
                {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Login"}
              </Button>

              <div className="text-center">
                <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                  Esqueci a senha
                </Link>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
