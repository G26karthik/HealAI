import axios from 'axios';

// Relative base — Vite proxies /api to the Express server, so there is no CORS
// dance in dev and no hardcoded host to change before the demo.
export const api = axios.create({ baseURL: '/api', timeout: 20000 });

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const data = err.response?.data;
    const message = data?.error || err.message || 'Request failed';
    return Promise.reject(Object.assign(new Error(message), { status: err.response?.status, data }));
  }
);

export const getHealth = () => api.get('/health').then((r) => r.data);
export const getChaos = () => api.get('/chaos').then((r) => r.data);
export const setChaos = (flag, value) => api.post('/chaos', { flag, value }).then((r) => r.data);
export const resetChaos = () => api.post('/chaos/reset').then((r) => r.data);

export const createRequest = (body) => api.post('/requests', body).then((r) => r.data);
export const listRequests = (params) => api.get('/requests', { params }).then((r) => r.data);
export const getRequest = (id) => api.get(`/requests/${id}`).then((r) => r.data);
export const reviewRequest = (id, body) => api.post(`/requests/${id}/review`, body).then((r) => r.data);
export const getModelMetrics = () => api.get('/requests/model/metrics').then((r) => r.data);

export const getOptions = (requestId, kind) =>
  api.get('/assignments/options', { params: { requestId, kind } }).then((r) => r.data);
export const createAssignment = (body) => api.post('/assignments', body).then((r) => r.data);
export const getCapacity = () => api.get('/assignments/capacity').then((r) => r.data);
export const getFleet = (kinds = 'ambulance') =>
  api.get('/fleet', { params: { kinds } }).then((r) => r.data);
