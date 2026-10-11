/** Dia no fuso do navegador, no formato "AAAA-MM-DD" usado pelos campos de data e pelos filtros de período. */
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
