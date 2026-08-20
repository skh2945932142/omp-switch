import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Search } from "lucide-react";
import type { OmpModel, OmpProvider, RoleThinkingLevel } from "@omp-switch/core";
import { ROLE_THINKING_LEVELS, findMisusedRoleThinkingSuffix, parseRoleSelector } from "@omp-switch/core/validation";

/**
 * Selects a model by provider, not by typing a selector string. The stored value stays the raw
 * OMP selector (`provider/model`, `provider/model:high`, `@default`, `*`), so what this component
 * writes is byte-identical to what the old free-text input produced.
 */

interface FlatOption {
  providerId: string;
  model: OmpModel;
}

export interface ModelPickerProps {
  providers: Array<[string, OmpProvider]>;
  value: string;
  onValueChange: (value: string) => void;
  /** Show the pinned @default / * / clear row. Roles need it; gateway upstreams do not. */
  allowSpecial?: boolean;
  /** Show the thinking-level footer. Role selectors accept a level suffix; gateway upstreams do not. */
  allowLevel?: boolean;
  /** Marks models the OMP catalog will filter out (enabledModels coverage) so a pick cannot silently no-op. */
  isEnabled?: (providerId: string, modelId: string) => boolean;
  placeholder?: string;
  ariaLabel?: string;
}

function withLevel(base: string, level: RoleThinkingLevel | null): string {
  return level ? `${base}:${level}` : base;
}

/** Strips a trailing documented level (or the misused off/auto) so a new suffix can replace it. */
function stripLevelSuffix(value: string): string {
  return value.replace(/:(minimal|low|medium|high|xhigh|max|off|auto)$/, "");
}

export function modelLabel(providers: Array<[string, OmpProvider]>, providerId: string, modelId: string): OmpModel | undefined {
  return providers.find(([id]) => id === providerId)?.[1]?.models?.find((model) => model.id === modelId);
}

