import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { pockets as pocketsRepo } from "../repository.js";

export function usePockets() {
  const list = useLiveQuery(() => db.pockets.orderBy("name").toArray(), [], undefined);
  return {
    list: list || [],
    loading: list === undefined,
    error: null,
    refresh: () => {},
    add: pocketsRepo.add,
    update: pocketsRepo.update,
    remove: pocketsRepo.remove,
  };
}
