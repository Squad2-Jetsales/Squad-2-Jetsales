import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  Handle,
  Position,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import {
  ArrowLeft,
  Clock,
  Flag,
  GitBranch,
  Loader2,
  ListOrdered,
  MessageSquare,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  Redo2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanvasStore } from "@/lib/stores/canvasStore";
import { flowsApi } from "@/lib/api/flows";
import { chatbotsApi } from "@/lib/api/chatbots";
import { ApiError } from "@/lib/api/client";
import {
  removeNodesAndConnectedEdges,
  sanitizeReactFlowEdges,
  validateFlowGraph,
  type RFNodeData,
} from "@/lib/flowGraph";
import { AdjustWithAIDialog } from "@/components/chatbot/AdjustWithAIDialog";
import { FlowTesterDialog } from "@/components/chatbot/FlowTesterDialog";
import type { FlowEdge, FlowNode, FlowNodeData, FlowNodeType, FlowWithGraph } from "@/types/domain";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// Feature flag dos botões de IA — endpoints aiGenerate/aiAdjust no back ainda
// retornam 501 (decisão de Fase 2 — implementação real fica para a Fase 3).
const AI_ENABLED = import.meta.env.VITE_ENABLE_AI === "true";

/* ------------------------------- Custom Nodes ------------------------------ */

function NodeShell({
  color,
  icon,
  label,
  children,
  hasError,
  selected,
  showSourceHandle = true,
  showTargetHandle = true,
}: {
  color: string;
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
  hasError?: boolean;
  selected?: boolean;
  showSourceHandle?: boolean;
  showTargetHandle?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[220px] rounded-lg border-2 bg-card shadow-card overflow-hidden transition-all",
        selected ? "border-primary ring-2 ring-primary/20" : "border-border",
        hasError && "animate-pulse-error border-danger",
      )}
    >
      {showTargetHandle && <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />}
      <div className="flex items-center gap-2 px-3 py-2 text-white text-xs font-semibold" style={{ background: color }}>
        {icon}
        <span className="flex-1 truncate">{label}</span>
      </div>
      <div className="px-3 py-2 text-xs text-foreground">{children}</div>
      {showSourceHandle && <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />}
    </div>
  );
}

function MessageNode({ data, selected }: NodeProps) {
  const d = data as RFNodeData;
  return (
    <NodeShell color="hsl(var(--node-message))" icon={<MessageSquare className="h-3.5 w-3.5" />} label="Enviar Mensagem" selected={selected}>
      <p className="line-clamp-3 text-muted-foreground">{d.data.text || "Sem mensagem"}</p>
    </NodeShell>
  );
}

function CaptureNode({ data, selected }: NodeProps) {
  const d = data as RFNodeData;
  return (
    <NodeShell color="hsl(var(--node-message))" icon={<MessageSquare className="h-3.5 w-3.5" />} label="Capturar Resposta" selected={selected}>
      <p className="line-clamp-3 text-muted-foreground">{d.data.text || "Sem pergunta"}</p>
      {d.data.variable && <p className="mt-2 text-[11px] text-muted-foreground">Salva em: {d.data.variable}</p>}
    </NodeShell>
  );
}

