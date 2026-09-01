import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UKDateInput } from './uk-date-input';

// Exercise the real date picker without depending on popup positioning.
jest.mock('./popover', () => ({
  Popover: ({ children }) => <>{children}</>,
  PopoverTrigger: ({ children }) => children,
  PopoverContent: ({ children }) => <>{children}</>,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const type = (value) => {
  const input = host.querySelector('input');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
};

test('UK entry emits ISO, retains invalid draft and blocks submission', () => {
  const changed = jest.fn();
  function Form() {
    const [value, setValue] = useState('2026-09-01');
    return <form><UKDateInput value={value} onChange={(event) => { changed(event.target.value); setValue(event.target.value); }} /></form>;
  }
  act(() => root.render(<Form />));
  expect(host.querySelector('input').value).toBe('01/09/2026');
  expect(type('31/02/2026').value).toBe('31/02/2026');
  expect(changed).toHaveBeenLastCalledWith('');
  expect(host.querySelector('form').checkValidity()).toBe(false);
  type('02/09/2026');
  expect(changed).toHaveBeenLastCalledWith('2026-09-02');
  expect(host.querySelector('form').checkValidity()).toBe(true);
});

test('minimum date is enforced and external resets update the displayed date', () => {
  act(() => root.render(<UKDateInput value="2026-09-01" min="2026-09-02" />));
  expect(host.querySelector('input').checkValidity()).toBe(false);
  act(() => root.render(<UKDateInput value="2026-09-03" min="2026-09-02" />));
  expect(host.querySelector('input').value).toBe('03/09/2026');
  expect(host.querySelector('input').checkValidity()).toBe(true);
});


test('calendar selection returns the same ISO value as UK text entry', () => {
  const changed = jest.fn();
  act(() => root.render(<UKDateInput value="2026-09-01" onChange={(event) => changed(event.target.value)} />));
  const day = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '15');
  act(() => day.click());
  expect(changed).toHaveBeenLastCalledWith('2026-09-15');
  expect(host.querySelector('input').value).toBe('15/09/2026');
});
