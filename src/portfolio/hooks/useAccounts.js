import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { accounts as accountsRepo } from "../repository.js";

export function useAccounts() {
  const list = useLiveQuery(() => db.accounts.orderBy("name").toArray(), [], undefined);
  return {
    list: list || [],
    loading: list === undefined,
    error: null,
    refresh: () => {},
    add: accountsRepo.add,
    update: accountsRepo.update,
    remove: accountsRepo.remove,
  };
}
