import type { ReactElement, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { IconButton } from "../ui-primitives";

const DRAWER_EASE = [0.16, 1, 0.3, 1] as const;

export interface DetailDrawerProps {
  eyebrow: ReactNode;
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

export function DetailDrawer({ eyebrow, title, closeLabel, onClose, children }: DetailDrawerProps): ReactElement {
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const firstControl = drawer?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-drawer-close])",
    );
    (firstControl ?? drawer)?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <motion.aside
      ref={drawerRef}
      className="detail-drawer"
      role="complementary"
      aria-labelledby={titleId}
      tabIndex={-1}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion
        ? { opacity: 0, transition: { duration: 0 } }
        : { opacity: 0, x: 16, transition: { duration: 0.12, ease: DRAWER_EASE } }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: DRAWER_EASE }}
    >
      <div className="drawer-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <IconButton label={closeLabel} data-drawer-close onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      {children}
    </motion.aside>
  );
}
