"use client";

import { useEffect, useState } from "react";

interface RecentPool {
  mint: string;
  name: string;
  symbol: string;
  imageUrl?: string;
  createdAt: string;
  quoteSymbol: string;
  volume24hUsd: number;
  isRewardLaunch: boolean;
}

interface DormantEntry {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  createdAt: string;
  lastPayoutAt: string | null;
  volume24hUsd: number;
  pendingTaxUsd: number;
  pendingUsd: number;
  holderCount: number;
  quoteSymbol: string;
  checkedAt: string;
}

interface Holder {
  address: string;
  amountRaw: string;
  decimals: number;
  owner: string | null;
}

function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = ms / 60000;
  if (mins < 60) return `${mins.toFixed(0)}m`;
  const hours = mins / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(0)}d`;
}

function formatUsd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 4 : 2 });
}

function formatHolderAmount(raw: string, decimals: number): string {
  const value = Number(raw) / 10 ** decimals;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function HolderList({ mint }: { mint: string }) {
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/holders?mint=${mint}`)
      .then((res) => res.json())
      .then((data: { holders?: Holder[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setHolders(data.holders ?? []);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [mint]);

  if (error) return <div className="error">Couldn't load holders: {error}</div>;
  if (!holders) return <div className="loading">Loading top holders…</div>;
  if (holders.length === 0) return <div className="empty">No holder accounts found.</div>;

  return (
    <div style={{ padding: "8px 16px" }}>
      {holders.map((h) => (
        <div className="holder-line" key={h.address}>
          <span>{h.owner ?? h.address}</span>
          <span className="amt">{formatHolderAmount(h.amountRaw, h.decimals)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<"recent" | "dormant">("dormant");
  const [recent, setRecent] = useState<RecentPool[] | null>(null);
  const [dormant, setDormant] = useState<DormantEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const load = () => {
      if (tab === "recent") {
        fetch("/api/recent")
          .then((res) => res.json())
          .then((data: { pools?: RecentPool[]; error?: string }) => {
            if (cancelled) return;
            if (data.error) setError(data.error);
            else setRecent(data.pools ?? []);
          })
          .catch((e) => !cancelled && setError(String(e)));
      } else {
        fetch("/api/dormant")
          .then((res) => res.json())
          .then((data: { entries?: DormantEntry[]; error?: string }) => {
            if (cancelled) return;
            if (data.error) setError(data.error);
            else setDormant(data.entries ?? []);
          })
          .catch((e) => !cancelled && setError(String(e)));
      }
    };
    load();
    const interval = setInterval(load, tab === "recent" ? 15_000 : 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tab]);

  return (
    <div className="wrap">
      <div className="title">$ stonk-hounds</div>
      <div className="subtitle">
        Tokens on stonk.fun that are either brand new (&lt;4h old) or dormant with fee revenue piling up unclaimed. Not limited to Bruno launches.
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "dormant" ? "active" : ""}`} onClick={() => setTab("dormant")}>
          Dormant + pending fees{dormant ? ` (${dormant.length})` : ""}
        </button>
        <button className={`tab ${tab === "recent" ? "active" : ""}`} onClick={() => setTab("recent")}>
          Recent (&lt;4h){recent ? ` (${recent.length})` : ""}
        </button>
      </div>

      <div className="panel">
        {error && <div className="error">{error}</div>}

        {tab === "dormant" && (
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Age</th>
                <th>Holders</th>
                <th>Pending tax</th>
                <th>Last payout</th>
                <th>24h vol</th>
              </tr>
            </thead>
            <tbody>
              {dormant === null && (
                <tr>
                  <td colSpan={6} className="loading">
                    Loading…
                  </td>
                </tr>
              )}
              {dormant?.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No dormant tokens with pending fees found yet — the background scanner is still working through
                    stonk.fun's full history.
                  </td>
                </tr>
              )}
              {dormant?.map((d) => (
                <>
                  <tr className="row" key={d.mint} onClick={() => setExpanded(expanded === d.mint ? null : d.mint)}>
                    <td>
                      <span className="sym">{d.symbol}</span>{" "}
                      <a className="mint-link" href={`https://www.stonkfun.xyz/token/${d.mint}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        {d.mint.slice(0, 4)}…{d.mint.slice(-4)}
                      </a>
                    </td>
                    <td className="age-old">{ageString(d.createdAt)}</td>
                    <td>{d.holderCount.toLocaleString()}</td>
                    <td className="pending">{formatUsd(d.pendingTaxUsd)}</td>
                    <td>{d.lastPayoutAt ? ageString(d.lastPayoutAt) + " ago" : "never"}</td>
                    <td>{formatUsd(d.volume24hUsd)}</td>
                  </tr>
                  {expanded === d.mint && (
                    <tr className="holders-row" key={d.mint + "-holders"}>
                      <td colSpan={6}>
                        <HolderList mint={d.mint} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}

        {tab === "recent" && (
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Age</th>
                <th>Quote</th>
                <th>24h vol</th>
                <th>Reward launch</th>
              </tr>
            </thead>
            <tbody>
              {recent === null && (
                <tr>
                  <td colSpan={5} className="loading">
                    Loading…
                  </td>
                </tr>
              )}
              {recent?.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    Nothing launched in the last 4 hours.
                  </td>
                </tr>
              )}
              {recent?.map((p) => (
                <>
                  <tr className="row" key={p.mint} onClick={() => setExpanded(expanded === p.mint ? null : p.mint)}>
                    <td>
                      <span className="sym">{p.symbol}</span>{" "}
                      <a className="mint-link" href={`https://www.stonkfun.xyz/token/${p.mint}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        {p.mint.slice(0, 4)}…{p.mint.slice(-4)}
                      </a>
                    </td>
                    <td className="age-fresh">{ageString(p.createdAt)}</td>
                    <td>{p.quoteSymbol}</td>
                    <td>{formatUsd(p.volume24hUsd ?? 0)}</td>
                    <td>{p.isRewardLaunch ? "yes" : "no"}</td>
                  </tr>
                  {expanded === p.mint && (
                    <tr className="holders-row" key={p.mint + "-holders"}>
                      <td colSpan={5}>
                        <HolderList mint={p.mint} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
