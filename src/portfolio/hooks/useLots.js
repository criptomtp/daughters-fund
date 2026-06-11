import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { lots as lotsRepo } from "../repository.js";

export function useLots({ accountId, isin } = {}) {
  const list = useLiveQuery(async () => {
    let all;
    if (accountId) all = await db.lots.where("accountId").equals(accountId).toArray();
    else if (isin) all = await db.lots.where("isin").equals(isin).toArray();
    else           all = await db.lots.orderBy("purchaseDate").toArray();

    if (accountId && isin) all = all.filter(l => l.isin === isin);
    return all.sort((a, b) => (a.purchaseDate || "").localeCompare(b.purchaseDate || ""));
  }, [accountId, isin], undefined);

  return {
    list: list || [],
    loading: list === undefined,
    error: null,
    refresh: () => {},
    add: lotsRepo.add,
    update: lotsRepo.update,
    remove: lotsRepo.remove,
  };
}
