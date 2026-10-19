const API_BASE = '/api';

export async function apiRequest(endpoint, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
    credentials: 'include', // sends HTTP-only session cookie
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = data.error || `HTTP error ${response.status}`;
    const errorObj = new Error(errorMsg);
    errorObj.data = data;
    errorObj.status = response.status;
    throw errorObj;
  }
  return data;
}

export const authApi = {
  getMe: () => apiRequest('/auth/me'),
  loginStaff: (credentials) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  loginPatron: (credentials) => apiRequest('/auth/patron-login', { method: 'POST', body: JSON.stringify(credentials) }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
};

export const catalogApi = {
  getBooks: (params) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/catalog/books?${query}`);
  },
  getBookByIsbn: (isbn) => apiRequest(`/catalog/books/${isbn}`),
  getCategories: () => apiRequest('/catalog/categories'),
  addBook: (bookData) => apiRequest('/catalog/books', { method: 'POST', body: JSON.stringify(bookData) }),
  updateBook: (isbn, bookData) => apiRequest(`/catalog/books/${isbn}`, { method: 'PUT', body: JSON.stringify(bookData) }),
  addCopies: (isbn, count) => apiRequest(`/catalog/books/${isbn}/copies`, { method: 'POST', body: JSON.stringify({ count }) }),
  updateCopyStatus: (accessionNumber, status, remarks) => 
    apiRequest(`/catalog/copies/${accessionNumber}/status`, { method: 'PATCH', body: JSON.stringify({ status, remarks }) }),
};

export const membersApi = {
  getMembers: (params) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/members?${query}`);
  },
  getMemberDetails: (membershipId) => apiRequest(`/members/${membershipId}`),
  registerMember: (memberData) => apiRequest('/members/register', { method: 'POST', body: JSON.stringify(memberData) }),
  updateMember: (membershipId, memberData) => apiRequest(`/members/${membershipId}`, { method: 'PUT', body: JSON.stringify(memberData) }),
  deactivateMember: (membershipId) => apiRequest(`/members/${membershipId}/deactivate`, { method: 'POST' }),
  reactivateMember: (membershipId) => apiRequest(`/members/${membershipId}/reactivate`, { method: 'POST' }),
};

export const circulationApi = {
  getActiveLoans: (params) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/circulation/loans?${query}`);
  },
  previewIssue: (membershipId, requestedDays) => apiRequest(`/circulation/issue/preview?${new URLSearchParams({ membershipId, ...(requestedDays ? { requestedDays } : {}) }).toString()}`),
  issueBook: (payload) => apiRequest('/circulation/issue', { method: 'POST', body: JSON.stringify(payload) }),
  returnBook: (payload) => apiRequest('/circulation/return', { method: 'POST', body: JSON.stringify(payload) }),
  payFine: (payload) => apiRequest('/circulation/fines/pay', { method: 'POST', body: JSON.stringify(payload) }),
  waiveFine: (payload) => apiRequest('/circulation/fines/waive', { method: 'POST', body: JSON.stringify(payload) }),
  reserveBook: (payload) => apiRequest('/circulation/reserve', { method: 'POST', body: JSON.stringify(payload) }),
  cancelReservation: (reservationId) => apiRequest(`/circulation/reserve/${reservationId}/cancel`, { method: 'POST' }),
};

export const reportsApi = {
  getInventoryReport: () => apiRequest('/reports/inventory'),
  getOverdueReport: () => apiRequest('/reports/overdue'),
  exportUrl: (type, params = {}) => `${API_BASE}/reports/export/${type}?${new URLSearchParams(params).toString()}`,
  getCirculationReport: (params) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/reports/circulation?${query}`);
  },
  getFinesReport: (params) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/reports/fines?${query}`);
  },
  getSettings: () => apiRequest('/reports/settings'),
  updateSettings: (settings) => apiRequest('/reports/settings', { method: 'PUT', body: JSON.stringify({ settings }) }),
};

export const requestsApi = {
  getPolicy: () => apiRequest('/requests/policy'),
  getMine: () => apiRequest('/requests/mine'),
  getAll: (status = 'All') => apiRequest(`/requests?${new URLSearchParams({ status }).toString()}`),
  create: (payload) => apiRequest('/requests', { method: 'POST', body: JSON.stringify(payload) }),
  review: (requestId, status, staffNote) => apiRequest(`/requests/${requestId}/review`, { method: 'PATCH', body: JSON.stringify({ status, staffNote }) }),
  cancel: (requestId) => apiRequest(`/requests/${requestId}/cancel`, { method: 'POST' }),
};

export const ledgerApi = {
  me: () => apiRequest('/ledger/me'),
  member: (membershipId) => apiRequest(`/ledger/members/${encodeURIComponent(membershipId)}`),
  book: (isbn) => apiRequest(`/ledger/books/${encodeURIComponent(isbn)}`),
};

export const reservationsApi = {
  getQueue: (params = {}) => apiRequest(`/circulation/reservations?${new URLSearchParams(params).toString()}`),
};
