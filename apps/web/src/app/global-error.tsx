"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { reportClientError } from "@/lib/error-reporting";

import styles from "./error-boundary.module.css";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError(error, "root", "reload");
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main className={styles.page}>
          <section className={styles.panel} aria-labelledby="global-error-title">
            <div className={styles.mark} aria-hidden="true">
              <TriangleAlert size={22} strokeWidth={1.8} />
            </div>
            <h1 id="global-error-title" className={styles.title}>
              Memora 需要重新加载
            </h1>
            <p className={styles.description}>本地内容仍然保留，重新加载后可以继续。</p>
            <div className={styles.actions}>
              <button
                className={styles.action}
                type="button"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                重新加载
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
