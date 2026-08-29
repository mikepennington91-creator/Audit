import axios from 'axios';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const emailExport = async ({ kind, resourceId, resourceIds = [], defaultEmail = '' }) => {
  const recipient = window.prompt('Email this report to:', defaultEmail);
  if (recipient === null) return false;
  if (!recipient.trim()) {
    toast.error('Enter an email address');
    return false;
  }
  try {
    const response = await axios.post(`${API}/exports/email`, {
      kind,
      resource_id: resourceId || null,
      resource_ids: resourceIds,
      recipient_email: recipient.trim(),
    });
    toast.success(response.data.message || 'Report emailed');
    return true;
  } catch (error) {
    toast.error(error.response?.data?.detail || 'Failed to email report');
    return false;
  }
};
