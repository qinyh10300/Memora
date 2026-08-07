"use client";

import { Home, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { reportClientError } from "@/lib/error-reporting";

import styles from "./error-boundary.module.css";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError(error, "workbench", "retry");
  }, [error]);

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="error-title">
        <div className={styles.mark} aria-hidden="true">
          <TriangleAlert size={22} strokeWidth={1.8} />
        </div>
        <h1 id="error-title" className={styles.title}>
          页面暂时没有完成加载
        </h1>
        <p className={styles.description}>你的记忆和草稿不会因此被修改，可以直接重试。</p>
        <div className={styles.actions}>
          <button className={styles.action} type="button" onClick={reset}>
            <RefreshCw size={16} aria-hidden="true" />
            重试
          </button>
          <button
            className={styles.secondaryAction}
            type="button"
            onClick={() => window.location.assign("/")}
          >
            <Home size={16} aria-hidden="true" />
            返回首页
          </button>
        </div>
      </section>
    </main>
  );
}
