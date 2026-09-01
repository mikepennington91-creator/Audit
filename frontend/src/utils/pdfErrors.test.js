import { pdfErrorMessage } from './pdfErrors';

test('reads the API detail from a PDF error Blob', async () => {
  const error = { response: { data: { text: async () => JSON.stringify({ detail: 'The original audit template is no longer available.' }) } } };
  expect(await pdfErrorMessage(error)).toBe('The original audit template is no longer available.');
});

test('handles ordinary JSON errors and non-JSON server responses', async () => {
  expect(await pdfErrorMessage({ response: { data: { detail: 'Access denied' } } })).toBe('Access denied');
  expect(await pdfErrorMessage({ response: { data: { text: async () => '<html>Error</html>' } } }, 'Could not download')).toBe('Could not download');
  expect(await pdfErrorMessage({ message: 'Network Error' })).toBe('Failed to download PDF');
});
