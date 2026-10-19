import { CURRENCIES, currencyIcon, currencyName } from "../../lib/money";
import { Icon } from "../ui";

/** The currency the shop's prices are in. Used in shop setup and in Details. */
export function CurrencyField({ id, value, onChange }: { id: string; value: string; onChange: (code: string) => void }) {
  const codes: string[] = CURRENCIES.includes(value as (typeof CURRENCIES)[number]) ? [...CURRENCIES] : [value, ...CURRENCIES];
  return (
    <div className="field">
      <label className="mg-label" htmlFor={id}><Icon name={currencyIcon(value)} size={15} />Currency</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {codes.map((c) => <option key={c} value={c}>{currencyName(c)}</option>)}
      </select>
      <span className="tiny muted">Prices on your page show in this currency.</span>
    </div>
  );
}
