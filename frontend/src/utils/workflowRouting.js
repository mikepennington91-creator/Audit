import axios from 'axios';

let installed = false;

export const installWorkflowRouting = () => {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use((config) => {
    const method = (config.method || 'get').toLowerCase();
    const url = config.url || '';
    if (method !== 'put') return config;

    if (/\/api\/run-audits\/[^/?]+(?:\?.*)?$/.test(url)) {
      config.url = url.replace('/api/run-audits/', '/api/workflow/run-audits/');
      return config;
    }
    if (/\/api\/actions\/[^/?]+\/reassign(?:\?.*)?$/.test(url)) {
      config.url = url.replace('/api/actions/', '/api/workflow/actions/');
      return config;
    }
    if (/\/api\/actions\/[^/?]+(?:\?.*)?$/.test(url)) {
      config.url = url.replace('/api/actions/', '/api/workflow/actions/') + '/complete';
    }
    return config;
  });
};
