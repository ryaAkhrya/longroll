"use client";

import { Button } from "@/components/ui/Button";
import type { ButtonProps } from "@/components/ui/Button";
import { JOIN_INPUT_ID } from "./JoinCodeForm";

/** Menggulir ke input kode di landing dan memberi fokus (04 SCR-01 navigasi). */
export function FocusJoinButton(props: Omit<ButtonProps, "onClick">) {
  return (
    <Button
      {...props}
      onClick={() => {
        const input = document.getElementById(JOIN_INPUT_ID);
        input?.scrollIntoView({ block: "center", behavior: "smooth" });
        input?.focus({ preventScroll: true });
      }}
    />
  );
}
