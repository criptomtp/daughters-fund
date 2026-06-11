import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { coupons as couponsRepo } from "../repository.js";

export function useCoupons({ accountId, status, from, to, lotId } = {}) {
  const list = useLiveQuery(async () => {
    let all = await db.couponPayments.orderBy("scheduledDate").toArray();
    if (lotId)  all = all.filter(c => c.lotId === lotId);
    if (status) all = all.filter(c => c.status === status);
    if (from)   all = all.filter(c => c.scheduledDate >= from);
    if (to)     all = all.filter(c => c.scheduledDate <= to);
    if (accountId) {
      const accLots = await db.lots.where("accountId").equals(accountId).toArray();
      const ids = new Set(accLots.map(l => l.id));
      all = all.filter(c => ids.has(c.lotId));
    }
    return all;
  }, [accountId, status, from, to, lotId], undefined);

  return {
    list: list || [],
    loading: list === undefined,
    error: null,
    refresh: () => {},
    markReceived:  couponsRepo.markReceived,
    markScheduled: couponsRepo.markScheduled,
  };
}