function MenuNode({ data, selected }: NodeProps) {
  const d = data as RFNodeData;
  const opts = d.data.options ?? [];
  return (
    <div className={cn("min-w-[240px] rounded-lg border-2 bg-card shadow-card overflow-hidden", selected ? "border-primary ring-2 ring-primary/20" : "border-border")}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 text-white text-xs font-semibold" style={{ background: "hsl(var(--node-menu))" }}>
        <ListOrdered className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Menu de Opções</span>
      </div>
      <div className="px-3 py-2 text-xs">
        {opts.length === 0 && <p className="text-muted-foreground">Sem opções</p>}
        {opts.map((opt, idx) => (
          <div key={opt.id} className="relative flex items-center justify-between py-1 border-b last:border-0 border-border">
            <span className="text-foreground">{idx + 1}. {opt.label || "—"}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={opt.id}
              style={{ top: "auto", right: -8, transform: "none" }}
              className="!bg-node-menu !w-2 !h-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  const d = data as RFNodeData;
  const c = d.data.condition;
  return (
    <div className={cn("min-w-[220px] rounded-lg border-2 bg-card shadow-card overflow-hidden", selected ? "border-primary ring-2 ring-primary/20" : "border-border")}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 text-white text-xs font-semibold" style={{ background: "hsl(var(--node-condition))" }}>
        <GitBranch className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Condição</span>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {c ? `${c.field} ${c.operator} ${c.value}` : "Sem condição"}
      </div>
      <div className="flex justify-around border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        <span>verdadeiro</span>
        <span>falso</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: "25%" }} className="!bg-success !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: "75%" }} className="!bg-danger !w-2 !h-2" />
    </div>
  );
}

function WaitNode({ data, selected }: NodeProps) {
  const d = data as RFNodeData;
  const ms = d.data.waitMs ?? 0;
  return (
    <NodeShell color="hsl(var(--node-wait))" icon={<Clock className="h-3.5 w-3.5" />} label="Aguardar" selected={selected}>
      <p className="text-muted-foreground">{(ms / 1000).toFixed(1)}s</p>
    </NodeShell>
  );
}

function TriggerNode({ selected }: NodeProps) {
  return (
    <div className={cn("min-w-[180px] rounded-lg border-2 bg-card shadow-card overflow-hidden", selected ? "border-primary ring-2 ring-primary/20" : "border-border")}>
      <div className="flex items-center gap-2 px-3 py-2 text-white text-xs font-semibold" style={{ background: "hsl(var(--node-trigger))" }}>
        <Zap className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Início</span>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground">Disparado quando o usuário inicia</div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

function EndNode({ selected }: NodeProps) {
  return (
    <div className={cn("min-w-[180px] rounded-lg border-2 bg-card shadow-card overflow-hidden", selected ? "border-primary ring-2 ring-primary/20" : "border-border")}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2 px-3 py-2 text-white text-xs font-semibold" style={{ background: "hsl(var(--node-end))" }}>
        <Flag className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Fim</span>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground">Encerra este caminho do fluxo</div>
    </div>
  );
}

const NODE_TYPES = {
  capture: CaptureNode,
  message: MessageNode,
  menu: MenuNode,
  condition: ConditionNode,
  wait: WaitNode,
  trigger: TriggerNode,
  end: EndNode,
};

/* ------------------------------ Helpers --------------------------------- */

const BLOCK_PALETTE: Array<{
  type: FlowNodeType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  defaults: FlowNodeData;
}> = [
  // Trigger é o ponto de entrada do fluxo — o publish do back exige pelo menos
  // um node tipo "trigger". Só pode existir um por fluxo (lock no onDrop).
  { type: "trigger", label: "Início", icon: Zap, color: "hsl(var(--node-trigger))", defaults: {} },
  { type: "message", label: "Enviar Mensagem", icon: MessageSquare, color: "hsl(var(--node-message))", defaults: { text: "Olá!" } },
  // Capture estava no NODE_TYPES, no NodeEditor e no engine, mas faltava o
  // card no toolbox — sem ele Condition não recebia variável e caía sempre
  // no branch false (B-15).
  { type: "capture", label: "Capturar Resposta", icon: MessageSquare, color: "hsl(var(--node-message))", defaults: { text: "Qual seu nome?", variable: "input" } },
  { type: "menu", label: "Menu de Opções", icon: ListOrdered, color: "hsl(var(--node-menu))", defaults: { options: [{ id: crypto.randomUUID(), label: "Opção 1", value: "1" }] } },
  { type: "condition", label: "Condição", icon: GitBranch, color: "hsl(var(--node-condition))", defaults: { condition: { field: "input", operator: "==", value: "" } } },
  { type: "wait", label: "Aguardar", icon: Clock, color: "hsl(var(--node-wait))", defaults: { waitMs: 1000 } },
  // Fim encerra um caminho do fluxo. Múltiplos são válidos (um por ramo).
  // validateFlow exige que todo node não-end tenha edge de saída — sem este
  // card no toolbox o caminho manual ficava impublicável.
  { type: "end", label: "Fim", icon: Flag, color: "hsl(var(--node-end))", defaults: {} },
];

function toRFNode(n: FlowNode): Node {
  return {
    id: n.id,
    type: n.type,
    position: { x: n.positionX, y: n.positionY },
    data: { domainType: n.type, data: n.data } as RFNodeData,
    deletable: n.type !== "trigger",
  };
}

function toRFEdge(e: FlowEdge): Edge {
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    data: {
      conditionType: e.conditionType ?? null,
      conditionValue: e.conditionValue ?? null,
    },
    type: "default",
    style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  };
}

function rfToDomainNode(n: Node, flowId: string): FlowNode {
  const d = n.data as RFNodeData;
  return {
    id: n.id,
    flowId,
    type: d.domainType,
    data: d.data,
    positionX: n.position.x,
    positionY: n.position.y,
  };
}

function rfToDomainEdge(e: Edge, flowId: string): FlowEdge {
  const edgeData = (e.data ?? {}) as { conditionType?: string | null; conditionValue?: string | null };
  return {
    id: e.id,
    flowId,
    sourceNodeId: e.source,
    targetNodeId: e.target,
    sourceHandle: e.sourceHandle ?? null,
    conditionType: edgeData.conditionType ?? undefined,
    conditionValue: edgeData.conditionValue ?? undefined,
  };
}

/* ------------------------------ Editor ---------------------------------- */

function FlowCanvas({ flow, chatbotId }: { flow: FlowWithGraph; chatbotId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [bannerVisible, setBannerVisible] = useState(params.get("generated") === "1");
  const [testerOpen, setTesterOpen] = useState(params.get("tester") === "1");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorNodeIds, setErrorNodeIds] = useState<Set<string>>(new Set());
  const [adjustOpen, setAdjustOpen] = useState(false);
  const reactFlow = useReactFlow();

  const present = useCanvasStore((s) => s.present);
  const setPresent = useCanvasStore((s) => s.setPresent);
  const pushHistory = useCanvasStore((s) => s.pushHistory);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const reset = useCanvasStore((s) => s.reset);
  const past = useCanvasStore((s) => s.past);
  const future = useCanvasStore((s) => s.future);

  // Initial load
  useEffect(() => {
    const nodes = flow.nodes.map(toRFNode);
    const edges = flow.edges.map(toRFEdge);
    reset({ nodes, edges });
  }, [flow, reset]);

  // Autosave
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (present.nodes.length === 0) return;
    saveTimer.current = setTimeout(() => {
      const sanitized = sanitizeReactFlowEdges(present.nodes, present.edges);
      if (sanitized.removedEdges.length > 0) {
        setPresent({ nodes: present.nodes, edges: sanitized.edges });
        toast.warning("Removemos conexões inválidas do fluxo. Revise e publique novamente.");
        return;
      }

      setSaveStatus("saving");
      flowsApi
        .bulkUpdate(flow.id, {
          nodes: present.nodes.map((n) => rfToDomainNode(n, flow.id)),
          edges: sanitized.edges.map((e) => rfToDomainEdge(e, flow.id)),
        })
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [present, flow.id, setPresent]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, present.nodes);
      const removedNodeIds = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);
      const nextGraph = removedNodeIds.length > 0
        ? removeNodesAndConnectedEdges(next, present.edges, removedNodeIds)
        : { nodes: next, edges: present.edges };
      const hasStructural = changes.some((c) => c.type === "remove" || c.type === "add");
      const hasMoveEnd = changes.some((c) => c.type === "position" && c.dragging === false);
      if (hasStructural || hasMoveEnd) {
        pushHistory({ nodes: nextGraph.nodes, edges: nextGraph.edges });
        if (removedNodeIds.includes(selectedNodeId ?? "")) selectNode(null);
      } else {
        setPresent({ nodes: nextGraph.nodes, edges: nextGraph.edges });
      }
    },
    [present, pushHistory, selectedNodeId, selectNode, setPresent],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, present.edges);
      const sanitized = sanitizeReactFlowEdges(present.nodes, next);
      const hasStructural = changes.some((c) => c.type === "remove" || c.type === "add");
      if (hasStructural) {
        pushHistory({ nodes: present.nodes, edges: sanitized.edges });
      } else {
        setPresent({ nodes: present.nodes, edges: sanitized.edges });
      }
    },
    [present, pushHistory, setPresent],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const target = present.nodes.find((n) => n.id === conn.target);
      const source = present.nodes.find((n) => n.id === conn.source);
      if (target && (target.data as RFNodeData).domainType === "trigger") {
        toast.error("Não é possível conectar para o nó de Início");
        return;
      }
      if (source && (source.data as RFNodeData).domainType === "end") {
        toast.error("Nó de fim não pode ter saídas");
        return;
      }
      if (!source || !target || !conn.source || !conn.target) {
        toast.error("Conexão inválida. Reconecte os blocos.");
        return;
      }
      const newEdge: Edge = {
        ...conn,
        id: crypto.randomUUID(),
        source: conn.source,
        target: conn.target,
        type: "default",
        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      };
      pushHistory({ nodes: present.nodes, edges: addEdge(newEdge, present.edges) });
    },
    [present, pushHistory],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[] }) => {
      selectNode(nodes[0]?.id ?? null);
    },
    [selectNode],
  );

  // Drag from palette
  const onDragStart = (e: React.DragEvent, type: FlowNodeType) => {
    e.dataTransfer.setData("application/jetgo-node", type);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/jetgo-node") as FlowNodeType;
      if (!type) return;
      const palette = BLOCK_PALETTE.find((p) => p.type === type);
      if (!palette) return;

      // Só um trigger por fluxo: o back rejeita publish sem trigger e a UI
      // proíbe edge entrando nele — dois triggers viraria um deles em órfão.
      if (type === "trigger" && present.nodes.some((n) => (n.data as RFNodeData).domainType === "trigger")) {
        toast.error("Este fluxo já tem um nó de Início");
        return;
      }

      const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newNode: Node = {
        id: crypto.randomUUID(),
        type,
        position,
        data: { domainType: type, data: { ...palette.defaults } } as RFNodeData,
      };
      pushHistory({ nodes: [...present.nodes, newNode], edges: present.edges });
    },
    [present, pushHistory, reactFlow],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const selectedNode = present.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const updateSelectedData = (patch: Partial<FlowNodeData>) => {
    if (!selectedNode) return;
    const next = present.nodes.map((n) => {
      if (n.id !== selectedNode.id) return n;
      const d = n.data as RFNodeData;
      return { ...n, data: { ...d, data: { ...d.data, ...patch } } };
    });
    setPresent({ nodes: next, edges: present.edges });
  };

  const persistSelected = () => {
    pushHistory({ nodes: present.nodes, edges: present.edges });
    toast.success("Bloco atualizado");
  };

  const publish = useMutation({
    mutationFn: async () => {
      const sanitized = sanitizeReactFlowEdges(present.nodes, present.edges);
      await flowsApi.bulkUpdate(flow.id, {
        nodes: present.nodes.map((n) => rfToDomainNode(n, flow.id)),
        edges: sanitized.edges.map((e) => rfToDomainEdge(e, flow.id)),
      });
      return flowsApi.publish(flow.id);
    },
    onMutate: () => {
      const sanitized = sanitizeReactFlowEdges(present.nodes, present.edges);
      if (sanitized.removedEdges.length > 0) {
        setPresent({ nodes: present.nodes, edges: sanitized.edges });
        toast.warning("Removemos conexões inválidas do fluxo. Revise e publique novamente.");
        throw new Error("validation");
      }

      const errs = validateFlowGraph(present.nodes, sanitized.edges);
      if (errs.length > 0) {
        const ids = new Set<string>();
        for (const n of present.nodes) {
          if ((n.data as RFNodeData).domainType !== "end") {
            const has = sanitized.edges.some((e) => e.source === n.id);
            if (!has) ids.add(n.id);
          }
        }
        setErrorNodeIds(ids);
        toast.error(errs[0] ?? "Validação falhou");
        throw new Error("validation");
      }
      setErrorNodeIds(new Set());
    },
    onSuccess: () => {
      toast.success("Fluxo publicado");
      qc.invalidateQueries({ queryKey: ["flow", flow.id] });
    },
    onError: (err) => {
      if (err.message === "validation") return;
      toast.error(err instanceof ApiError ? err.message : "Falha ao publicar");
    },
  });

  // Mark error nodes via class
  const decoratedNodes = useMemo(
    () =>
      present.nodes.map((n) =>
        errorNodeIds.has(n.id)
          ? { ...n, className: cn(n.className, "ring-2 ring-danger animate-pulse-error rounded-lg") }
          : n,
      ),
    [present.nodes, errorNodeIds],
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/chatbots")} aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-foreground truncate">{flow.name}</h1>
          <p className="text-xs text-muted-foreground">Editor Visual de Fluxo</p>
        </div>
        <SaveStatus status={saveStatus} />
        <Button variant="ghost" size="icon" onClick={undo} disabled={past.length === 0} aria-label="Desfazer">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={redo} disabled={future.length === 0} aria-label="Refazer">
          <Redo2 className="h-4 w-4" />
        </Button>
        {AI_ENABLED && (
          <Button
            variant="outline"
            onClick={() => setAdjustOpen(true)}
            className="border-ai/40 text-ai hover:bg-ai-soft hover:text-ai"
          >
            <Sparkles className="h-4 w-4" />
            Ajustar com IA
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            const sanitized = sanitizeReactFlowEdges(present.nodes, present.edges);
            if (sanitized.removedEdges.length > 0) {
              setPresent({ nodes: present.nodes, edges: sanitized.edges });
              toast.warning("Removemos conexões inválidas do fluxo. Revise e teste novamente.");
              return;
            }
            const errs = validateFlowGraph(present.nodes, sanitized.edges);
            if (errs.length > 0) {
              toast.error(errs[0] ?? "Validação falhou");
              return;
            }
            setTesterOpen(true);
          }}
        >
          <Play className="h-4 w-4" />
          Testar Bot
        </Button>
        <Button onClick={() => publish.mutate()} disabled={publish.isPending}>
          {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Publicar
        </Button>
      </header>

      {bannerVisible && (
        <div className="flex items-center justify-between gap-3 border-b border-ai/20 bg-ai-soft px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2 text-ai">
            <Sparkles className="h-4 w-4" />
            <span className="font-medium">Fluxo gerado pela IA com sucesso!</span>
            <span className="text-foreground/70">Revise e ajuste visualmente o que quiser.</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setBannerVisible(false)} className="h-6 w-6">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Palette */}
        <aside className="w-[240px] shrink-0 overflow-y-auto border-r border-border bg-card p-3">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Blocos Disponíveis
          </h2>
          <div className="space-y-2">
            {BLOCK_PALETTE.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, p.type)}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors cursor-grab active:cursor-grabbing"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded text-white" style={{ background: p.color }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{p.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-lg border border-border bg-secondary p-3 text-xs text-muted-foreground">
            <p className="mb-2 font-semibold text-foreground">Instruções</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Arraste blocos para o canvas</li>
              <li>Conecte arrastando entre os pontos</li>
              <li>Clique para editar à direita</li>
              <li>Salvar é automático</li>
            </ol>
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={decoratedNodes}
            edges={present.edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            nodeTypes={NODE_TYPES}
            snapToGrid
            snapGrid={[16, 16]}
            fitView
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} color="hsl(var(--border))" />
            <Controls className="!bg-card !border-border" />
            <MiniMap pannable zoomable className="!bg-card !border-border" />
          </ReactFlow>
        </div>

        {/* Side panel */}
        {selectedNode && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-border bg-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Editar Bloco</h2>
              <Button variant="ghost" size="icon" onClick={() => selectNode(null)} aria-label="Fechar" className="h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <NodeEditor node={selectedNode} onChange={updateSelectedData} onSave={persistSelected} onDelete={() => {
              if ((selectedNode.data as RFNodeData).domainType === "trigger") {
                toast.error("O nó de Início não pode ser excluído");
                return;
              }
              const nextGraph = removeNodesAndConnectedEdges(present.nodes, present.edges, [selectedNode.id]);
              pushHistory({ nodes: nextGraph.nodes, edges: nextGraph.edges });
              selectNode(null);
            }} />
          </aside>
        )}
      </div>

      {AI_ENABLED && (
        <AdjustWithAIDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          chatbotId={chatbotId}
          currentNodes={present.nodes.map((n) => ({ domainType: (n.data as RFNodeData).domainType }))}
          onApply={({ nodes, edges }) => {
            const rfNodes = nodes.map(toRFNode);
            const rfEdges = edges.map(toRFEdge);
            const sanitized = sanitizeReactFlowEdges(rfNodes, rfEdges);
            pushHistory({ nodes: rfNodes, edges: sanitized.edges });
          }}
        />
      )}
      <FlowTesterDialog
        flowId={flow.id}
        open={testerOpen}
        onOpenChange={setTesterOpen}
        title={flow.name}
      />
    </div>
  );
}

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  const map = {
    idle: { label: "—", cls: "text-muted-foreground" },
    saving: { label: "Salvando...", cls: "text-muted-foreground" },
    saved: { label: "Salvo", cls: "text-success" },
    error: { label: "Erro ao salvar", cls: "text-danger" },
  };
  const v = map[status];
  return <span className={cn("text-xs font-medium mr-2", v.cls)}>{v.label}</span>;
}

