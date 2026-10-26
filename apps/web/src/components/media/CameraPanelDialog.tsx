"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { SheetSnap } from "@/components/ui/BottomSheet";
import { Modal } from "@/components/ui/Modal";
import { useMediaQuery } from "@/room/hooks";
import { CameraSettings } from "./CameraSettings";

/** Kameraku sebagai modal (desktop) / bottom sheet tanpa scrim (mobile, feed tetap terlihat). */
export function CameraPanelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mobile = useMediaQuery("(max-width: 1023px)");
  const [snap, setSnap] = useState<SheetSnap>("full");
  if (mobile) {
    return (
      <BottomSheet open={open} onClose={onClose} title="Kameraku" snap={snap} onSnapChange={setSnap}>
        <CameraSettings />
      </BottomSheet>
    );
  }
  return (
    <Modal open={open} onClose={onClose} title="Kameraku">
      <CameraSettings />
    </Modal>
  );
}
