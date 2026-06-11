import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { transactions as txRepo } from "../repository.js";

export function useTransactions({ accountId, kind, currency, limit = 200 } = {}) {
  const list = useLiveQuery(async () => {
    let all;
    if (accountId) all = await db.cashTransactions.where("accountId").equals(accountId).toArray();
    else           all = await db.cashTransactions.toArray();
    if (kind)     all = all.filter(t => t.kind === kind);
    if (currency) all = all.filter(t => t.currency === currency);
    all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return all.slice(0, limit);
  }, [accountId, kind, currency, limit], undefined);

  return {
    list: list || [],
    loading: list === undefined,
    deposit:  txRepo.deposit,
    withdraw: txRepo.withdraw,
    transfer: txRepo.transfer,
    remove:   txRepo.remove,
  };
}

export function useCashBalance(accountId) {
  const balance = useLiveQuery(async () => {
    const txs = accountId
      ? await db.cashTransactions.where("accountId").equals(accountId).toArray()
      : await db.cashTransactions.toArray();
    const result = {};
    for (const t of txs) {
      const cur = t.currency || "UAH";
      result[cur] = (result[cur] || 0) + (Number(t.amount) || 0);
    }
    return result;
  }, [accountId], {});

  return balance || {};
}
