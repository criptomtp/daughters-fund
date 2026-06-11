import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db.js";
import { persons as personsRepo, seedDefaultsIfEmpty } from "../repository.js";

const SEED_FLAG_KEY = "df_portfolio_seeded_v2";

export function usePersons() {
  useEffect(() => {
    if (!localStorage.getItem(SEED_FLAG_KEY)) {
      seedDefaultsIfEmpty()
        .then(() => localStorage.setItem(SEED_FLAG_KEY, "1"))
        .catch(() => {});
    }
  }, []);

  const list = useLiveQuery(() => db.persons.orderBy("name").toArray(), [], undefined);

  return {
    list: list || [],
    loading: list === undefined,
    error: null,
    refresh: () => {},
    add: personsRepo.add,
    update: personsRepo.update,
    remove: personsRepo.remove,
  };
}
