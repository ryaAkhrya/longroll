"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/cx";
import { attemptUrl, forgetAttempt } from "./attemptUrls";
import styles from "./AttemptImage.module.css";

interface AttemptImageProps {
  code: string;
  attemptId: string | null;
  part?: "preview" | "full";
  alt: string;
  className?: string;
  /** Foto belum ada (mis. upload berjalan): tampilkan skeleton, bukan gambar palsu. */
  pending?: boolean;
}

/** Foto attempt via signed URL berumur pendek. Tidak pernah menampilkan placeholder sebagai "foto berhasil". */
export function AttemptImage({ code, attemptId, part = "preview", alt, className, pending }: AttemptImageProps) {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({ key: "", url: null, failed: false });
  const key = attemptId ? `${attemptId}:${part}` : "";
  useEffect(() => {
    if (!attemptId) return;
    let alive = true;
    attemptUrl(code, attemptId, part).then(
      (url) => alive && setState({ key: `${attemptId}:${part}`, url, failed: false }),
      () => alive && setState({ key: `${attemptId}:${part}`, url: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [code, attemptId, part]);
  const cur = state.key === key ? state : { url: null, failed: false };
  if (!attemptId || pending || (!cur.url && !cur.failed)) return <span className={cx(styles.skeleton, className)} role="img" aria-label={`${alt} (memuat)`} />;
  if (cur.failed || !cur.url) return <span className={cx(styles.error, className)} role="img" aria-label={`${alt} (gagal dimuat)`}>Foto gak kebuka</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={cur.url} alt={alt} className={cx(styles.img, className)} draggable={false} onError={() => (forgetAttempt(code, attemptId), setState({ key, url: null, failed: true }))} />;
}
