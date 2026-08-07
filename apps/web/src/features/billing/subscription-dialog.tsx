"use client";

import { ArrowUpRight, Check, Coins, Crown, Gauge, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { CreditLedgerEntry, Plan, Subscription } from "@/features/shared/contracts";
import { Logo } from "@/features/shared/icons";
import { formatDateTime } from "@/features/shared/utils";
import { api } from "@/lib/api";

const planRank = { PLUS: 0, PRO: 1, ULTRA: 2 } as const;

export function SubscriptionDialog({
  current,
  onClose,
  onSubscriptionChange,
  onNotify,
}: {
  current: Subscription | null;
  onClose: () => void;
  onSubscriptionChange: (subscription: Subscription) => void;
  onNotify: (message: string) => void;
}) {
  const [subscription, setSubscription] = useState(current);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<Plan["code"] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.GET("/billing/plans"),
      api.GET("/billing/subscription"),
      api.GET("/billing/credits"),
    ])
      .then(([planResult, subscriptionResult, ledgerResult]) => {
        if (!active) return;
        if (!planResult.data || !subscriptionResult.data) {
          throw new Error("额度信息暂时不可用");
        }
        setPlans(planResult.data);
        setSubscription(subscriptionResult.data);
        setLedger(ledgerResult.data ?? []);
      })
      .catch(() => {
        if (active) setError("暂时无法读取套餐信息，请稍后重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const usagePercent = useMemo(() => {
    if (!subscription?.credits_granted) return 0;
    return Math.min(100, (subscription.credits_used / subscription.credits_granted) * 100);
  }, [subscription]);

  async function upgrade(plan: Plan) {
    if (!subscription || upgrading) return;
    setUpgrading(plan.code);
    setError("");
    try {
      const result = await api.POST("/billing/subscription/upgrade", {
        body: { plan_code: plan.code },
      });
      if (!result.data || !result.response.ok) throw new Error("upgrade_failed");
      setSubscription(result.data);
      onSubscriptionChange(result.data);
      onNotify(`已升级到 ${result.data.plan_name}`);
      const ledgerResult = await api.GET("/billing/credits");
      if (ledgerResult.data) setLedger(ledgerResult.data);
    } catch {
      setError("升级没有完成，请稍后重试。");
    } finally {
      setUpgrading(null);
    }
  }

  return (
    <div
      className="dialog-backdrop subscription-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="subscription-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="subscription-header">
          <div>
            <Logo />
            <span>
              <small>MEMORA MEMBERSHIP</small>
              <strong id="subscription-title">套餐与 Credits</strong>
            </span>
          </div>
          <button type="button" aria-label="关闭套餐窗口" onClick={onClose}>
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>

        {loading ? (
          <div className="subscription-loading" role="status">
            正在读取额度…
          </div>
        ) : subscription ? (
          <>
            <div className="credit-overview">
              <div>
                <span className="credit-icon">
                  <Coins aria-hidden="true" size={18} strokeWidth={1.7} />
                </span>
                <span>
                  <small>{subscription.plan_name} 当前可用</small>
                  <strong>{subscription.credits_remaining.toLocaleString("zh-CN")}</strong>
                </span>
              </div>
              <div className="credit-meter" aria-label="额度使用进度">
                <span style={{ width: `${usagePercent}%` }} />
              </div>
              <small>
                本周期已用 {subscription.credits_used.toLocaleString("zh-CN")} /{" "}
                {subscription.credits_granted.toLocaleString("zh-CN")}，到期于{" "}
                {formatDateTime(subscription.period_ends_at)}
              </small>
            </div>

            <div className="plan-grid" aria-label="可用套餐">
              {plans.map((plan) => {
                const isCurrent = plan.code === subscription.plan_code;
                const isLower = planRank[plan.code] < planRank[subscription.plan_code];
                return (
                  <article
                    className={isCurrent ? "plan-option is-current" : "plan-option"}
                    key={plan.code}
                  >
                    <header>
                      <span>
                        {plan.code === "ULTRA" ? <Crown size={17} /> : <Gauge size={17} />}
                      </span>
                      <div>
                        <h3>{plan.name}</h3>
                        <strong>{plan.credits_per_period.toLocaleString("zh-CN")} credits</strong>
                      </div>
                    </header>
                    <p>{plan.description}</p>
                    <ul>
                      {plan.features.map((feature) => (
                        <li key={feature}>
                          <Check aria-hidden="true" size={13} strokeWidth={2} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={isCurrent || isLower || upgrading !== null}
                      onClick={() => void upgrade(plan)}
                    >
                      {isCurrent
                        ? "当前套餐"
                        : isLower
                          ? "已包含"
                          : upgrading === plan.code
                            ? "正在升级…"
                            : `升级到 ${plan.name}`}
                      {!isCurrent && !isLower && upgrading !== plan.code ? (
                        <ArrowUpRight aria-hidden="true" size={14} />
                      ) : null}
                    </button>
                  </article>
                );
              })}
            </div>

            <div className="credit-ledger">
              <header>
                <strong>最近额度记录</strong>
                <small>AI 成功完成后扣除，失败不会扣除</small>
              </header>
              <div>
                {ledger.slice(0, 6).map((entry) => (
                  <span key={entry.id}>
                    <small>{formatDateTime(entry.created_at)}</small>
                    <strong>{entry.reason === "AI_USAGE" ? "AI 调用" : "额度调整"}</strong>
                    <b className={entry.delta < 0 ? "is-debit" : "is-credit"}>
                      {entry.delta > 0 ? "+" : ""}
                      {entry.delta.toLocaleString("zh-CN")}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : null}
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="subscription-note">内测阶段升级不会发起真实扣款。</footer>
      </section>
    </div>
  );
}
