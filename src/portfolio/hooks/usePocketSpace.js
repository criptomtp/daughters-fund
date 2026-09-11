import { useEffect, useState } from "react";
import { usePockets } from "./usePockets.js";

// Активний простір — «Доньки» чи «Я». Вибір живе тут одним місцем, бо його
// читають усі екрани: фонд, історія, деталі й лист запису.

const KEY = "df_pocket";
const load = () => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };

export function usePocketSpace() {
  const { list: pockets } = usePockets();
  const [chosen, setChosen] = useState(load);

  // Збережений id не є правдою сам по собі: кишеню могли видалити в іншій
  // вкладці або на іншому пристрої після відновлення з бекапу. Тому активна
  // кишеня завжди звіряється зі списком, а не береться зі стану наосліп.
  const pocket = pockets.find(p => p.id === chosen) || pockets[0] || null;

  useEffect(() => {
    if (!pocket) return;
    try { localStorage.setItem(KEY, pocket.id); } catch { /* приватний режим */ }
  }, [pocket]);

  return { pockets, pocket, pocketId: pocket?.id || null, setPocketId: setChosen };
}