export function ModelPicker({ providers, value, onValueChange, allowSpecial, allowLevel, isEnabled, placeholder = "选择模型", ariaLabel }: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<RoleThinkingLevel | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const providerIds = useMemo(() => providers.map(([id]) => id), [providers]);
  const parsed = useMemo(() => (value.trim() ? parseRoleSelector(value, providerIds) : null), [value, providerIds]);
  const allOptions = useMemo(() => providers.flatMap(([providerId, provider]) => (Array.isArray(provider.models) ? provider.models : []).map((model) => ({ providerId, model }))), [providers]);
  const options = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return allOptions;
    return allOptions.filter(({ providerId, model }) => `${providerId}/${model.id} ${model.name ?? ""}`.toLowerCase().includes(text));
  }, [allOptions, query]);
  const groups = useMemo(() => {
    const map = new Map<string, FlatOption[]>();
    for (const option of options) {
      const bucket = map.get(option.providerId);
      if (bucket) bucket.push(option);
      else map.set(option.providerId, [option]);
    }
    return Array.from(map.entries());
  }, [options]);

  useEffect(() => {
    const node = optionRefs.current[highlight];
    if (node) node.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      setQuery("");
      setLevel(parsed?.thinking ?? null);
      const current = parsed?.kind === "model" ? allOptions.findIndex((option) => option.providerId === parsed.provider && option.model.id === parsed.model) : -1;
      setHighlight(current >= 0 ? current : allOptions.length ? 0 : -1);
    }
  }

  function pick(option: FlatOption): void {
    onValueChange(withLevel(`${option.providerId}/${option.model.id}`, level));
    setOpen(false);
  }

  function pickSpecial(kind: "role" | "wildcard" | "none"): void {
    if (kind === "none") onValueChange("");
    else if (kind === "role") onValueChange(withLevel("@default", level));
    else onValueChange(withLevel("*", level));
    setOpen(false);
  }

  function applyLevel(next: RoleThinkingLevel | null): void {
    setLevel(next);
    const base = value.trim();
    if (!base) return;
    onValueChange(withLevel(stripLevelSuffix(base), next));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (current < 0 ? (delta > 0 ? 0 : options.length - 1) : (current + delta + options.length) % options.length));
    } else if (event.key === "Home") {
      if (options.length) setHighlight(0);
    } else if (event.key === "End") {
      if (options.length) setHighlight(options.length - 1);
    } else if (event.key === "Enter") {
      const option = options[highlight];
      if (option) {
        event.preventDefault();
        pick(option);
      }
    }
  }

  const triggerLabel = (() => {
    if (!value.trim()) return <span className="mp-plain mp-placeholder">{placeholder}</span>;
    if (!parsed) return <span className="mp-plain mono warn-line" title="无法解析的选择器">{value}</span>;
    if (parsed.kind === "model") {
      const model = modelLabel(providers, parsed.provider, parsed.model);
      return <>
        <span className="mp-provider-chip">{parsed.provider}</span>
        <span className="mp-plain" title={parsed.model}>{model?.name ?? parsed.model}</span>
        {parsed.thinking ? <span className="mp-level-chip">{parsed.thinking}</span> : null}
      </>;
    }
    if (parsed.kind === "role") {
      return <>
        <span className="mp-provider-chip">@{parsed.role}</span>
        <span className="mp-plain">跟随 @{parsed.role}</span>
        {parsed.thinking ? <span className="mp-level-chip">{parsed.thinking}</span> : null}
      </>;
    }
    return <>
      <span className="mp-provider-chip">*</span>
      <span className="mp-plain">任意模型</span>
      {parsed.thinking ? <span className="mp-level-chip">{parsed.thinking}</span> : null}
    </>;
  })();

  let flatIndex = -1;

  return <Popover.Root open={open} onOpenChange={handleOpenChange}>
    <Popover.Trigger asChild>
      <button className="mp-trigger" aria-label={ariaLabel ?? "选择模型"}>
        {triggerLabel}
        <ChevronDown size={15} className="chevron" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="mp-popover" align="start" sideOffset={6} collisionPadding={10} onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }} onKeyDown={handleKeyDown}>
        <div className="mp-search">
          <Search size={14} />
          <input ref={searchRef} value={query} placeholder="搜索供应商、模型 ID 或名称" aria-label="搜索模型" onChange={(event) => { setQuery(event.target.value); setHighlight(options.length ? 0 : -1); }} />
        </div>
        {allowSpecial ? <div className="mp-special">
          <button type="button" data-active={parsed?.kind === "role" && parsed.role === "default"} onClick={() => pickSpecial("role")} title="跟随 default 角色的选择">@default</button>
          <button type="button" data-active={parsed?.kind === "wildcard"} onClick={() => pickSpecial("wildcard")} title="任意可用模型">*</button>
          <button type="button" onClick={() => pickSpecial("none")} title="清除该角色">清除</button>
        </div> : null}
        <div className="mp-list" role="listbox" aria-label="模型列表">
          {options.length === 0 ? <div className="mp-empty">没有匹配的模型</div> : groups.map(([providerId, groupOptions]) => <div key={providerId}>
            <div className="mp-group-title">{providerId}<small>{groupOptions.length}</small></div>
            {groupOptions.map((option) => {
              flatIndex += 1;
              const index = flatIndex;
              const selected = parsed?.kind === "model" && parsed.provider === option.providerId && parsed.model === option.model.id;
              const blocked = Boolean(isEnabled && !isEnabled(option.providerId, option.model.id ?? ""));
              return <button
                type="button"
                key={`${option.providerId}/${option.model.id}`}
                ref={(node) => { optionRefs.current[index] = node; }}
                className="mp-option"
                role="option"
                aria-selected={selected}
                data-active={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(option)}
                title={blocked ? "enabledModels 未覆盖此模型，OMP 会将其过滤出目录" : undefined}
              >
                <span className="mp-option-main">
                  <strong>{option.model.name ?? option.model.id}</strong>
                  <small>{option.providerId}/{option.model.id}</small>
                </span>
                <span className="mp-option-side">
                  {blocked ? <span className="capability cap-blocked" title="enabledModels 未覆盖">过滤</span> : null}
                  {typeof option.model.contextWindow === "number" ? <span className="capability">{Math.round(option.model.contextWindow / 1000)}k</span> : null}
                  <span className={option.model.reasoning ? "capability on" : "capability"}>{option.model.reasoning ? "思考" : "标准"}</span>
                  <span className="capability">{option.model.input?.includes("image") ? "视觉" : "文本"}</span>
                </span>
              </button>;
            })}
          </div>)}
        </div>
        {allowLevel ? <div className="mp-level">
          <span className="mp-level-label">思考</span>
          <div className="mp-seg">
            <button type="button" data-active={level === null && !findMisusedRoleThinkingSuffix(value)} onClick={() => applyLevel(null)}>默认</button>
            {ROLE_THINKING_LEVELS.map((candidate) => <button type="button" key={candidate} data-active={parsed?.thinking === candidate && level === candidate} onClick={() => applyLevel(candidate)}>{candidate}</button>)}
          </div>
        </div> : null}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
