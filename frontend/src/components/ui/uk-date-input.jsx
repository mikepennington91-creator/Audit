import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { formatUKDate, ukDateToISO } from '../../utils/dates';
import { cn } from '../../lib/utils';

// Keep the existing Input API (ISO values/onChange) while always displaying UK dates.
export const UKDateInput = React.forwardRef(({ value = '', onChange, min, max, className, disabled, readOnly, ...props }, forwardedRef) => {
  const [text, setText] = React.useState(() => formatUKDate(value, ''));
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef(null);
  const lastValue = React.useRef(value);
  React.useImperativeHandle(forwardedRef, () => inputRef.current);

  React.useEffect(() => {
    if (value !== lastValue.current) {
      setText(formatUKDate(value, ''));
      lastValue.current = value;
    }
  }, [value]);

  React.useEffect(() => {
    const iso = ukDateToISO(text);
    const message = text && !iso ? 'Enter a valid date as DD/MM/YYYY.'
      : iso && min && iso < min ? `Date must be on or after ${formatUKDate(min)}.`
        : iso && max && iso > max ? `Date must be on or before ${formatUKDate(max)}.` : '';
    inputRef.current?.setCustomValidity(message);
  }, [text, min, max]);

  const change = (nextText) => {
    setText(nextText);
    const iso = ukDateToISO(nextText);
    lastValue.current = iso;
    const target = { value: iso, name: props.name, id: props.id, type: 'date' };
    onChange?.({ target, currentTarget: target });
  };
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;
  return <div className="relative">
    <input {...props} ref={inputRef} type="text" inputMode="numeric" lang="en-GB"
      placeholder="DD/MM/YYYY" maxLength={10} value={text} disabled={disabled} readOnly={readOnly}
      className={cn(className, 'pr-10')} onChange={(event) => change(event.target.value)} />
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Choose date${props.id ? ` for ${props.id}` : ''}`} disabled={disabled || readOnly}
          className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-muted-foreground disabled:opacity-50">
          <CalendarIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={selected} defaultMonth={selected} initialFocus
          disabled={(day) => {
            const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
            return !!((min && iso < min) || (max && iso > max));
          }}
          onSelect={(day) => {
            if (day) change(`${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}/${day.getFullYear()}`);
            else change('');
            setOpen(false);
          }} />
      </PopoverContent>
    </Popover>
  </div>;
});
UKDateInput.displayName = 'UKDateInput';