function NodeEditor({ node, onChange, onSave, onDelete }: { node: Node; onChange: (p: Partial<FlowNodeData>) => void; onSave: () => void; onDelete: () => void }) {
  const d = (node.data as RFNodeData).data;
  const type = (node.data as RFNodeData).domainType;

  return (
    <div className="space-y-4">
      <Badge variant="outline" className="capitalize">{type}</Badge>

      {type === "message" && (
        <div className="space-y-2">
          <Label htmlFor="msg-text">Mensagem</Label>
          <Textarea id="msg-text" rows={5} value={d.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      )}

      {type === "capture" && (
        <div className="space-y-2">
          <Label htmlFor="capture-text">Mensagem</Label>
          <Textarea id="capture-text" rows={5} value={d.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} />
          <Label htmlFor="capture-variable">Variavel</Label>
          <Input
            id="capture-variable"
            value={d.variable ?? ""}
            onChange={(e) => onChange({ variable: e.target.value })}
            placeholder="input"
          />
        </div>
      )}

      {type === "menu" && (
        <div className="space-y-2">
          <Label>Opções do Menu</Label>
          {(d.options ?? []).map((opt, idx) => (
            <div key={opt.id} className="flex items-center gap-2">
              <Input
                value={opt.label}
                placeholder={`Opção ${idx + 1}`}
                onChange={(e) => {
                  const next = [...(d.options ?? [])];
                  next[idx] = { ...opt, label: e.target.value, value: e.target.value };
                  onChange({ options: next });
                }}
              />
              <Button variant="ghost" size="icon" onClick={() => onChange({ options: (d.options ?? []).filter((o) => o.id !== opt.id) })} aria-label="Remover opção">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => onChange({ options: [...(d.options ?? []), { id: crypto.randomUUID(), label: "", value: "" }] })}>
            <Plus className="h-4 w-4" /> Adicionar Opção
          </Button>
        </div>
      )}

      {type === "condition" && (
        <div className="space-y-2">
          <Label>Campo</Label>
          <Input value={d.condition?.field ?? ""} onChange={(e) => onChange({ condition: { field: e.target.value, operator: d.condition?.operator ?? "==", value: d.condition?.value ?? "" } })} />
          <Label>Operador</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={d.condition?.operator ?? "=="}
            onChange={(e) => onChange({ condition: { field: d.condition?.field ?? "", operator: e.target.value as FlowNodeData["condition"] extends infer C ? C extends { operator: infer O } ? O : never : never, value: d.condition?.value ?? "" } })}
          >
            <option value="==">igual</option>
            <option value="!=">diferente</option>
            <option value="contains">contém</option>
            <option value=">">maior</option>
            <option value="<">menor</option>
          </select>
          <Label>Valor</Label>
          <Input value={d.condition?.value ?? ""} onChange={(e) => onChange({ condition: { field: d.condition?.field ?? "", operator: d.condition?.operator ?? "==", value: e.target.value } })} />
        </div>
      )}

      {type === "wait" && (
        <div className="space-y-2">
          <Label htmlFor="wait-sec">Segundos</Label>
          <Input id="wait-sec" type="number" min={0} step={0.5} value={(d.waitMs ?? 0) / 1000} onChange={(e) => onChange({ waitMs: Math.max(0, Number(e.target.value) * 1000) })} />
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button onClick={onSave} className="flex-1">
          <Save className="h-4 w-4" />
          Salvar Alterações
        </Button>
        {type !== "trigger" && (
          <Button variant="ghost" onClick={onDelete} className="text-danger hover:bg-danger-soft hover:text-danger">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Page ------------------------------------ */

export default function ChatbotEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const chatbot = useQuery({
    queryKey: ["chatbot", id],
    queryFn: () => chatbotsApi.get(id!),
    enabled: !!id,
  });

  const flow = useQuery({
    queryKey: ["flow", chatbot.data?.activeFlowId],
    queryFn: () => flowsApi.get(chatbot.data!.activeFlowId!),
    enabled: !!chatbot.data?.activeFlowId,
  });

  if (isMobile) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center bg-background">
        <Card className="p-6 max-w-sm">
          <h2 className="text-base font-semibold text-foreground">Editor visual</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Edite o fluxo no desktop para a melhor experiência. Esta tela não é otimizada para mobile.
          </p>
          <Button className="mt-4" onClick={() => navigate("/chatbots")}>Voltar</Button>
        </Card>
      </div>
    );
  }

  if (chatbot.isLoading || flow.isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (chatbot.isError || !chatbot.data) {
    return (
      <div className="p-8">
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Não foi possível carregar o chatbot.</p>
          <Button className="mt-4" variant="outline" onClick={() => chatbot.refetch()}>Tentar novamente</Button>
        </Card>
      </div>
    );
  }

  if (!chatbot.data.activeFlowId || !flow.data) {
    return (
      <div className="p-8">
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Este chatbot ainda não tem um fluxo ativo.</p>
          <Button className="mt-4" variant="outline" onClick={() => navigate("/chatbots")}>Voltar</Button>
        </Card>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <FlowCanvas flow={flow.data} chatbotId={chatbot.data.id} />
    </ReactFlowProvider>
  );
}
