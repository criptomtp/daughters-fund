import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { brokers as brokersRepo } from "../repository.js";

export function useBrokers() {
  const list = useLiveQuery(() => db.brokers.orderBy("name").toArray(), [], undefined);
  return {
    list: list || [],
    loading: list === undefined,
    error: null,
    refresh: () => {},
    add: brokersRepo.add,
    update: brokersRepo.update,
    remove: brokersRepo.remove,
  };
}
