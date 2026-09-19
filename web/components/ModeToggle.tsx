import type { AssistantMode } from "@/lib/assistant";

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
}) {
  const base = "rounded-full px-4 py-2 text-sm font-semibold border";
  const active = "bg-accent/10 text-accent border-accent";
  const inactive = "border-border text-textSecondary";
  return (
    <div className="flex gap-2">
      <button onClick={() => onChange("crag")} className={`${base} ${mode === "crag" ? active : inactive}`}>
        Pipeline CRAG (cố định)
      </button>
      <button onClick={() => onChange("agent")} className={`${base} ${mode === "agent" ? active : inactive}`}>
        Tool-calling Agent
      </button>
    </div>
  );
}
