import type { ReactElement, ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, ChevronDown } from "lucide-react";

/**
 * Styled primitives over Radix's headless Select and Tooltip. They exist so native
 * <select> elements and title-only hints can adopt the Quiet Instrument look without
 * each call site re-declaring the classes.
 */

export interface SelectOption {
  value: string;
  label: string;
}

interface StyledSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
  /** Mono face for the trigger text (ids, levels). */
  mono?: boolean;
  disabled?: boolean;
}

export function StyledSelect({ value, onValueChange, options, ariaLabel, mono, disabled }: StyledSelectProps): ReactElement {
  // Internal item values are indexes: preset lists can carry duplicate ids (two "openai"
  // entries with different apis), and Radix needs distinct item values.
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const current = options[selectedIndex];
  return <SelectPrimitive.Root
    value={String(selectedIndex)}
    onValueChange={(internal) => { const option = options[Number(internal)]; if (option) onValueChange(option.value); }}
    disabled={disabled}
  >
    <SelectPrimitive.Trigger className={`sel-trigger${mono ? " mono" : ""}`} aria-label={ariaLabel}>
      <SelectPrimitive.Value>{current?.label ?? value}</SelectPrimitive.Value>
      <SelectPrimitive.Icon><ChevronDown size={15} className="chevron" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className="sel-content" position="popper" sideOffset={5} collisionPadding={10}>
        <SelectPrimitive.ScrollUpButton className="sel-scroll-button"><ChevronDown size={13} style={{ transform: "rotate(180deg)" }} /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport>
          {options.map((option, index) => <SelectPrimitive.Item key={`${option.value}-${index}`} value={String(index)} className="sel-item">
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator><Check size={13} /></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="sel-scroll-button"><ChevronDown size={13} /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}

/** Tooltip wrapper for icon buttons; the label doubles as aria-label. */
export function IconButtonTip({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return <TooltipPrimitive.Root delayDuration={350}>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content className="tip-content" sideOffset={6} collisionPadding={10}>{label}</TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}
