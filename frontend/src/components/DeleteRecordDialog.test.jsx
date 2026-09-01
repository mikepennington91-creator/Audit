import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DeleteRecordDialog from './DeleteRecordDialog';
jest.mock('./ui/dialog', () => ({
  Dialog: ({ open, children }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}));
global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const enter = value => act(() => {
  const field = host.querySelector('textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
});
test('deletion requires a nonblank reason and submits the trimmed reason', async () => {
  const remove = jest.fn().mockResolvedValue();
  act(() => root.render(<DeleteRecordDialog record={{ id: 'one', audit_name: 'Weekly audit' }} onClose={() => {}} onDelete={remove} />));
  const button = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Delete record');
  expect(button().disabled).toBe(true);
  enter('   ');
  expect(button().disabled).toBe(true);
  enter('  Duplicate audit  ');
  expect(button().disabled).toBe(false);
  await act(async () => button().click());
  expect(remove).toHaveBeenCalledWith('Duplicate audit');
});
test('switching records clears the previous deletion reason', () => {
  const props = { onClose: () => {}, onDelete: () => {} };
  act(() => root.render(<DeleteRecordDialog record={{ id: 'one' }} {...props} />));
  enter('Wrong record');
  act(() => root.render(<DeleteRecordDialog record={{ id: 'two' }} {...props} />));
  expect(host.querySelector('textarea').value).toBe('');
});
