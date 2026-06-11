import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { bonds as bondsRepo } from "../repository.js";

export function useBonds() {
  const list = useLiveQuery(() => db.bondReferences.orderBy("maturityDate").toArray(), [], undefined);
  return {
    list: list || [],
    loading: list === undefined,
    error: null,
    refresh: () => {},
    add: bondsRepo.add,
    update: bondsRepo.update,
    remove: bondsRepo.remove,
  };
}
